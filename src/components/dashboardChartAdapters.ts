/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CoveragePoint, VolumePoint } from '../utils/executiveCharts';
import type { ChartConfig } from './charts/ChartBuilder';

/**
 * Adapters from executive-chart data shapes to the periods/plan/actual cube
 * ChartCard expects.
 *
 * ── Why only two of the six charts get one ──────────────────────────────────
 * ChartCard's whole model is plan (a ghost bar -- an intention) against
 * actual (a solid bar -- what happened). Two of the six executive series
 * genuinely are that shape. The other two are not, and forcing them in would
 * misrepresent the data rather than merely limit its formatting:
 *
 *   StockFlowPoint  {month, STK, Usage, PO}      -- three unrelated series,
 *     no plan/actual relationship between any pair of them.
 *   StockVsSalesPoint {month, STK, Sales}         -- a snapshot LEVEL against
 *     a flow ACTUAL. Calling either one "plan" would be the same category
 *     error the codebase spent this whole engagement removing: labelling a
 *     realised number as an intention.
 *
 * Those two keep their existing fixed-purpose charts. Giving them Excel-style
 * customisation needs ChartBuilder to support an arbitrary number of named
 * series rather than exactly plan-and-actual, which is real, separate work.
 */

export interface ChartCube {
  periods: string[];
  seriesNames: string[];
  plan: number[][];
  actual: number[][];
}

/**
 * VolumePoint {month, BC, FC} -> the cube.
 *
 * BC (base case / actual) and FC (forecast / plan) are already exactly
 * plan-and-actual by month. Months where either side is null are dropped
 * rather than coerced to zero -- ChartBuilder's ChartDatum has no concept of
 * "no data", and turning an absence into a zero is the exact bug the rest of
 * this data pipeline was built to avoid. A dropped month simply does not
 * appear as a category; it does not render as a false zero-height bar.
 */
export function volumePointsToCube(points: readonly VolumePoint[]): ChartCube {
  const usable = points.filter(p => p.BC !== null && p.FC !== null);
  return {
    periods: usable.map(p => p.month),
    // Exactly one true series here (the monthly total) -- NOT one name per
    // month. `plan`/`actual` are therefore single rows, each one value per
    // month, matching `periods` by index; transpose('period') sums across
    // rows for a given period index, which with one row just returns that
    // row's value. The caller should pass fixedAxis="period": swapping to
    // the series axis with only one series would collapse twelve months
    // into a single bar, the same collapse bug fixed earlier on
    // PlanVsActualScreen, just from the opposite direction.
    seriesNames: ['Volume'],
    plan: [usable.map(p => p.FC as number)],
    actual: [usable.map(p => p.BC as number)],
  };
}

/**
 * CoveragePoint {month, coverage, target} -> the cube, PLUS a suggested
 * target-line default.
 *
 * `target` here is a constant threshold (e.g. "3.0 months"), not a value that
 * varies by month the way a sales plan does. That is a reference line, not a
 * ghost bar -- so unlike volumePointsToCube, this does NOT put target into
 * the `plan` series. It comes back separately as a ChartConfig suggestion for
 * ChartCard's `defaultConfig` prop, so the Format panel opens already showing
 * the real threshold instead of the generic default of 100.
 */
export function coveragePointsToCube(
  points: readonly CoveragePoint[],
): { cube: ChartCube; targetDefault: Partial<ChartConfig> } {
  const usable = points.filter(p => p.coverage !== null);
  const target = points[0]?.target ?? 0;

  return {
    cube: {
      periods: usable.map(p => p.month),
      // One true series (the coverage figure itself). Same reasoning as
      // volumePointsToCube: fixedAxis="period" is required, or a swap would
      // collapse every month into one bar.
      seriesNames: ['Coverage'],
      plan: [usable.map(() => 0)], // unused: measure is 'actual' only for coverage charts
      actual: [usable.map(p => p.coverage as number)],
    },
    targetDefault: {
      measure: 'actual',
      showTarget: true,
      targetValue: target,
      targetCaption: 'Target',
      colorByTarget: true,
    },
  };
}
