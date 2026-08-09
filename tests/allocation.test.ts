/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Stock allocation.
 *
 * The rule under test: an export SKU is not reserved for export. Domestic
 * channels and every other export order compete for the same physical pool, so
 * "how much can I promise this customer" is only answerable after subtracting
 * what everyone else has already claimed.
 */
import { describe, it, expect } from 'vitest';
import { buildAllocations, availableForOrder, claimsByCountry } from '../src/utils/allocation';
import { fetchTableData, getPlanningPeriod } from '../src/supabaseClient';
import type {
  Product, ExportForecast, InventorySnapshot, ProductionPlan, SalesPlan, Channel,
} from '../src/types';

const period = '2026-08-01';

const product = (id: string): Product => ({
  id, name: id, sku: id, description: '', group_id: 'G1', category_id: 'C1',
  brand: '', variant: '', product_line: 'SOFY', pack_type: '', size: '',
  status: 'running', pcs_per_bag: 10, bags_per_carton: 4,
  selling_price: 10, standard_cost: 5, uom: 'PCS',
});

const order = (id: string, country: string, lines: Array<[string, number]>): ExportForecast => ({
  id, order_number: `EXP-${id}`, country_code: country, country_name: country,
  customer_name: `${country} Co`, period_start: period, target_ship_date: period,
  order_status: 'confirmed', merged_to_sales_plan: false,
  items: lines.map(([pid, qty], i) => ({
    id: `${id}-L${i}`, product_id: pid, forecast_qty: qty,
    confirmed_order_qty: qty, produced_stock_qty: qty,
  })),
} as ExportForecast);

const channels: Channel[] = [
  { id: 'C1', name: 'Zeina Distributor', status: 'active' },
  { id: 'C4', name: 'Export Global', status: 'active' },
];

const build = (over: Partial<Parameters<typeof buildAllocations>[0]> = {}) =>
  buildAllocations({
    products: [product('P1')],
    exportOrders: [],
    inventory: [{ id: 'IV1', item_type: 'product', item_id: 'P1', snapshot_date: period, quantity: 100 }] as InventorySnapshot[],
    productionPlans: [] as ProductionPlan[],
    salesPlans: [] as SalesPlan[],
    channels,
    period,
    ...over,
  });

describe('buildAllocations', () => {
  it('treats supply as stock on hand plus production planned for the period', () => {
    const a = build({
      productionPlans: [{ id: 'PP1', product_id: 'P1', machine_id: 'M1', period_type: 'month', period_start: period, quantity: 50 }] as ProductionPlan[],
    }).get('P1')!;
    expect(a.onHand).toBe(100);
    expect(a.plannedProduction).toBe(50);
    expect(a.supply).toBe(150);
  });

  it('counts every export order claiming the SKU', () => {
    const a = build({
      exportOrders: [order('A', 'KSA', [['P1', 30]]), order('B', 'UAE', [['P1', 20]])],
    }).get('P1')!;
    expect(a.exportAllocated).toBe(50);
    expect(a.claims).toHaveLength(2);
    expect(a.free).toBe(50);
    expect(a.overAllocated).toBe(false);
  });

  it('subtracts demand booked through non-export channels', () => {
    // The heart of it: the same SKU sold domestically is not available to
    // promise to an export customer.
    const a = build({
      exportOrders: [order('A', 'KSA', [['P1', 30]])],
      salesPlans: [{ id: 'SP1', product_id: 'P1', channel_id: 'C1', period_type: 'month', period_start: period, quantity: 60 }] as SalesPlan[],
    }).get('P1')!;
    expect(a.otherChannelDemand).toBe(60);
    expect(a.free).toBe(10); // 100 supply - 30 export - 60 domestic
  });

  it('does not double-count export demand booked in the sales plan', () => {
    // An order can be merged into the sales plan under the export channel.
    // Counting both the order line and the plan row would charge it twice.
    const a = build({
      exportOrders: [order('A', 'KSA', [['P1', 30]])],
      salesPlans: [{ id: 'SP1', product_id: 'P1', channel_id: 'C4', period_type: 'month', period_start: period, quantity: 30 }] as SalesPlan[],
    }).get('P1')!;
    expect(a.otherChannelDemand).toBe(0);
    expect(a.free).toBe(70);
  });

  it('reports a negative free position rather than clamping it', () => {
    // Over-commitment is the condition this module exists to expose; hiding it
    // at zero would present an impossible plan as merely fully booked.
    const a = build({
      exportOrders: [order('A', 'KSA', [['P1', 80]]), order('B', 'UAE', [['P1', 70]])],
    }).get('P1')!;
    expect(a.free).toBe(-50);
    expect(a.overAllocated).toBe(true);
  });

  it('ignores demand from other periods', () => {
    const a = build({
      salesPlans: [{ id: 'SP1', product_id: 'P1', channel_id: 'C1', period_type: 'month', period_start: '2026-09-01', quantity: 999 }] as SalesPlan[],
    }).get('P1')!;
    expect(a.otherChannelDemand).toBe(0);
  });
});

describe('availableForOrder', () => {
  it("adds back the order's own claim so an edit is not blocked by itself", () => {
    // Editing an order from 30 to 35 must be measured against the 30 it
    // already holds, not told there is nothing left.
    const alloc = build({
      exportOrders: [order('A', 'KSA', [['P1', 30]]), order('B', 'UAE', [['P1', 40]])],
    }).get('P1')!;
    expect(availableForOrder(alloc, 'A')).toBe(60); // 100 - 40 held by B
    expect(availableForOrder(alloc, 'B')).toBe(70); // 100 - 30 held by A
  });

  it('returns 0 for an unknown SKU rather than throwing', () => {
    expect(availableForOrder(undefined, 'A')).toBe(0);
  });
});

describe('claimsByCountry', () => {
  it('groups claims by destination and sorts by size', () => {
    const alloc = build({
      exportOrders: [
        order('A', 'KSA', [['P1', 30]]),
        order('B', 'UAE', [['P1', 50]]),
        order('C', 'KSA', [['P1', 10]]),
      ],
    }).get('P1')!;
    const rows = claimsByCountry(alloc);
    expect(rows[0]).toMatchObject({ countryCode: 'UAE', qty: 50, orders: 1 });
    expect(rows[1]).toMatchObject({ countryCode: 'KSA', qty: 40, orders: 2 });
  });
});

describe('against the seeded dataset', () => {
  it('detects the over-allocated SKUs that shipped in the seed data', async () => {
    // P3: 37,000 promised across three export orders against 15,000 on hand.
    // P5: 25,000 promised against 22,000. Both were invisible before.
    const [products, exportOrders, inventory, productionPlans, salesPlans, channels] =
      await Promise.all([
        fetchTableData<Product>('products'),
        fetchTableData<ExportForecast>('export_forecasts'),
        fetchTableData<InventorySnapshot>('inventory_snapshots'),
        fetchTableData<ProductionPlan>('production_plan'),
        fetchTableData<SalesPlan>('sales_plan'),
        fetchTableData<Channel>('channels'),
      ]);

    const allocs = buildAllocations({
      products, exportOrders, inventory, productionPlans, salesPlans, channels,
      period: getPlanningPeriod(),
    });

    const over = [...allocs.values()].filter(a => a.overAllocated);
    expect(over.length).toBeGreaterThan(0);

    // Every claim must be attributable to a specific order and country —
    // that is what makes the position actionable rather than just alarming.
    for (const a of over) {
      for (const c of a.claims) {
        expect(c.orderNumber).toBeTruthy();
        expect(c.countryCode).toBeTruthy();
      }
    }
  });
});
