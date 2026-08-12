import { describe, expect, it } from 'vitest';
import { buildGrid, mrpPlannedMonths } from '../src/services/rmForecastGrid';
import type { Material, MRPResult, PurchaseOrder, Supplier } from '../src/types';

const material = (id: string, cost = 10, sup = 'S1'): Material => ({
  id, name: `Material ${id}`, sku: `SKU-${id}`, description: '',
  category_id: 'MC1', supplier_id: sup, supplier_lead_time_days: 10,
  transit_days: 5, customs_clearance_days: 3, total_lead_time_days: 18,
  reorder_point_days: 20, safety_stock_months: 1, moq: 0, max_usage: 100,
  controller: '', status: 'running', standard_cost: cost, cost_basis: 'standard',
});

const suppliers: Supplier[] = [
  {
    id: 'S1', name: 'Suzano', default_lead_time_days: 30,
    default_transit_days: 21, default_customs_clearance_days: 7, status: 'active',
  },
];

const mrp = (materialId: string, month: string, releases: number, runId = 'R1'): MRPResult => ({
  id: `${runId}-${materialId}-${month}`, run_id: runId, run_date: '2026-08-01T00:00:00Z',
  material_id: materialId, week_start_date: `${month}-01`,
  projected_available: 0, safety_stock: 0, net_requirements: releases,
  planned_order_releases: releases,
});

const po = (id: string, materialId: string, qty: number, poDate: string): PurchaseOrder => ({
  id, material_id: materialId, supplier_id: 'S1', order_no: `PO-${id}`,
  qty, remaining_qty: qty, required_date: '2026-12-01', status: 'pending',
  timing: 'Normal', po_date: poDate, unit_price: 10,
});

// MRP planned Aug-Nov only. Dec onward must be projected.
const MRP: MRPResult[] = [
  mrp('M1', '2026-08', 1000), mrp('M1', '2026-09', 1000),
  mrp('M1', '2026-10', 1000), mrp('M1', '2026-11', 1000),
];

const base = {
  mrpResults: MRP, materials: [material('M1')], suppliers,
  startPeriod: '2026-08', horizonMonths: 6,
};

describe('grid shape', () => {
  it('emits one column per month of the requested horizon', () => {
    const { periods } = buildGrid({ ...base, purchaseOrders: [] });
    expect(periods).toHaveLength(6);
    expect(periods.map(p => p.key)).toEqual([
      '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01',
    ]);
  });

  it('marks only the months MRP actually planned as real', () => {
    const { periods } = buildGrid({ ...base, purchaseOrders: [] });
    expect(periods.filter(p => !p.projected).map(p => p.key))
      .toEqual(['2026-08', '2026-09', '2026-10', '2026-11']);
    expect(periods.filter(p => p.projected).map(p => p.key))
      .toEqual(['2026-12', '2027-01']);
  });

  it('every row has exactly one cell per column, so the table cannot skew', () => {
    const { rows, periods } = buildGrid({ ...base, purchaseOrders: [] });
    for (const r of rows) expect(r.cells).toHaveLength(periods.length);
  });

  it('hides projected months entirely in off mode', () => {
    const { periods } = buildGrid({ ...base, purchaseOrders: [], projection: 'off' });
    expect(periods).toHaveLength(4);
    expect(periods.every(p => !p.projected)).toBe(true);
  });
});

describe('matching', () => {
  it('matches a PO to the month it was RAISED, not its required date', () => {
    // required_date on this PO is December; po_date is August. The August
    // column must pick it up, because planned_order_releases is itself a
    // release-date concept.
    const { rows } = buildGrid({ ...base, purchaseOrders: [po('1', 'M1', 900, '2026-08-14')] });
    expect(rows[0].cells[0].actualQty).toBe(900);
    expect(rows[0].cells[1].actualQty).toBe(0);
  });

  it('sums several POs in one month and lists their numbers', () => {
    const { rows } = buildGrid({
      ...base,
      purchaseOrders: [po('1', 'M1', 400, '2026-08-03'), po('2', 'M1', 500, '2026-08-20')],
    });
    expect(rows[0].cells[0].actualQty).toBe(900);
    expect(rows[0].cells[0].poNumbers).toEqual(['PO-1', 'PO-2']);
  });

  it('includes a material that was bought but never planned', () => {
    // Iterating only the forecast would drop this row silently, and an
    // unplanned buy is exactly what a procurement review is looking for.
    const { rows } = buildGrid({
      ...base,
      materials: [material('M1'), material('M2')],
      purchaseOrders: [po('1', 'M2', 500, '2026-08-10')],
    });
    expect(rows.map(r => r.materialId).sort()).toEqual(['M1', 'M2']);
    const m2 = rows.find(r => r.materialId === 'M2')!;
    expect(m2.cells[0].forecastQty).toBe(0);
    expect(m2.cells[0].actualQty).toBe(500);
  });
});

describe('percentages', () => {
  it('computes ordered over forecast', () => {
    const { rows } = buildGrid({ ...base, purchaseOrders: [po('1', 'M1', 1160, '2026-08-05')] });
    expect(rows[0].cells[0].achievementPct).toBe(116);
  });

  it('returns null rather than Infinity when there is no forecast', () => {
    const { rows } = buildGrid({
      ...base, materials: [material('M1'), material('M2')],
      purchaseOrders: [po('1', 'M2', 500, '2026-08-10')],
    });
    const m2 = rows.find(r => r.materialId === 'M2')!;
    expect(m2.cells[0].achievementPct).toBeNull();
  });

  it('reports zero, not null, when a plan existed and nothing was ordered', () => {
    // The distinction matters: null means "no plan to measure against",
    // zero means "we planned and bought none of it". Different problems.
    const { rows } = buildGrid({ ...base, purchaseOrders: [] });
    expect(rows[0].cells[0].achievementPct).toBe(0);
  });

  it('does not let float noise move a figure off a round number', () => {
    const { rows } = buildGrid({ ...base, purchaseOrders: [po('1', 'M1', 1050, '2026-08-05')] });
    expect(rows[0].cells[0].achievementPct).toBe(105);
  });
});

describe('projection', () => {
  it('projects from the average of the planned months', () => {
    const mixed = [
      mrp('M1', '2026-08', 1000), mrp('M1', '2026-09', 2000),
      mrp('M1', '2026-10', 3000), mrp('M1', '2026-11', 2000),
    ];
    const { rows } = buildGrid({ ...base, mrpResults: mixed, purchaseOrders: [] });
    expect(rows[0].cells[4].projected).toBe(true);
    expect(rows[0].cells[4].forecastQty).toBe(2000); // (1000+2000+3000+2000)/4
  });

  it('carries a +/-15% band in band mode', () => {
    const { rows } = buildGrid({ ...base, purchaseOrders: [], projection: 'band' });
    const c = rows[0].cells[4];
    expect(c.lowQty).toBe(850);
    expect(c.highQty).toBe(1150);
  });

  it('varies each projected month within +/-15% in varied mode', () => {
    const { rows } = buildGrid({ ...base, purchaseOrders: [], projection: 'varied' });
    const dec = rows[0].cells[4].forecastQty;
    const jan = rows[0].cells[5].forecastQty;
    expect(dec).toBeGreaterThanOrEqual(850);
    expect(dec).toBeLessThanOrEqual(1150);
    expect(dec).not.toBe(jan); // genuinely varies month to month
  });

  /**
   * The reason variation is hashed rather than randomised. A projected figure
   * that moves between two page loads cannot be reconciled against yesterday's
   * export, and if it reaches a supplier it is indefensible.
   */
  it('produces the SAME varied figure on every rebuild with the same seed', () => {
    const a = buildGrid({ ...base, purchaseOrders: [], projection: 'varied', seed: 7 });
    const b = buildGrid({ ...base, purchaseOrders: [], projection: 'varied', seed: 7 });
    expect(a.rows[0].cells[4].forecastQty).toBe(b.rows[0].cells[4].forecastQty);
  });

  it('changes only when the seed is deliberately changed', () => {
    const a = buildGrid({ ...base, purchaseOrders: [], projection: 'varied', seed: 1 });
    const b = buildGrid({ ...base, purchaseOrders: [], projection: 'varied', seed: 2 });
    expect(a.rows[0].cells[4].forecastQty).not.toBe(b.rows[0].cells[4].forecastQty);
  });

  it('never puts an ordered figure or a percentage on a projected month', () => {
    const { rows } = buildGrid({
      ...base,
      // A PO genuinely raised in a projected month must not create a
      // comparison, because there is no plan behind that column.
      purchaseOrders: [po('1', 'M1', 900, '2026-12-10')],
    });
    expect(rows[0].cells[4].actualQty).toBeNull();
    expect(rows[0].cells[4].achievementPct).toBeNull();
  });
});

describe('totals exclude projections', () => {
  it('row totals count the real months only', () => {
    const { rows } = buildGrid({
      ...base,
      purchaseOrders: [po('1', 'M1', 1000, '2026-08-05')],
    });
    // Four planned months at 1000 each. The two projected months add nothing.
    expect(rows[0].totalForecastQty).toBe(4000);
    expect(rows[0].totalActualQty).toBe(1000);
    expect(rows[0].totalAchievementPct).toBe(25);
  });

  it('column totals leave the actual side null on projected months', () => {
    const { totals } = buildGrid({ ...base, purchaseOrders: [] });
    expect(totals.byPeriod[4].projected).toBe(true);
    expect(totals.byPeriod[4].actualQty).toBeNull();
    expect(totals.byPeriod[4].achievementPct).toBeNull();
  });

  it('grand total percentage is real months only', () => {
    const { totals } = buildGrid({
      ...base, purchaseOrders: [po('1', 'M1', 2000, '2026-08-05')],
    });
    expect(totals.forecastQty).toBe(4000);
    expect(totals.actualQty).toBe(2000);
    expect(totals.achievementPct).toBe(50);
  });
});

describe('supplier', () => {
  it('resolves the supplier name for the column', () => {
    const { rows } = buildGrid({ ...base, purchaseOrders: [] });
    expect(rows[0].supplierName).toBe('Suzano');
  });

  it('falls back to a dash rather than crashing on an unknown supplier', () => {
    const { rows } = buildGrid({
      ...base, materials: [material('M1', 10, 'GHOST')], purchaseOrders: [],
    });
    expect(rows[0].supplierName).toBe('—');
  });
});

describe('mrpPlannedMonths', () => {
  it('ignores months whose only rows are zero releases', () => {
    const withZero = [...MRP, mrp('M1', '2026-12', 0)];
    const months = mrpPlannedMonths(withZero);
    expect(months.has('2026-12')).toBe(false);
    expect(months.size).toBe(4);
  });

  it('filters to a single run when asked', () => {
    const twoRuns = [...MRP, mrp('M1', '2026-12', 500, 'R2')];
    expect(mrpPlannedMonths(twoRuns, 'R1').has('2026-12')).toBe(false);
    expect(mrpPlannedMonths(twoRuns, 'R2').has('2026-12')).toBe(true);
  });
});
