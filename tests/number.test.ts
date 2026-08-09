/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { toNumber, toNumberInRange, toQuantity } from '../src/utils/number';

describe('toNumber', () => {
  it('passes through ordinary numeric input', () => {
    expect(toNumber('4.5')).toBe(4.5);
    expect(toNumber('0')).toBe(0);
    expect(toNumber(220)).toBe(220);
    expect(toNumber('  12  ')).toBe(12);
  });

  it('rejects the values that used to reach saved records as NaN', () => {
    // A paste into a qty field is the realistic path here.
    expect(toNumber('abc')).toBe(0);
    expect(toNumber('12kg')).toBe(0);
    expect(toNumber(NaN)).toBe(0);
    expect(toNumber(Infinity)).toBe(0);
    expect(toNumber(-Infinity)).toBe(0);
  });

  it('treats empty and nullish input as the fallback', () => {
    expect(toNumber('')).toBe(0);
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber('', 1)).toBe(1);
  });

  it('honours a custom fallback so callers can default sensibly', () => {
    expect(toNumber('nonsense', 15)).toBe(15);
  });

  it('never returns NaN for any input', () => {
    const hostile = ['', ' ', 'abc', '1e', '--5', '0x', {}, [], null, undefined, NaN];
    for (const v of hostile) expect(Number.isNaN(toNumber(v))).toBe(false);
  });
});

describe('toNumberInRange', () => {
  it('clamps to the range', () => {
    expect(toNumberInRange('150', 0, 100)).toBe(100);
    expect(toNumberInRange('-5', 0, 100)).toBe(0);
    expect(toNumberInRange('42', 0, 100)).toBe(42);
  });

  it('falls back then clamps for junk input', () => {
    expect(toNumberInRange('abc', 0, 100)).toBe(0);
    expect(toNumberInRange('abc', 1, 5, 3)).toBe(3);
  });
});

describe('toQuantity', () => {
  it('never returns a negative quantity', () => {
    // A stray minus in a requirement field would otherwise invert it.
    expect(toQuantity('-50')).toBe(0);
    expect(toQuantity(-1)).toBe(0);
  });

  it('preserves valid quantities including zero', () => {
    expect(toQuantity('500')).toBe(500);
    expect(toQuantity('0')).toBe(0);
    expect(toQuantity('4.5')).toBe(4.5);
  });
});
