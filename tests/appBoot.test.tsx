import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../src/App';
import { AuthProvider } from '../src/context/AuthContext';
import { ToastConfirmProvider } from '../src/context/ToastConfirmContext';
import { AppTextProvider } from '../src/context/AppTextContext';

/**
 * Boot smoke test.
 *
 * A clean typecheck and green unit tests do not mean the application starts.
 * Provider order, a missing route case, a bad lazy import or a hook called
 * outside its provider all compile perfectly and then throw on mount. This
 * renders the real App with the real provider stack and walks to the two
 * screens added in this work.
 *
 * It runs against the offline local-storage dataset, which is how the app
 * behaves before Supabase credentials are entered.
 */

/**
 * Sign in before mounting.
 *
 * The app gates everything behind a login screen, so a smoke test that just
 * renders <App /> only ever proves the login form works. AuthContext persists
 * the current user to localStorage, so seeding that key is the same thing a
 * real sign-in does.
 */
beforeEach(() => {
  localStorage.setItem('sc_planner_current_user_id', 'U1'); // seeded admin
});

function bootApp() {
  return render(
    <AuthProvider>
      <AppTextProvider>
        <ToastConfirmProvider>
          <App />
        </ToastConfirmProvider>
      </AppTextProvider>
    </AuthProvider>,
  );
}

describe('application boot', () => {
  it('mounts without throwing', async () => {
    bootApp();
    // Something from the shell must appear -- either the login gate or the
    // planner shell, depending on the seeded auth state.
    await waitFor(() => {
      expect(document.body.textContent?.length ?? 0).toBeGreaterThan(0);
    });
  });

  it('renders the navigation with the new screens present', async () => {
    bootApp();
    await waitFor(() => {
      expect(screen.getAllByText(/Dashboard/i).length).toBeGreaterThan(0);
    }, { timeout: 15000 });

    // Both screens added in this work must be reachable from the menu.
    expect(screen.getAllByText(/Month Close/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Settings/i).length).toBeGreaterThan(0);
  });

  it('opens Month Close without crashing', { timeout: 25000 }, async () => {
    const user = userEvent.setup();
    bootApp();

    await waitFor(() => {
      expect(screen.getAllByText(/Month Close/i).length).toBeGreaterThan(0);
    }, { timeout: 15000 });

    await user.click(screen.getAllByText(/Month Close/i)[0]);

    // The scorecard headings come from MonthCloseScreen. If the container's
    // wiring to buildScorecard/runReadiness were wrong, this throws rather
    // than rendering.
    await waitFor(() => {
      expect(screen.getAllByText(/Raw material coverage/i).length).toBeGreaterThan(0);
    }, { timeout: 15000 });
  });

  it('opens Settings without crashing', { timeout: 25000 }, async () => {
    const user = userEvent.setup();
    bootApp();

    await waitFor(() => {
      expect(screen.getAllByText(/Settings/i).length).toBeGreaterThan(0);
    }, { timeout: 15000 });

    await user.click(screen.getAllByText(/Settings/i)[0]);

    // getAllBy, not getBy: "App text" appears twice -- once in the section
    // sub-nav and once as the card title. getByText throws on multiples.
    await waitFor(() => {
      expect(screen.getAllByText(/App text/i).length).toBeGreaterThan(0);
    }, { timeout: 15000 });

    // Threshold controls are the part that carries real risk, so confirm the
    // section list rendered rather than just the shell.
    expect(screen.getAllByText(/Planning thresholds/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Change log/i).length).toBeGreaterThan(0);
  });
});
