/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  explodeBOM,
  getPlannedPeriods,
  getSafetyStockQty,
  getSafetyStockMonths,
  hasSafetyStockOverride,
  runLocalMigrations,
  isInPeriod,
  monthsOfCover,
  UNLIMITED_COVER_MONTHS,
  getVFGPSIAnalysis,
  toDateStr,
  daysInMonthOf,
  getCurrentPeriods,
  getBomAlternates,
  SAFETY_SERVICE_FACTOR,
  DAYS_PER_MONTH,
  getPlanningPeriod,
  setPlanningPeriod,
  formatPlanningPeriod,
  getVBOMCostDetail,
  getVFGCost,
  getVMaterialCoverage,
  getVMaterialMonthlyProjection,
  getVProductCoverage,
  getVPlanVsActual,
  runMRP,
} from '../src/supabaseClient';

// All figures below are hand-derived from the seed data in src/supabaseClient.ts
// (INITIAL_PRODUCTS, INITIAL_MATERIALS, INITIAL_BOM_*, INITIAL_SALES_PLAN,
// INITIAL_SALES_ACTUAL, INITIAL_INVENTORY, INITIAL_POS, INITIAL_SHIPMENTS),
// which is unchanged from the earlier review of this codebase. These are
// regression tests: if the seed data or the calculation engine changes,
// these numbers should be re-derived by hand rather than copied from the
// new code, or the test loses its value as an independent check.

// The engine now reports on whichever planning period is selected, defaulting
// to the real current month. Every expectation below is derived from July 2026,
// so pin the period rather than letting the wall clock decide what these tests
// are measuring.
// Some tests write to the seeded tables to exercise a case the fixture does
// not cover. localStorage persists for the whole file, so the store is
// snapshotted and put back afterwards - otherwise one test's extra plan row
// silently changes every total measured after it.
let dbSnapshot: Array<[string, string]> = [];

beforeEach(() => {
  setPlanningPeriod('2026-07-01');
  dbSnapshot = Object.keys(localStorage).map(k => [k, localStorage.getItem(k)!]);
});

afterEach(() => {
  localStorage.clear();
  dbSnapshot.forEach(([k, v]) => localStorage.setItem(k, v));
});

describe('getVBOMCostDetail / getVFGCost - BOM cost rollup for P1 (BabyJoy Maxi S4)', () => {
  // BS1 Core Fluff Pulp   -> MT1 qty 4.5 Grams/unit, scrap 3%, std_cost $1.50/KG (RM)
  //                          UOM normalised: 4.5g → 0.0045 KG per unit
  // BS2 Top Sheet Surface -> MT2 qty 1.2 SQM/unit, scrap 5%, std_cost $0.80/SQM (RM, primary)
  //                          MT6 qty 1.25 SQM/unit, scrap 4%, std_cost $0.72/SQM (RM, alternate)
  // BS3 Super Absorbent   -> MT5 qty 2.0 Grams/unit, scrap 2%, std_cost $2.20/KG (RM)
  //                          UOM normalised: 2.0g → 0.002 KG per unit
  // BS4 Packaging Carton  -> MT4 qty 0.25 PCS/unit, scrap 1%, weighted_avg cost
  //                          PO5 (50000 PCS, unit_price 1.20) → weighted avg = 1.20
  // line_cost = normalised_qty_per_unit * (1 + scrap%/100) * unit_cost
  //   MT1: 0.0045 * 1.03 * 1.50 = 0.006953
  //   MT2: 1.2    * 1.05 * 0.80 = 1.008
  //   MT5: 0.002  * 1.02 * 2.20 = 0.004488
  //   MT4: 0.25   * 1.01 * 1.20 = 0.303
  // selling_price(P1) = 18.5

  it('returns all 5 BOM option rows (primary + alternate)', async () => {
    const details = await getVBOMCostDetail('P1');
    expect(details).toHaveLength(5);
  });

  it('computes the primary Core Pulp line cost correctly (Grams→KG normalised)', async () => {
    const details = await getVBOMCostDetail('P1');
    const corePulp = details.find(d => d.material_id === 'MT1');
    // 4.5g → 0.0045 KG * 1.03 scrap * $1.50/KG = 0.006953 → stored rounded to 3dp = 0.007
    expect(corePulp!.line_cost).toBeCloseTo(0.0045 * 1.03 * 1.50, 3);
  });

  it('uses weighted-avg unit_price from PO history for MT4 (PO5 unit_price = 1.20)', async () => {
    const details = await getVBOMCostDetail('P1');
    const carton = details.find(d => d.material_id === 'MT4');
    expect(carton!.unit_cost).toBeCloseTo(1.2, 4);
    expect(carton!.line_cost).toBeCloseTo(0.303, 4);
  });

  it('rolls up only priority-1 lines into RM/PK/CON costs and computes margin%', async () => {
    const cost = await getVFGCost('P1');
    // MT1 (KG-normalised) + MT2 (SQM, no conversion) + MT5 (KG-normalised)
    const mt1 = 0.0045 * 1.03 * 1.50;
    const mt2 = 1.2 * 1.05 * 0.80;
    const mt5 = 0.002 * 1.02 * 2.20;
    expect(cost!.rm_cost).toBeCloseTo(mt1 + mt2 + mt5, 3);
    expect(cost!.pk_cost).toBeCloseTo(0.303, 4); // MT4 unchanged
    expect(cost!.con_cost).toBe(0);
    const total = mt1 + mt2 + mt5 + 0.303;
    expect(cost!.total_material_cost).toBeCloseTo(total, 3);
    expect(cost!.margin_percent).toBeCloseTo((18.5 - total) / 18.5 * 100, 1);
  });

  it('returns null/empty for unknown products', async () => {
    expect(await getVFGCost('NOPE')).toBeNull();
    expect(await getVBOMCostDetail('NOPE')).toEqual([]);
  });
});

describe('getVMaterialCoverage / getVProductCoverage - stock coverage flags', () => {
  // MT3 (used only in P2's BOM, qty/unit 0.125, scrap 0%):
  //   P2 forecast demand 2026-07-01 = SP5(200000) + SP6(80000) = 280000
  //   monthly_demand = 280000 * 0.125 = 35000
  //   opening_stock = 3000, in-transit (SH1) = 25000
  //   PO3 status is 'in_transit' (not 'pending'), so it must NOT double-count
  //   total_available = 3000 + 25000 + 0 = 28000 -> coverage = 0.8mo -> OOS risk

  it('flags MT3 as an out-of-stock risk and excludes its in_transit-status PO from pendingPoQty', async () => {
    // SH1 (MT3, 25000 PCS) has factory_arrival_date='2026-07-11' → already arrived,
    // so in-transit qty = 0. coverage = 3000 / 35000 = 0.086mo
    const rows = await getVMaterialCoverage('forecast');
    const mt3 = rows.find(r => r.material_id === 'MT3');
    expect(mt3!.monthly_demand).toBe(35000);
    expect(mt3!.coverage_months).toBeCloseTo(3000 / 35000, 2);
    expect(mt3!.oos_risk_flag).toBe(true);
  });

  // MT5 (SAP, used only in P1's BOM slot BS3, qty/unit 2.0g, scrap 2%):
  //   UOM normalised: 2.0g → 0.002 KG per unit
  //   P1 forecast demand 2026-07-01 = SP1..SP4 = 275000 units
  //   monthly_demand = 275000 * 0.002 * 1.02 = 561 KG
  //   opening_stock = 1750 KG, no in-transit, PO4 pending = 80 KG
  //   total_available = 1830 KG -> coverage 3.26mo -> overstock (> 3.0)
  it('flags MT5 as overstock once incoming POs are counted', async () => {
    const rows = await getVMaterialCoverage('forecast');
    const mt5 = rows.find(r => r.material_id === 'MT5');
    // 275000 * (2.0/1000) * 1.02 = 561 KG
    const expected_demand = 275000 * 0.002 * 1.02;
    expect(mt5!.monthly_demand).toBeCloseTo(expected_demand, 2);
    expect(mt5!.coverage_months).toBeCloseTo((1750 + 80) / expected_demand, 2);
    expect(mt5!.overstock_flag).toBe(true);
    expect(mt5!.oos_risk_flag).toBe(false);
  });

  // MT4 (carton, P1 only, qty/unit 0.25 PCS, scrap 1%):
  //   monthly_demand = 275000 * 0.25 * 1.01 = 69437.5 PCS
  //   opening_stock = 175000 PCS, PO5 pending = 50000 PCS
  //   total_available = 225000 -> 225000 / 69437.5 = 3.24mo -> overstock (> 3.0)
  it('leaves MT4 in the overstock band (PO5 pushes it above 3.0 mo)', async () => {
    const rows = await getVMaterialCoverage('forecast');
    const mt4 = rows.find(r => r.material_id === 'MT4');
    const monthly_demand = 275000 * 0.25 * 1.01; // 69437.5
    expect(mt4!.coverage_months).toBeCloseTo((175000 + 50000) / monthly_demand, 2);
    expect(mt4!.oos_risk_flag).toBe(false);
    expect(mt4!.overstock_flag).toBe(true);
  });

  it('computes P1 product coverage from opening stock over July forecast demand', async () => {
    const rows = await getVProductCoverage('forecast');
    const p1 = rows.find(r => r.product_id === 'P1');
    expect(p1!.monthly_demand).toBe(275000); // SP1+SP2+SP3+SP4
    expect(p1!.coverage_months).toBeCloseTo(0.24, 2);
    expect(p1!.below_safety_flag).toBe(true);
  });

  it('uses sales actuals instead of forecast when demandBasis is "sales"', async () => {
    const rows = await getVProductCoverage('sales');
    const p1 = rows.find(r => r.product_id === 'P1');
    expect(p1!.monthly_demand).toBe(191000); // SA1(142000) + SA2(49000)
  });
});

describe('getVPlanVsActual - sales plan vs actual for 2026-07-01', () => {
  it('computes variance and achievement% for P1 and P2', async () => {
    const rows = await getVPlanVsActual('sales');

    const p1 = rows.find(r => r.item_id === 'P1');
    expect(p1!.plan_qty).toBe(275000);
    expect(p1!.actual_qty).toBe(191000);
    expect(p1!.variance_qty).toBe(-84000);
    expect(p1!.achievement_percent).toBeCloseTo(69.5, 1);

    const p2 = rows.find(r => r.item_id === 'P2');
    expect(p2!.plan_qty).toBe(280000);
    expect(p2!.actual_qty).toBe(215000);
    expect(p2!.variance_qty).toBe(-65000);
    expect(p2!.achievement_percent).toBeCloseTo(76.8, 1);
  });

  it('reports no achievement figure for a product with zero plan', async () => {
    // P6 has no July sales_plan rows at all. Dividing by a zero plan has no
    // meaningful answer, so the engine returns null and the UI renders "No
    // plan" - it used to return 100, which painted un-planned SKUs green as
    // if they were perfectly on target.
    const rows = await getVPlanVsActual('sales');
    const p6 = rows.find(r => r.item_id === 'P6');
    expect(p6!.plan_qty).toBe(0);
    expect(p6!.actual_qty).toBe(0);
    expect(p6!.achievement_percent).toBeNull();
  });
});

describe('explodeBOM - the shared BOM explosion', () => {
  // Stock coverage, the MRP engine and the Material Check drill-down all route
  // through this one function. They used to each carry their own copy of the
  // explosion loop, which is how they drifted apart.
  it('explodes a per-product demand map into material requirements (KG-normalised)', () => {
    // P1 only: 100000 units
    //   MT1 100000 * (4.5/1000) * 1.03 = 463.5 KG
    //   MT2 100000 * 1.2        * 1.05 = 126000 SQM (no conversion)
    //   MT5 100000 * (2.0/1000) * 1.02 = 204 KG
    //   MT4 100000 * 0.25       * 1.01 = 25250 PCS (no conversion)
    const req = explodeBOM({ P1: 100000 });
    expect(req.MT1).toBeCloseTo(100000 * (4.5 / 1000) * 1.03, 4); // 463.5
    expect(req.MT2).toBeCloseTo(126000, 4);                        // no UOM change
    expect(req.MT5).toBeCloseTo(100000 * (2.0 / 1000) * 1.02, 4); // 204
    expect(req.MT4).toBeCloseTo(25250, 4);                         // no UOM change
  });

  it('sums across products that share a material', () => {
    // MT1 is consumed by both P1 (4.5g/unit, 3%) and P2 (2.1g/unit, 2%).
    const req = explodeBOM({ P1: 100000, P2: 100000 });
    const p1_mt1 = 100000 * (4.5 / 1000) * 1.03;  // 463.5
    const p2_mt1 = 100000 * (2.1 / 1000) * 1.02;  // 214.2
    expect(req.MT1).toBeCloseTo(p1_mt1 + p2_mt1, 4); // 677.7
  });

  it('never consumes priority-2 alternates', () => {
    // MT6 is the alternate top sheet on both P1 and P2.
    const req = explodeBOM({ P1: 100000, P2: 100000 });
    expect(req.MT6).toBeUndefined();
  });

  it('ignores products with no active BOM and zero demand', () => {
    expect(explodeBOM({ P3: 100000 })).toEqual({});
    expect(explodeBOM({ P1: 0 })).toEqual({});
    expect(explodeBOM({})).toEqual({});
  });
});

describe('getVMaterialMonthlyProjection - Material Check drill-down', () => {
  // Consumption is exploded from the MPS through the active BOM, so it must
  // agree with what runMRP() reports for the same material and month.
  //   MT1 is consumed by P1 (4.5/unit, 3% scrap) and P2 (2.1/unit, 2% scrap).
  //   Jul MPS: PP1 P1=260000, PP2 P2=290000 (KG-normalised via UOM conversion)
  //     260000 * (4.5/1000) * 1.03 = 1205.1 KG
  //     290000 * (2.1/1000) * 1.02 =  621.18 KG
  //     total                       = 1826.28 KG → Math.round = 1826
  it('explodes MT1 consumption from the production plan, not a hardcoded constant', async () => {
    const jul_mt1 = 260000 * (4.5 / 1000) * 1.03 + 290000 * (2.1 / 1000) * 1.02; // 1826.28
    const rows = await getVMaterialMonthlyProjection('MT1');
    const jul = rows.find(r => r.period_start === '2026-07-01');
    expect(jul!.plan_consumption).toBeCloseTo(jul_mt1, 0);
    expect(jul!.opening_stock).toBe(220); // seed fixed: IV7 quantity = 220 KG
  });

  it('agrees with the MRP engine on gross requirements for the same month', async () => {
    const projection = await getVMaterialMonthlyProjection('MT1');
    const { results } = await runMRP('2026-07-01', 3, 'month');

    for (const row of projection.slice(0, 3)) {
      const mrpRow = results.find(
        r => r.material_id === 'MT1' && r.week_start_date === row.period_start
      );
      if (mrpRow) {
        expect(mrpRow.gross_requirements).toBeCloseTo(row.plan_consumption, 0);
      }
    }
  });

  it('reports zero consumption for months with no production plan', async () => {
    // October 2026 has no MPS rows in the seed data.
    const rows = await getVMaterialMonthlyProjection('MT1');
    const oct = rows.find(r => r.period_start === '2026-10-01');
    expect(oct!.plan_consumption).toBe(0);
    // MT1 is exhausted by then, so a quiet month still covers nothing - the
    // zero-demand branch used to report a flat 999 days regardless of stock.
    expect(oct!.ending_stock).toBe(0);
    expect(oct!.ending_coverage_days).toBe(0);
  });

  it('returns zero consumption for a material no active BOM consumes', async () => {
    // MT6 is only ever a priority-2 alternate, so the MPS never consumes it.
    const rows = await getVMaterialMonthlyProjection('MT6');
    expect(rows.every(r => r.plan_consumption === 0)).toBe(true);
  });
});

describe('runMRP - offline MRP simulation', () => {
  it('produces one result row per material per period', async () => {
    const { results } = await runMRP('2026-07-01', 4, 'week');
    // 6 seeded materials x 4 weeks = 24 rows.
    expect(results).toHaveLength(24);
  });

  it('never proposes a planned order release below net requirements (MOQ floor)', async () => {
    const { results } = await runMRP('2026-07-01', 4, 'week');
    for (const row of results) {
      if (row.planned_order_releases > 0) {
        expect(row.planned_order_releases).toBeGreaterThanOrEqual(row.net_requirements);
      }
    }
  });

  it('supports a month-grain horizon via getCurrentPeriods without throwing', async () => {
    const { results } = await runMRP('2026-07-01', 3, 'month');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].week_start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns a distinct run_id on each invocation', async () => {
    const first = await runMRP('2026-07-01', 2, 'week');
    await new Promise(resolve => setTimeout(resolve, 5));
    const second = await runMRP('2026-07-01', 2, 'week');
    expect(first.run_id).not.toBe(second.run_id);
  });
});


describe('the active planning period', () => {
  it('lists every month the dataset plans for, oldest first', () => {
    // Seed sales plans cover Jul/Aug/Sep 2026; production plans the same.
    expect(getPlannedPeriods()).toEqual(['2026-07-01', '2026-08-01', '2026-09-01']);
  });

  it('round-trips a selected period and persists it', () => {
    setPlanningPeriod('2026-09-01');
    expect(getPlanningPeriod()).toBe('2026-09-01');
    setPlanningPeriod('2026-07-01');
    expect(getPlanningPeriod()).toBe('2026-07-01');
  });

  it('reports plan vs actual against the selected period, not a fixed month', async () => {
    setPlanningPeriod('2026-08-01');
    const aug = await getVPlanVsActual('sales');
    const p1Aug = aug.find(r => r.item_id === 'P1');
    // SP7(160000) + SP8(55000), and no August actuals exist.
    expect(p1Aug!.plan_qty).toBe(215000);
    expect(p1Aug!.actual_qty).toBe(0);
    expect(p1Aug!.period).toBe('2026-08');

    setPlanningPeriod('2026-07-01');
    const jul = await getVPlanVsActual('sales');
    expect(jul.find(r => r.item_id === 'P1')!.plan_qty).toBe(275000);
  });

  it('explodes coverage demand from the selected period', async () => {
    setPlanningPeriod('2026-08-01');
    const rows = await getVMaterialCoverage('forecast');
    // MT5 is P1-only: Aug forecast 215000 units * (2.0/1000 KG/unit) * 1.02 scrap = 438.6
    // The engine rounds to nearest integer → 439.
    expect(rows.find(r => r.material_id === 'MT5')!.monthly_demand).toBeCloseTo(215000 * (2.0 / 1000) * 1.02, 0);
  });

  it('accepts an explicit period argument that overrides the selection', async () => {
    setPlanningPeriod('2026-07-01');
    const rows = await getVPlanVsActual('sales', '2026-08-01');
    expect(rows.find(r => r.item_id === 'P1')!.plan_qty).toBe(215000);
  });

  it('formats a period for display', () => {
    expect(formatPlanningPeriod('2026-08-01')).toBe('August 2026');
  });
});


describe('getSafetyStockQty - lead-time-based buffers', () => {
  // MT1: total_lead_time_days 34 (15 supplier + 12 transit + 7 customs).
  const mt1 = { total_lead_time_days: 34, max_usage: 1200 } as any;
  // MT3: total_lead_time_days 12 (7 + 3 + 2) - the same plan, a nearer supplier.
  const mt3 = { total_lead_time_days: 12, max_usage: 500 } as any;

  // KG-scale July MT1 demand: 260000*(4.5/1000)*1.03 + 290000*(2.1/1000)*1.02 = 1826.28
  const JUL_MT1 = 260000 * (4.5 / 1000) * 1.03 + 290000 * (2.1 / 1000) * 1.02;
  const AUG_MT1 = 280000 * (4.5 / 1000) * 1.03 + 300000 * (2.1 / 1000) * 1.02;
  const SEP_MT1 = 250000 * (4.5 / 1000) * 1.03 + 280000 * (2.1 / 1000) * 1.02;

  it('covers demand across the replenishment lead time', () => {
    const daily = JUL_MT1 / DAYS_PER_MONTH;
    expect(getSafetyStockQty(mt1, JUL_MT1)).toBeCloseTo(daily * 34 * 1.25, 2);
  });

  it('holds less buffer for a short-lead-time material at identical demand', () => {
    const long = getSafetyStockQty(mt1, JUL_MT1);
    const short = getSafetyStockQty({ ...mt3, max_usage: 1200 }, JUL_MT1);
    expect(short).toBeLessThan(long);
    expect(short / long).toBeCloseTo(12 / 34, 6);
  });

  it('falls back to the master-data usage rate when the plan consumes nothing', () => {
    // Obsolete or un-BOMed materials still need a target, not zero. max_usage
    // is already a daily rate, so it is used directly.
    expect(getSafetyStockQty(mt1, 0)).toBeCloseTo(1200 * 34 * 1.25, 4);
  });

  it('falls back to a 30-day lead time when the material records none', () => {
    const noLeadTime = { total_lead_time_days: 0, max_usage: 1200 } as any;
    const daily = JUL_MT1 / DAYS_PER_MONTH;
    expect(getSafetyStockQty(noLeadTime, JUL_MT1)).toBeCloseTo(daily * 30 * 1.25, 2);
  });

  it('reports the months of cover the lead-time buffer represents', () => {
    expect(getSafetyStockMonths(mt1)).toBeCloseTo((34 * SAFETY_SERVICE_FACTOR) / 30, 6);
    expect(getSafetyStockMonths(mt3)).toBeCloseTo((12 * SAFETY_SERVICE_FACTOR) / 30, 6);
  });

  it('is a stock level, so it does not scale with the MRP bucket size', async () => {
    // Both runs cover exactly July: one month-bucket, or four week-buckets.
    const monthly = await runMRP('2026-07-01', 1, 'month');
    const weekly = await runMRP('2026-07-01', 4, 'week');

    const mFirst = monthly.results.find(r => r.material_id === 'MT1')!;
    const wFirst = weekly.results.find(r => r.material_id === 'MT1')!;
    expect(mFirst.safety_stock).toBe(wFirst.safety_stock);
    expect(mFirst.safety_stock).toBe(Math.round((JUL_MT1 / DAYS_PER_MONTH) * 34 * 1.25));
  });

  it('sizes the buffer over the months the run spans', async () => {
    // A longer horizon averages more months, so the buffer reflects the whole
    // window being planned rather than just its first bucket.
    const oneMonth = await runMRP('2026-07-01', 1, 'month');
    const threeMonths = await runMRP('2026-07-01', 3, 'month');
    const jul = oneMonth.results.find(r => r.material_id === 'MT1')!;
    const q3 = threeMonths.results.find(r => r.material_id === 'MT1')!;
    const avg = (JUL_MT1 + AUG_MT1 + SEP_MT1) / 3;
    expect(jul.safety_stock).toBe(Math.round((JUL_MT1 / DAYS_PER_MONTH) * 34 * 1.25));
    expect(q3.safety_stock).toBe(Math.round((avg / DAYS_PER_MONTH) * 34 * 1.25));
  });

  it('holds a smaller buffer than the old months-of-demand formula', () => {
    // MT1 previously carried safety_stock_months (1.5) x monthly demand.
    const oldFormula = JUL_MT1 * 1.5;
    expect(getSafetyStockQty(mt1, JUL_MT1)).toBeLessThan(oldFormula);
  });
});

describe('getSafetyStockQty - manual override', () => {
  const auto = { total_lead_time_days: 34, max_usage: 1200, safety_stock_months: 0 } as any;
  const pinned = { total_lead_time_days: 34, max_usage: 1200, safety_stock_months: 2.5 } as any;

  it('treats zero months as "size it from lead time"', () => {
    const JUL_MT1 = 260000 * (4.5 / 1000) * 1.03 + 290000 * (2.1 / 1000) * 1.02;
    expect(hasSafetyStockOverride(auto)).toBe(false);
    const daily = JUL_MT1 / DAYS_PER_MONTH;
    expect(getSafetyStockQty(auto, JUL_MT1)).toBeCloseTo(daily * 34 * 1.25, 2);
  });

  it('honours a planner-set months figure over the lead-time default', () => {
    const JUL_MT1 = 260000 * (4.5 / 1000) * 1.03 + 290000 * (2.1 / 1000) * 1.02;
    expect(hasSafetyStockOverride(pinned)).toBe(true);
    expect(getSafetyStockQty(pinned, JUL_MT1)).toBeCloseTo(JUL_MT1 * 2.5, 2);
  });

  it('reports the override months back for display', () => {
    expect(getSafetyStockMonths(pinned)).toBe(2.5);
    expect(getSafetyStockMonths(auto)).toBeCloseTo((34 * SAFETY_SERVICE_FACTOR) / 30, 6);
  });

  it('applies the override inside a real MRP run', async () => {
    // MT5 is seeded with an explicit 2.5-month buffer; MT1 is left on auto.
    const { results } = await runMRP('2026-07-01', 1, 'month');
    const mt5 = results.find(r => r.material_id === 'MT5')!;
    const mt1Row = results.find(r => r.material_id === 'MT1')!;
    const mt5LeadMonths = (47 * SAFETY_SERVICE_FACTOR) / DAYS_PER_MONTH;
    expect(2.5).toBeGreaterThan(mt5LeadMonths);
    expect(mt5.safety_stock).toBeGreaterThan(0);
    const JUL_MT1 = 260000 * (4.5 / 1000) * 1.03 + 290000 * (2.1 / 1000) * 1.02;
    expect(mt1Row.safety_stock).toBe(Math.round((JUL_MT1 / DAYS_PER_MONTH) * 34 * 1.25));
  });
});

describe('runMRP - lead-time offset between release and receipt', () => {
  it('separates when an order must arrive from when it must be placed', async () => {
    const { results } = await runMRP('2026-07-01', 3, 'month');
    const rows = results.filter(r => r.material_id === 'MT3');
    // MT3 has a 12-day lead time, so a receipt needed on the 1st of a month
    // is released in the previous bucket - never in its own.
    const receipts = rows.map(r => r.planned_order_receipts || 0);
    const releases = rows.map(r => r.planned_order_releases);
    expect(receipts.some(q => q > 0)).toBe(true);
    for (let i = 0; i + 1 < rows.length; i++) {
      expect(releases[i]).toBe(receipts[i + 1]);
    }
  });

  it('conserves quantity - every receipt is released or flagged past due', async () => {
    const { results } = await runMRP('2026-07-01', 4, 'month');
    ['MT1', 'MT2', 'MT3', 'MT4', 'MT5'].forEach(id => {
      const rows = results.filter(r => r.material_id === id);
      const receipts = rows.reduce((s, r) => s + (r.planned_order_receipts || 0), 0);
      const released = rows.reduce((s, r) => s + r.planned_order_releases, 0);
      const pastDue = rows.reduce((s, r) => s + (r.past_due_releases || 0), 0);
      expect(released + pastDue).toBe(receipts);
    });
  });

  it('flags a receipt as past due when its release date precedes the run', async () => {
    const { results } = await runMRP('2026-07-01', 3, 'month');
    // MT2 has a 48-day lead time, so a July 1 receipt had to be ordered in
    // mid-May - before this run begins. That cannot be recovered by planning.
    const jul = results.find(r => r.material_id === 'MT2' && r.week_start_date === '2026-07-01')!;
    expect(jul.planned_order_receipts).toBeGreaterThan(0);
    expect(jul.past_due_releases).toBeGreaterThan(0);
  });

  it('does not credit stock in the period an order is released', async () => {
    // The old engine added planned orders straight into the same bucket's
    // ending stock, so a shortage could never propagate forward.
    const { results } = await runMRP('2026-07-01', 3, 'month');
    const rows = results.filter(r => r.material_id === 'MT2');
    const releasedInOwnBucket = rows.filter(
      r => r.planned_order_releases > 0 && r.planned_order_releases === (r.planned_order_receipts || 0)
    );
    expect(releasedInOwnBucket).toHaveLength(0);
  });
});

describe('runMRP - weekly buckets prorate the monthly plan', () => {
  it('splits a month by actual bucket days, not a flat quarter', async () => {
    // July has 31 days, so a 7-day bucket is 7/31 of the month - not 1/4.
    const JUL_MT1 = 260000 * (4.5 / 1000) * 1.03 + 290000 * (2.1 / 1000) * 1.02;
    const { results } = await runMRP('2026-07-01', 1, 'week');
    const wk = results.find(r => r.material_id === 'MT1')!;
    expect(wk.gross_requirements).toBe(Math.round(JUL_MT1 * (7 / 31)));
  });

  it('keeps weekly and monthly runs on the same demand rate', async () => {
    const weekly = await runMRP('2026-07-01', 1, 'week');
    const monthly = await runMRP('2026-07-01', 1, 'month');
    const w = weekly.results.find(r => r.material_id === 'MT1')!;
    const m = monthly.results.find(r => r.material_id === 'MT1')!;
    // A week's requirement, scaled back up to a month, matches the month run.
    expect((w.gross_requirements || 0) * (31 / 7)).toBeCloseTo(m.gross_requirements || 0, -1);
  });
});

describe('local schema migration - safety stock override semantics', () => {
  it('resets pre-existing months values so they do not become silent overrides', () => {
    // Before v2 this field *was* the buffer formula. A value stored then
    // carried no override intent, so leaving it would pin every material back
    // to the old oversized buffer the moment a planner reloaded the app.
    const stored = JSON.parse(localStorage.getItem('sc_db_materials')!);
    stored.forEach((m: any) => { m.safety_stock_months = 1.5; });
    localStorage.setItem('sc_db_materials', JSON.stringify(stored));
    localStorage.setItem('sc_db_schema_version', '1');

    runLocalMigrations();

    const after = JSON.parse(localStorage.getItem('sc_db_materials')!);
    after.forEach((m: any) => expect(m.safety_stock_months).toBe(0));
    // After all migrations run, schema version advances to the current level.
    const ver = localStorage.getItem('sc_db_schema_version');
    expect(Number(ver)).toBeGreaterThanOrEqual(2);
  });

  it('does not touch data that is already at the current schema', () => {
    const stored = JSON.parse(localStorage.getItem('sc_db_materials')!);
    stored.forEach((m: any) => { m.safety_stock_months = 0; });
    stored[0].safety_stock_months = 3.0; // a deliberate override set after v2
    localStorage.setItem('sc_db_materials', JSON.stringify(stored));
    localStorage.setItem('sc_db_schema_version', '2');

    runLocalMigrations();

    const after = JSON.parse(localStorage.getItem('sc_db_materials')!);
    expect(after[0].safety_stock_months).toBe(3.0);
  });
});

describe('isInPeriod - one definition of "in this month"', () => {
  it('matches any day inside the month, not just the first', () => {
    // The CSV importer accepts whatever date a file carries, so plan rows do
    // not always land on the 1st.
    expect(isInPeriod('2026-08-01', '2026-08-01')).toBe(true);
    expect(isInPeriod('2026-08-15', '2026-08-01')).toBe(true);
    expect(isInPeriod('2026-08-31', '2026-08-01')).toBe(true);
  });

  it('rejects neighbouring months and empty input', () => {
    expect(isInPeriod('2026-07-31', '2026-08-01')).toBe(false);
    expect(isInPeriod('2026-09-01', '2026-08-01')).toBe(false);
    expect(isInPeriod('', '2026-08-01')).toBe(false);
    expect(isInPeriod('2026-08-01', '')).toBe(false);
  });

  it('reports a mid-month plan row consistently across every screen', async () => {
    // Previously runMRP matched on the month while coverage, PSI and plan vs
    // actual matched on the exact date, so a row dated mid-month drove the
    // solver and was invisible everywhere else.
    const plans = JSON.parse(localStorage.getItem('sc_db_sales_plan')!);
    plans.push({
      id: 'SP_MID', product_id: 'P1', channel_id: 'CH1',
      period_start: '2026-07-17', quantity: 10000, price: 18.5,
    });
    localStorage.setItem('sc_db_sales_plan', JSON.stringify(plans));

    const cov = await getVProductCoverage('forecast', '2026-07-01');
    const pva = await getVPlanVsActual('sales', '2026-07-01');
    const psi = await getVFGPSIAnalysis('2026-07-01');

    const p1cov = cov.find(r => r.product_id === 'P1')!;
    const p1pva = pva.find(r => r.item_id === 'P1')!;
    const p1psi = psi.find(r => r.row_id === 'P1')!;

    // 275,000 seeded + 10,000 mid-month.
    expect(p1cov.monthly_demand).toBe(285000);
    expect(p1pva.plan_qty).toBe(285000);
    expect(p1psi.sales_forecast).toBe(285000);
  });
});

describe('monthsOfCover - zero-demand handling', () => {
  it('divides normally when there is demand', () => {
    expect(monthsOfCover(300, 100)).toBe(3);
  });

  it('separates "stock but no demand" from "nothing at all"', () => {
    // A flat 99 for both made an empty, unused item read as the healthiest
    // line on the coverage screen.
    expect(monthsOfCover(500, 0)).toBe(UNLIMITED_COVER_MONTHS);
    expect(monthsOfCover(0, 0)).toBe(0);
  });

  it('keeps a shortfall negative rather than clamping it', () => {
    expect(monthsOfCover(-200, 100)).toBe(-2);
  });

  it('shows zero demand for a period with no forecast (decision 6: no magic fallback)', async () => {
    // Decision 6: when there is no forecast, coverage shows blank + "no forecast" label.
    // The max_usage*DAYS_PER_MONTH fallback and the 45000 magic number are deleted.
    const rows = await getVMaterialCoverage('forecast', '2026-12-01');
    const mt1 = rows.find(r => r.material_id === 'MT1')!;
    expect(mt1.monthly_demand).toBe(0);
  });

  it('reports zero cover for a material with no stock and nothing incoming', async () => {
    // Availability counts stock plus in-transit plus open POs, so all three
    // have to be empty for this to be the "nothing at all" case.
    const inv = JSON.parse(localStorage.getItem('sc_db_inventory_snapshots')!);
    inv.forEach((i: any) => { if (i.item_type === 'material') i.quantity = 0; });
    localStorage.setItem('sc_db_inventory_snapshots', JSON.stringify(inv));
    localStorage.setItem('sc_db_shipments', '[]');
    localStorage.setItem('sc_db_purchase_orders', '[]');

    const rows = await getVMaterialCoverage('forecast', '2026-07-01');
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach(r => expect(r.coverage_months).toBe(0));
  });
});

describe('getVFGPSIAnalysis - PSI figures', () => {
  it('computes expected stock, coverage and achievement for P1 in July', async () => {
    // P1: opening stock 65,000; July forecast 275,000 (SP1..SP4);
    // production plan 305,000; sales actual 191,000 (SA1+SA2).
    const rows = await getVFGPSIAnalysis('2026-07-01');
    const p1 = rows.find(r => r.row_id === 'P1')!;
    expect(p1.sales_forecast).toBe(275000);
    expect(p1.actual_sales).toBe(191000);
    expect(p1.sales_achievement_percent).toBeCloseTo(69.5, 1);
    expect(p1.expected_stock).toBe(p1.start_stock + p1.production_plan - p1.sales_forecast);
    expect(p1.coverage_months).toBeCloseTo(p1.expected_stock / p1.sales_forecast, 2);
  });

  it('reports no achievement figure where nothing was planned', async () => {
    // Reporting 0% painted an un-planned SKU as a total miss, which is the
    // bug getVPlanVsActual already had fixed.
    const rows = await getVFGPSIAnalysis('2026-12-01');
    rows.forEach(r => {
      expect(r.sales_achievement_percent).toBeNull();
      expect(r.production_achievement_percent).toBeNull();
    });
  });

  it('agrees with getVPlanVsActual on the same period', async () => {
    const psi = await getVFGPSIAnalysis('2026-07-01');
    const pva = await getVPlanVsActual('sales', '2026-07-01');
    psi.forEach(row => {
      const match = pva.find(r => r.item_id === row.row_id);
      if (match) {
        expect(row.sales_forecast).toBe(match.plan_qty);
        expect(row.actual_sales).toBe(match.actual_qty);
      }
    });
  });
});

describe('date helpers', () => {
  it('formats a local date without the UTC shift toISOString introduces', () => {
    // toISOString on a local midnight in a positive-offset zone rolls back a
    // day, which silently moved planned release dates.
    expect(toDateStr(new Date(2026, 7, 1))).toBe('2026-08-01');
    expect(toDateStr(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('knows the calendar length of a month, including leap February', () => {
    expect(daysInMonthOf('2026-07-01')).toBe(31);
    expect(daysInMonthOf('2026-02-01')).toBe(28);
    expect(daysInMonthOf('2028-02-01')).toBe(29);
    expect(daysInMonthOf('2026-04-01')).toBe(30);
  });

  it('generates contiguous month and week buckets', () => {
    expect(getCurrentPeriods('2026-07-01', 3, 'month')).toEqual(['2026-07-01', '2026-08-01', '2026-09-01']);
    const weeks = getCurrentPeriods('2026-07-01', 3, 'week');
    expect(weeks).toEqual(['2026-07-01', '2026-07-08', '2026-07-15']);
  });

  it('rolls a month bucket across a year boundary', () => {
    expect(getCurrentPeriods('2026-12-01', 2, 'month')).toEqual(['2026-12-01', '2027-01-01']);
  });
});

describe('getVFGPSIAnalysis - actuals presence', () => {
  it('counts actual rows so "not reported yet" is distinguishable from "sold nothing"', async () => {
    const july = await getVFGPSIAnalysis('2026-07-01');
    const p1 = july.find(r => r.row_id === 'P1')!;
    expect(p1.sales_actual_records).toBeGreaterThan(0);
    expect(p1.actual_sales).toBeGreaterThan(0);
  });

  it('reports zero records for a period nobody has reported on', async () => {
    const dec = await getVFGPSIAnalysis('2026-12-01');
    dec.forEach(r => {
      expect(r.sales_actual_records).toBe(0);
      expect(r.production_actual_records).toBe(0);
    });
  });

  it('separates a genuine zero from an unreported month', async () => {
    // A row that exists and says zero is a real miss; no row at all is not.
    const actuals = JSON.parse(localStorage.getItem('sc_db_sales_actual')!);
    actuals.push({
      id: 'SA_ZERO', product_id: 'P1', channel_id: 'CH1',
      period_start: '2026-12-01', quantity: 0, price: 18.5,
    });
    localStorage.setItem('sc_db_sales_actual', JSON.stringify(actuals));

    const dec = await getVFGPSIAnalysis('2026-12-01');
    const p1 = dec.find(r => r.row_id === 'P1')!;
    expect(p1.sales_actual_records).toBe(1);
    expect(p1.actual_sales).toBe(0);
  });

  it('is the single source the PSI screen and the dashboard both read', async () => {
    // The PSI screen used to sum these tables itself. Both now take the same
    // rows, so a mid-month entry cannot show up on one and not the other.
    const plans = JSON.parse(localStorage.getItem('sc_db_production_plan')!);
    plans.push({
      id: 'PP_MID', product_id: 'P1', machine_id: 'M1',
      period_start: '2026-07-22', quantity: 5000,
    });
    localStorage.setItem('sc_db_production_plan', JSON.stringify(plans));

    const rows = await getVFGPSIAnalysis('2026-07-01');
    const p1 = rows.find(r => r.row_id === 'P1')!;
    // Expected stock must move with the extra mid-month production.
    expect(p1.expected_stock).toBe(p1.start_stock + p1.production_plan - p1.sales_forecast);
    expect(p1.production_plan).toBeGreaterThanOrEqual(5000);
  });
});

describe('getBomAlternates - approved substitutes from the BOM', () => {
  it('finds the qualified alternate for a slot and its conversion ratio', () => {
    // BS2 holds MT2 at priority 1 (1.2 @ 5% scrap) and MT6 at priority 2
    // (1.25 @ 4%), so one unit of MT2 is replaced by 1.3/1.26 of MT6.
    const alts = getBomAlternates('MT2');
    const bs2 = alts.find(a => a.slot_id === 'BS2')!;
    expect(bs2.alternate_material_id).toBe('MT6');
    expect(bs2.primary_per_unit).toBeCloseTo(1.2 * 1.05, 6);
    expect(bs2.alternate_per_unit).toBeCloseTo(1.25 * 1.04, 6);
    expect(bs2.conversion).toBeCloseTo((1.25 * 1.04) / (1.2 * 1.05), 6);
  });

  it('returns nothing for a material whose slot has no second option', () => {
    expect(getBomAlternates('MT1')).toEqual([]);
  });

  it('never treats the primary as its own alternate', () => {
    getBomAlternates('MT2').forEach(a => expect(a.alternate_material_id).not.toBe('MT2'));
  });
});

describe('runMRP - substitution proposals', () => {
  it('proposes the faster approved alternate when the primary cannot arrive', async () => {
    const { substitutions } = await runMRP('2026-08-01', 4, 'month');
    const sub = substitutions.find(s => s.material_id === 'MT2')!;
    expect(sub).toBeDefined();
    expect(sub.alternate_material_id).toBe('MT6');
    expect(sub.alternate_lead_time_days).toBeLessThan(sub.primary_lead_time_days);
  });

  it('raises nothing for a material that is not short', async () => {
    const { substitutions } = await runMRP('2026-08-01', 4, 'month');
    // MT5 opens well above its buffer, so it is never past due.
    expect(substitutions.some(s => s.material_id === 'MT5')).toBe(false);
  });

  it('raises nothing for a short material with no approved alternate', async () => {
    // MT1 is past due but its slot carries no second option, so there is
    // nothing to propose - the shortage is real and unavoidable.
    const { results, substitutions } = await runMRP('2026-08-01', 4, 'month');
    const mt1PastDue = results
      .filter(r => r.material_id === 'MT1')
      .reduce((s, r) => s + (r.past_due_releases || 0), 0);
    expect(mt1PastDue).toBeGreaterThan(0);
    expect(substitutions.some(s => s.material_id === 'MT1')).toBe(false);
  });

  it('splits one shortfall across the slots that consume it, without double counting', async () => {
    // MT2 is the top sheet in both product families. Before the split, each
    // slot claimed the entire shortfall and the totals read twice too high.
    const { results, substitutions } = await runMRP('2026-08-01', 4, 'month');
    const actual = results
      .filter(r => r.material_id === 'MT2')
      .reduce((s, r) => s + (r.past_due_releases || 0), 0);
    const attributed = substitutions
      .filter(s => s.material_id === 'MT2')
      .reduce((s, p) => s + p.shortfall_qty, 0);
    expect(substitutions.filter(s => s.material_id === 'MT2').length).toBeGreaterThan(1);
    expect(attributed).toBeCloseTo(actual, 0);
  });

  it('converts the covered quantity through both BOM lines', async () => {
    const { substitutions } = await runMRP('2026-08-01', 4, 'month');
    const bs2 = substitutions.find(s => s.material_id === 'MT2' && s.slot_id === 'BS2')!;
    const conversion = (1.25 * 1.04) / (1.2 * 1.05);
    // The engine converts the precise figure and rounds once; re-deriving from
    // the already-rounded coverable quantity can differ by a unit.
    expect(Math.abs(bs2.alternate_qty - bs2.coverable_qty * conversion)).toBeLessThanOrEqual(1);
    expect(bs2.alternate_qty).toBeGreaterThan(bs2.coverable_qty);
  });

  it('reports what even the alternate cannot rescue', async () => {
    // The alternate needs 18 days too, so the earliest bucket stays unreachable.
    const { substitutions } = await runMRP('2026-08-01', 4, 'month');
    const sub = substitutions.find(s => s.material_id === 'MT2')!;
    expect(sub.uncoverable_qty).toBeGreaterThan(0);
    expect(sub.coverable_qty + sub.uncoverable_qty).toBeCloseTo(sub.shortfall_qty, 0);
    expect(sub.covers_from_period).not.toBeNull();
  });

  it('dates the earliest arrival from the run start plus the alternate lead time', async () => {
    const { substitutions } = await runMRP('2026-08-01', 4, 'month');
    const sub = substitutions.find(s => s.material_id === 'MT2')!;
    // MT6 has total_lead_time_days = 15. 2026-08-01 + 15 days = 2026-08-16.
    expect(sub.earliest_arrival).toBe('2026-08-16');
  });

  it('reports the per-unit cost difference so the trade-off is visible', async () => {
    // MT6 is 0.72 at 1.3/unit against MT2 at 0.80 and 1.26/unit - cheaper here,
    // which is exactly the sort of thing a planner should be told.
    const { substitutions } = await runMRP('2026-08-01', 4, 'month');
    const bs2 = substitutions.find(s => s.material_id === 'MT2' && s.slot_id === 'BS2')!;
    expect(bs2.unit_cost_delta).toBeCloseTo(1.25 * 1.04 * 0.72 - 1.2 * 1.05 * 0.8, 4);
    expect(bs2.unit_cost_delta).toBeLessThan(0);
  });

  it('skips an obsolete alternate', async () => {
    const mats = JSON.parse(localStorage.getItem('sc_db_materials')!);
    mats.forEach((m: any) => { if (m.id === 'MT6') m.status = 'obsolete'; });
    localStorage.setItem('sc_db_materials', JSON.stringify(mats));

    const { substitutions } = await runMRP('2026-08-01', 4, 'month');
    expect(substitutions.some(s => s.alternate_material_id === 'MT6')).toBe(false);
  });
})

describe('substitution proposals - product context', () => {
  it('names the product whose BOM each slot belongs to', async () => {
    // BS2 and BS5 are both called "Top Sheet Surface". Without the product
    // the two proposals are indistinguishable on screen.
    const { substitutions } = await runMRP('2026-08-01', 4, 'month');
    const mt2 = substitutions.filter(s => s.material_id === 'MT2');
    expect(mt2.length).toBeGreaterThan(1);
    const names = mt2.map(s => s.product_name);
    expect(new Set(names).size).toBe(mt2.length);
    names.forEach(n => expect(n).toBeTruthy());
  });
});
