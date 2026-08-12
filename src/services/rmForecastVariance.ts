/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Material, MRPResult, PurchaseOrder, Supplier } from '../types';

/**
 * Raw material forecast vs actual purchase orders.
 *
 * ── What counts as the forecast ─────────────────────────────────────────────
 * `MRPResult.planned_order_releases` -- by its own definition, "quantity that
 * must be ORDERED in this period to land a lead time later". That is already
 * an order forecast; nothing new needed to produce it.
 *
 * ── Why a frozen baseline, not a live one ───────────────────────────────────
 * Variance is measured against a specific, immutable MRP run. If it were
 * recomputed live, last month's variance would change every time someone
 * edited an old sales plan, and a variance report that rewrites its own
 * history is worse than no report -- people act on it. `mrp_results` rows are
 * already immutable per `run_id`, so the baseline is just "which run_id".
 *
 * ── Why TWO variances and not one ───────────────────────────────────────────
 * Collapsing these into a single number hides which team owns a gap, and lets
 * two opposite errors cancel into a healthy-looking zero:
 *
 *   forecastDrift  = current forecast - baseline forecast   (Planning)
 *     Demand, BOM or stock assumptions moved since the baseline was set.
 *
 *   orderVariance  = actual ordered - baseline forecast     (Procurement)
 *     We did or did not buy what the plan called for.
 *
 * A material whose demand dropped 20% while procurement under-ordered 20%
 * nets to zero on a combined figure and looks perfectly on plan. It is not.
 */

/** Why a material's ordering diverged from plan. Recorded per material per period. */
export type VarianceReasonCode =
  | 'supplier_moq'
  | 'price_break'
  | 'late_demand_change'
  | 'stock_correction'
  | 'substitution'
  | 'procurement_deferral'
  | 'other';

export type VarianceFlag =
  /** POs raised with no corresponding baseline forecast. */
  | 'unplanned'
  /** Baseline called for an order that was never raised. */
  | 'not_ordered'
  /** Both sides present. */
  | 'matched';

export type VarianceBand = 'on_plan' | 'watch' | 'off_plan' | 'none';

export interface VarianceRow {
  materialId: string;
  materialName: string;
  materialSku: string;
  supplierId: string;
  supplierName: string;
  unitCost: number;

  /** Frozen forecast: planned_order_releases from the baseline run. */
  baselineQty: number;
  /** Latest forecast, for drift only -- never the variance denominator. */
  currentForecastQty: number;
  /** Ordered quantity from POs raised in the period. */
  actualQty: number;

  /** currentForecastQty - baselineQty. Planning's number. */
  forecastDriftQty: number;
  /** actualQty - baselineQty. Procurement's number. */
  orderVarianceQty: number;

  /** Value equivalents at standard cost -- a 10% miss on pulp != on polybags. */
  baselineValue: number;
  actualValue: number;
  orderVarianceValue: number;

  /**
   * orderVarianceQty as a percentage of baseline.
   * Null when baseline is zero: there is no ratio against nothing, and
   * coercing it to 0 or Infinity is how a nonsense figure reaches a report.
   */
  orderVariancePct: number | null;

  flag: VarianceFlag;
  band: VarianceBand;
  /** PO numbers that matched, so every figure is traceable to documents. */
  matchedPoNumbers: string[];
}

export interface VarianceTotals {
  baselineValue: number;
  actualValue: number;
  varianceValue: number;
  /** Null when nothing was planned -- same reasoning as orderVariancePct. */
  variancePct: number | null;
  materialsOffPlan: number;
  materialsNotOrdered: number;
  materialsUnplanned: number;
}

export interface VarianceTolerance {
  /** Absolute % within which a material counts as on plan. */
  onPlanPct: number;
  /** Absolute % within which it is a watch item; beyond is off plan. */
  watchPct: number;
}

export const DEFAULT_VARIANCE_TOLERANCE: VarianceTolerance = {
  onPlanPct: 5,
  watchPct: 10,
};

export interface BuildVarianceInput {
  /** Frozen run. Rows outside `period` are ignored. */
  baselineResults: readonly MRPResult[];
  /** Latest run, for drift. Pass the baseline again if there is no newer run. */
  currentResults: readonly MRPResult[];
  purchaseOrders: readonly PurchaseOrder[];
  materials: readonly Material[];
  suppliers: readonly Supplier[];
  /** 'YYYY-MM' or 'YYYY-MM-DD'. */
  period: string;
  tolerance?: VarianceTolerance;
}

/** Month-prefix match, consistent with isInPeriod() elsewhere in the app. */
const inMonth = (date: string | undefined, period: string): boolean =>
  !!date && date.slice(0, 7) === period.slice(0, 7);

/**
 * Sum planned_order_releases per material for the period.
 *
 * A run may bucket by day, week or month; `week_start_date` holds whatever
 * period start the run used. Matching on the month prefix therefore rolls
 * weekly runs up into months without extra handling.
 */
function sumReleasesByMaterial(
  results: readonly MRPResult[],
  period: string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of results) {
    if (!inMonth(r.week_start_date, period)) continue;
    const qty = Number(r.planned_order_releases) || 0;
    out.set(r.material_id, (out.get(r.material_id) ?? 0) + qty);
  }
  return out;
}

/**
 * Sum ordered quantity per material for the period.
 *
 * Matched on `po_date` -- when the order was RAISED -- because
 * planned_order_releases is itself a release-date concept. Matching on
 * `required_date` would compare a release plan against a receipt date and
 * generate variance that is pure calendar misalignment.
 *
 * Uses `qty` (ordered), not `remaining_qty` or a received figure: this is a
 * PROCUREMENT variance. Whether goods then arrived is a supplier-performance
 * question, and conflating the two hides which team owns a gap.
 */
function sumOrderedByMaterial(
  purchaseOrders: readonly PurchaseOrder[],
  period: string,
): { qty: Map<string, number>; poNumbers: Map<string, string[]> } {
  const qty = new Map<string, number>();
  const poNumbers = new Map<string, string[]>();

  for (const po of purchaseOrders) {
    if (!inMonth(po.po_date, period)) continue;

    // A cancelled PO means nothing was bought, so it must not count as
    // ordered. PurchaseOrder has no 'cancelled' status today, which makes
    // this guard inert -- it exists so adding the status later is a schema
    // change plus nothing, rather than a hunt through the variance engine
    // for every place ordered quantity is summed.
    if ((po.status as string) === 'cancelled') continue;

    const amount = Number(po.qty) || 0;
    qty.set(po.material_id, (qty.get(po.material_id) ?? 0) + amount);
    const list = poNumbers.get(po.material_id) ?? [];
    list.push(po.order_no);
    poNumbers.set(po.material_id, list);
  }
  return { qty, poNumbers };
}

function bandFor(pct: number | null, tol: VarianceTolerance): VarianceBand {
  if (pct === null) return 'none';
  const abs = Math.abs(pct);
  if (abs <= tol.onPlanPct) return 'on_plan';
  if (abs <= tol.watchPct) return 'watch';
  return 'off_plan';
}

export function buildVarianceRows(input: BuildVarianceInput): VarianceRow[] {
  const {
    baselineResults, currentResults, purchaseOrders, materials, suppliers,
    period, tolerance = DEFAULT_VARIANCE_TOLERANCE,
  } = input;

  const baseline = sumReleasesByMaterial(baselineResults, period);
  const current = sumReleasesByMaterial(currentResults, period);
  const { qty: ordered, poNumbers } = sumOrderedByMaterial(purchaseOrders, period);

  const materialById = new Map(materials.map(m => [m.id, m]));
  const supplierById = new Map(suppliers.map(s => [s.id, s]));

  // Union of every material appearing on any side. A material planned but
  // never ordered, or ordered but never planned, is exactly what this report
  // exists to surface -- neither may be dropped for lacking a counterpart.
  const materialIds = new Set<string>([
    ...baseline.keys(), ...current.keys(), ...ordered.keys(),
  ]);

  const rows: VarianceRow[] = [];

  for (const materialId of materialIds) {
    const material = materialById.get(materialId);
    // A material referenced by a run or PO but absent from master data is a
    // data-integrity problem, not something to silently drop -- it still
    // shows, with its ID standing in for the name.
    const supplierId = material?.supplier_id ?? '';
    const unitCost = Number(material?.standard_cost) || 0;

    const baselineQty = baseline.get(materialId) ?? 0;
    const currentForecastQty = current.get(materialId) ?? 0;
    const actualQty = ordered.get(materialId) ?? 0;

    const orderVarianceQty = actualQty - baselineQty;
    const orderVariancePct = baselineQty > 0
      // Rounded to kill float noise: 110.00000000000001 style artefacts flip a
      // row across a tolerance boundary on representation error alone.
      ? Number(((orderVarianceQty / baselineQty) * 100).toFixed(6))
      : null;

    // Nothing planned and nothing ordered is not a variance -- it is a
    // material that simply had no activity this period. A run emits a row
    // per material per bucket including zeros, so without this every
    // dormant material would appear as a 'matched' row with 0 = 0 and bury
    // the handful of rows that actually need attention.
    if (baselineQty <= 0 && actualQty <= 0) continue;

    const flag: VarianceFlag =
      baselineQty <= 0 && actualQty > 0 ? 'unplanned'
      : baselineQty > 0 && actualQty <= 0 ? 'not_ordered'
      : 'matched';

    rows.push({
      materialId,
      materialName: material?.name ?? materialId,
      materialSku: material?.sku ?? '',
      supplierId,
      supplierName: supplierById.get(supplierId)?.name ?? '',
      unitCost,

      baselineQty,
      currentForecastQty,
      actualQty,

      forecastDriftQty: currentForecastQty - baselineQty,
      orderVarianceQty,

      baselineValue: baselineQty * unitCost,
      actualValue: actualQty * unitCost,
      orderVarianceValue: orderVarianceQty * unitCost,

      orderVariancePct,
      flag,
      band: bandFor(orderVariancePct, tolerance),
      matchedPoNumbers: poNumbers.get(materialId) ?? [],
    });
  }

  // Largest absolute value variance first: the figures worth a conversation
  // are the ones moving the most money, not the largest percentages on
  // trivial quantities.
  return rows.sort(
    (a, b) => Math.abs(b.orderVarianceValue) - Math.abs(a.orderVarianceValue),
  );
}

export function summariseVariance(rows: readonly VarianceRow[]): VarianceTotals {
  let baselineValue = 0;
  let actualValue = 0;
  let materialsOffPlan = 0;
  let materialsNotOrdered = 0;
  let materialsUnplanned = 0;

  for (const r of rows) {
    baselineValue += r.baselineValue;
    actualValue += r.actualValue;
    if (r.band === 'off_plan') materialsOffPlan += 1;
    if (r.flag === 'not_ordered') materialsNotOrdered += 1;
    if (r.flag === 'unplanned') materialsUnplanned += 1;
  }

  const varianceValue = actualValue - baselineValue;

  return {
    baselineValue,
    actualValue,
    varianceValue,
    variancePct: baselineValue > 0
      ? Number(((varianceValue / baselineValue) * 100).toFixed(6))
      : null,
    materialsOffPlan,
    materialsNotOrdered,
    materialsUnplanned,
  };
}

/**
 * Choose which MRP run is the baseline for a period.
 *
 * For a CLOSED month the answer is already recorded: `closed_periods.run_id`,
 * captured at the moment of close.
 *
 * For the OPEN month there is no close yet, so the baseline is the EARLIEST
 * run raised inside that month -- the plan as it stood when the month began.
 * The obvious alternative, carrying the previous close's run forward, would
 * compare this month's POs against last month's plan and measure the wrong
 * thing entirely.
 *
 * Returns null when the period contains no runs, so the caller can render an
 * empty state. Falling back to "no baseline" silently would report every
 * single PO as unplanned, which reads as a catastrophic variance rather than
 * as missing data.
 */
export function resolveBaselineRunId(
  allResults: readonly MRPResult[],
  period: string,
  closedPeriodRunId?: string | null,
): string | null {
  if (closedPeriodRunId) return closedPeriodRunId;

  let earliest: { runId: string; date: string } | null = null;
  for (const r of allResults) {
    if (!inMonth(r.week_start_date, period)) continue;
    const date = String(r.run_date ?? '');
    if (!earliest || date < earliest.date) earliest = { runId: r.run_id, date };
  }
  return earliest?.runId ?? null;
}

/** The most recent run touching a period, for the drift comparison. */
export function resolveCurrentRunId(
  allResults: readonly MRPResult[],
  period: string,
): string | null {
  let latest: { runId: string; date: string } | null = null;
  for (const r of allResults) {
    if (!inMonth(r.week_start_date, period)) continue;
    const date = String(r.run_date ?? '');
    if (!latest || date > latest.date) latest = { runId: r.run_id, date };
  }
  return latest?.runId ?? null;
}

/** Rows belonging to a single run. */
export function resultsForRun(
  allResults: readonly MRPResult[],
  runId: string | null,
): MRPResult[] {
  return runId ? allResults.filter(r => r.run_id === runId) : [];
}
