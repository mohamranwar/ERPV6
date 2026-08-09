import { UOMConversion } from '../types';

/**
 * Normalizes and converts quantities between different Units of Measure (UOM).
 * Consumes UOM conversion ratios defined in the Master Data module.
 */

// Standard fallback conversions for common physical units if not specified in master DB
const STANDARD_FALLBACKS: Array<{ from: string; to: string; factor: number }> = [
  { from: 'KG', to: 'G', factor: 1000 },
  { from: 'KG', to: 'GRAMS', factor: 1000 },
  { from: 'KG', to: 'GRAM', factor: 1000 },
  { from: 'KILOGRAM', to: 'GRAM', factor: 1000 },
  { from: 'TON', to: 'KG', factor: 1000 },
  { from: 'TONNE', to: 'KG', factor: 1000 },
  { from: 'MT', to: 'KG', factor: 1000 },
  { from: 'L', to: 'ML', factor: 1000 },
  { from: 'LITER', to: 'ML', factor: 1000 },
  { from: 'LITRE', to: 'ML', factor: 1000 },
  { from: 'M', to: 'MM', factor: 1000 },
  { from: 'METER', to: 'MM', factor: 1000 },
  { from: 'METRES', to: 'MM', factor: 1000 },
  { from: 'M', to: 'CM', factor: 100 },
  { from: 'METER', to: 'CM', factor: 100 },
  { from: 'CARTON', to: 'PCS', factor: 100 },
  { from: 'PACK', to: 'PCS', factor: 12 },
  { from: 'BAG', to: 'PCS', factor: 24 },
  { from: 'BOX', to: 'PCS', factor: 50 },
  { from: 'ROLL', to: 'METERS', factor: 500 },
  { from: 'ROLL', to: 'M', factor: 500 },
];

/**
 * Retrieves the conversion ratio from one UOM to another.
 * Returns null if no valid conversion path exists.
 */
export function getConversionFactor(
  fromUom: string | undefined | null,
  toUom: string | undefined | null,
  conversions: UOMConversion[] = [],
  itemIdOrSku?: string
): number | null {
  const f = (fromUom || '').trim().toUpperCase();
  const t = (toUom || '').trim().toUpperCase();

  if (!f || !t) return 1;
  if (f === t) return 1;

  // 1. Search specific material/product conversion rules first
  if (itemIdOrSku) {
    const itemRule = conversions.find(
      c =>
        c.item_id === itemIdOrSku &&
        ((c.from_uom.toUpperCase() === f && c.to_uom.toUpperCase() === t) ||
         (c.from_uom.toUpperCase() === t && c.to_uom.toUpperCase() === f))
    );
    if (itemRule) {
      if (itemRule.from_uom.toUpperCase() === f && itemRule.to_uom.toUpperCase() === t) {
        return itemRule.conversion_factor;
      } else {
        return 1 / itemRule.conversion_factor;
      }
    }
  }

  // 2. Search global conversion rules defined in DB
  const globalRule = conversions.find(
    c =>
      (c.from_uom.toUpperCase() === f && c.to_uom.toUpperCase() === t) ||
      (c.from_uom.toUpperCase() === t && c.to_uom.toUpperCase() === f)
  );

  if (globalRule) {
    if (globalRule.from_uom.toUpperCase() === f && globalRule.to_uom.toUpperCase() === t) {
      return globalRule.conversion_factor;
    } else {
      return 1 / globalRule.conversion_factor;
    }
  }

  // 3. Fallback to standard physics/industry defaults
  const std = STANDARD_FALLBACKS.find(
    s => (s.from === f && s.to === t) || (s.from === t && s.to === f)
  );

  if (std) {
    if (std.from === f && std.to === t) {
      return std.factor;
    } else {
      return 1 / std.factor;
    }
  }

  // 4. Multi-step conversion (e.g. TON -> KG -> G)
  for (const c1 of [...conversions, ...STANDARD_FALLBACKS.map(s => ({ from_uom: s.from, to_uom: s.to, conversion_factor: s.factor }))]) {
    const c1From = c1.from_uom.toUpperCase();
    const c1To = c1.to_uom.toUpperCase();

    let midUnit: string | null = null;
    let factor1 = 1;

    if (c1From === f) {
      midUnit = c1To;
      factor1 = c1.conversion_factor;
    } else if (c1To === f) {
      midUnit = c1From;
      factor1 = 1 / c1.conversion_factor;
    }

    if (midUnit) {
      const step2Factor = getConversionFactor(midUnit, t, conversions, itemIdOrSku);
      if (step2Factor !== null) {
        return factor1 * step2Factor;
      }
    }
  }

  // No valid conversion path found
  return null;
}

/**
 * Checks if two UOMs are compatible (equal or have a valid conversion factor).
 */
export function isUomCompatible(
  fromUom: string | undefined | null,
  toUom: string | undefined | null,
  conversions: UOMConversion[] = [],
  itemIdOrSku?: string
): boolean {
  return getConversionFactor(fromUom, toUom, conversions, itemIdOrSku) !== null;
}

/**
 * Normalizes a quantity from source UOM to target base UOM.
 */
export function normalizeQuantity(
  quantity: number,
  fromUom: string | undefined | null,
  toUom: string | undefined | null,
  conversions: UOMConversion[] = [],
  itemIdOrSku?: string
): { normalizedQty: number; factor: number; isCompatible: boolean } {
  const factor = getConversionFactor(fromUom, toUom, conversions, itemIdOrSku);
  if (factor === null) {
    return { normalizedQty: quantity, factor: 1, isCompatible: false };
  }
  return { normalizedQty: quantity * factor, factor, isCompatible: true };
}
