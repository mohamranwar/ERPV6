/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Stock allocation ledger.
 *
 * An export SKU is not reserved for export. The same finished good is sold
 * through domestic distributors, pharmacy chains and e-commerce as well as
 * being shipped to several countries, and every one of those is a claim on a
 * single physical pool of stock.
 *
 * Before this existed, `produced_stock_qty` on an export order line was a
 * free-typed number checked against nothing: not against stock on hand, not
 * against what other export orders had already claimed of the same SKU, and
 * not against domestic demand for it. The seeded data is itself impossible —
 * 37,000 units of P3 are promised across three export orders against 15,000
 * on hand — and nothing in the app said so.
 *
 * This module answers one question: for a given SKU, what is genuinely left to
 * promise, and who has already claimed the rest?
 */
import type {
  Product, ExportForecast, InventorySnapshot, ProductionPlan, SalesPlan, Channel,
} from '../types';
import { isInPeriod } from '../supabaseClient';

/** A single export order's claim on one SKU. */
export interface OrderClaim {
  orderId: string;
  orderNumber: string;
  countryCode: string;
  countryName: string;
  customerName: string;
  qty: number;
}

export interface SkuAllocation {
  productId: string;
  /** Physical stock on hand at the start of the period. */
  onHand: number;
  /** Production planned for the period, which becomes available within it. */
  plannedProduction: number;
  /** Everything that could be promised: on hand plus planned production. */
  supply: number;
  /** Total already promised to export orders. */
  exportAllocated: number;
  /** Who promised it, per order and country. */
  claims: OrderClaim[];
  /** Demand booked through non-export channels in the same period. */
  otherChannelDemand: number;
  /**
   * What is genuinely still free to promise. Can be negative, and a negative
   * value is the point of this module — it means commitments already exceed
   * supply and someone will not get their goods.
   */
  free: number;
  overAllocated: boolean;
}

interface BuildInput {
  products: Product[];
  exportOrders: ExportForecast[];
  inventory: InventorySnapshot[];
  productionPlans: ProductionPlan[];
  salesPlans: SalesPlan[];
  channels: Channel[];
  period: string;
  /** Channel that represents export, resolved by name rather than a literal id. */
  exportChannelName?: string;
}

/**
 * Builds the allocation position for every product.
 *
 * Export orders are counted from their line items rather than from the sales
 * plan, because an order can be entered before it has been merged into the
 * plan — counting both would double-count the same commitment.
 */
export function buildAllocations({
  products, exportOrders, inventory, productionPlans, salesPlans, channels,
  period, exportChannelName = 'Export Global',
}: BuildInput): Map<string, SkuAllocation> {
  const exportChannelId = channels.find(c => c.name === exportChannelName)?.id;

  const result = new Map<string, SkuAllocation>();

  for (const p of products) {
    const onHand = inventory
      .filter(i => i.item_type === 'product' && i.item_id === p.id)
      .reduce((s, i) => s + i.quantity, 0);

    const plannedProduction = productionPlans
      .filter(pl => pl.product_id === p.id && isInPeriod(pl.period_start, period))
      .reduce((s, pl) => s + pl.quantity, 0);

    // Demand booked through every channel that is not export. Export demand is
    // taken from the orders themselves, below.
    const otherChannelDemand = salesPlans
      .filter(sp =>
        sp.product_id === p.id &&
        isInPeriod(sp.period_start, period) &&
        sp.channel_id !== exportChannelId)
      .reduce((s, sp) => s + sp.quantity, 0);

    const claims: OrderClaim[] = [];
    for (const order of exportOrders) {
      for (const li of order.items || []) {
        if (li.product_id !== p.id) continue;
        const qty = Number(li.produced_stock_qty) || 0;
        if (qty <= 0) continue;
        claims.push({
          orderId: order.id,
          orderNumber: order.order_number,
          countryCode: order.country_code,
          countryName: order.country_name,
          customerName: order.customer_name,
          qty,
        });
      }
    }

    const exportAllocated = claims.reduce((s, c) => s + c.qty, 0);
    const supply = onHand + plannedProduction;
    const free = supply - exportAllocated - otherChannelDemand;

    result.set(p.id, {
      productId: p.id,
      onHand,
      plannedProduction,
      supply,
      exportAllocated,
      claims,
      otherChannelDemand,
      free,
      overAllocated: free < 0,
    });
  }

  return result;
}

/**
 * How much of a SKU one specific order may still claim.
 *
 * Its own existing claim is added back before subtracting, so editing an order
 * from 10,000 to 12,000 is measured against the 10,000 it already holds rather
 * than being told it has none left.
 */
export function availableForOrder(
  alloc: SkuAllocation | undefined,
  orderId: string
): number {
  if (!alloc) return 0;
  const ownClaim = alloc.claims
    .filter(c => c.orderId === orderId)
    .reduce((s, c) => s + c.qty, 0);
  return alloc.supply - alloc.otherChannelDemand - (alloc.exportAllocated - ownClaim);
}

/** Claims grouped by destination country, for the per-country view. */
export function claimsByCountry(alloc: SkuAllocation | undefined): Array<{
  countryCode: string;
  countryName: string;
  qty: number;
  orders: number;
}> {
  if (!alloc) return [];
  const acc = new Map<string, { countryCode: string; countryName: string; qty: number; orders: number }>();
  for (const c of alloc.claims) {
    const row = acc.get(c.countryCode) ?? {
      countryCode: c.countryCode, countryName: c.countryName, qty: 0, orders: 0,
    };
    row.qty += c.qty;
    row.orders += 1;
    acc.set(c.countryCode, row);
  }
  return [...acc.values()].sort((a, b) => b.qty - a.qty);
}
