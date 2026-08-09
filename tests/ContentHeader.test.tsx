/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ContentHeader from '../src/components/ContentHeader';

describe('<ContentHeader />', () => {
  it('renders the title always, and subtitle/actions only when provided', () => {
    const { rerender } = render(<ContentHeader title="Stock Coverage" />);
    expect(screen.getByText('Stock Coverage')).toBeInTheDocument();
    expect(screen.queryByText(/subtitle/i)).not.toBeInTheDocument();

    rerender(
      <ContentHeader
        title="Stock Coverage"
        subtitle="Compare months of inventory"
        actions={<button>Refresh</button>}
      />
    );
    expect(screen.getByText('Compare months of inventory')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });
});
