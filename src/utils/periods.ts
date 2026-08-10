/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Rolling month windows.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * ExecutiveCharts.tsx built its history from a literal map:
 *
 *   const MONTH_MAP = { '2025-06': 'Jun-25', ... '2026-05': 'MAY-26' };
 *
 * paired with a hardcoded fallback series. Any month outside that range found
 * no key, returned the seeded demo figure, and rendered without complaint. The
 * chart captions still read "Jul-25 to May-26" long after those months stopped
 * being the last twelve. Nothing threw, nothing logged, and the numbers on a
 * board-room projector were quietly fictional.
 *
 * The map also carried a second defect: the labels were inconsistently cased
 * ('Jun-25' but 'JUL-25'), so the lookup had to `.toUpperCase()` both sides to
 * work at all — a sign the key was doing a job a date should have been doing.
 *
 * Everything here derives from an anchor date instead. Pass the open planning
 * period and the window follows it forever.
 *
 * ── Rule ────────────────────────────────────────────────────────────────────
 * No month label, month range or period key is ever written as a literal.
 */

/** A single bucket in a planning window. */
export interface PeriodBucket {
  /** Sort- and match-safe key, 'YYYY-MM'. Use this to filter rows. */
  key: string;
  /** First day of the month, 'YYYY-MM-01'. Matches `period_start` columns. */
  start: string;
  /** Display label, 'Aug-26'. Presentation only — never match on this. */
  label: string;
  /** True when this bucket is the anchor month itself. */
  isCurrent: boolean;
  /** True when the bucket is in the future relative to the anchor. */
  isFuture: boolean;
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * 'YYYY-MM' for a date, in local time.
 *
 * `toISOString()` converts to UTC first, which rolls the date backwards for
 * anyone east of Greenwich. At 00:30 on the 1st in Cairo that lands the whole
 * app in the previous month. The codebase already learned this once — see
 * `toDateStr` in supabaseClient.ts — so the same care applies here.
 */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** 'Aug-26' from a 'YYYY-MM' or 'YYYY-MM-DD' string. */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  const idx = Number(m) - 1;
  if (!y || Number.isNaN(idx) || idx < 0 || idx > 11) return key;
  return `${MONTH_NAMES[idx]}-${y.slice(2)}`;
}

/** Shift a 'YYYY-MM' key by a whole number of months, forward or back. */
export function addMonths(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  // Day 1 avoids the classic 31st-of-January overflow into March.
  const d = new Date(y, m - 1 + delta, 1);
  return monthKey(d);
}

/** Whole months from `from` to `to`. Negative when `to` is earlier. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/**
 * A rolling window of buckets around an anchor month.
 *
 * @param anchor  'YYYY-MM' or 'YYYY-MM-DD'. Pass the open planning period.
 * @param back    Months of history to include, not counting the anchor.
 * @param forward Months ahead to include. 0 for a history-only chart.
 *
 * A 12-month trailing window ending on the open month is `buildWindow(p, 11, 0)`
 * — eleven back plus the anchor itself.
 */
export function buildWindow(anchor: string, back: number, forward = 0): PeriodBucket[] {
  const anchorKey = anchor.slice(0, 7);
  const out: PeriodBucket[] = [];

  for (let i = -back; i <= forward; i++) {
    const key = addMonths(anchorKey, i);
    out.push({
      key,
      start: `${key}-01`,
      label: monthLabel(key),
      isCurrent: i === 0,
      isFuture: i > 0,
    });
  }
  return out;
}

/** Trailing window ending on, and including, the anchor month. */
export function trailingMonths(anchor: string, count: number): PeriodBucket[] {
  return buildWindow(anchor, Math.max(count - 1, 0), 0);
}

/**
 * Caption for a window: "Aug-25 to Jul-26".
 *
 * Chart subtitles used to carry this range as literal text, so they kept
 * claiming a range the data no longer covered. Derive it instead.
 */
export function windowCaption(buckets: PeriodBucket[]): string {
  if (buckets.length === 0) return '';
  if (buckets.length === 1) return buckets[0].label;
  return `${buckets[0].label} to ${buckets[buckets.length - 1].label}`;
}

/**
 * Sum a quantity field across rows, bucketed by month.
 *
 * Rows are matched on the 'YYYY-MM' prefix rather than exact date equality.
 * `period_start` is a full date and the CSV importer accepts whatever the file
 * carries, so a row landing on the 15th is still a row for that month — the
 * same reasoning as `isInPeriod` in supabaseClient.ts.
 *
 * Buckets with no rows return 0, not undefined. A month with no production is
 * a real zero and should plot as one; leaving a hole lets a line chart bridge
 * the gap and imply output that never happened.
 */
export function bucketSum<T extends Record<string, unknown>>(
  rows: readonly T[],
  buckets: readonly PeriodBucket[],
  dateField: keyof T,
  valueField: keyof T,
): number[] {
  const totals = new Map<string, number>();
  for (const b of buckets) totals.set(b.key, 0);

  for (const row of rows) {
    const raw = row[dateField];
    if (typeof raw !== 'string' || raw.length < 7) continue;

    const key = raw.slice(0, 7);
    if (!totals.has(key)) continue;

    const value = Number(row[valueField]);
    if (!Number.isFinite(value)) continue;

    totals.set(key, totals.get(key)! + value);
  }

  return buckets.map(b => totals.get(b.key) ?? 0);
}

/**
 * Attainment as a percentage, element-wise.
 *
 * Two things this guards against:
 *
 * 1. A plan of zero has no meaningful ratio, so it yields null rather than
 *    Infinity or a misleading 0. Charts should skip a null point; a KPI should
 *    show a dash. Coercing it to a number is how "∞%" reaches a slide.
 *
 * 2. Binary floating point makes `220 / 200 * 100` evaluate to
 *    110.00000000000001, and by the same mechanism a row that hit plan exactly
 *    can land on 99.99999999999999. Compared against a threshold of 100 that
 *    row is classified "watch" instead of "on target" — a badge flips colour
 *    because of representation error, not performance. Rounding to six places
 *    is far finer than any threshold anyone will set and removes the noise.
 */
const ATTAINMENT_DP = 6;

export function attainmentSeries(
  plan: readonly number[],
  actual: readonly number[],
): (number | null)[] {
  return plan.map((p, i) => {
    if (!(p > 0)) return null;
    const pct = ((actual[i] ?? 0) / p) * 100;
    return Number(pct.toFixed(ATTAINMENT_DP));
  });
}

/**
 * Carton conversion deliberately lives elsewhere.
 *
 * `src/utils/uom.ts` already owns it, and its contract is the right one:
 * `pcsPerCarton()` returns null when a product's pack configuration is missing
 * rather than falling back to a guess. An earlier version of this file carried
 * its own `toCartons` that returned pieces unchanged on a bad pack count —
 * which would have reported a piece figure under a "cartons" heading. Two
 * implementations of the same conversion is exactly how those disagree.
 *
 * Import from '../utils/uom' instead.
 */
