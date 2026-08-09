/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SearchBar from '../src/components/SearchBar';

describe('<SearchBar />', () => {
  it('renders the given value and placeholder', () => {
    render(<SearchBar value="fluff" onChange={() => {}} placeholder="Search materials..." />);
    expect(screen.getByPlaceholderText('Search materials...')).toHaveValue('fluff');
  });

  it('calls onChange with the new text as the user types', () => {
    const onChange = vi.fn();
    render(<SearchBar value="" onChange={onChange} placeholder="Search..." />);
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'pulp' } });
    expect(onChange).toHaveBeenCalledWith('pulp');
  });

  it('shows a clear button only when there is a value, and clears on click', () => {
    const onChange = vi.fn();
    const { rerender } = render(<SearchBar value="" onChange={onChange} />);
    expect(screen.queryByLabelText('Clear search')).not.toBeInTheDocument();

    rerender(<SearchBar value="pulp" onChange={onChange} />);
    const clearBtn = screen.getByLabelText('Clear search');
    fireEvent.click(clearBtn);
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('shows the "search overrides filters" pill only when hasActiveSearch is true', () => {
    const { rerender } = render(<SearchBar value="pulp" onChange={() => {}} hasActiveSearch={false} />);
    expect(screen.queryByText(/filters bypassed/i)).not.toBeInTheDocument();

    rerender(<SearchBar value="pulp" onChange={() => {}} hasActiveSearch={true} />);
    expect(screen.getByText(/filters bypassed/i)).toBeInTheDocument();
  });
});
