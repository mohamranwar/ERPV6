/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  pcsPerCarton, hasCartonConfig, toCartons, toPieces,
  formatQty, formatDual, formatMoney, formatMoneyCompact, formatQtyCompact, CURRENCY,
} from '../src/utils/uom';

// P1 in the seed data: 44 pcs/bag x 4 bags/carton = 176 pcs per carton.
const P1 = { pcs_per_bag: 44, bags_per_carton: 4 };

describe('pcsPerCarton', () => {
  it('multiplies the pack configuration', () => {
    expect(pcsPerCarton(P1)).toBe(176);
  });

  /**
   * The behaviour this helper exists for. The previous inline version used
   * (pcs_per_bag || 10) * (bags_per_carton || 4), so a product with no pack
   * configuration silently reported cartons based on an invented 40-piece
   * carton — a confident, wrong number with nothing to indicate it was made up.
   */
  it('returns null rather than inventing a carton size', () => {
    expect(pcsPerCarton({ pcs_per_bag: 0, bags_per_carton: 4 })).toBeNull();
    expect(pcsPerCarton({ pcs_per_bag: 44, bags_per_carton: 0 })).toBeNull();
    expect(pcsPerCarton(undefined as never)).toBeNull();
    expect(pcsPerCarton({} as never)).toBeNull();
    expect(pcsPerCarton({ pcs_per_bag: -5, bags_per_carton: 4 })).toBeNull();
  });

  it('reports whether cartons can be derived at all', () => {
    expect(hasCartonConfig(P1)).toBe(true);
    expect(hasCartonConfig({ pcs_per_bag: 0, bags_per_carton: 0 })).toBe(false);
  });
});

describe('toCartons / toPieces', () => {
  it('converts in both directions and round-trips', () => {
    expect(toCartons(1760, P1)).toBe(10);
    expect(toPieces(10, P1)).toBe(1760);
    expect(toPieces(toCartons(880, P1)!, P1)).toBe(880);
  });

  it('keeps the fraction rather than rounding to whole cartons', () => {
    // 300 pcs is 1.7045… cartons. Rounding here would stop carton totals
    // reconciling with the piece totals shown beside them.
    expect(toCartons(300, P1)).toBeCloseTo(1.7045, 3);
  });

  it('returns null when the pack config is missing', () => {
    expect(toCartons(1000, { pcs_per_bag: 0, bags_per_carton: 0 })).toBeNull();
    expect(toPieces(10, null)).toBeNull();
  });
});

describe('formatQty / formatDual', () => {
  it('formats pieces as whole units with separators', () => {
    expect(formatQty(275000, P1, 'pcs')).toBe('275,000');
  });

  it('formats cartons to one decimal', () => {
    expect(formatQty(1760, P1, 'cartons')).toBe('10.0');
  });

  it('shows "n/a" for cartons when the product has no pack config', () => {
    expect(formatQty(1000, { pcs_per_bag: 0, bags_per_carton: 0 }, 'cartons')).toBe('n/a');
  });

  it('gives both readings so a figure never needs mental conversion', () => {
    expect(formatDual(1760, P1)).toBe('1,760 PCS (10 CTN)');
  });

  it('falls back to pieces alone when cartons are underivable', () => {
    expect(formatDual(1760, { pcs_per_bag: 0, bags_per_carton: 0 })).toBe('1,760 PCS');
  });

  it('never renders NaN', () => {
    expect(formatQty(NaN, P1, 'pcs')).toBe('—');
    expect(formatDual(NaN, P1)).toBe('—');
  });
});

describe('money', () => {
  it('always carries the EGP prefix', () => {
    expect(CURRENCY).toBe('EGP');
    expect(formatMoney(1234.5)).toBe('EGP 1,234.50');
    expect(formatMoney(18.5, 2)).toBe('EGP 18.50');
  });

  it('compacts large figures for dense tiles', () => {
    expect(formatMoneyCompact(1_250_000)).toBe('EGP 1.3M');
    expect(formatMoneyCompact(845_000)).toBe('EGP 845K');
    expect(formatMoneyCompact(320)).toBe('EGP 320');
  });

  it('compacts quantities for chart axes', () => {
    expect(formatQtyCompact(275_000)).toBe('275K');
    expect(formatQtyCompact(1_500_000)).toBe('1.5M');
    expect(formatQtyCompact(420)).toBe('420');
  });
});
