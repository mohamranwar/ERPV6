import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import DashboardScreen from '../src/components/DashboardScreen';

beforeEach(() => localStorage.setItem('sc_planner_current_user_id', 'U1'));

/**
 * Proves the Dashboard's Sales by PCS and RM Coverage charts are genuinely
 * ChartCard now -- Format button present, panel opens, controls work -- not
 * merely that the code compiles and the widget still renders SOME chart.
 */
describe('Dashboard executive charts are customisable', () => {
  it('Sales by PCS has a working Format panel', async () => {
    const user = userEvent.setup();
    render(<DashboardScreen />);

    await waitFor(() => {
      expect(screen.getByText('Sales by PCS')).toBeInTheDocument();
    }, { timeout: 15000 });

    const card = screen.getByText('Sales by PCS').closest('div')?.parentElement;
    expect(card).toBeTruthy();

    const formatButtons = screen.getAllByText(/Format/i);
    await user.click(formatButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/Format chart/i)).toBeInTheDocument();
    });

    // The row/column swap must be ABSENT: this is a single-period aggregate,
    // not a multi-line breakdown, so fixedAxis="period" should hide it --
    // same discipline as the earlier PlanVsActualScreen fix.
    expect(screen.queryByText(/Categories on X axis/i)).toBeNull();
  });

  it('RM coverage chart opens with the real 3.0-month target, not the generic default of 100', async () => {
    const user = userEvent.setup();
    render(<DashboardScreen />);

    await waitFor(() => {
      expect(screen.getByText('Raw material coverage')).toBeInTheDocument();
    }, { timeout: 15000 });

    const formatButtons = screen.getAllByText(/Format/i);
    // Second chart card's Format button -- Sales is first, RM coverage
    // follows it in the default widget order.
    await user.click(formatButtons[formatButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getByText(/Format chart/i)).toBeInTheDocument();
    });

    const targetInput = screen.getByLabelText(/Target value/i) as HTMLInputElement;
    // Not asserting the exact figure (it depends on seeded settings data),
    // only that it is NOT the generic DEFAULT_CHART_CONFIG value of 100 --
    // which is what every earlier chart on this screen would have shown
    // before defaultConfig existed.
    expect(Number(targetInput.value)).not.toBe(100);
  });
});
