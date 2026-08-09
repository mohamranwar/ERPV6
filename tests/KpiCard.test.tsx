/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Four screens previously each carried their own KPI tile, with different type
 * scales, shadows and status-chip treatments, so the same figure looked like a
 * different class of thing depending on where you saw it. This is the single
 * implementation they now share; these tests pin the behaviour each screen
 * depended on so the consolidation cannot silently regress one of them.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { KpiCard } from '../src/components/ui';

describe('<KpiCard />', () => {
  it('renders the label and figure', () => {
    render(<KpiCard label="OOS Risk" value={3} />);
    expect(screen.getByText('OOS Risk')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders a unit beside the figure without merging into it', () => {
    render(<KpiCard label="Volume" value="215,000" unit="PCS" />);
    expect(screen.getByText('215,000')).toBeInTheDocument();
    expect(screen.getByText('PCS')).toBeInTheDocument();
  });

  it('renders the sub-line', () => {
    render(<KpiCard label="Orders" value={12} sub="POs & in-transit records" />);
    expect(screen.getByText(/POs & in-transit records/)).toBeInTheDocument();
  });

  it('renders a status badge when supplied', () => {
    render(<KpiCard label="OOS Risk" value={3} badge={{ label: 'Critical', intent: 'danger' }} />);
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });

  it('renders a progress rail and its rounded percentage', () => {
    render(<KpiCard label="Readiness" value="40,000" progress={62.4} />);
    expect(screen.getByText('62%')).toBeInTheDocument();
  });

  it('clamps progress into 0-100 rather than overflowing the rail', () => {
    const { container, rerender } = render(<KpiCard label="A" value={1} progress={180} />);
    expect((container.querySelector('[style*="width"]') as HTMLElement).style.width).toBe('100%');
    rerender(<KpiCard label="A" value={1} progress={-20} />);
    expect((container.querySelector('[style*="width"]') as HTMLElement).style.width).toBe('0%');
  });

  it('omits the progress rail entirely when progress is undefined', () => {
    // Distinct from progress={0}: "not applicable" must not render as an empty
    // rail implying zero percent of something.
    const { container } = render(<KpiCard label="A" value={1} />);
    expect(container.querySelector('[style*="width"]')).toBeNull();
  });

  it('becomes a real button when it drills into a screen', () => {
    const onClick = vi.fn();
    render(<KpiCard label="OOS Risk" value={3} onClick={onClick} />);
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    // A div with a click handler is not keyboard reachable; a button is.
    expect(btn.tagName).toBe('BUTTON');
  });

  it('is not a button when it has no action', () => {
    render(<KpiCard label="Orders" value={12} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders arbitrary footer content', () => {
    render(<KpiCard label="Ready" value={4} footer={<span>KSA</span>} />);
    expect(screen.getByText('KSA')).toBeInTheDocument();
  });
});
