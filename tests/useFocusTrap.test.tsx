/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useFocusTrap } from '../src/hooks/useFocusTrap';

function TestModal({ onClose }: { onClose: () => void }) {
  const [isOpen, setIsOpen] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, isOpen, () => {
    setIsOpen(false);
    onClose();
  });

  if (!isOpen) return null;

  return (
    <div ref={ref} data-testid="modal">
      <button>First</button>
      <button>Middle</button>
      <button>Last</button>
    </div>
  );
}

describe('useFocusTrap', () => {
  it('focuses the first focusable element when it opens', () => {
    render(<TestModal onClose={() => {}} />);
    expect(screen.getByText('First')).toHaveFocus();
  });

  it('wraps Tab from the last element back to the first', () => {
    render(<TestModal onClose={() => {}} />);
    screen.getByText('Last').focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(screen.getByText('First')).toHaveFocus();
  });

  it('wraps Shift+Tab from the first element back to the last', () => {
    render(<TestModal onClose={() => {}} />);
    screen.getByText('First').focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(screen.getByText('Last')).toHaveFocus();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<TestModal onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
