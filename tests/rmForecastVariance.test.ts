import { describe, expect, it } from 'vitest';
import {
  buildVarianceRows, summariseVariance, resolveBaselineRunId,
  resolveCurrentRunId, resultsForRun, DEFAULT_VARIANCE_TOLERANCE,
} from '../src/services/rmForecastVariance';
import type { Material, MRPResult, PurchaseOrder, Supplier } from '../src/types';

const material = (id: string, cost: number): Material => ({
  id, name: `Material ${id}`, sku: `SKU-${id}`, description: '',
  category_id: 'MC1', supplier_id: 'S1', supplier_lead_time_days: 10,
  transit_days: 5, customs_clearance_days: 3, total_lead_time_days: 18,
  reorder_point_days: 20, safety_stock_months: 1, moq: 0, max_usage: 100,
  controller: '', status: 'running', standard_cost: cost,
  cost_basis: 'standard',
});

const mrp = (
  runId: string, materialId: string, releases: number,
  week = '2026-08-01', runDate = '2026-08-01T00:00:00Z',
): MRPResult => ({
  id: `${runId}-${materialId}-${week}`, run_id: runId, run_date: runDate,
  material_id: materialId, week_start_date: week,
  projected_available: 0, safety_stock: 0, net_requirements: releases,
  planned_order_releases: releases,
});

const po = (
  id: string, materialId: string, qty: number,
  poDate = '2026-08-10', status: PurchaseOrder['status'] = 'pending',
): PurchaseOrder => ({
  id, material_id: materialId, supplier_id: 'S1', order_no: `PO-${id}`,
  qty, remaining_qty: qty, required_date: '2026-09-01', status,
  timing: 'Normal', po_date: poDate, unit_price: 10,
});

const MATERIALS = [material('M1', 50), material('M2', 5), material('M3', 200)];
const SUPPLIERS: Supplier[] = [];
const PERIOD = '2026-08';

function build(baseline: MRPResult[], current: MRPResult[], pos: PurchaseOrder[]) {
  return buildVarianceRows({
    baselineResults: baseline, currentResults: current,
    purchaseOrders: pos, materials: MATERIALS, suppliers: SUPPLIERS,
    period: PERIOD,
  });
}

describe('matching rules', () => {
  it('matches a PO to the forecast by material and the month it was RAISED', () => {
    // planned_order_releases is a release-date concept, so po_date is the
    // correct join. required_date here is September; that must not matter.
    const rows = build([mrp('R1', 'M1', 1000)], [mrp('R1', 'M1', 1000)], [po('1', 'M1', 900)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].baselineQty).toBe(1000);
    expect(rows[0].actualQty).toBe(900);
  });

  it('ignores POs raised in a different month', () => {
    const rows = build(
      [mrp('R1', 'M1', 1000)], [mrp('R1', 'M1', 1000)],
      [po('1', 'M1', 900, '2026-07-28')],
    );
    expect(rows[0].actualQty).toBe(0);
    expect(rows[0].flag).toBe('not_ordered');
  });

  it('rolls multiple weekly MRP buckets up into the reported month', () => {
    const rows = build(
      [mrp('R1', 'M1', 400, '2026-08-03'), mrp('R1', 'M1', 600, '2026-08-10')],
      [mrp('R1', 'M1', 400, '2026-08-03'), mrp('R1', 'M1', 600, '2026-08-10')],
      [po('1', 'M1', 1000)],
    );
    expect(rows[0].baselineQty).toBe(1000);
    expect(rows[0].orderVarianceQty).toBe(0);
  });

  it('sums several POs for the same material and lists their numbers', () => {
    const rows = build(
      [mrp('R1', 'M1', 1000)], [mrp('R1', 'M1', 1000)],
      [po('1', 'M1', 400), po('2', 'M1', 300)],
    );
    expect(rows[0].actualQty).toBe(700);
    expect(rows[0].matchedPoNumbers).toEqual(['PO-1', 'PO-2']);
  });

  it('uses ordered qty, not remaining qty', () => {
    // This is a procurement variance -- did we buy what we planned. Whether
    // it arrived is a separate, supplier-performance question.
    const partial = { ...po('1', 'M1', 1000), remaining_qty: 250 };
    const rows = build([mrp('R1', 'M1', 1000)], [mrp('R1', 'M1', 1000)], [partial]);
    expect(rows[0].actualQty).toBe(1000);
  });
});

describe('the three edge cases that must never be silently dropped', () => {
  it('flags an unplanned buy rather than excluding it', () => {
    // Iterating only the baseline would hide these entirely -- and they are
    // exactly what a procurement review wants to see.
    const rows = build([], [], [po('1', 'M2', 500)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].flag).toBe('unplanned');
    expect(rows[0].baselineQty).toBe(0);
    expect(rows[0].actualQty).toBe(500);
  });

  it('flags a planned material that was never ordered', () => {
    const rows = build([mrp('R1', 'M1', 800)], [mrp('R1', 'M1', 800)], []);
    expect(rows[0].flag).toBe('not_ordered');
    expect(rows[0].orderVarianceQty).toBe(-800);
  });

  it('drops rows where neither side has a figure', () => {
    const rows = build([mrp('R1', 'M1', 0)], [mrp('R1', 'M1', 0)], []);
    expect(rows).toHaveLength(0);
  });
});

describe('percentage handling', () => {
  it('returns null, not Infinity, when there is no baseline to divide by', () => {
    const rows = build([], [], [po('1', 'M2', 500)]);
    expect(rows[0].orderVariancePct).toBeNull();
    expect(rows[0].band).toBe('none');
  });

  it('computes a signed percentage against the baseline', () => {
    const rows = build([mrp('R1', 'M1', 1000)], [mrp('R1', 'M1', 1000)], [po('1', 'M1', 1100)]);
    expect(rows[0].orderVariancePct).toBe(10);
  });

  it('does not let float noise push an exact figure across a band boundary', () => {
    // 1050/1000 is exactly 5% -- the on_plan ceiling. Binary floating point
    // can render this as 5.000000000000001 and flip the band to 'watch'.
    const rows = build([mrp('R1', 'M1', 1000)], [mrp('R1', 'M1', 1000)], [po('1', 'M1', 1050)]);
    expect(rows[0].orderVariancePct).toBe(5);
    expect(rows[0].band).toBe('on_plan');
  });
});

describe('the two variances stay separate', () => {
  it('reports forecast drift and procurement variance independently', () => {
    // Baseline said 1000. Demand later dropped the forecast to 700.
    // Procurement ordered 700 -- correct against today, short against the
    // frozen plan. Collapsing these to one number would show "on plan" and
    // hide that the plan itself moved.
    const rows = build(
      [mrp('R1', 'M1', 1000)],
      [mrp('R2', 'M1', 700, '2026-08-01', '2026-08-20T00:00:00Z')],
      [po('1', 'M1', 700)],
    );
    expect(rows[0].forecastDriftQty).toBe(-300);       // Planning's number
    expect(rows[0].orderVarianceQty).toBe(-300); // Procurement's number
  });
});

describe('value weighting', () => {
  it('ranks rows by absolute value variance, not quantity', () => {
    // M2 misses by 1000 units at cost 5 = 5,000.
    // M3 misses by 100 units at cost 200 = 20,000 -- the bigger conversation.
    const rows = build(
      [mrp('R1', 'M2', 2000), mrp('R1', 'M3', 500)],
      [mrp('R1', 'M2', 2000), mrp('R1', 'M3', 500)],
      [po('1', 'M2', 1000), po('2', 'M3', 400)],
    );
    expect(rows[0].materialId).toBe('M3');
    expect(rows[0].orderVarianceValue).toBe(-20000);
  });

  it('treats an uncosted material as zero value rather than crashing', () => {
    const rows = buildVarianceRows({
      baselineResults: [mrp('R1', 'MX', 100)],
      currentResults: [mrp('R1', 'MX', 100)],
      purchaseOrders: [po('1', 'MX', 50)],
      materials: [], suppliers: [], period: PERIOD,
    });
    expect(rows[0].baselineValue).toBe(0);
    expect(rows[0].materialName).toBe('MX'); // falls back to the id
  });
});

describe('summariseVariance', () => {
  it('totals value and counts each exception type', () => {
    const rows = build(
      [mrp('R1', 'M1', 1000), mrp('R1', 'M3', 100)],
      [mrp('R1', 'M1', 1000), mrp('R1', 'M3', 100)],
      [po('1', 'M1', 500), po('2', 'M2', 200)],
    );
    const t = summariseVariance(rows);
    expect(t.materialsNotOrdered).toBe(1); // M3
    expect(t.materialsUnplanned).toBe(1);  // M2
    expect(t.baselineValue).toBe(1000 * 50 + 100 * 200);
  });

  it('returns a null percentage when there is no baseline at all', () => {
    const t = summariseVariance(build([], [], [po('1', 'M2', 100)]));
    expect(t.variancePct).toBeNull();
  });
});

describe('baseline run selection', () => {
  const results = [
    mrp('EARLY', 'M1', 100, '2026-08-01', '2026-08-02T00:00:00Z'),
    mrp('LATER', 'M1', 120, '2026-08-01', '2026-08-19T00:00:00Z'),
  ];

  it('prefers the recorded run for a closed period', () => {
    expect(resolveBaselineRunId(results, PERIOD, 'CLOSED_RUN')).toBe('CLOSED_RUN');
  });

  it('falls back to the earliest run in an open month', () => {
    // The plan as it stood when the month began -- not last month's plan,
    // which would measure the wrong thing.
    expect(resolveBaselineRunId(results, PERIOD)).toBe('EARLY');
  });

  it('returns null when the period has no runs, so the caller can show an empty state', () => {
    expect(resolveBaselineRunId(results, '2027-01')).toBeNull();
  });

  it('resolves the latest run for the drift comparison', () => {
    expect(resolveCurrentRunId(results, PERIOD)).toBe('LATER');
  });

  it('filters rows to a single run', () => {
    expect(resultsForRun(results, 'EARLY')).toHaveLength(1);
    expect(resultsForRun(results, null)).toEqual([]);
  });
});
