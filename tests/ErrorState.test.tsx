/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Before this component existed, every data screen swallowed a failed load
 * into console.error and then rendered an empty table. A planner could not
 * distinguish "the database is unreachable" from "there is no data", which is
 * the difference between retrying and making a decision on missing figures.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ErrorState from '../src/components/ErrorState';

describe('<ErrorState />', () => {
  it('renders nothing when there is no error', () => {
    const { container } = render(<ErrorState error={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('announces itself to assistive tech as an alert', () => {
    render(<ErrorState error="Connection refused" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows the underlying message so the cause is diagnosable', () => {
    render(<ErrorState error="permission denied for table materials" />);
    expect(screen.getByText(/permission denied for table materials/i)).toBeInTheDocument();
  });

  it('accepts an Error instance as well as a string', () => {
    render(<ErrorState error={new Error('fetch failed')} />);
    expect(screen.getByText(/fetch failed/i)).toBeInTheDocument();
  });

  it('warns that displayed figures may be stale', () => {
    // The banner sits above live data, so it must say the numbers below are
    // not to be trusted — otherwise it reads as dismissable noise.
    render(<ErrorState error="boom" />);
    expect(screen.getByText(/stale or incomplete/i)).toBeInTheDocument();
  });

  it('offers a retry that calls back', () => {
    const onRetry = vi.fn();
    render(<ErrorState error="boom" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('omits the retry button when no handler is supplied', () => {
    render(<ErrorState error="boom" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
