import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../src/App';
import { AuthProvider } from '../src/context/AuthContext';
import { ToastConfirmProvider } from '../src/context/ToastConfirmContext';
import { AppTextProvider } from '../src/context/AppTextContext';
import userEvent from '@testing-library/user-event';

beforeEach(() => localStorage.setItem('sc_planner_current_user_id', 'U1'));

/**
 * Guards the gap this test was written to close: components were built,
 * unit-tested in isolation, and never connected to a screen. A green suite on
 * an unused component says nothing about the app. This asserts the chart is
 * actually ON the Plan vs Actuals screen.
 */
describe('Plan vs Actuals chart', () => {
  it('renders a plan-vs-actual chart with its format control', { timeout: 30000 }, async () => {
    const user = userEvent.setup();
    render(<AuthProvider><AppTextProvider><ToastConfirmProvider><App />
      </ToastConfirmProvider></AppTextProvider></AuthProvider>);

    await waitFor(() => {
      expect(screen.getAllByText(/Plan vs Actuals/i).length).toBeGreaterThan(0);
    }, { timeout: 15000 });

    await user.click(screen.getAllByText(/Plan vs Actuals/i)[0]);

    // Wait for the CHART, not the nav item. An earlier version of this test
    // matched /plan vs actual/ which the sidebar link satisfies immediately,
    // so it asserted before the chart had loaded and failed on the next line.
    await waitFor(() => {
      expect(screen.getByText(/Top 12 by planned volume/i)).toBeInTheDocument();
    }, { timeout: 20000 });

    // The Format button is the Excel-style customisation entry point.
    expect(screen.getAllByText(/Format/i).length).toBeGreaterThan(0);
    // And the data export beside it.
    expect(screen.getAllByText(/^\s*Data\s*$/i).length).toBeGreaterThan(0);
  });
});
