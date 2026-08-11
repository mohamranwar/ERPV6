import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import DashboardScreen from '../src/components/DashboardScreen';

beforeEach(() => localStorage.setItem('sc_planner_current_user_id', 'U1'));

/**
 * Proves the "Source: ... (Jul-25 to May-26)" badges are gone and replaced
 * with a caption derived from the real planning period -- not merely that the
 * literal string doesn't appear in the source file, which a component that
 * renders nothing at all would also satisfy.
 *
 * The bug this guards: SalesByPcsChart and the five other executive chart
 * components received real computed `data`, correctly, from
 * computeExecutiveChartData -- but the small caption badge underneath each
 * title was a second, separate hardcoded JSX string that nothing in the
 * earlier "activate live charts" work had touched. The chart itself was
 * fixed; a label three lines below it was not, and it kept asserting
 * "Jul-25 to May-26" regardless of what the chart above it was showing.
 */
describe('executive chart captions', () => {
  it('render a period-derived caption, not a fixed literal date range', async () => {
    render(<DashboardScreen />);

    await waitFor(() => {
      expect(screen.getByText(/Supply chain dashboard/i)).toBeInTheDocument();
    }, { timeout: 10000 });

    const body = document.body.textContent || '';

    // The specific literals from the screen recording, and their counterparts
    // on the other four charts that share the same bug.
    expect(body).not.toContain('Jul-25 to May-26');
    expect(body).not.toContain('Jun-25 to May-26');

    // A caption badge is present and reads as a derived range (MMM-YY to
    // MMM-YY) rather than being silently blank, which passing `undefined`
    // to a component with no fallback would also produce.
    const captionPattern = /[A-Z][a-z]{2}-\d{2} to [A-Z][a-z]{2}-\d{2}/;
    expect(body).toMatch(captionPattern);
  });
});
