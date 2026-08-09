/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit-of-measure presentation and currency formatting.
 *
 * Plans, actuals and inventory are all stored in PIECES — that is the engine's
 * base unit and nothing here changes it. Cartons are a *presentation* unit
 * derived from each product's pack configuration, so a planner can work in the
 * unit the warehouse and the customer actually talk in.
 *
 * This is a single shared implementation on purpose. The carton divisor was
 * previously computed inline in one screen as
 *
 *     (p.pcs_per_bag || 10) * (p.bags_per_carton || 4)
 *
 * which silently invents a 40-piece carton for any product whose pack
 * configuration is missing, producing a confident but wrong carton count. A
 * missing configuration is a data problem and has to be visible, not papered
 * over with a default.
 */
import type { Product } from '../types';

/** The company reports in Egyptian pounds. */
export const CURRENCY = 'EGP';

/** Pack configuration needed to convert pieces to cartons. */
type Packable = Pick<Product, 'pcs_per_bag' | 'bags_per_carton'>;

/**
 * Pieces in one carton, or null when the product's pack configuration is
 * incomplete. Null rather than a fallback: an unconfigured product must show
 * as "not configured" instead of silently reporting cartons computed from an
 * invented pack size.
 */
export function pcsPerCarton(product: Packable | null | undefined): number | null {
  if (!product) return null;
  const perBag = Number(product.pcs_per_bag);
  const bags = Number(product.bags_per_carton);
  if (!Number.isFinite(perBag) || !Number.isFinite(bags)) return null;
  if (perBag <= 0 || bags <= 0) return null;
  return perBag * bags;
}

/** True when cartons can be derived for this product. */
export function hasCartonConfig(product: Packable | null | undefined): boolean {
  return pcsPerCarton(product) !== null;
}

/** Converts pieces to cartons, or null when the pack config is missing. */
export function toCartons(pieces: number, product: Packable | null | undefined): number | null {
  const per = pcsPerCarton(product);
  if (per === null || !Number.isFinite(pieces)) return null;
  return pieces / per;
}

/** Converts cartons to pieces, or null when the pack config is missing. */
export function toPieces(cartons: number, product: Packable | null | undefined): number | null {
  const per = pcsPerCarton(product);
  if (per === null || !Number.isFinite(cartons)) return null;
  return cartons * per;
}

export type QtyUnit = 'pcs' | 'cartons';

/**
 * Formats a piece quantity in the requested unit.
 *
 * Cartons keep one decimal because a plan rarely lands on a whole carton and
 * rounding to an integer would make totals stop reconciling with the piece
 * figures shown beside them.
 */
export function formatQty(
  pieces: number,
  product: Packable | null | undefined,
  unit: QtyUnit
): string {
  if (!Number.isFinite(pieces)) return '—';
  if (unit === 'pcs') return Math.round(pieces).toLocaleString('en-US');
  const ctn = toCartons(pieces, product);
  if (ctn === null) return 'n/a';
  return ctn.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Short unit label for column headers and chips. */
export function unitLabel(unit: QtyUnit): string {
  return unit === 'pcs' ? 'PCS' : 'CTN';
}

/**
 * "1,250 PCS (28.4 CTN)" — the dual reading the planners asked for, so a
 * figure never has to be mentally converted to be checked against a document.
 * Falls back to pieces alone when the pack config is missing.
 */
export function formatDual(pieces: number, product: Packable | null | undefined): string {
  if (!Number.isFinite(pieces)) return '—';
  const pcs = `${Math.round(pieces).toLocaleString('en-US')} PCS`;
  const ctn = toCartons(pieces, product);
  if (ctn === null) return pcs;
  return `${pcs} (${ctn.toLocaleString('en-US', { maximumFractionDigits: 1 })} CTN)`;
}

/** Money, always in EGP. */
export function formatMoney(amount: number, decimals = 2): string {
  if (!Number.isFinite(amount)) return '—';
  return `${CURRENCY} ${amount.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/** Compact money for dense tiles: "EGP 1.2M", "EGP 845K". */
export function formatMoneyCompact(amount: number): string {
  if (!Number.isFinite(amount)) return '—';
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${CURRENCY} ${(amount / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${CURRENCY} ${(amount / 1_000).toFixed(0)}K`;
  return `${CURRENCY} ${amount.toFixed(0)}`;
}

/** Compact quantity for dense tiles and chart axes. */
export function formatQtyCompact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}
