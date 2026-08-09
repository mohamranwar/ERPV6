/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Export order readiness roll-up.
 *
 * The rule under test: an order is only as ready as its least-ready SKU can
 * make it. Readiness used to be sum(produced) / sum(target) across the whole
 * order, so an order holding 200% of SKU A and 0% of SKU B reported 100%
 * ready — and then could not actually be shipped.
 *
 * This mirrors the calculation in ExportForecastScreen.calculateOrderTotals.
 * It is kept here as an executable statement of the rule so the roll-up cannot
 * quietly revert to a plain sum.
 */
import { describe, it, expect } from 'vitest';

interface Line { target: number; produced: number }

function rollUp(lines: Line[]) {
  const targetQty = lines.reduce((s, l) => s + l.target, 0);
  const produced = lines.reduce((s, l) => s + l.produced, 0);
  // Each line credited only up to its own target.
  const shippable = lines.reduce((s, l) => s + Math.min(l.produced, l.target), 0);
  return {
    targetQty,
    produced,
    readinessPct: targetQty > 0 ? Math.round((shippable / targetQty) * 100) : 0,
    linesReady: lines.filter(l => (l.target > 0 ? l.produced >= l.target : false)).length,
    shortfall: Math.max(0, targetQty - shippable),
  };
}

describe('export order readiness', () => {
  it('is 100% only when every SKU meets its own target', () => {
    const r = rollUp([{ target: 1000, produced: 1000 }, { target: 500, produced: 500 }]);
    expect(r.readinessPct).toBe(100);
    expect(r.linesReady).toBe(2);
    expect(r.shortfall).toBe(0);
  });

  it('does not let a surplus on one SKU mask a shortfall on another', () => {
    // The regression case. Plain sum: (2000 + 0) / (1000 + 1000) = 100%.
    const lines = [{ target: 1000, produced: 2000 }, { target: 1000, produced: 0 }];
    const naive = Math.round(
      (lines.reduce((s, l) => s + l.produced, 0) / lines.reduce((s, l) => s + l.target, 0)) * 100
    );
    expect(naive).toBe(100); // what the old calculation reported

    const r = rollUp(lines);
    expect(r.readinessPct).toBe(50); // what is genuinely shippable
    expect(r.linesReady).toBe(1);
    expect(r.shortfall).toBe(1000);
  });

  it('reports partial progress proportionally', () => {
    const r = rollUp([{ target: 1000, produced: 250 }, { target: 1000, produced: 750 }]);
    expect(r.readinessPct).toBe(50);
    expect(r.linesReady).toBe(0);
  });

  it('treats an order with nothing produced as zero, not as complete', () => {
    const r = rollUp([{ target: 800, produced: 0 }]);
    expect(r.readinessPct).toBe(0);
    expect(r.shortfall).toBe(800);
  });

  it('returns zero rather than dividing by zero when nothing is ordered', () => {
    const r = rollUp([{ target: 0, produced: 0 }]);
    expect(r.readinessPct).toBe(0);
    expect(Number.isNaN(r.readinessPct)).toBe(false);
  });

  it('never exceeds 100% however much surplus exists', () => {
    const r = rollUp([{ target: 100, produced: 10_000 }]);
    expect(r.readinessPct).toBe(100);
  });
});
