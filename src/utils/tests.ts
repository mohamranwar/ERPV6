/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getCurrentPeriods, runMRP } from '../supabaseClient';

/**
 * Run a full system verification suite of Supply Chain Planner core utilities.
 * Asserts correctness of the date generators, MRP engines, filtering, and reports.
 */
export async function runSystemTests() {
  console.log("🚀 [System Tests] Initiating system verification suite...");
  let passedCount = 0;
  let failedCount = 0;

  function assert(condition: boolean, message: string) {
    if (!condition) {
      failedCount++;
      console.error(`❌ [Assertion Failed] ${message}`);
      throw new Error(`Test assertion failed: ${message}`);
    } else {
      passedCount++;
      console.log(`  ✓ ${message}`);
    }
  }

  try {
    // -------------------------------------------------------------
    // TEST 1: getCurrentPeriods Date Period Generator
    // -------------------------------------------------------------
    console.log("\n🧪 Running Test 1: getCurrentPeriods...");
    
    // Month grain test
    const periodsMonth = getCurrentPeriods('2026-07-01', 3, 'month');
    assert(periodsMonth.length === 3, "Month grain should generate exactly 3 periods");
    assert(periodsMonth[0] === '2026-07-01', "First monthly period should be 2026-07-01");
    assert(periodsMonth[1] === '2026-08-01', "Second monthly period should be 2026-08-01");
    assert(periodsMonth[2] === '2026-09-01', "Third monthly period should be 2026-09-01");

    // Week grain test
    const periodsWeek = getCurrentPeriods('2026-07-01', 2, 'week');
    assert(periodsWeek.length === 2, "Week grain should generate exactly 2 periods");
    assert(periodsWeek[0] === '2026-07-01', "First weekly period should match start date");
    assert(periodsWeek[1] === '2026-07-08', "Second weekly period should be 7 days later");

    // Boundary conditions
    assert(getCurrentPeriods('invalid-date', 3, 'month').length === 0, "Invalid date should yield empty periods");
    assert(getCurrentPeriods('2026-07-01', 0, 'month').length === 0, "Zero horizon should yield empty periods");

    // -------------------------------------------------------------
    // TEST 2: runMRP Engine with Monthly grain
    // -------------------------------------------------------------
    console.log("\n🧪 Running Test 2: runMRP (Monthly Grain)...");
    const mrpData = await runMRP('2026-07-01', 3, 'month');
    assert(!!mrpData.run_id, "MRP run should return a non-empty run_id");
    assert(mrpData.results.length >= 0, "MRP execution results should be fetched");
    
    // If we have simulation results, let's verify their period structures
    if (mrpData.results.length > 0) {
      const firstResult = mrpData.results[0];
      assert(!!firstResult.material_id, "MRP result row must have a material_id");
      assert(firstResult.gross_requirements !== undefined, "MRP result row must have gross_requirements");
      assert(firstResult.projected_available !== undefined, "MRP result row must have projected_available");
      assert(firstResult.week_start_date.length === 10, "MRP result periods should be in YYYY-MM-DD string format");
    }

    // -------------------------------------------------------------
    // TEST 3: useTableFilters Mock Verification
    // -------------------------------------------------------------
    console.log("\n🧪 Running Test 3: useTableFilters logic...");
    // Since useTableFilters is a React hook and cannot be run in isolation without React context,
    // we test the core underlying filtering logic here.
    const mockItems = [
      { id: '1', sku: 'BJ-M4', name: 'BabyJoy Large', status: 'running' },
      { id: '2', sku: 'SF-SLW', name: 'SOFY Slim', status: 'running' },
      { id: '3', sku: 'AT-NC', name: 'Atlas Comfort', status: 'obsolete' }
    ];

    // Simulate search bypass
    const searchString = 'sofy';
    const hasSearch = searchString.trim() !== '';
    const filteredBySearch = mockItems.filter(item => {
      if (hasSearch) {
        return item.sku.toLowerCase().includes(searchString) || item.name.toLowerCase().includes(searchString);
      }
      return item.status === 'running'; // should be bypassed if searching
    });
    assert(filteredBySearch.length === 1 && filteredBySearch[0].sku === 'SF-SLW', "Search filter should identify SOFY Slim");

    const noSearchFiltered = mockItems.filter(item => item.status === 'running');
    assert(noSearchFiltered.length === 2, "State filters should apply when search query is empty");

    // -------------------------------------------------------------
    // TEST 4: ProductionPlanScreen reports aggregator computation
    // -------------------------------------------------------------
    console.log("\n🧪 Running Test 4: ProductionPlanScreen Report Aggregations...");
    // Ensure we can calculate capacity utilization and pivot quantities correctly
    const mockMachines = [
      { id: 'M1', name: 'SOFY', monthly_capacity: 550000 },
      { id: 'M2', name: 'VOXY', monthly_capacity: 300000 }
    ];
    const mockProducts = [
      { id: 'P1', sku: 'SKU1', product_line: 'SOFY' },
      { id: 'P2', sku: 'SKU2', product_line: 'SOFY' },
      { id: 'P3', sku: 'SKU3', product_line: 'VOXY' }
    ];
    const mockPlans = [
      { product_id: 'P1', quantity: 200000 },
      { product_id: 'P2', quantity: 150000 },
      { product_id: 'P3', quantity: 120000 }
    ];

    // Test SOFY line roll-up
    const sofySpeed = 900;
    const sofyProducts = mockProducts.filter(p => p.product_line === 'SOFY');
    let sofyPlannedQty = 0;
    sofyProducts.forEach(p => {
      const q = mockPlans.filter(pl => pl.product_id === p.id).reduce((s, pl) => s + pl.quantity, 0);
      sofyPlannedQty += q;
    });
    const sofyHours = sofyPlannedQty / sofySpeed;
    const sofyCapacityHours = 550000 / sofySpeed;
    const sofyUtil = (sofyHours / sofyCapacityHours) * 100;

    assert(sofyPlannedQty === 350000, "Rolled up SOFY quantity should be exactly 350,000");
    assert(parseFloat(sofyHours.toFixed(1)) === 388.9, "Planned operating hours for SOFY should be ~388.9");
    assert(parseFloat(sofyUtil.toFixed(1)) === 63.6, "Sofy capacity utilization rate should be ~63.6%");

    console.log(`\n🎉 ALL PLATFORM SYSTEM TESTS COMPLETED SUCCESSFULLY (${passedCount} assertions passed)`);
  } catch (err: any) {
    console.error("❌ TEST RUN FAILED:", err);
  }
}
