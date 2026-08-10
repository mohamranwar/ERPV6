import { describe, expect, it } from 'vitest';
import { computeExecutiveChartData, chartCaption } from '../src/utils/executiveCharts';
import type {
  InventorySnapshot, Material, ProductionActual, ProductionPlan,
  PurchaseOrder, SalesActual, SalesPlan,
} from '../src/types';

const ANCHOR = '2026-08';

const MATERIALS: Material[] = [
  { id: 'M1', name: 'SAP', sku: 'SAP-1', description: '', category_id: 'MC1',
    supplier_id: 'S1', supplier_lead_time_days: 10, transit_days: 5,
    customs_clearance_days: 3, total_lead_time_days: 18, reorder_point_days: 20,
    safety_stock_months: 1, moq: 0, max_usage: 1_000, controller: '',
    status: 'running', standard_cost: 50, cost_basis: 'standard' },
];

const salesActual = (period: string, qty: number): SalesActual =>
  ({ id: `sa-${period}`, product_id: 'P1', channel_id: 'C1', period_start: `${period}-01`, quantity: qty });

const salesPlan = (period: string, qty: number): SalesPlan =>
  ({ id: `sp-${period}`, product_id: 'P1', channel_id: 'C1', period_type: 'month',
     period_start: `${period}-01`, quantity: qty });

describe('window is rolling, not hardcoded', () => {
  it('ends on the anchor month', () => {
    const d = computeExecutiveChartData({ anchor: ANCHOR });
    expect(d.salesByPcs).toHaveLength(12);
    expect(d.salesByPcs[11].month).toBe('Aug-26');
    expect(d.salesByPcs[0].month).toBe('Sep-25');
  });

  /**
   * The core regression. The replaced code keyed off a literal MONTH_MAP
   * covering 2025-06 to 2026-05; anything later silently returned seed rows.
   */
  it('produces real months well past the old 2026-05 ceiling', () => {
    const d = computeExecutiveChartData({ anchor: '2028-03', months: 3 });
    expect(d.salesByPcs.map(p => p.month)).toEqual(['Jan-28', 'Feb-28', 'Mar-28']);
  });

  it('derives the caption instead of asserting a literal range', () => {
    const d = computeExecutiveChartData({ anchor: ANCHOR, months: 3 });
    expect(d.caption).toBe('Jun-26 to Aug-26');
  });
});

describe('no fallback to seed data', () => {
  it('returns null, not an invented figure, for a month with no rows', () => {
    const d = computeExecutiveChartData({
      anchor: ANCHOR, months: 3,
      salesActuals: [salesActual('2026-08', 5_000_000)],
    });
    expect(d.salesByPcs[0].BC).toBeNull();  // Jun-26, no rows
    expect(d.salesByPcs[1].BC).toBeNull();  // Jul-26, no rows
    expect(d.salesByPcs[2].BC).toBe(5);     // Aug-26, real
  });

  /**
   * The subtler half of the old bug: the guard was `qty > 0 ? real : seed`,
   * so a month that genuinely sold nothing was overwritten with a demo
   * figure. A real zero must survive.
   */
  it('preserves a genuine zero rather than treating it as missing', () => {
    const d = computeExecutiveChartData({
      anchor: ANCHOR, months: 2,
      salesActuals: [salesActual('2026-07', 0), salesActual('2026-08', 3_000_000)],
    });
    expect(d.salesByPcs[0].BC).toBe(0);   // a fact, not a hole
    expect(d.salesByPcs[1].BC).toBe(3);
  });

  it('is empty when there is no data at all, and says so', () => {
    const d = computeExecutiveChartData({ anchor: ANCHOR, months: 3 });
    expect(d.isEmpty).toBe(true);
    expect(chartCaption(d, 'Sales')).toContain('no data');
  });

  it('reports how many months are missing when partially populated', () => {
    const d = computeExecutiveChartData({
      anchor: ANCHOR, months: 3,
      salesActuals: [salesActual('2026-08', 1_000_000)],
    });
    expect(d.monthsWithoutData).toBe(2);
    expect(chartCaption(d, 'Sales')).toContain('2 months without data');
  });
});

describe('plan and actual are separate series', () => {
  it('maps actual to BC and plan to FC', () => {
    const d = computeExecutiveChartData({
      anchor: ANCHOR, months: 1,
      salesActuals: [salesActual('2026-08', 7_400_000)],
      salesPlans: [salesPlan('2026-08', 8_000_000)],
    });
    expect(d.salesByPcs[0]).toEqual({ month: 'Aug-26', BC: 7.4, FC: 8 });
  });

  it('shows a plan with no actual as a plan and a gap, not as zero', () => {
    const d = computeExecutiveChartData({
      anchor: ANCHOR, months: 1,
      salesPlans: [salesPlan('2026-08', 8_000_000)],
    });
    expect(d.salesByPcs[0].FC).toBe(8);
    expect(d.salesByPcs[0].BC).toBeNull();
  });
});

describe('RM coverage uses real consumption, not a magic constant', () => {
  const inventory: InventorySnapshot[] = [
    { id: 'i1', item_type: 'material', item_id: 'M1', snapshot_date: '2026-08-31', quantity: 3_000 },
  ];

  it('divides inventory value by monthly consumption value', () => {
    // stock 3000 × cost 50 = 150,000. consumption 1000 × 50 = 50,000 → 3.00
    const d = computeExecutiveChartData({
      anchor: ANCHOR, months: 1, inventory, materials: MATERIALS,
    });
    expect(d.rmCoverageMonths[0].coverage).toBe(3);
  });

  it('returns null when no material is costed, rather than dividing by a constant', () => {
    const uncosted = [{ ...MATERIALS[0], standard_cost: 0 }];
    const d = computeExecutiveChartData({
      anchor: ANCHOR, months: 1, inventory, materials: uncosted,
    });
    expect(d.rmCoverageMonths[0].coverage).toBeNull();
  });

  it('carries the target through from settings', () => {
    const d = computeExecutiveChartData({
      anchor: ANCHOR, months: 1, inventory, materials: MATERIALS, rmCoverageTarget: 2.5,
    });
    expect(d.rmCoverageMonths[0].target).toBe(2.5);
  });
});

describe('FG series are computed at all', () => {
  /**
   * `fgStockCoverage` and `fgStkVsSales` were previously `[...SEED]` in every
   * code path — they had never reflected the database in any state.
   */
  const inventory: InventorySnapshot[] = [
    { id: 'i1', item_type: 'product', item_id: 'P1', snapshot_date: '2026-08-31', quantity: 9_000_000 },
  ];

  it('computes FG coverage as stock over sales', () => {
    const d = computeExecutiveChartData({
      anchor: ANCHOR, months: 1, inventory,
      salesActuals: [salesActual('2026-08', 6_000_000)],
    });
    expect(d.fgStockCoverage[0].coverage).toBe(1.5);
  });

  it('computes FG stock against sales in millions', () => {
    const d = computeExecutiveChartData({
      anchor: ANCHOR, months: 1, inventory,
      salesActuals: [salesActual('2026-08', 6_000_000)],
    });
    expect(d.fgStkVsSales[0]).toEqual({ month: 'Aug-26', STK: 9, Sales: 6 });
  });

  it('returns null coverage when sales are zero rather than dividing by zero', () => {
    const d = computeExecutiveChartData({
      anchor: ANCHOR, months: 1, inventory,
      salesActuals: [salesActual('2026-08', 0)],
    });
    expect(d.fgStockCoverage[0].coverage).toBeNull();
  });
});

describe('inventory carries forward', () => {
  it('uses the latest snapshot on or before each month, not only exact matches', () => {
    const inventory: InventorySnapshot[] = [
      { id: 'i1', item_type: 'product', item_id: 'P1', snapshot_date: '2026-06-30', quantity: 4_000_000 },
    ];
    const d = computeExecutiveChartData({ anchor: ANCHOR, months: 3, inventory });
    // Jun has the snapshot; Jul and Aug carry it forward rather than showing a hole.
    expect(d.fgStkVsSales[0].STK).toBe(4);
    expect(d.fgStkVsSales[1].STK).toBe(4);
    expect(d.fgStkVsSales[2].STK).toBe(4);
  });

  it('shows null for months before the first snapshot', () => {
    const inventory: InventorySnapshot[] = [
      { id: 'i1', item_type: 'product', item_id: 'P1', snapshot_date: '2026-08-31', quantity: 4_000_000 },
    ];
    const d = computeExecutiveChartData({ anchor: ANCHOR, months: 3, inventory });
    expect(d.fgStkVsSales[0].STK).toBeNull();
    expect(d.fgStkVsSales[2].STK).toBe(4);
  });
});

describe('purchase orders', () => {
  it('buckets PO quantity by po_date into thousands', () => {
    const pos: PurchaseOrder[] = [
      { id: 'po1', material_id: 'M1', supplier_id: 'S1', order_no: 'PO-1', qty: 320_000,
        remaining_qty: 0, required_date: '2026-09-01', status: 'pending',
        timing: 'Normal', po_date: '2026-08-04' },
    ];
    const d = computeExecutiveChartData({ anchor: ANCHOR, months: 1, purchaseOrders: pos });
    expect(d.rmStockUsagePo[0].PO).toBe(320);
  });

  it('shows null, not zero, for a month with no POs raised', () => {
    const d = computeExecutiveChartData({ anchor: ANCHOR, months: 1 });
    expect(d.rmStockUsagePo[0].PO).toBeNull();
  });
});
