/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatusBadge, coverageIntent, COVERAGE_OOS_MONTHS, COVERAGE_OVERSTOCK_MONTHS } from '../src/components/ui';
import { getVMaterialCoverage } from '../src/supabaseClient';

describe('<StatusBadge />', () => {
  it('renders its content', () => {
    render(<StatusBadge intent="oos">OOS risk</StatusBadge>);
    expect(screen.getByText('OOS risk')).toBeInTheDocument();
  });

  it('maps each intent to a token-backed pill class', () => {
    const { container, rerender } = render(<StatusBadge intent="oos">x</StatusBadge>);
    expect(container.querySelector('.pill-oos')).toBeTruthy();
    rerender(<StatusBadge intent="healthy">x</StatusBadge>);
    expect(container.querySelector('.pill-healthy')).toBeTruthy();
    rerender(<StatusBadge intent="overstock">x</StatusBadge>);
    expect(container.querySelector('.pill-overstock')).toBeTruthy();
  });
});

describe('coverageIntent', () => {
  it('classifies each band', () => {
    expect(coverageIntent(0)).toBe('oos');
    expect(coverageIntent(0.4)).toBe('danger');
    expect(coverageIntent(1.5)).toBe('warning');
    expect(coverageIntent(2.6)).toBe('healthy');
    expect(coverageIntent(4.2)).toBe('overstock');
  });

  /**
   * The regression this test exists for: the helper used > 4 for overstock
   * while the engine flags at > 3.0, so a material at 3.5 months would have
   * been painted "healthy" on any screen adopting the helper while the engine
   * reported overstock_flag true for the very same row.
   */
  it('agrees with the engine on every seeded material', async () => {
    const rows = await getVMaterialCoverage('forecast');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const intent = coverageIntent(r.coverage_months);
      if (r.oos_risk_flag) {
        expect(['oos', 'danger']).toContain(intent);
      }
      if (r.overstock_flag) {
        expect(intent).toBe('overstock');
      }
      if (intent === 'overstock') {
        expect(r.overstock_flag).toBe(true);
      }
    }
  });

  it('exposes the same threshold constants the engine uses', () => {
    expect(COVERAGE_OOS_MONTHS).toBe(1.0);
    expect(COVERAGE_OVERSTOCK_MONTHS).toBe(3.0);
  });
});
