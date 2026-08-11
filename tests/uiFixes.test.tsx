import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { transpose } from '../src/components/charts/ChartBuilder';
import ChartCard from '../src/components/charts/ChartCard';

describe('chart wiring on a single-period screen', () => {
  it('charts one bar per item, not one bar total', () => {
    // The shape PlanVsActualScreen now passes: items are the SERIES, and the
    // single reporting month is the period. Previously items were passed as
    // periods with one dummy series, so the swap summed all of them into one.
    const periods = ['August 2026'];
    const seriesNames = ['BJ-M4', 'AT-NC', 'SF-L2'];
    const plan = [[15000], [9000], [12000]];
    const actual = [[12000], [0], [11000]];

    const bySeries = transpose(periods, seriesNames, plan, actual, 'series');
    expect(bySeries).toHaveLength(3);
    expect(bySeries[0]).toEqual({ category: 'BJ-M4', plan: 15000, actual: 12000 });
  });

  it('hides the row/column swap when the axis is pinned', async () => {
    const user = userEvent.setup();
    render(
      <ChartCard
        chartId="t1" title="T"
        periods={['August 2026']}
        seriesNames={['A', 'B']}
        plan={[[10], [20]]} actual={[[8], [22]]}
        fixedAxis="series" seriesLabel="Items"
      />
    );
    await user.click(screen.getByText(/Format/i));
    await waitFor(() => expect(screen.getByText(/Format chart/i)).toBeInTheDocument());

    // Offering a transpose that can only produce one bar is worse than not
    // offering it, so the control is absent.
    expect(screen.queryByText(/Categories on X axis/i)).toBeNull();
    // The controls that DO work are still there.
    expect(screen.getByLabelText(/Measure/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Target line/i).length).toBeGreaterThan(0);
  });

  it('still offers the swap when there are real periods', async () => {
    const user = userEvent.setup();
    render(
      <ChartCard chartId="t2" title="T"
        periods={['Jul', 'Aug']} seriesNames={['A']}
        plan={[[10, 20]]} actual={[[9, 21]]} />
    );
    await user.click(screen.getByText(/Format/i));
    await waitFor(() => {
      expect(screen.getByText(/Categories on X axis/i)).toBeInTheDocument();
    });
  });
});
