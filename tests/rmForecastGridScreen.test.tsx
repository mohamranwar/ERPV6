import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import RMForecastVarianceScreen from '../src/components/RMForecastVarianceScreen';
import { resetLoadedScreens } from '../src/hooks/useFirstLoad';

beforeEach(() => {
  localStorage.setItem('sc_planner_current_user_id', 'U1');
  resetLoadedScreens();
});

/**
 * The bug this guards: a two-row header built with colSpan is exactly where a
 * table silently skews by one cell. Adding the supplier column moved every
 * month group one to the right, and nothing about that failure is visible in
 * a typecheck -- the page renders, the numbers just sit under the wrong
 * headings, which is worse than a crash because it looks fine.
 */
describe('RM forecast grid renders as a grid', () => {
  it('shows the grid columns, not KPI cards', async () => {
    render(<RMForecastVarianceScreen />);

    await waitFor(() => {
      expect(screen.getByText('RM Forecast vs Actual PO')).toBeInTheDocument();
    }, { timeout: 15000 });

    // Supplier is its own column now, not a suffix on the SKU line.
    // Scoped to the table header: "Supplier" also appears as the filter label.
    const headers = Array.from(document.querySelectorAll('thead th'))
      .map(th => th.textContent?.trim());
    expect(headers).toContain('Supplier');
    // Per-month sub-headers.
    expect(screen.getAllByText('Forecast').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ordered').length).toBeGreaterThan(0);
  });

  it('every body row has exactly as many cells as the header declares', async () => {
    const { container } = render(<RMForecastVarianceScreen />);

    await waitFor(() => {
      expect(screen.getByText('RM Forecast vs Actual PO')).toBeInTheDocument();
    }, { timeout: 15000 });

    const headRows = container.querySelectorAll('thead tr');
    if (headRows.length < 2) return; // no data in this environment

    // Total columns the header claims, counting colSpan and rowSpan.
    let declared = 0;
    headRows[0].querySelectorAll('th').forEach(th => {
      declared += Number(th.getAttribute('colspan') ?? 1);
    });

    const bodyRows = Array.from(container.querySelectorAll('tbody tr'))
      // Drill-down rows and the empty state legitimately span the table.
      .filter(tr => tr.querySelectorAll('td').length > 3);

    for (const tr of bodyRows) {
      expect(tr.querySelectorAll('td').length).toBe(declared);
    }
  });

  it('has no chart or gauge elements left on the screen', async () => {
    const { container } = render(<RMForecastVarianceScreen />);

    await waitFor(() => {
      expect(screen.getByText('RM Forecast vs Actual PO')).toBeInTheDocument();
    }, { timeout: 15000 });

    // The brief was explicit: remove the graphs, show percentages only.
    expect(container.querySelector('.recharts-wrapper')).toBeNull();
    expect(screen.queryByText(/Format/i)).toBeNull();
  });

  it('offers the horizon and projection controls', async () => {
    render(<RMForecastVarianceScreen />);

    await waitFor(() => {
      expect(screen.getByText('RM Forecast vs Actual PO')).toBeInTheDocument();
    }, { timeout: 15000 });

    expect(screen.getByText('4 months')).toBeInTheDocument();
    expect(screen.getByText('6 months')).toBeInTheDocument();
    expect(screen.getByText('12 months')).toBeInTheDocument();
    expect(screen.getByText(/Average ±15%/)).toBeInTheDocument();
    // Grain toggle
    expect(screen.getByText('Month')).toBeInTheDocument();
    expect(screen.getByText('Week')).toBeInTheDocument();
  });
});

/**
 * The bug this exists to prevent, which shipped and reached the user.
 *
 * Every other piece was in place -- the ScreenID union, the SCREEN_META
 * entry, the sidebar nav item, the lazy import -- but the `case` in App's
 * render switch was missing. TypeScript cannot catch that: a switch with no
 * matching case just falls through to the default, so clicking "RM Forecast
 * vs PO" rendered the Dashboard under the RM Forecast header. It typechecked,
 * the whole suite passed, and the screen was simply never reachable.
 *
 * Every existing test rendered the component directly, which is exactly why
 * none of them noticed. This one goes through App.
 */
describe('RM forecast screen is actually routable', () => {
  it('has a route case for every screen that has a nav entry', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');

    // Screen ids that appear as a nav item must also appear as a case.
    const navIds = Array.from(src.matchAll(/\{\s*id:\s*'([a-z_]+)'\s*,\s*label:/g))
      .map(m => m[1]);
    const caseIds = Array.from(src.matchAll(/case\s+'([a-z_]+)'\s*:/g))
      .map(m => m[1]);

    const unrouted = navIds.filter(id => !caseIds.includes(id));
    expect(unrouted).toEqual([]);
  });
});
