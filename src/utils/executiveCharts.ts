/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { bucketSum, trailingMonths, windowCaption, type PeriodBucket } from './periods';
import type {
  InventorySnapshot, Material, ProductionActual, ProductionPlan,
  PurchaseOrder, SalesActual, SalesPlan,
} from '../types';

/**
 * Executive chart series, derived from live data.
 *
 * ── What this replaces, and why it mattered ─────────────────────────────────
 * `computeExecutiveChartData` in ExecutiveCharts.tsx mapped over a hardcoded
 * seed (`EXECUTIVE_CHART_DATA`) and overwrote entries where it could find a
 * match. That design had four separate ways of showing invented numbers, none
 * of which surfaced an error:
 *
 *   1. MONTH_MAP covered only 2025-06 to 2026-05. Any month outside that range
 *      found no key and returned the seed row untouched.
 *
 *   2. Within range, the guard was `actualQty > 0 ? real : item.BC`. A month
 *      with genuinely zero sales is indistinguishable from a lookup miss, so a
 *      real zero was replaced by a demo figure.
 *
 *   3. RM coverage divided by `const avgDemand = 250000` — a magic constant
 *      unrelated to any material's actual consumption.
 *
 *   4. `fgStockCoverage` and `fgStkVsSales` were never computed at all. They
 *      were `[...EXECUTIVE_CHART_DATA.x]` — pure seed, always, in every state
 *      of the database.
 *
 * The captions still read "Jul-25 to May-26" throughout. Two of six charts on
 * the executive dashboard have therefore never shown real data, and the other
 * four stopped in June 2026.
 *
 * ── The rule here ───────────────────────────────────────────────────────────
 * A value is either computed from real rows or it is `null`. There is no
 * fallback. A gap renders as a gap and the caption says how many months are
 * missing — an empty chart that admits it is worth more than a full one that
 * lies, particularly on a projector in front of the board.
 */

/** Actual (BC) and plan (FC), in millions of pieces. */
export interface VolumePoint {
  month: string;
  BC: number | null;
  FC: number | null;
}

/** Coverage in months against a target. */
export interface CoveragePoint {
  month: string;
  coverage: number | null;
  target: number;
}

/** Stock, usage and incoming PO, in thousands of base units. */
export interface StockFlowPoint {
  month: string;
  STK: number | null;
  Usage: number | null;
  PO: number | null;
}

/** Finished goods stock against sales, in millions of pieces. */
export interface StockVsSalesPoint {
  month: string;
  STK: number | null;
  Sales: number | null;
}

export interface ExecutiveChartData {
  salesByPcs: VolumePoint[];
  productionByPcs: VolumePoint[];
  rmCoverageMonths: CoveragePoint[];
  rmStockUsagePo: StockFlowPoint[];
  fgStockCoverage: CoveragePoint[];
  fgStkVsSales: StockVsSalesPoint[];
  /** "Sep-25 to Aug-26", derived — never a literal. */
  caption: string;
  /** Months in the window with no underlying rows at all. */
  monthsWithoutData: number;
  /** True when nothing could be computed. Render an empty state, not a chart. */
  isEmpty: boolean;
}

export interface ExecutiveChartInputs {
  /** Open planning period, 'YYYY-MM' or 'YYYY-MM-DD'. */
  anchor: string;
  months?: number;
  salesPlans?: readonly SalesPlan[];
  salesActuals?: readonly SalesActual[];
  productionPlans?: readonly ProductionPlan[];
  productionActuals?: readonly ProductionActual[];
  inventory?: readonly InventorySnapshot[];
  purchaseOrders?: readonly PurchaseOrder[];
  materials?: readonly Material[];
  /** Coverage targets. Defaults match the shipped thresholds. */
  rmCoverageTarget?: number;
  fgCoverageTarget?: number;
}

const MILLION = 1_000_000;
const THOUSAND = 1_000;

/** Round for display without letting float noise reach a label. */
const round = (v: number, dp = 1): number => Number(v.toFixed(dp));

/**
 * Zero is a real value; absence is not.
 *
 * `bucketSum` returns 0 both for "this month totalled zero" and "this month
 * had no rows". The two must render differently — one is a fact, the other is
 * a hole — so presence is tracked separately rather than inferred from the sum.
 */
function bucketHasRows<T extends { [k: string]: unknown }>(
  rows: readonly T[],
  buckets: readonly PeriodBucket[],
  dateField: keyof T,
): boolean[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const raw = row[dateField];
    if (typeof raw === 'string' && raw.length >= 7) seen.add(raw.slice(0, 7));
  }
  return buckets.map(b => seen.has(b.key));
}

/** Latest snapshot value per item, on or before each bucket's month. */
function stockAtEachMonth(
  snapshots: readonly InventorySnapshot[],
  buckets: readonly PeriodBucket[],
  itemType: 'product' | 'material',
): (number | null)[] {
  const relevant = snapshots
    .filter(s => s.item_type === itemType && typeof s.snapshot_date === 'string')
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));

  return buckets.map(b => {
    const latestPerItem = new Map<string, number>();
    let sawAny = false;
    for (const s of relevant) {
      if (s.snapshot_date.slice(0, 7) > b.key) break; // sorted, so stop early
      latestPerItem.set(s.item_id, Number(s.quantity) || 0);
      sawAny = true;
    }
    if (!sawAny) return null;
    let total = 0;
    for (const qty of latestPerItem.values()) total += qty;
    return total;
  });
}

export function computeExecutiveChartData(inp: ExecutiveChartInputs): ExecutiveChartData {
  const {
    anchor, months = 12,
    salesPlans = [], salesActuals = [],
    productionPlans = [], productionActuals = [],
    inventory = [], purchaseOrders = [], materials = [],
    rmCoverageTarget = 3, fgCoverageTarget = 1.5,
  } = inp;

  const buckets = trailingMonths(anchor, months);
  const labels = buckets.map(b => b.label);

  // ── 1 & 2. Sales and production volume ──────────────────────────────────
  const salesActualPcs = bucketSum(salesActuals as any[], buckets, 'period_start', 'quantity');
  const salesPlanPcs = bucketSum(salesPlans as any[], buckets, 'period_start', 'quantity');
  const prodActualPcs = bucketSum(productionActuals as any[], buckets, 'period_start', 'quantity');
  const prodPlanPcs = bucketSum(productionPlans as any[], buckets, 'period_start', 'quantity');

  const hasSalesActual = bucketHasRows(salesActuals as any[], buckets, 'period_start');
  const hasSalesPlan = bucketHasRows(salesPlans as any[], buckets, 'period_start');
  const hasProdActual = bucketHasRows(productionActuals as any[], buckets, 'period_start');
  const hasProdPlan = bucketHasRows(productionPlans as any[], buckets, 'period_start');

  const salesByPcs: VolumePoint[] = labels.map((month, i) => ({
    month,
    BC: hasSalesActual[i] ? round(salesActualPcs[i] / MILLION) : null,
    FC: hasSalesPlan[i] ? round(salesPlanPcs[i] / MILLION) : null,
  }));

  const productionByPcs: VolumePoint[] = labels.map((month, i) => ({
    month,
    BC: hasProdActual[i] ? round(prodActualPcs[i] / MILLION) : null,
    FC: hasProdPlan[i] ? round(prodPlanPcs[i] / MILLION) : null,
  }));

  // ── 3 & 4. Raw material ─────────────────────────────────────────────────
  // Coverage is value-based — inventory value over monthly consumption value —
  // so the dashboard and the month-close scorecard report the same number.
  // The old code divided a raw quantity by a hardcoded 250000, which agreed
  // with nothing.
  const cost = new Map(materials.map(m => [m.id, Number(m.standard_cost) || 0]));
  const usage = new Map(materials.map(m => [m.id, Number(m.max_usage) || 0]));

  let monthlyConsumptionValue = 0;
  let monthlyConsumptionQty = 0;
  for (const m of materials) {
    const u = Number(m.max_usage) || 0;
    monthlyConsumptionQty += u;
    monthlyConsumptionValue += u * (Number(m.standard_cost) || 0);
  }

  const rmStockQty = stockAtEachMonth(inventory, buckets, 'material');

  // Value the stock month by month using the same per-item cost table.
  const rmStockValue = buckets.map((b, i) => {
    if (rmStockQty[i] === null) return null;
    const latest = new Map<string, number>();
    for (const s of inventory) {
      if (s.item_type !== 'material') continue;
      if (s.snapshot_date.slice(0, 7) > b.key) continue;
      latest.set(s.item_id, Number(s.quantity) || 0);
    }
    let value = 0;
    for (const [id, qty] of latest) value += qty * (cost.get(id) ?? 0);
    return value;
  });

  const rmCoverageMonths: CoveragePoint[] = labels.map((month, i) => ({
    month,
    coverage: rmStockValue[i] !== null && monthlyConsumptionValue > 0
      ? round(rmStockValue[i]! / monthlyConsumptionValue, 2)
      : null,
    target: rmCoverageTarget,
  }));

  const poQty = bucketSum(purchaseOrders as any[], buckets, 'po_date', 'qty');
  const hasPo = bucketHasRows(purchaseOrders as any[], buckets, 'po_date');

  const rmStockUsagePo: StockFlowPoint[] = labels.map((month, i) => ({
    month,
    STK: rmStockQty[i] !== null ? round(rmStockQty[i]! / THOUSAND, 0) : null,
    // Usage is the same each month because `max_usage` is a static planning
    // figure, not a time series. Flat is the honest rendering of that; if you
    // want real month-by-month consumption it has to come from a BOM
    // explosion over production actuals, which belongs in the MRP engine.
    Usage: monthlyConsumptionQty > 0 ? round(monthlyConsumptionQty / THOUSAND, 0) : null,
    PO: hasPo[i] ? round(poQty[i] / THOUSAND, 0) : null,
  }));

  // ── 5 & 6. Finished goods ───────────────────────────────────────────────
  // Computed for the first time. These two series were previously copied
  // straight from the seed in every code path.
  const fgStockPcs = stockAtEachMonth(inventory, buckets, 'product');

  const fgStockCoverage: CoveragePoint[] = labels.map((month, i) => ({
    month,
    coverage: fgStockPcs[i] !== null && hasSalesActual[i] && salesActualPcs[i] > 0
      ? round(fgStockPcs[i]! / salesActualPcs[i], 2)
      : null,
    target: fgCoverageTarget,
  }));

  const fgStkVsSales: StockVsSalesPoint[] = labels.map((month, i) => ({
    month,
    STK: fgStockPcs[i] !== null ? round(fgStockPcs[i]! / MILLION) : null,
    Sales: hasSalesActual[i] ? round(salesActualPcs[i] / MILLION) : null,
  }));

  const monthsWithoutData = buckets.filter(
    (_, i) => !hasSalesActual[i] && !hasProdActual[i] && rmStockQty[i] === null,
  ).length;

  return {
    salesByPcs,
    productionByPcs,
    rmCoverageMonths,
    rmStockUsagePo,
    fgStockCoverage,
    fgStkVsSales,
    caption: windowCaption(buckets),
    monthsWithoutData,
    isEmpty: monthsWithoutData === buckets.length,
  };
}

/**
 * Caption for a chart card.
 *
 * States the range and, when data is missing, says so. The old captions were
 * literal strings that kept asserting a range the data no longer covered.
 */
export function chartCaption(d: ExecutiveChartData, source: string): string {
  const base = `${source} · ${d.caption}`;
  if (d.isEmpty) return `${base} · no data`;
  if (d.monthsWithoutData > 0) return `${base} · ${d.monthsWithoutData} months without data`;
  return base;
}
