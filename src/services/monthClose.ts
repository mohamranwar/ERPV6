/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  supabase, isSupabaseConnected, readLocalTable, writeLocalTable, isInPeriod,
} from '../supabaseClient';
import { monthLabel } from '../utils/periods';
import { pcsPerCarton } from '../utils/uom';
import type { VarianceRow, VarianceTotals } from './rmForecastVariance';
import { toCsvText, downloadCsv } from '../utils/csv';
import type {
  Material, Product, ProductCategory, ProductionActual, ProductionPlan,
  PurchaseOrder, SalesActual, SalesPlan, Shipment, InventorySnapshot,
} from '../types';
import type { Thresholds } from '../hooks/useAppSettings';
import type {
  CategoryScorecard, PeriodScorecard, ReadinessCheck, ClosedPeriodRow,
} from '../components/MonthCloseScreen';

/**
 * Month-close service.
 *
 * Three responsibilities, in the order a close actually runs:
 *
 *   1. buildScorecard  — assemble the period position from live tables
 *   2. runReadiness    — decide whether closing now would bake in a gap
 *   3. writeSnapshot   — freeze it
 *
 * Everything reads through the same local-table / Supabase split the rest of
 * supabaseClient.ts uses, so the screen works offline exactly like the others.
 */

// ── Scorecard ───────────────────────────────────────────────────────────────

interface ScorecardInputs {
  period: string; // 'YYYY-MM-01'
  products: Product[];
  categories: ProductCategory[];
  materials: Material[];
  salesPlans: SalesPlan[];
  salesActuals: SalesActual[];
  productionPlans: ProductionPlan[];
  productionActuals: ProductionActual[];
  purchaseOrders: PurchaseOrder[];
  shipments: Shipment[];
  inventory: InventorySnapshot[];
}

export function readScorecardInputs(period: string): ScorecardInputs {
  return {
    period,
    products: readLocalTable<Product>('products'),
    categories: readLocalTable<ProductCategory>('product_categories'),
    materials: readLocalTable<Material>('materials'),
    salesPlans: readLocalTable<SalesPlan>('sales_plan'),
    salesActuals: readLocalTable<SalesActual>('sales_actuals'),
    productionPlans: readLocalTable<ProductionPlan>('production_plan'),
    productionActuals: readLocalTable<ProductionActual>('production_actuals'),
    purchaseOrders: readLocalTable<PurchaseOrder>('purchase_orders'),
    shipments: readLocalTable<Shipment>('shipments'),
    inventory: readLocalTable<InventorySnapshot>('inventory_snapshots'),
  };
}

function sumByProduct<
  T extends { product_id: string; quantity: number; period_start: string },
>(
  rows: readonly T[],
  inPeriod: (r: T) => boolean,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!inPeriod(r)) continue;
    out.set(r.product_id, (out.get(r.product_id) ?? 0) + (Number(r.quantity) || 0));
  }
  return out;
}

/**
 * Category rows with one pack divisor each.
 *
 * A category mixing different pack sizes gets `pcsPerCarton: null`: summing
 * pieces and dividing by one product's pack size would print a confident but
 * wrong carton figure. The screen shows "no pack configuration" for these,
 * which is the honest answer.
 */
function buildCategories(inp: ScorecardInputs): CategoryScorecard[] {
  const inMonth = (r: { period_start: string }) => isInPeriod(r.period_start, inp.period);

  const salesPlan = sumByProduct(inp.salesPlans, inMonth);
  const salesActual = sumByProduct(inp.salesActuals, inMonth);
  const prodPlan = sumByProduct(inp.productionPlans, inMonth);
  const prodActual = sumByProduct(inp.productionActuals, inMonth);

  // FG stock: latest snapshot per product on or before month end.
  const monthEndPrefix = inp.period.slice(0, 7);
  const fgStock = new Map<string, number>();
  const latest = new Map<string, string>();
  for (const s of inp.inventory) {
    if (s.item_type !== 'product') continue;
    if (s.snapshot_date.slice(0, 7) > monthEndPrefix) continue;
    const prev = latest.get(s.item_id);
    if (!prev || s.snapshot_date > prev) {
      latest.set(s.item_id, s.snapshot_date);
      fgStock.set(s.item_id, Number(s.quantity) || 0);
    }
  }

  return inp.categories.map(cat => {
    const items = inp.products.filter(p => p.category_id === cat.id);

    let per: number | null = null;
    let mixed = false;
    for (const p of items) {
      const v = pcsPerCarton(p);
      if (v === null) { mixed = true; break; }
      if (per === null) per = v;
      else if (per !== v) { mixed = true; break; }
    }

    const sum = (m: Map<string, number>) =>
      items.reduce((acc, p) => acc + (m.get(p.id) ?? 0), 0);

    return {
      categoryId: cat.id,
      categoryName: cat.name,
      pcsPerCarton: mixed ? null : per,
      salesPlanPcs: sum(salesPlan),
      salesActualPcs: sum(salesActual),
      prodPlanPcs: sum(prodPlan),
      prodActualPcs: sum(prodActual),
      fgStockPcs: sum(fgStock),
    };
  });
}

export function buildScorecard(inp: ScorecardInputs): PeriodScorecard {
  const categories = buildCategories(inp);
  const monthPrefix = inp.period.slice(0, 7);

  // ── RM value coverage ────────────────────────────────────────────────────
  // Inventory value = latest material snapshot × unit cost. Consumption value
  // approximated from this month's production actuals is a deeper BOM
  // explosion than belongs here, so consumption uses the materials' recorded
  // monthly usage where present. Where the dataset has no usage figure the
  // material contributes zero and the readiness check calls it out.
  // Material carries `standard_cost` and `max_usage` (max monthly usage).
  // max_usage is the conservative consumption figure the coverage screens
  // already plan against, so value coverage uses the same basis.
  const matCost = new Map(inp.materials.map(m => [m.id, Number(m.standard_cost) || 0]));
  const matUsage = new Map(inp.materials.map(m => [m.id, Number(m.max_usage) || 0]));

  let rmInventoryValue = 0;
  const latestMat = new Map<string, string>();
  const matQty = new Map<string, number>();
  for (const s of inp.inventory) {
    if (s.item_type !== 'material') continue;
    if (s.snapshot_date.slice(0, 7) > monthPrefix) continue;
    const prev = latestMat.get(s.item_id);
    if (!prev || s.snapshot_date > prev) {
      latestMat.set(s.item_id, s.snapshot_date);
      matQty.set(s.item_id, Number(s.quantity) || 0);
    }
  }
  for (const [id, qty] of matQty) rmInventoryValue += qty * (matCost.get(id) ?? 0);

  let rmConsumptionValue = 0;
  for (const [id, usage] of matUsage) rmConsumptionValue += usage * (matCost.get(id) ?? 0);

  // In transit: not yet arrived at the factory, valued at cost.
  // `factory_arrival_date` is the authoritative landed signal — a shipment
  // with an arrival date on or before month end has landed. Where it is null
  // the shipment is still moving, whatever its ETA said.
  const monthEndKey = `${monthPrefix}-31`;
  let rmInTransitValue = 0;
  for (const sh of inp.shipments) {
    const arrived = sh.factory_arrival_date;
    if (arrived && arrived <= monthEndKey) continue; // landed
    rmInTransitValue += (Number(sh.qty) || 0) * (matCost.get(sh.material_id) ?? 0);
  }

  // ── PO position ──────────────────────────────────────────────────────────
  const monthEnd = `${monthPrefix}-31`;
  const open = inp.purchaseOrders.filter(po => po.status !== 'completed');
  const delayed = open.filter(po => po.required_date && po.required_date <= monthEnd);
  const raised = inp.purchaseOrders.filter(po => po.po_date?.slice(0, 7) === monthPrefix);
  const closed = inp.purchaseOrders.filter(po =>
    po.status === 'completed' &&
    ((po.revised_delivery_date ?? po.original_delivery_date ?? '').slice(0, 7) === monthPrefix));
  const poOpenValue = open.reduce(
    (acc, po) => acc + (Number(po.remaining_qty) || 0) * (Number(po.unit_price) || 0), 0);

  // ── Containers ───────────────────────────────────────────────────────────
  const monthShipments = inp.shipments.filter(sh =>
    (sh.port_eta ?? sh.etd ?? '').slice(0, 7) === monthPrefix);
  const count = (pred: (s: Shipment) => boolean) =>
    monthShipments.filter(pred).reduce((a, s) => a + (Number(s.container_count) || 1), 0);

  const containersTotal = count(() => true);
  const containersSea = count(s => s.ship_method === 'sea');
  const containersAir = count(s => s.ship_method === 'air');
  const containersLand = count(s => s.ship_method === 'land');
  // Cleared = arrived at the factory. `factory_arrival_date` is the explicit
  // signal; a shipment without one is still at port or at sea, which errs on
  // the cautious side for the "still at port" count.
  const cleared = monthShipments.filter(s => !!s.factory_arrival_date);
  const containersCleared = cleared.reduce((a, s) => a + (Number(s.container_count) || 1), 0);
  const clearanceDays = monthShipments
    .map(s => Number(s.customs_clearance_days))
    .filter(d => Number.isFinite(d) && d > 0);

  const totalsPcs = categories.reduce(
    (acc, c) => ({
      fg: acc.fg + c.fgStockPcs,
      sales: acc.sales + c.salesActualPcs,
    }),
    { fg: 0, sales: 0 },
  );

  return {
    period: inp.period,
    rmInventoryValue,
    rmConsumptionValue,
    rmInTransitValue,
    fgStockPcs: totalsPcs.fg,
    fgSalesPcs: totalsPcs.sales,
    poTotal: open.length,
    poDelayed: delayed.length,
    poRaised: raised.length,
    poClosed: closed.length,
    poOpenValue,
    containersTotal,
    containersSea,
    containersAir,
    containersLand,
    containersCleared,
    containersAtPort: Math.max(containersTotal - containersCleared, 0),
    avgClearanceDays: clearanceDays.length
      ? clearanceDays.reduce((a, b) => a + b, 0) / clearanceDays.length : 0,
    categories,
  };
}

// ── Readiness ───────────────────────────────────────────────────────────────

/**
 * The gate. `fail` blocks the close outright; `warn` is recorded into the
 * snapshot so a later reviewer can see what was accepted.
 *
 * Blockers are deliberately few and unarguable. A long fussy checklist gets
 * overridden as a habit, and then it protects nothing.
 */
export function runReadiness(inp: ScorecardInputs, sc: PeriodScorecard): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];
  const monthPrefix = inp.period.slice(0, 7);

  // 1. Sales actuals must exist for the month.
  const hasSalesActuals = inp.salesActuals.some(r => isInPeriod(r.period_start, inp.period));
  checks.push(hasSalesActuals
    ? { id: 'sales', severity: 'pass', title: 'Sales actuals posted', detail: `Actuals exist for ${monthLabel(inp.period)}.` }
    : { id: 'sales', severity: 'fail', title: 'No sales actuals for this month',
        detail: 'Closing without actuals writes zeros into permanent history, and every future chart inherits them.' });

  // 2. Production actuals must exist.
  const hasProdActuals = inp.productionActuals.some(r => isInPeriod(r.period_start, inp.period));
  checks.push(hasProdActuals
    ? { id: 'prod', severity: 'pass', title: 'Production actuals posted', detail: `Actuals exist for ${monthLabel(inp.period)}.` }
    : { id: 'prod', severity: 'fail', title: 'No production actuals for this month',
        detail: 'Post production actuals before closing.' });

  // 3. Open POs need a required date, or they cannot be flagged as delayed.
  const noDate = inp.purchaseOrders.filter(po => po.status !== 'completed' && !po.required_date);
  checks.push(noDate.length === 0
    ? { id: 'po_dates', severity: 'pass', title: 'All open POs have a required date', detail: 'Delay flags are computable.' }
    : { id: 'po_dates', severity: 'fail',
        title: `${noDate.length} open ${noDate.length === 1 ? 'PO has' : 'POs have'} no required date`,
        detail: `${noDate.slice(0, 3).map(p => p.order_no).join(', ')}${noDate.length > 3 ? '…' : ''} cannot be netted or flagged as delayed.` });

  // 4. Materials without a cost undercount RM coverage. Warn, not block —
  //    valuation gaps are common early on and the figure is still directionally
  //    useful, but the snapshot records that it was incomplete.
  const uncosted = inp.materials.filter(m => !(Number(m.standard_cost) > 0));
  if (uncosted.length > 0) {
    checks.push({ id: 'rm_cost', severity: 'warn',
      title: `${uncosted.length} materials have no unit cost`,
      detail: 'They contribute zero to RM coverage value, so coverage is understated.' });
  } else {
    checks.push({ id: 'rm_cost', severity: 'pass', title: 'All materials costed', detail: 'RM valuation is complete.' });
  }

  // 5. Carton configuration gaps. Warn: the piece figures are still exact.
  const unconfigured = sc.categories.filter(c => c.pcsPerCarton === null);
  if (unconfigured.length > 0) {
    checks.push({ id: 'pack', severity: 'warn',
      title: `${unconfigured.length} ${unconfigured.length === 1 ? 'category lacks' : 'categories lack'} a single pack configuration`,
      detail: `${unconfigured.map(c => c.categoryName).join(', ')} — carton figures unavailable; pieces are unaffected.` });
  }

  // 6. Containers still at port carry forward. Informational.
  if (sc.containersAtPort > 0) {
    checks.push({ id: 'port', severity: 'warn',
      title: `${sc.containersAtPort} containers still at port`,
      detail: `They carry into the next month as opening in-transit.` });
  }

  return checks;
}

// ── Snapshot write ──────────────────────────────────────────────────────────

const LOCAL_SNAPSHOTS = 'period_snapshots';

export interface WriteSnapshotArgs {
  scorecard: PeriodScorecard;
  readiness: ReadinessCheck[];
  thresholds: Thresholds;
  userId: string;
  mrpRunId?: string;
  /** Variance rows at the moment of close. Frozen so re-running MRP cannot change history. */
  varianceRows?: readonly VarianceRow[];
  varianceTotals?: VarianceTotals;
  /** Which MRP run was the variance baseline. May differ from mrpRunId. */
  varianceBaselineRunId?: string | null;
}

/**
 * Freeze the month.
 *
 * The row stores pieces plus each category's pack count, the thresholds in
 * force, and the readiness result. It is written locally first and then to
 * Supabase — same order as every other write in the app, so an offline close
 * still lands and syncs later.
 */
export async function writeSnapshot(args: WriteSnapshotArgs): Promise<void> {
  const { scorecard: sc, readiness, thresholds, userId, mrpRunId,
    varianceRows, varianceTotals, varianceBaselineRunId } = args;

  const salesPlan = sc.categories.reduce((a, c) => a + c.salesPlanPcs, 0);
  const salesActual = sc.categories.reduce((a, c) => a + c.salesActualPcs, 0);
  const prodPlan = sc.categories.reduce((a, c) => a + c.prodPlanPcs, 0);
  const prodActual = sc.categories.reduce((a, c) => a + c.prodActualPcs, 0);

  const row = {
    id: `PS-${sc.period.slice(0, 7)}`,
    period: sc.period,
    status: 'closed' as const,
    closed_at: new Date().toISOString(),
    closed_by: userId,
    reopen_count: 0,

    rm_inventory_value: sc.rmInventoryValue,
    rm_consumption_value: sc.rmConsumptionValue,
    rm_in_transit_value: sc.rmInTransitValue,
    rm_coverage_months: sc.rmConsumptionValue > 0 ? sc.rmInventoryValue / sc.rmConsumptionValue : 0,
    rm_coverage_total: sc.rmConsumptionValue > 0
      ? (sc.rmInventoryValue + sc.rmInTransitValue) / sc.rmConsumptionValue : 0,

    fg_stock_pcs: sc.fgStockPcs,
    fg_sales_pcs: sc.fgSalesPcs,
    fg_coverage_months: sc.fgSalesPcs > 0 ? sc.fgStockPcs / sc.fgSalesPcs : 0,

    po_total: sc.poTotal,
    po_delayed: sc.poDelayed,
    po_raised: sc.poRaised,
    po_closed: sc.poClosed,
    po_open_value: sc.poOpenValue,

    containers_total: sc.containersTotal,
    containers_sea: sc.containersSea,
    containers_air: sc.containersAir,
    containers_land: sc.containersLand,
    containers_cleared: sc.containersCleared,
    containers_at_port: sc.containersAtPort,
    avg_clearance_days: sc.avgClearanceDays,

    sales_plan_pcs: salesPlan,
    sales_actual_pcs: salesActual,
    prod_plan_pcs: prodPlan,
    prod_actual_pcs: prodActual,

    category_breakdown: sc.categories.map(c => ({
      category_id: c.categoryId,
      category_name: c.categoryName,
      pcs_per_carton: c.pcsPerCarton,
      sales_plan_pcs: c.salesPlanPcs,
      sales_actual_pcs: c.salesActualPcs,
      prod_plan_pcs: c.prodPlanPcs,
      prod_actual_pcs: c.prodActualPcs,
      fg_stock_pcs: c.fgStockPcs,
    })),

    thresholds_applied: thresholds,
    readiness: readiness.map(r => ({ id: r.id, severity: r.severity, title: r.title })),
    mrp_run_id: mrpRunId ?? null,

    // Variance freeze. Stored as JSONB so re-running MRP or editing an old PO
    // cannot rewrite what was true at the moment of close. A variance report
    // that silently changes its own history is worse than useless.
    variance_baseline_value: varianceTotals?.baselineValue ?? 0,
    variance_actual_value:   varianceTotals?.actualValue   ?? 0,
    variance_value:          varianceTotals?.varianceValue  ?? 0,
    variance_pct:            varianceTotals?.variancePct    ?? null,
    variance_off_plan_count:     varianceTotals?.materialsOffPlan    ?? 0,
    variance_not_ordered_count:  varianceTotals?.materialsNotOrdered ?? 0,
    variance_unplanned_count:    varianceTotals?.materialsUnplanned  ?? 0,
    variance_detail: (varianceRows ?? []).map(r => ({
      materialId: r.materialId, materialSku: r.materialSku,
      materialName: r.materialName, supplierId: r.supplierId,
      baselineQty: r.baselineQty, currentForecastQty: r.currentForecastQty,
      actualQty: r.actualQty, forecastDriftQty: r.forecastDriftQty,
      orderVarianceQty: r.orderVarianceQty, orderVariancePct: r.orderVariancePct,
      baselineValue: r.baselineValue, actualValue: r.actualValue,
      orderVarianceValue: r.orderVarianceValue,
      flag: r.flag, band: r.band, matchedPoNumbers: r.matchedPoNumbers,
    })),
    variance_baseline_run_id: varianceBaselineRunId ?? null,

    row_counts: {},
  };

  // Local first — an offline close must still land.
  const existing = readLocalTable<typeof row>(LOCAL_SNAPSHOTS)
    .filter(r => r.period !== row.period);
  writeLocalTable(LOCAL_SNAPSHOTS, [...existing, row]);

  if (isSupabaseConnected() && supabase) {
    const { error } = await supabase
      .from('period_snapshots')
      .upsert(row, { onConflict: 'period' });
    if (error) {
      // The local write already succeeded; surfacing the sync failure is the
      // caller's job. Swallowing it here would hide a split-brain state.
      throw new Error(`Snapshot saved locally but failed to sync: ${error.message}`);
    }
  }
}

export function readSnapshotHistory(): ClosedPeriodRow[] {
  const rows = readLocalTable<any>(LOCAL_SNAPSHOTS);
  return rows
    .map(r => ({
      period: r.period,
      status: r.status ?? 'closed',
      salesActualPcs: Number(r.sales_actual_pcs) || 0,
      prodActualPcs: Number(r.prod_actual_pcs) || 0,
      rmCoverageMonths: Number(r.rm_coverage_months) || 0,
      fgCoverageMonths: Number(r.fg_coverage_months) || 0,
      poDelayed: Number(r.po_delayed) || 0,
      containersTotal: Number(r.containers_total) || 0,
      attainmentPct: Number(r.sales_plan_pcs) > 0
        ? (Number(r.sales_actual_pcs) / Number(r.sales_plan_pcs)) * 100 : 0,
      closedBy: r.closed_by ?? '',
    }))
    .sort((a, b) => b.period.localeCompare(a.period));
}

// ── Exports ─────────────────────────────────────────────────────────────────

/**
 * Export one closed month: scorecard totals plus the category breakdown.
 * Reads the SNAPSHOT, not live tables — the export of a closed month must
 * match what was frozen even if someone has edited the plans since.
 */
export function exportPeriodCsv(period: string): void {
  const snap = readLocalTable<any>(LOCAL_SNAPSHOTS).find(r => r.period === period);
  if (!snap) return;

  const headers = [
    'Section', 'Category', 'Pcs per carton',
    'Sales plan (pcs)', 'Sales actual (pcs)',
    'Production plan (pcs)', 'Production actual (pcs)',
    'FG stock (pcs)',
  ];

  const rows: unknown[][] = (snap.category_breakdown ?? []).map((c: any) => [
    'Category', c.category_name, c.pcs_per_carton ?? 'not configured',
    c.sales_plan_pcs, c.sales_actual_pcs,
    c.prod_plan_pcs, c.prod_actual_pcs,
    c.fg_stock_pcs,
  ]);

  rows.push(
    ['Total', '', '', snap.sales_plan_pcs, snap.sales_actual_pcs,
      snap.prod_plan_pcs, snap.prod_actual_pcs, snap.fg_stock_pcs],
    [], // spacer
    ['RM coverage (months, stock only)', snap.rm_coverage_months],
    ['RM coverage (months, incl. transit)', snap.rm_coverage_total],
    ['FG coverage (months)', snap.fg_coverage_months],
    ['Open POs', snap.po_total], ['Delayed POs', snap.po_delayed],
    ['Containers', snap.containers_total], ['Cleared', snap.containers_cleared],
    ['Closed at', snap.closed_at], ['Closed by', snap.closed_by],
  );

  downloadCsv(toCsvText(headers, rows), `month-close-${period.slice(0, 7)}.csv`);
}

/** Export the live MPS / production plan / MRP for the open month. */
export function exportPlanningDataCsv(period: string): void {
  const monthPrefix = period.slice(0, 7);
  const products = new Map(readLocalTable<Product>('products').map(p => [p.id, p]));

  const sales = readLocalTable<SalesPlan>('sales_plan')
    .filter(r => r.period_start.slice(0, 7) === monthPrefix);
  const production = readLocalTable<ProductionPlan>('production_plan')
    .filter(r => r.period_start.slice(0, 7) === monthPrefix);
  const mrp = readLocalTable<any>('mrp_results')
    .filter(r => (r.period_start ?? r.period ?? '').slice(0, 7) === monthPrefix);

  const headers = ['Type', 'Product / Material', 'SKU', 'Period', 'Quantity (pcs)'];
  const rows: unknown[][] = [
    ...sales.map(r => ['Sales plan', products.get(r.product_id)?.name ?? r.product_id,
      products.get(r.product_id)?.sku ?? '', r.period_start, r.quantity]),
    ...production.map(r => ['Production plan', products.get(r.product_id)?.name ?? r.product_id,
      products.get(r.product_id)?.sku ?? '', r.period_start, r.quantity]),
    ...mrp.map(r => ['MRP', r.material_id ?? '', '', r.period_start ?? r.period ?? '',
      r.net_requirement ?? r.quantity ?? '']),
  ];

  downloadCsv(toCsvText(headers, rows), `planning-data-${monthPrefix}.csv`);
}
