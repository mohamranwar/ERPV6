import React, { useState } from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAsyncLoad, type LoadSignal } from '../src/hooks/useAsyncLoad';

/**
 * The bug these guard against: every data screen re-ran its load on
 * `refreshKey`, which `handlePeriodChange` bumps. Clicking month to month
 * through the period dropdown starts overlapping loads, and responses are not
 * guaranteed to return in the order they were sent. An earlier load resolving
 * last wrote its results into state, so the screen showed one month's numbers
 * under another month's heading — silently.
 */

/** A promise whose resolution this test controls. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

describe('useAsyncLoad', () => {
  it('runs the load once on mount', async () => {
    let runs = 0;
    function Screen() {
      useAsyncLoad(async () => { runs += 1; }, []);
      return <div>ready</div>;
    }
    render(<Screen />);
    await waitFor(() => expect(runs).toBe(1));
  });

  it('re-runs when a dependency changes', async () => {
    let runs = 0;
    function Screen({ k }: { k: number }) {
      useAsyncLoad(async () => { runs += 1; }, [k]);
      return <div>ready</div>;
    }
    const { rerender } = render(<Screen k={1} />);
    await waitFor(() => expect(runs).toBe(1));
    rerender(<Screen k={2} />);
    await waitFor(() => expect(runs).toBe(2));
  });

  /**
   * The core case. Two loads overlap and the FIRST resolves LAST — exactly
   * what happens when a slow query for August returns after a fast one for
   * September.
   */
  it('discards a superseded response even when it resolves last', async () => {
    const first = deferred<string>();
    const second = deferred<string>();

    function Screen({ period }: { period: string }) {
      const [value, setValue] = useState('none');
      useAsyncLoad(async (signal: LoadSignal) => {
        const result = await (period === 'aug' ? first.promise : second.promise);
        if (signal.cancelled) return;
        setValue(result);
      }, [period]);
      return <div>{value}</div>;
    }

    const { rerender } = render(<Screen period="aug" />);
    rerender(<Screen period="sep" />);          // supersedes the August load

    await act(async () => { second.resolve('september'); });
    await waitFor(() => expect(screen.getByText('september')).toBeInTheDocument());

    // August now returns, out of order. Without the guard it would overwrite.
    await act(async () => { first.resolve('august'); });

    expect(screen.getByText('september')).toBeInTheDocument();
    expect(screen.queryByText('august')).toBeNull();
  });

  it('marks the signal cancelled after unmount', async () => {
    const pending = deferred<string>();
    let sawCancelled: boolean | null = null;

    function Screen() {
      useAsyncLoad(async (signal: LoadSignal) => {
        await pending.promise;
        sawCancelled = signal.cancelled;
      }, []);
      return <div>ready</div>;
    }

    const { unmount } = render(<Screen />);
    unmount();
    await act(async () => { pending.resolve('done'); });

    // The screen is gone; writing state here would warn and leak.
    expect(sawCancelled).toBe(true);
  });

  it('does not re-run when the callback identity changes on re-render', async () => {
    // Screens define loadData inline, so it is a new function every render.
    // If identity triggered the effect, the state the load sets would re-fire
    // the load — an infinite loop.
    let runs = 0;
    function Screen({ tick }: { tick: number }) {
      const [, setState] = useState(0);
      useAsyncLoad(async () => { runs += 1; setState(n => n + 1); }, []);
      return <div>{tick}</div>;
    }
    const { rerender } = render(<Screen tick={1} />);
    await waitFor(() => expect(runs).toBe(1));
    rerender(<Screen tick={2} />);
    rerender(<Screen tick={3} />);
    await new Promise(r => setTimeout(r, 20));
    expect(runs).toBe(1);
  });

  it('leaves an error from a live load unswallowed', async () => {
    // The hook's internal catch exists only to silence rejections from
    // superseded loads. A live failure is still the screen's to handle.
    let caught: string | null = null;
    function Screen() {
      useAsyncLoad(async () => {
        try {
          throw new Error('query failed');
        } catch (e) {
          caught = (e as Error).message;
        }
      }, []);
      return <div>ready</div>;
    }
    render(<Screen />);
    await waitFor(() => expect(caught).toBe('query failed'));
  });
});
