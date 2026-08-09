/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DataStateWrapper from '../src/components/DataStateWrapper';

// Regression coverage for the MaterialDrillDown infinite-spinner bug: that
// screen now routes its loading/error/empty states through this component
// instead of a bare `if (loading) return <spinner>` that could get stuck
// forever if the initial fetch failed silently.
describe('<DataStateWrapper />', () => {
  it('shows a loading state and not the children while loading', () => {
    render(
      <DataStateWrapper loading={true} error={null} isEmpty={false}>
        <div>Real Content</div>
      </DataStateWrapper>
    );
    expect(screen.queryByText('Real Content')).not.toBeInTheDocument();
  });

  it('shows an error state with a working retry button instead of hanging forever', () => {
    const onRetry = vi.fn();
    render(
      <DataStateWrapper loading={false} error="Network failed" isEmpty={false} onRetry={onRetry}>
        <div>Real Content</div>
      </DataStateWrapper>
    );
    expect(screen.getByText('Network failed')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/retry/i));
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows an explicit empty message rather than a blank screen when there is no data', () => {
    render(
      <DataStateWrapper loading={false} error={null} isEmpty={true} emptyMessage="No materials configured.">
        <div>Real Content</div>
      </DataStateWrapper>
    );
    expect(screen.getByText('No materials configured.')).toBeInTheDocument();
    expect(screen.queryByText('Real Content')).not.toBeInTheDocument();
  });

  it('renders children once loaded, non-empty, and error-free', () => {
    render(
      <DataStateWrapper loading={false} error={null} isEmpty={false}>
        <div>Real Content</div>
      </DataStateWrapper>
    );
    expect(screen.getByText('Real Content')).toBeInTheDocument();
  });
});
