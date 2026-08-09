/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import MaterialDrillDown from '../src/components/MaterialDrillDown';
import { ToastConfirmProvider } from '../src/context/ToastConfirmContext';

function renderDrillDown(props: any = {}) {
  return render(
    <ToastConfirmProvider>
      <MaterialDrillDown {...props} />
    </ToastConfirmProvider>
  );
}

describe('<MaterialDrillDown />', () => {
  it('renders Component Selector mode with Day/Week/Month grain buttons', async () => {
    renderDrillDown({ initialMode: 'selector' });

    await waitFor(() => {
      expect(screen.getByText(/Material Check/i)).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /Daily/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Weekly/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Monthly/i })).toBeInTheDocument();
  });

  it('renders Material Inspection Detail mode and allows grain switching', async () => {
    renderDrillDown({ initialMode: 'detail' });

    await waitFor(() => {
      expect(screen.getByText(/Material Inspection Mode/i)).toBeInTheDocument();
    });

    // Switch to Daily grain
    const dailyBtns = screen.getAllByRole('button', { name: /Daily/i });
    fireEvent.click(dailyBtns[0]);

    await waitFor(() => {
      expect(screen.getByText(/Daily \(14 Days\) Stock & Coverage Projections/i)).toBeInTheDocument();
    });

    // Switch to Weekly grain
    const weeklyBtns = screen.getAllByRole('button', { name: /Weekly/i });
    fireEvent.click(weeklyBtns[0]);

    await waitFor(() => {
      expect(screen.getByText(/Weekly \(8 Weeks\) Stock & Coverage Projections/i)).toBeInTheDocument();
    });
  });
});
