/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, type DependencyList } from 'react';

/**
 * Runs a screen's data load, discarding results from superseded runs.
 *
 * ── The bug this exists to prevent ──────────────────────────────────────────
 * Every data screen loaded like this:
 *
 *     useEffect(() => { loadData(); }, [refreshKey]);
 *
 *     async function loadData() {
 *       const [a, b, …] = await Promise.all([…nine queries…]);
 *       setSalesCompare(a);
 *       setProductionCompare(b);
 *     }
 *
 * with no cancellation. `handlePeriodChange` bumps `refreshKey`, so every
 * period switch re-fires the effect. A planner clicking month to month through
 * the dropdown — an entirely ordinary action — starts overlapping loads of
 * nine parallel queries each. Responses are not guaranteed to arrive in the
 * order they were sent, so an earlier load resolving last writes its results
 * into state and the screen displays one month's numbers under another
 * month's heading. No error, no spinner, no visual cue that anything is wrong.
 *
 * Navigating away mid-load also set state on an unmounted component.
 *
 * ── How it works ────────────────────────────────────────────────────────────
 * The callback receives a `signal` object. Check `signal.cancelled` after
 * every await, before writing state:
 *
 *     useAsyncLoad(async (signal) => {
 *       setLoading(true);
 *       try {
 *         const [a, b] = await Promise.all([fetchA(), fetchB()]);
 *         if (signal.cancelled) return;
 *         setA(a);
 *         setB(b);
 *       } catch (e) {
 *         if (!signal.cancelled) setError(String(e));
 *       } finally {
 *         if (!signal.cancelled) setLoading(false);
 *       }
 *     }, [refreshKey]);
 *
 * A plain mutable object rather than `AbortController` because these loads go
 * through `supabaseClient`, which does not accept a signal. This cannot abort
 * the request in flight — it discards the response. That is enough to fix the
 * displayed-data bug, which is the one that misleads people. Wiring real
 * abortion would mean threading a signal through every query helper; worth
 * doing eventually, not needed to stop the wrong month appearing.
 */

export interface LoadSignal {
  /** True once a newer run has started or the component has unmounted. */
  readonly cancelled: boolean;
}

export function useAsyncLoad(
  load: (signal: LoadSignal) => Promise<void> | void,
  deps: DependencyList,
): void {
  // The callback is intentionally excluded from the effect's dependencies:
  // screens define `loadData` inline, so it is a new function every render and
  // would re-fire the effect on every state update — including the state the
  // load itself sets, which is an infinite loop. The ref keeps the latest
  // closure available without making identity a trigger.
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const signal = { cancelled: false };

    // Errors are the caller's to handle; this catch only stops an unhandled
    // rejection when a load throws after being superseded.
    Promise.resolve(loadRef.current(signal)).catch(err => {
      if (!signal.cancelled) throw err;
    });

    return () => { signal.cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export default useAsyncLoad;
