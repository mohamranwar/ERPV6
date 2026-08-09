/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import DashboardScreen from '../src/components/DashboardScreen';

describe('<DashboardScreen />', () => {
  it('renders the Dashboard headline and core executive KPI tiles', async () => {
    render(<DashboardScreen />);

    // Wait for data load
    await waitFor(() => {
      expect(screen.getByText('Supply chain dashboard')).toBeInTheDocument();
    });

    // Check for required KPI titles
    expect(screen.getByText('Total RM Stock Coverage')).toBeInTheDocument();
    expect(screen.getByText('Monthly PO Count')).toBeInTheDocument();
    expect(screen.getByText('Finished Goods Coverage')).toBeInTheDocument();
    expect(screen.getByText('Sales Achievement')).toBeInTheDocument();
  });

  it('renders executive management graph sections', async () => {
    render(<DashboardScreen />);

    await waitFor(() => {
      expect(screen.getByText(/Raw Material Stock Coverage by Category/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Monthly Purchase Orders \(PO\) & Status Breakdown/i)).toBeInTheDocument();
    expect(screen.getByText(/Finished Goods Coverage Matrix by Category/i)).toBeInTheDocument();
  });
});
