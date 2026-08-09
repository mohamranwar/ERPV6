/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Smoke test: does the whole app actually mount and render?
 *
 * The unit tests cover calculations and individual components, but nothing
 * previously asserted that <App /> boots at all. That gap let a runtime-only
 * breakage (a removed helper still referenced in JSX, a bad lazy import, a
 * portal with no container) ship green. This test renders the real app with
 * its real providers and walks a few screens.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import App from '../src/App';
import { AuthProvider } from '../src/context/AuthContext';
import { ToastConfirmProvider } from '../src/context/ToastConfirmContext';

function renderApp() {
  return render(
    <ToastConfirmProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ToastConfirmProvider>
  );
}

describe('App smoke test', () => {
  beforeEach(() => {
    // Start every case logged out so we exercise the login gate first.
    localStorage.removeItem('sc_planner_current_user_id');
  });

  it('mounts without throwing and shows the login screen when logged out', async () => {
    renderApp();
    // LoginScreen lists the seeded demo accounts.
    await waitFor(() => {
      expect(screen.getByText(/Mohamed Amr/i)).toBeInTheDocument();
    });
  });

  it('logs in as admin and renders the dashboard shell', async () => {
    renderApp();

    const adminBtn = await screen.findByText(/Mohamed Amr/i);
    fireEvent.click(adminBtn);

    // The sidebar brand and the dashboard nav entry should both appear.
    await waitFor(() => {
      expect(screen.getByText('Supply Chain')).toBeInTheDocument();
    });
    expect(screen.getAllByText(/Dashboard/i).length).toBeGreaterThan(0);
  });

  it('renders the nav entry for the new Customs Clearance screen', async () => {
    renderApp();
    fireEvent.click(await screen.findByText(/Mohamed Amr/i));

    await waitFor(() => {
      expect(screen.getByText('Supply Chain')).toBeInTheDocument();
    });
    // Added in the customs-clearance workstream; proves the nav wiring is live.
    expect(screen.getByText('Customs Clearance')).toBeInTheDocument();
  });

  it('navigates to Customs Clearance and renders it without crashing', async () => {
    renderApp();
    fireEvent.click(await screen.findByText(/Mohamed Amr/i));

    const navItem = await screen.findByText('Customs Clearance');
    fireEvent.click(navItem);

    // The screen lazy-loads; its KPI labels confirm the module evaluated,
    // the seed data resolved, and the UI kit (Card/StatusBadge) rendered.
    await waitFor(() => {
      expect(screen.getByText(/Avg Cycle Time/i)).toBeInTheDocument();
    }, { timeout: 5000 });
  });
});
