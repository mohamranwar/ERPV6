/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import DashboardScreen from '../src/components/DashboardScreen';
import { DEFAULT_WIDGET_CONFIGS } from '../src/components/DashboardCustomizerModal';

describe('<DashboardScreen />', () => {
  it('renders the Dashboard headline and core executive KPI tiles', async () => {
    render(<DashboardScreen />);

    await waitFor(() => {
      expect(screen.getByText('Supply chain dashboard')).toBeInTheDocument();
    });

    expect(screen.getByText('Total RM Stock Coverage')).toBeInTheDocument();
    expect(screen.getByText('Monthly PO Count')).toBeInTheDocument();
    expect(screen.getByText('Finished Goods Coverage')).toBeInTheDocument();
    expect(screen.getByText('Sales Achievement')).toBeInTheDocument();
  });

  /**
   * Asserts that every registered analytics widget actually renders.
   *
   * History, because it explains the shape of this test. The previous version
   * hardcoded three headings, and one of them
   * ("Finished Goods Coverage Matrix by Category") was copied from the
   * customiser registry while DashboardScreen rendered a different string
   * ("Finished Goods Stock Coverage Matrix by Category"). The test failed, but
   * it read as merely stale rather than as the real defect it was pointing at:
   * every widget title was written twice -- once in DEFAULT_WIDGET_CONFIGS and
   * again as hardcoded <h3> text -- and all three of these panels had drifted.
   * Users toggled one name in the customiser and saw another on the panel.
   *
   * Titles now come from the registry in both places, so that particular
   * divergence is impossible by construction rather than caught here. What
   * this test still catches -- and the reason it earns its place -- is a
   * widget registered in DEFAULT_WIDGET_CONFIGS that renderWidget does not
   * render: a dropped or misspelled switch case leaves the user with a
   * toggle that turns on nothing at all, and getByText fails.
   */
  it('renders each analytics panel under its registry title', async () => {
    render(<DashboardScreen />);

    const titleOf = (id: string) =>
      DEFAULT_WIDGET_CONFIGS.find(w => w.id === id)!.title;

    await waitFor(() => {
      expect(screen.getByText(titleOf('rm_cat_coverage'))).toBeInTheDocument();
    });

    expect(screen.getByText(titleOf('po_status'))).toBeInTheDocument();
    expect(screen.getByText(titleOf('fg_cat_matrix'))).toBeInTheDocument();
  });
});
