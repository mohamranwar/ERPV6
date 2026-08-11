import { describe, expect, it } from 'vitest';
import { volumePointsToCube, coveragePointsToCube } from '../src/components/dashboardChartAdapters';
import { transpose } from '../src/components/charts/ChartBuilder';
import type { CoveragePoint, VolumePoint } from '../src/utils/executiveCharts';

/**
 * The bug these guard: seriesNames must be a single-element array naming the
 * ONE true series (the aggregate figure), not a copy of the month labels.
 * Setting it to the months, as an early draft of this adapter did, produces
 * a cube where transpose('period') still happens to look right by
 * coincidence of array shape, but the adapter's OWN seriesNames become
 * meaningless labels that never get used correctly if anything ever reads
 * them -- and more importantly signals the wrong mental model to whoever
 * next touches this file.
 */

const points: VolumePoint[] = [
  { month: 'Jun-26', BC: 70, FC: 75 },
  { month: 'Jul-26', BC: null, FC: 80 },   // no actual yet -- must be dropped
  { month: 'Aug-26', BC: 74, FC: 78 },
];

describe('volumePointsToCube', () => {
  it('keeps one bar per month, in order', () => {
    const cube = volumePointsToCube(points);
    expect(cube.periods).toEqual(['Jun-26', 'Aug-26']); // Jul-26 dropped
  });

  it('names exactly one series, not one per month', () => {
    const cube = volumePointsToCube(points);
    expect(cube.seriesNames).toHaveLength(1);
  });

  it('drops a month where either side is null rather than showing it as zero', () => {
    const cube = volumePointsToCube(points);
    expect(cube.periods).not.toContain('Jul-26');
  });

  it('transpose(period) reproduces the original per-month plan/actual pairs', () => {
    const cube = volumePointsToCube(points);
    const rows = transpose(cube.periods, cube.seriesNames, cube.plan, cube.actual, 'period');
    expect(rows).toEqual([
      { category: 'Jun-26', plan: 75, actual: 70 },
      { category: 'Aug-26', plan: 78, actual: 74 },
    ]);
  });

  it('an empty series list produces an empty chart, not a crash', () => {
    const cube = volumePointsToCube([]);
    expect(cube.periods).toEqual([]);
    const rows = transpose(cube.periods, cube.seriesNames, cube.plan, cube.actual, 'period');
    expect(rows).toEqual([]);
  });
});

const coveragePoints: CoveragePoint[] = [
  { month: 'Jun-26', coverage: 3.2, target: 3.0 },
  { month: 'Jul-26', coverage: null, target: 3.0 },
  { month: 'Aug-26', coverage: 2.8, target: 3.0 },
];

describe('coveragePointsToCube', () => {
  it('carries the real target as a config suggestion, not the generic default', () => {
    const { targetDefault } = coveragePointsToCube(coveragePoints);
    expect(targetDefault.targetValue).toBe(3.0);
    expect(targetDefault.measure).toBe('actual');
    expect(targetDefault.showTarget).toBe(true);
  });

  it('drops months with no coverage figure', () => {
    const { cube } = coveragePointsToCube(coveragePoints);
    expect(cube.periods).toEqual(['Jun-26', 'Aug-26']);
  });

  it('transpose(period) reproduces the coverage values by month', () => {
    const { cube } = coveragePointsToCube(coveragePoints);
    const rows = transpose(cube.periods, cube.seriesNames, cube.plan, cube.actual, 'period');
    expect(rows.map(r => r.actual)).toEqual([3.2, 2.8]);
  });

  it('falls back to zero target when the series is entirely empty', () => {
    const { targetDefault } = coveragePointsToCube([]);
    expect(targetDefault.targetValue).toBe(0);
  });
});
