import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import DashboardScreen from '../src/components/DashboardScreen';

beforeEach(() => localStorage.setItem('sc_planner_current_user_id', 'U1'));

/**
 * Proves the flash is gone -- by mounting the real screen, forcing a second
 * load the way a real navigation does, and checking SYNCHRONOUSLY right
 * after the rerender, before any awaited data resolves.
 *
 * That timing detail is not incidental. An earlier version of this test
 * waited 50ms before checking and passed even against the UNFIXED code,
 * because the localStorage-backed load in this test environment resolves
 * faster than 50ms -- the skeleton appeared and disappeared entirely within
 * that window, so the assertion ran too late to see it. A test that cannot
 * fail against broken code proves nothing; this one was verified to fail
 * against the pre-fix `if (loading)` gate before being kept.
 */
describe('DashboardScreen refresh does not re-blank the screen', () => {
  it('shows the skeleton on first mount', async () => {
    render(<DashboardScreen />);
    expect(document.querySelector('.animate-pulse')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText(/Supply chain dashboard/i)).toBeInTheDocument();
    }, { timeout: 10000 });
  });

  it('does not show the skeleton again when refreshKey changes', async () => {
    const { rerender } = render(<DashboardScreen refreshKey={1} />);
    await waitFor(() => {
      expect(screen.getByText(/Supply chain dashboard/i)).toBeInTheDocument();
    }, { timeout: 10000 });

    // The exact action from the screen recording: navigating back to an
    // already-visited screen bumps refreshKey and re-fires the load.
    rerender(<DashboardScreen refreshKey={2} />);

    // Checked with NO await in between -- this is the instant the skeleton
    // would appear if the gate does not account for hasLoadedOnce.
    expect(document.querySelector('.animate-pulse')).toBeNull();
    expect(screen.getByText(/Supply chain dashboard/i)).toBeInTheDocument();

    // Content must still be correct once the refresh actually completes.
    await waitFor(() => {
      expect(screen.getByText(/Supply chain dashboard/i)).toBeInTheDocument();
    });
    expect(document.querySelector('.animate-pulse')).toBeNull();
  });
});
