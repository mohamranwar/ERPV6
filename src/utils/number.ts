/**
 * Numeric coercion for user input.
 *
 * `Number('')` is 0 and `Number('abc')` is NaN, and both used to flow straight
 * from an <input> into a saved record. A NaN in qty_per_unit or scrap_percent
 * is especially damaging here: it propagates through the BOM explosion into
 * coverage, safety stock and MRP, and every downstream figure silently becomes
 * NaN rather than failing loudly at the point of entry.
 */

/**
 * Coerces user input to a finite number, falling back when it is not one.
 * Rejects NaN and ±Infinity; empty input yields the fallback rather than 0
 * so callers can distinguish "cleared" from "typed a zero" if they need to.
 */
export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (value === null || value === undefined) return fallback;
  const str = String(value).trim();
  if (str === '') return fallback;
  const n = Number(str);
  return Number.isFinite(n) ? n : fallback;
}

/** Coerces and constrains to a range. Useful for percentages and priorities. */
export function toNumberInRange(
  value: unknown,
  min: number,
  max: number,
  fallback = min
): number {
  const n = toNumber(value, fallback);
  return Math.min(max, Math.max(min, n));
}

/**
 * Coerces to a quantity: finite and never negative.
 * Negative quantities are not meaningful for stock, orders or BOM lines, and
 * a stray minus sign would otherwise invert a requirement.
 */
export function toQuantity(value: unknown, fallback = 0): number {
  return Math.max(0, toNumber(value, fallback));
}
