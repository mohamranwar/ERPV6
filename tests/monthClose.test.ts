import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildScorecard, runReadiness, writeSnapshot, readSnapshotHistory, exportPeriodCsv,
} from '../src/services/monthClose';
import { readLocalTable, writeLocalTable } from '../src/supabaseClient';
import type {
  Material, Product, ProductCategory, ProductionActual, ProductionPlan,
  PurchaseOrder, SalesActual, SalesPlan, Shipment, InventorySnapshot,
} from '../src/types';
import { DEFAULT_THRESHOLDS } from '../src/hooks/useAppSettings';

/**
 * Fixtures. Two categories:
 *   - Baby: two products, SAME pack config (120 pcs/ctn) → cartons derivable
 *   - Mixed: two products, DIFFERENT pack configs → cartons must be refused
 */
const PRODUCTS: Product[] = [
  { id: 'P1', name: 'Baby M', sku: 'B-M', description: '', group_id: 'G1',
    category_id: 'CAT-BABY', brand: '', variant: '', product_line: 'SOFY',
    pack_type: '', size: 'M', status: 'running',
    pcs_per_bag: 30, bags_per_carton: 4, selling_price: 0, standard_cost: 0 },
  { id: 'P2', name: 'Baby L', sku: 'B-L', description: '', group_id: 'G1',
    category_id: 'CAT-BABY', brand: '', variant: '', product_line: 'SOFY',
    pack_type: '', size: 'L', status: 'running',
    pcs_per_bag: 30, bags_per_carton: 4, selling_price: 0, standard_cost: 0 },
  { id: 'P3', name: 'Wipes 40', sku: 'W-40', description: '', group_id: 'G2',
    category_id: 'CAT-MIX', brand: '', variant: '', product_line: 'Atlas',
    pack_type: '', size: '', status: 'running',
    pcs_per_bag: 40, bags_per_carton: 6, selling_price: 0, standard_cost: 0 },
  { id: 'P4', name: 'Wipes 80', sku: 'W-80', description: '', group_id: 'G2',
    category_id: 'CAT-MIX', brand: '', variant: '', product_line: 'Atlas',
    pack_type: '', size: '', status: 'running',
    pcs_per_bag: 80, bags_per_carton: 6, selling_price: 0, standard_cost: 0 },
];

const CATEGORIES: ProductCategory[] = [
  { id: 'CAT-BABY', name: 'Baby Diapers' },
  { id: 'CAT-MIX', name: 'Wet Wipes' },
];

const MATERIALS: Material[] = [
  { id: 'M1', name: 'SAP', sku: 'SAP-1', description: '', category_id: 'MC1',
    supplier_id: 'S1', supplier_lead_time_days: 10, transit_days: 5,
    customs_clearance_days: 3, total_lead_time_days: 18, reorder_point_days: 20,
    safety_stock_months: 1, moq: 0, max_usage: 1000, controller: '',
    status: 'running', standard_cost: 50, cost_basis: 'standard' },
  { id: 'M2', name: 'Film', sku: 'FLM-1', description: '', category_id: 'MC1',
    supplier_id: 'S1', supplier_lead_time_days: 10, transit_days: 5,
    customs_clearance_days: 3, total_lead_time_days: 18, reorder_point_days: 20,
    safety_stock_months: 1, moq: 0, max_usage: 500, controller: '',
    status: 'running', standard_cost: 0, cost_basis: 'standard' }, // uncosted
];

const PERIOD = '2026-08-01';

function baseInputs() {
  const salesPlans: SalesPlan[] = [
    { id: 'sp1', product_id: 'P1', channel_id: 'C1', period_type: 'month', period_start: '2026-08-01', quantity: 1000 },
    { id: 'sp2', product_id: 'P2', channel_id: 'C1', period_type: 'month', period_start: '2026-08-15', quantity: 500 },
  ];
  const salesActuals: SalesActual[] = [
    { id: 'sa1', product_id: 'P1', channel_id: 'C1', period_start: '2026-08-01', quantity: 900 },
    { id: 'sa2', product_id: 'P2', channel_id: 'C1', period_start: '2026-08-01', quantity: 550 },
  ];
  const productionPlans: ProductionPlan[] = [
    { id: 'pp1', product_id: 'P1', machine_id: 'MC1', period_type: 'month', period_start: '2026-08-01', quantity: 1200 } as ProductionPlan,
  ];
  const productionActuals: ProductionActual[] = [
    { id: 'pa1', product_id: 'P1', machine_id: 'MC1', period_start: '2026-08-01', quantity: 1100 },
  ];
  const purchaseOrders: PurchaseOrder[] = [
    { id: 'po1', material_id: 'M1', supplier_id: 'S1', order_no: 'PO-1', qty: 100,
      remaining_qty: 100, required_date: '2026-08-10', status: 'pending',
      timing: 'Normal', po_date: '2026-08-01', unit_price: 10 },
    { id: 'po2', material_id: 'M1', supplier_id: 'S1', order_no: 'PO-2', qty: 100,
      remaining_qty: 50, required_date: '2026-10-01', status: 'in_transit',
      timing: 'Normal', po_date: '2026-07-01', unit_price: 10 },
  ];
  const shipments: Shipment[] = [
    { id: 'sh1', material_id: 'M1', supplier_id: 'S1', qty: 200, invoice_no: 'I1',
      container_count: 2, ship_method: 'sea', port_eta: '2026-08-05',
      customs_clearance_days: 3, factory_arrival_date: '2026-08-09', delay: 0 },
    { id: 'sh2', material_id: 'M1', supplier_id: 'S1', qty: 100, invoice_no: 'I2',
      container_count: 1, ship_method: 'air', port_eta: '2026-08-20',
      customs_clearance_days: 60, factory_arrival_date: null, delay: 0 }, // still moving
  ];
  const inventory: InventorySnapshot[] = [
    { id: 'inv1', item_type: 'product', item_id: 'P1', snapshot_date: '2026-08-31', quantity: 3000 },
    { id: 'inv2', item_type: 'product', item_id: 'P1', snapshot_date: '2026-07-31', quantity: 9999 }, // older, must lose
    { id: 'inv3', item_type: 'material', item_id: 'M1', snapshot_date: '2026-08-31', quantity: 40 },
  ];

  return {
    period: PERIOD,
    products: PRODUCTS, categories: CATEGORIES, materials: MATERIALS,
    salesPlans, salesActuals, productionPlans, productionActuals,
    purchaseOrders, shipments, inventory,
  };
}

describe('buildScorecard — categories', () => {
  it('sums products into their category, matching on month not exact date', () => {
    const sc = buildScorecard(baseInputs());
    const baby = sc.categories.find(c => c.categoryId === 'CAT-BABY')!;
    // sp2 lands on the 15th; month matching must still include it.
    expect(baby.salesPlanPcs).toBe(1500);
    expect(baby.salesActualPcs).toBe(1450);
  });

  it('derives a single pack divisor when all products in a category agree', () => {
    const sc = buildScorecard(baseInputs());
    const baby = sc.categories.find(c => c.categoryId === 'CAT-BABY')!;
    expect(baby.pcsPerCarton).toBe(120); // 30 × 4
  });

  it('refuses a carton divisor for a category with mixed pack sizes', () => {
    // Summing pieces and dividing by ONE product's pack size would print a
    // confident but wrong carton figure. Null is the honest answer.
    const sc = buildScorecard(baseInputs());
    const mixed = sc.categories.find(c => c.categoryId === 'CAT-MIX')!;
    expect(mixed.pcsPerCarton).toBeNull();
  });

  it('uses the latest inventory snapshot, not an older one', () => {
    const sc = buildScorecard(baseInputs());
    const baby = sc.categories.find(c => c.categoryId === 'CAT-BABY')!;
    expect(baby.fgStockPcs).toBe(3000); // not the stale 9999
  });
});

describe('buildScorecard — RM value coverage', () => {
  it('values inventory at standard cost', () => {
    const sc = buildScorecard(baseInputs());
    expect(sc.rmInventoryValue).toBe(40 * 50); // qty × standard_cost
  });

  it('excludes uncosted materials from consumption value rather than inventing a cost', () => {
    const sc = buildScorecard(baseInputs());
    // M1: 1000 × 50. M2 has standard_cost 0 and contributes nothing.
    expect(sc.rmConsumptionValue).toBe(50_000);
  });
});

describe('buildScorecard — PO and containers', () => {
  it('counts open POs and flags those past their required date as delayed', () => {
    const sc = buildScorecard(baseInputs());
    expect(sc.poTotal).toBe(2);
    expect(sc.poDelayed).toBe(1); // PO-1 required 2026-08-10, within month
  });

  it('values open POs on remaining quantity, not ordered quantity', () => {
    const sc = buildScorecard(baseInputs());
    expect(sc.poOpenValue).toBe(100 * 10 + 50 * 10);
  });

  it('counts containers by count field, split by ship method', () => {
    const sc = buildScorecard(baseInputs());
    expect(sc.containersTotal).toBe(3);
    expect(sc.containersSea).toBe(2);
    expect(sc.containersAir).toBe(1);
  });

  it('treats a shipment without a factory arrival date as still at port', () => {
    const sc = buildScorecard(baseInputs());
    // sh2 has factory_arrival_date null → not landed → at port/at sea.
    expect(sc.containersAtPort).toBe(1);
    expect(sc.containersCleared).toBe(2); // sh1's two containers arrived
  });

  it('values only un-arrived shipments as in-transit RM', () => {
    const sc = buildScorecard(baseInputs());
    // sh1 (200 pcs) arrived; only sh2 (100 × cost 50) is still in transit.
    expect(sc.rmInTransitValue).toBe(100 * 50);
  });
});

describe('runReadiness — the gate', () => {
  it('passes when actuals exist and POs are dated', () => {
    const inp = baseInputs();
    const checks = runReadiness(inp, buildScorecard(inp));
    expect(checks.filter(c => c.severity === 'fail')).toHaveLength(0);
  });

  it('blocks the close when sales actuals are missing', () => {
    const inp = { ...baseInputs(), salesActuals: [] };
    const checks = runReadiness(inp, buildScorecard(inp));
    const fail = checks.find(c => c.id === 'sales');
    expect(fail?.severity).toBe('fail');
  });

  it('blocks the close when an open PO has no required date', () => {
    const inp = baseInputs();
    inp.purchaseOrders.push({
      id: 'po3', material_id: 'M1', supplier_id: 'S1', order_no: 'PO-3', qty: 10,
      remaining_qty: 10, required_date: '', status: 'pending',
      timing: 'Normal', po_date: '2026-08-05', unit_price: 5,
    });
    const checks = runReadiness(inp, buildScorecard(inp));
    const fail = checks.find(c => c.id === 'po_dates');
    expect(fail?.severity).toBe('fail');
    expect(fail?.detail).toContain('PO-3');
  });

  it('warns — not blocks — on uncosted materials', () => {
    // M2 is uncosted in the fixtures. Valuation gaps are common early on and
    // the coverage figure is still directionally useful; blocking would train
    // people to bypass the gate.
    const inp = baseInputs();
    const checks = runReadiness(inp, buildScorecard(inp));
    const check = checks.find(c => c.id === 'rm_cost');
    expect(check?.severity).toBe('warn');
  });

  it('warns on categories without a single pack configuration', () => {
    const inp = baseInputs();
    const checks = runReadiness(inp, buildScorecard(inp));
    const check = checks.find(c => c.id === 'pack');
    expect(check?.severity).toBe('warn');
    expect(check?.detail).toContain('Wet Wipes');
  });
});

describe('snapshot round trip', () => {
  beforeEach(() => {
    localStorage.clear();
    writeLocalTable('period_snapshots', []);
  });

  it('writes a snapshot readable from history with the attainment derived', async () => {
    const inp = baseInputs();
    const sc = buildScorecard(inp);
    await writeSnapshot({
      scorecard: sc,
      readiness: runReadiness(inp, sc),
      thresholds: DEFAULT_THRESHOLDS,
      userId: 'U1',
    });

    const history = readSnapshotHistory();
    expect(history).toHaveLength(1);
    expect(history[0].period).toBe(PERIOD);
    // sales actual 1450 / plan 1500 ≈ 96.7%
    expect(history[0].attainmentPct).toBeCloseTo(96.67, 1);
    expect(history[0].closedBy).toBe('U1');
  });

  it('re-closing the same period replaces the row rather than duplicating it', async () => {
    const inp = baseInputs();
    const sc = buildScorecard(inp);
    const args = {
      scorecard: sc, readiness: runReadiness(inp, sc),
      thresholds: DEFAULT_THRESHOLDS, userId: 'U1',
    };
    await writeSnapshot(args);
    await writeSnapshot(args);
    expect(readSnapshotHistory()).toHaveLength(1);
  });

  it('stores the thresholds in force at close', async () => {
    // The reason: editing a band in Settings next year must not repaint the
    // colour of this month's history. The snapshot carries its own bands.
    const inp = baseInputs();
    const sc = buildScorecard(inp);
    const custom = { ...DEFAULT_THRESHOLDS, attainment_watch: 92 };
    await writeSnapshot({
      scorecard: sc, readiness: [], thresholds: custom, userId: 'U1',
    });

    // Read through the same API the service writes through — hardcoding the
    // storage key here couples the test to an implementation detail.
    const raw = readLocalTable<any>('period_snapshots');
    expect(raw[0]?.thresholds_applied?.attainment_watch).toBe(92);
  });

  it('stores pack counts inside the category breakdown', async () => {
    // If a pack size changes next year, last year's carton figures must stay
    // correct. That requires freezing the divisor with the snapshot.
    const inp = baseInputs();
    const sc = buildScorecard(inp);
    await writeSnapshot({
      scorecard: sc, readiness: [], thresholds: DEFAULT_THRESHOLDS, userId: 'U1',
    });

    const raw = readLocalTable<any>('period_snapshots');
    const baby = raw[0]?.category_breakdown?.find((c: any) => c.category_id === 'CAT-BABY');
    expect(baby?.pcs_per_carton).toBe(120);
    const mixed = raw[0]?.category_breakdown?.find((c: any) => c.category_id === 'CAT-MIX');
    expect(mixed?.pcs_per_carton).toBeNull();
  });
});
