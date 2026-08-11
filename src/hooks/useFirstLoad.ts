/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useRef, useState } from 'react';

/**
 * Tracks whether a screen has ever completed a load, across unmounts.
 *
 * ── Why component state was not enough ──────────────────────────────────────
 * Screens each kept their own `hasLoadedOnce` flag in useState, and gated
 * their loading skeleton on `loading && !hasLoadedOnce`. That correctly
 * stopped the skeleton reappearing when `refreshKey` changed while the screen
 * stayed mounted.
 *
 * It did nothing for navigation, which is the case people actually hit.
 * App.tsx renders the active screen through a switch that returns a DIFFERENT
 * component for each screen, so leaving Dashboard unmounts it outright.
 * Coming back constructs a fresh instance, `hasLoadedOnce` initialises to
 * false again, and the full-screen skeleton renders on every single visit --
 * exactly the flash the guard was supposed to remove.
 *
 * The flag has to outlive the component, so it lives here at module scope.
 * It is deliberately NOT a data cache: the load still re-runs on every visit
 * and the numbers are still fresh. All this remembers is "this screen has
 * shown real content before, so replace it in place rather than blanking to
 * a skeleton first".
 *
 * Cleared on sign-out via `resetLoadedScreens()`, so a different user does
 * not inherit the previous one's assumption that data is already on screen.
 */
const loadedScreens = new Set<string>();

/** Forget every screen's loaded state. Call on sign-out. */
export function resetLoadedScreens(): void {
  loadedScreens.clear();
}

export interface FirstLoadState {
  /**
   * True only before this screen has ever completed a load. Gate a
   * full-screen skeleton on `loading && isFirstLoad`; on later visits the
   * previous content stays until the refresh lands.
   */
  isFirstLoad: boolean;
  /** Call when a load completes successfully. */
  markLoaded: () => void;
}

export function useFirstLoad(screenKey: string): FirstLoadState {
  // Read once at mount. Reading on every render would flip isFirstLoad to
  // false mid-load as soon as markLoaded ran, which is right for the NEXT
  // visit but would swap the skeleton out from under the current one.
  const initial = useRef(!loadedScreens.has(screenKey));
  const [isFirstLoad, setIsFirstLoad] = useState(initial.current);

  const markLoaded = useCallback(() => {
    loadedScreens.add(screenKey);
    setIsFirstLoad(false);
  }, [screenKey]);

  return { isFirstLoad, markLoaded };
}
