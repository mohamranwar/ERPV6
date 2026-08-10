import { describe, expect, it } from 'vitest';
import {
  addMonths, attainmentSeries, bucketSum, buildWindow, monthKey, monthLabel,
  monthsBetween, trailingMonths, windowCaption,
} from '../src/utils/periods';

describe('monthKey', () => {
  it('formats local time, not UTC', () => {
    // The UTC trap: 00:30 on the 1st in Cairo (UTC+2/+3) is still the previous
    // day in UTC, so toISOString() would report the wrong month and shift the
    // entire planning window back by one.
    expect(monthKey(new Date(2026, 7, 1, 0, 30))).toBe('2026-08');
  });

  it('pads single-digit months', () => {
    expect(monthKey(new Date(2026, 0, 15))).toBe('2026-01');
  });
});

describe('monthLabel', () => {
  it('renders a short label', () => {
    expect(monthLabel('2026-08')).toBe('Aug-26');
  });

  it('accepts a full date', () => {
    expect(monthLabel('2026-08-01')).toBe('Aug-26');
  });

  it('returns the input unchanged when the month is out of range', () => {
    // Better a visibly odd label than a crash or a silently wrong month.
    expect(monthLabel('2026-13')).toBe('2026-13');
  });
});

describe('addMonths', () => {
  it('crosses a year boundary backwards', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });

  it('crosses a year boundary forwards', () => {
    expect(addMonths('2025-12', 1)).toBe('2026-01');
  });

  it('does not overflow on 31-day months', () => {
    // Naive date arithmetic on the 31st of January lands in March.
    expect(addMonths('2026-01', 1)).toBe('2026-02');
  });

  it('handles multi-year shifts', () => {
    expect(addMonths('2026-08', -26)).toBe('2024-06');
  });
});

describe('monthsBetween', () => {
  it('counts forwards', () => {
    expect(monthsBetween('2025-08', '2026-08')).toBe(12);
  });

  it('counts backwards as negative', () => {
    expect(monthsBetween('2026-08', '2025-08')).toBe(-12);
  });
});

describe('buildWindow', () => {
  it('includes the anchor plus the requested history', () => {
    const w = buildWindow('2026-08', 11, 0);
    expect(w).toHaveLength(12);
    expect(w[0].key).toBe('2025-09');
    expect(w[11].key).toBe('2026-08');
  });

  it('flags the anchor month', () => {
    const w = buildWindow('2026-08', 2, 2);
    expect(w.filter(b => b.isCurrent).map(b => b.key)).toEqual(['2026-08']);
  });

  it('flags future buckets', () => {
    const w = buildWindow('2026-08', 1, 2);
    expect(w.filter(b => b.isFuture).map(b => b.key)).toEqual(['2026-09', '2026-10']);
  });

  it('emits period_start values that match the database format', () => {
    expect(buildWindow('2026-08', 0, 0)[0].start).toBe('2026-08-01');
  });

  /**
   * Regression guard for the bug this module replaces.
   *
   * ExecutiveCharts.tsx carried a literal MONTH_MAP covering 2025-06 to
   * 2026-05 plus a hardcoded fallback series. From June 2026 onwards every
   * lookup missed, the fallback was returned, and the charts silently showed
   * demo figures while still captioned "Jul-25 to May-26".
   */
  it('stays correct past the old hardcoded ceiling of 2026-05', () => {
    const w = trailingMonths('2027-03', 12);
    expect(w[11].key).toBe('2027-03');
    expect(w[0].key).toBe('2026-04');
    expect(w.every(b => b.label !== b.key)).toBe(true);
  });

  it('works for an anchor years beyond the old map', () => {
    const w = trailingMonths('2031-01', 3);
    expect(w.map(b => b.label)).toEqual(['Nov-30', 'Dec-30', 'Jan-31']);
  });
});

describe('windowCaption', () => {
  it('derives the range from the data rather than a literal', () => {
    expect(windowCaption(trailingMonths('2026-08', 12))).toBe('Sep-25 to Aug-26');
  });

  it('collapses a single bucket', () => {
    expect(windowCaption(trailingMonths('2026-08', 1))).toBe('Aug-26');
  });

  it('handles an empty window', () => {
    expect(windowCaption([])).toBe('');
  });
});

describe('bucketSum', () => {
  const buckets = trailingMonths('2026-08', 3); // Jun, Jul, Aug 26

  it('sums rows into the right month', () => {
    const rows = [
      { period_start: '2026-06-01', quantity: 10 },
      { period_start: '2026-06-20', quantity: 5 },
      { period_start: '2026-08-01', quantity: 7 },
    ];
    expect(bucketSum(rows, buckets, 'period_start', 'quantity')).toEqual([15, 0, 7]);
  });

  it('matches on the month, not exact date equality', () => {
    // The CSV importer accepts mid-month dates. Matching on equality silently
    // dropped those rows — the same defect isInPeriod() was written to fix.
    const rows = [{ period_start: '2026-07-15', quantity: 42 }];
    expect(bucketSum(rows, buckets, 'period_start', 'quantity')).toEqual([0, 42, 0]);
  });

  it('returns zero rather than undefined for empty months', () => {
    // A hole lets a line chart bridge the gap and imply output that never
    // happened. A real zero must plot as a zero.
    expect(bucketSum([], buckets, 'period_start', 'quantity')).toEqual([0, 0, 0]);
  });

  it('ignores rows outside the window', () => {
    const rows = [
      { period_start: '2024-01-01', quantity: 999 },
      { period_start: '2026-07-01', quantity: 3 },
    ];
    expect(bucketSum(rows, buckets, 'period_start', 'quantity')).toEqual([0, 3, 0]);
  });

  it('skips malformed dates and non-numeric quantities', () => {
    const rows = [
      { period_start: '', quantity: 5 },
      { period_start: '2026-07-01', quantity: Number.NaN },
      { period_start: '2026-07-01', quantity: 4 },
    ];
    expect(bucketSum(rows as any, buckets, 'period_start', 'quantity')).toEqual([0, 4, 0]);
  });
});

describe('attainmentSeries', () => {
  it('computes actual over plan as a percentage', () => {
    expect(attainmentSeries([100, 200], [95, 220])).toEqual([95, 110]);
  });

  it('returns null when plan is zero', () => {
    // Not 0, not Infinity. There is no ratio against nothing, and coercing it
    // is how "∞%" reaches a slide.
    expect(attainmentSeries([0], [50])).toEqual([null]);
  });

  it('treats a missing actual as zero', () => {
    expect(attainmentSeries([100, 100], [50])).toEqual([50, 0]);
  });
});
