import React, { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import DashboardScreen from '../src/components/DashboardScreen';
import { resetLoadedScreens } from '../src/hooks/useFirstLoad';

beforeEach(() => {
  localStorage.setItem('sc_planner_current_user_id', 'U1');
  resetLoadedScreens();
});

/**
 * Reproduces the actual reported scenario: navigate away from a screen and
 * come back, which is what a user does constantly.
 *
 * An earlier test asserted the skeleton did not reappear when `refreshKey`
 * changed while the screen stayed MOUNTED. That passed, and the flash
 * persisted, because App.tsx renders the active screen through a switch that
 * returns a different component per screen -- so leaving Dashboard unmounts
 * it entirely. Returning built a fresh instance whose `hasLoadedOnce`
 * useState initialised to false all over again, and the full-screen skeleton
 * rendered on every single visit. The guard was real; it was simply scoped to
 * a lifetime shorter than the problem.
 *
 * These tests unmount for real, which is the only way to catch that.
 */
describe('screen revisit does not re-blank to a skeleton', () => {
  it('shows the skeleton on the very first visit', async () => {
    const { container } = render(<DashboardScreen />);
    expect(container.querySelector('.animate-pulse')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText(/Supply chain dashboard/i)).toBeInTheDocument();
    }, { timeout: 10000 });
  });

  it('does NOT show the skeleton after unmount and remount', async () => {
    // Visit 1 -- completes a load.
    const first = render(<DashboardScreen />);
    await waitFor(() => {
      expect(screen.getByText(/Supply chain dashboard/i)).toBeInTheDocument();
    }, { timeout: 10000 });

    // Navigate away. This is a real unmount, exactly like App.tsx's switch.
    first.unmount();

    // Visit 2 -- the skeleton must not come back. Checked synchronously on
    // the very first render, which is the instant it would appear.
    const second = render(<DashboardScreen />);
    expect(second.container.querySelector('.animate-pulse')).toBeNull();
  });

  it('shows the skeleton again after sign-out clears session state', async () => {
    const first = render(<DashboardScreen />);
    await waitFor(() => {
      expect(screen.getByText(/Supply chain dashboard/i)).toBeInTheDocument();
    }, { timeout: 10000 });
    first.unmount();

    // Signing out must not leave the next user assuming content is already
    // on screen for views they have never opened.
    resetLoadedScreens();

    const second = render(<DashboardScreen />);
    expect(second.container.querySelector('.animate-pulse')).toBeTruthy();
  });
});
