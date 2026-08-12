/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { addMonths, monthLabel } from '../utils/periods';
import type { Material, MRPResult, PurchaseOrder, Supplier } from '../types';

/**
 * Raw material forecast vs actual PO, as a material x month grid.
 *
 * ── Why this is separate from rmForecastVariance.ts ─────────────────────────
 * That module answers "what is the variance for ONE period", collapsing every
 * month into a single figure per material. This one keeps the time dimension:
 * a planner comparing what was sent to a supplier against what was ordered
 * needs to see the months side by side, because a material that is 116% in
 * October and 0% in November is a very different conversation from one that
 * is 58% twice. The two modules share the same matching rules deliberately;
 * only the shape of the output differs.
 *
 * ── The forecast ────────────────────────────────────────────────────────────
 * `planned_order_releases` from MRP. Lead time is already applied by the MRP
 * engine when it offsets a requirement back to a release date, so a release
 * sitting in August is what must be ORDERED in August to arrive when needed.
 * Nothing here re-applies lead time; doing so would double-count it.
 *
 * ── Projection beyond the MRP horizon ───────────────────────────────────────
 * MRP is typically run for four months. Months past that have no plan at all.
 * Rather than show them blank, they are projected from the average of the
 * months that DO have a plan -- but they are marked, styled differently, and
 * excluded from every total. A projection is not a plan, and the moment the
 * two are added together nobody can tell which part of a number was real.
 */

export type Grain = 'week' | 'month';

/**
 * How a row's stored period maps to a grid column.
 *
 * MRP writes the actual period start into `week_start_date` regardless of the
 * run's grain -- a monthly run stores '2026-08-01', a weekly run stores the
 * real week start like '2026-08-17'. So the bucket key IS the stored date for
 * weeks, and the month prefix for months. Slicing to YYYY-MM unconditionally,
 * which is what this module did before, silently merged every week of a month
 * into one column and made a weekly view impossible.
 */
export function bucketKey(dateStr: string, grain: Grain, weekAnchor?: string): string {
  if (grain === 'month') return dateStr.slice(0, 7);

  // A PO is raised on whatever day it is raised -- 2026-08-19, say -- while
  // the weekly columns are anchored to the run's start date and step in
  // 7-day increments: 2026-08-17, 2026-08-24, and so on. Comparing the raw
  // dates means 19 Aug matches no column at all, and the PO disappears from
  // the grid without any error. So a date is snapped BACK to the start of
  // the week that contains it, measured from the same anchor the columns
  // use, which is the only way the two agree.
  if (!weekAnchor) return dateStr.slice(0, 10);
  const anchor = Date.parse(weekAnchor.slice(0, 10) + 'T00:00:00Z');
  const at = Date.parse(dateStr.slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(anchor) || Number.isNaN(at)) return dateStr.slice(0, 10);

  const DAY = 86400000;
  const weeksSince = Math.floor((at - anchor) / (7 * DAY));
  return new Date(anchor + weeksSince * 7 * DAY).toISOString().slice(0, 10);
}

/** Monday-anchored ISO date n weeks after a start date. */
export function addWeeks(dateStr: string, weeks: number): string {
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

function nextBucket(key: string, grain: Grain, i: number): string {
  return grain === 'month' ? addMonths(key.slice(0, 7), i) : addWeeks(key, i);
}

function bucketLabel(key: string, grain: Grain): string {
  if (grain === 'month') return monthLabel(key);
  // e.g. "17 Aug" -- short enough for a dense column header.
  const d = new Date(key + 'T00:00:00Z');
  return `${d.getUTCDate()} ${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })}`;
}

export type ProjectionMode =
  /** Flat average, with a +/-15% range shown alongside. Deterministic. */
  | 'band'
  /** Per-month figures varied within +/-15%. Deterministic for a given seed. */
  | 'varied'
  /** Show only months MRP actually planned. */
  | 'off';

export interface GridCell {
  periodKey: string;
  periodLabel: string;
  /** True when this month is past the MRP horizon and the figure is derived. */
  projected: boolean;
  /** Planned order releases. For projected months, the derived figure. */
  forecastQty: number;
  /** Ordered quantity from POs. Null on projected months -- nothing to compare. */
  actualQty: number | null;
  /** ordered / forecast x 100. Null when there is no forecast to divide by. */
  achievementPct: number | null;
  /** Lower and upper bound at +/-15%. Only populated in 'band' mode. */
  lowQty?: number;
  highQty?: number;
  /** PO numbers behind actualQty, so any figure is traceable to documents. */
  poNumbers: string[];
}

export interface GridRow {
  materialId: string;
  materialSku: string;
  materialName: string;
  supplierId: string;
  supplierName: string;
  unitCost: number;
  cells: GridCell[];
  /** Totals across the REAL months only. Projections never enter these. */
  totalForecastQty: number;
  totalActualQty: number;
  totalAchievementPct: number | null;
}

export interface GridTotals {
  /** Per-month column totals, aligned by index with the period list. */
  byPeriod: Array<{
    periodKey: string;
    projected: boolean;
    forecastQty: number;
    actualQty: number | null;
    achievementPct: number | null;
  }>;
  forecastQty: number;
  actualQty: number;
  achievementPct: number | null;
}

export interface BuildGridInput {
  /** Every MRP result row available. The horizon is derived from these. */
  mrpResults: readonly MRPResult[];
  purchaseOrders: readonly PurchaseOrder[];
  materials: readonly Material[];
  suppliers: readonly Supplier[];
  /** First month of the grid, 'YYYY-MM' or a full date. */
  startPeriod: string;
  /** How many buckets wide. Months when grain is 'month', weeks when 'week'. */
  horizonMonths: number;
  /** Column granularity. Must match the grain the MRP run was executed at. */
  grain?: Grain;
  projection?: ProjectionMode;
  /** Only this run's rows count as the forecast. Null uses every run. */
  runId?: string | null;
  /** Changing this reshuffles 'varied' figures. A deliberate what-if, not a page load. */
  seed?: number;
}

/**
 * Deterministic 0..1 from a string.
 *
 * Deliberately NOT Math.random(). A projected figure that changes between two
 * page loads cannot be reconciled against yesterday's export, and if it ever
 * reaches a supplier it is indefensible. Keying the variation on material +
 * month + seed means October for a given material is always the same number,
 * varied across months but stable across refreshes -- and only an explicit
 * seed change moves it.
 */
function hashUnit(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** 0.85 .. 1.15 */
function variationFactor(materialId: string, periodKey: string, seed: number): number {
  return 0.85 + hashUnit(`${materialId}|${periodKey}|${seed}`) * 0.30;
}

/** The months MRP actually produced a plan for, as a Set of 'YYYY-MM'. */
export function mrpPlannedMonths(
  mrpResults: readonly MRPResult[],
  runId?: string | null,
  grain: Grain = 'month',
  weekAnchor?: string,
): Set<string> {
  const out = new Set<string>();
  for (const r of mrpResults) {
    if (runId && r.run_id !== runId) continue;
    if (!r.week_start_date) continue;
    if ((Number(r.planned_order_releases) || 0) <= 0) continue;
    out.add(bucketKey(r.week_start_date, grain, weekAnchor));
  }
  return out;
}

export function buildGrid(input: BuildGridInput): { rows: GridRow[]; totals: GridTotals; periods: Array<{ key: string; label: string; projected: boolean }> } {
  const {
    mrpResults, purchaseOrders, materials, suppliers,
    startPeriod, horizonMonths, projection = 'band', runId = null, seed = 1,
    grain = 'month',
  } = input;

  const supplierName = new Map(suppliers.map(s => [s.id, s.name]));
  const weekAnchor = grain === 'week' ? startPeriod.slice(0, 10) : undefined;
  const planned = mrpPlannedMonths(mrpResults, runId, grain, weekAnchor);

  // Column list. A month is "real" only if MRP actually planned something in
  // it -- not merely because it falls inside the requested horizon.
  const start = grain === 'month' ? startPeriod.slice(0, 7) : startPeriod.slice(0, 10);
  const allPeriods = Array.from({ length: horizonMonths }, (_, i) => {
    const key = nextBucket(start, grain, i);
    return { key, label: bucketLabel(key, grain), projected: !planned.has(key) };
  });

  const periods = projection === 'off'
    ? allPeriods.filter(p => !p.projected)
    : allPeriods;

  // ── Index the source data once ───────────────────────────────────────────
  // forecast[materialId][periodKey]
  const forecast = new Map<string, Map<string, number>>();
  for (const r of mrpResults) {
    if (runId && r.run_id !== runId) continue;
    if (!r.week_start_date) continue;
    const key = bucketKey(r.week_start_date, grain, weekAnchor);
    const qty = Number(r.planned_order_releases) || 0;
    if (qty <= 0) continue;
    let byPeriod = forecast.get(r.material_id);
    if (!byPeriod) { byPeriod = new Map(); forecast.set(r.material_id, byPeriod); }
    byPeriod.set(key, (byPeriod.get(key) ?? 0) + qty);
  }

  // ordered[materialId][periodKey], matched on po_date -- when the order was
  // RAISED. planned_order_releases is itself a release-date concept, so
  // matching on required_date would compare a release plan against a receipt
  // date and produce variance that is pure calendar misalignment.
  const ordered = new Map<string, Map<string, { qty: number; pos: string[] }>>();
  for (const po of purchaseOrders) {
    if (!po.po_date) continue;
    // Cancelled means nothing was bought. No such status exists on the type
    // today, so this is inert -- it is here so adding one later is a schema
    // change and nothing else.
    if ((po.status as string) === 'cancelled') continue;
    const key = bucketKey(po.po_date, grain, weekAnchor);
    let byPeriod = ordered.get(po.material_id);
    if (!byPeriod) { byPeriod = new Map(); ordered.set(po.material_id, byPeriod); }
    const cur = byPeriod.get(key) ?? { qty: 0, pos: [] };
    cur.qty += Number(po.qty) || 0;
    if (po.order_no) cur.pos.push(po.order_no);
    byPeriod.set(key, cur);
  }

  // Every material appearing on either side. Iterating only the forecast
  // would hide unplanned buys, which are exactly what a procurement review
  // wants to see.
  const materialIds = new Set<string>([...forecast.keys(), ...ordered.keys()]);
  const materialById = new Map(materials.map(m => [m.id, m]));

  const rows: GridRow[] = [];

  for (const id of materialIds) {
    const m = materialById.get(id);
    const fByPeriod = forecast.get(id);
    const oByPeriod = ordered.get(id);

    // Average of the months MRP genuinely planned, for projecting the rest.
    const realQtys = allPeriods
      .filter(p => !p.projected)
      .map(p => fByPeriod?.get(p.key) ?? 0);
    const avg = realQtys.length
      ? realQtys.reduce((a, b) => a + b, 0) / realQtys.length
      : 0;

    const cells: GridCell[] = periods.map(p => {
      if (!p.projected) {
        const f = fByPeriod?.get(p.key) ?? 0;
        const o = oByPeriod?.get(p.key);
        const a = o?.qty ?? 0;
        return {
          periodKey: p.key,
          periodLabel: p.label,
          projected: false,
          forecastQty: f,
          actualQty: a,
          // No ratio against nothing. An unplanned buy has no forecast to be
          // a percentage OF, so this is null rather than 0 or Infinity.
          achievementPct: f > 0
            ? Number(((a / f) * 100).toFixed(6))
            : null,
          poNumbers: o?.pos ?? [],
        };
      }

      const qty = projection === 'varied'
        ? avg * variationFactor(id, p.key, seed)
        : avg;

      return {
        periodKey: p.key,
        periodLabel: p.label,
        projected: true,
        forecastQty: qty,
        actualQty: null,
        achievementPct: null,
        ...(projection === 'band' ? { lowQty: avg * 0.85, highQty: avg * 1.15 } : {}),
        poNumbers: [],
      };
    });

    // Row totals cover the real months only. Adding a projection into a
    // total makes it impossible to tell which part of the figure was planned.
    const real = cells.filter(c => !c.projected);
    const tF = real.reduce((s, c) => s + c.forecastQty, 0);
    const tA = real.reduce((s, c) => s + (c.actualQty ?? 0), 0);

    rows.push({
      materialId: id,
      materialSku: m?.sku ?? id,
      materialName: m?.name ?? id,
      supplierId: m?.supplier_id ?? '',
      supplierName: supplierName.get(m?.supplier_id ?? '') ?? '—',
      unitCost: Number(m?.standard_cost) || 0,
      cells,
      totalForecastQty: tF,
      totalActualQty: tA,
      totalAchievementPct: tF > 0 ? Number(((tA / tF) * 100).toFixed(6)) : null,
    });
  }

  rows.sort((a, b) => a.materialSku.localeCompare(b.materialSku));

  // ── Column and grand totals ──────────────────────────────────────────────
  const byPeriod = periods.map((p, i) => {
    if (p.projected) {
      return {
        periodKey: p.key, projected: true,
        forecastQty: rows.reduce((s, r) => s + r.cells[i].forecastQty, 0),
        actualQty: null, achievementPct: null,
      };
    }
    const f = rows.reduce((s, r) => s + r.cells[i].forecastQty, 0);
    const a = rows.reduce((s, r) => s + (r.cells[i].actualQty ?? 0), 0);
    return {
      periodKey: p.key, projected: false,
      forecastQty: f, actualQty: a,
      achievementPct: f > 0 ? Number(((a / f) * 100).toFixed(6)) : null,
    };
  });

  const gF = rows.reduce((s, r) => s + r.totalForecastQty, 0);
  const gA = rows.reduce((s, r) => s + r.totalActualQty, 0);

  return {
    rows,
    periods,
    totals: {
      byPeriod,
      forecastQty: gF,
      actualQty: gA,
      achievementPct: gF > 0 ? Number(((gA / gF) * 100).toFixed(6)) : null,
    },
  };
}

/**
 * Which MRP run the grid should read as its forecast.
 *
 * A closed period records the run that was current when it closed, and that
 * is the answer -- the whole point of freezing a period is that its figures
 * stop moving. For an open period there is no record yet, so the latest run
 * is used: a planner comparing against a forecast wants the one they are
 * actually working to.
 *
 * Returns null when there are no runs at all, so the caller can show an empty
 * state rather than silently comparing every PO against nothing and reporting
 * a catastrophic variance that is really just missing data.
 */
export function resolveGridRunId(
  allResults: readonly MRPResult[],
  period: string,
  closedPeriods: ReadonlyArray<{ period?: string; run_id?: string | null }>,
): string | null {
  const closed = closedPeriods.find(
    cp => cp.period?.slice(0, 7) === period.slice(0, 7) && cp.run_id,
  );
  if (closed?.run_id) return closed.run_id;

  let latest: { runId: string; date: string } | null = null;
  for (const r of allResults) {
    const date = String(r.run_date ?? '');
    if (!latest || date > latest.date) latest = { runId: r.run_id, date };
  }
  return latest?.runId ?? null;
}
