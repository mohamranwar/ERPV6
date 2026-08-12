/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { resetChartColorCache } from '../utils/chartColors';

/**
 * Light / dark mode.
 *
 * The whole mechanism is one attribute on <html>: `data-theme="dark"`. Every
 * surface, line and ink colour already comes from a CSS token, so index.css
 * overrides those tokens under that selector and no component needs a `dark:`
 * variant. Adding a screen later costs nothing.
 *
 * Charts are the exception and have to be told explicitly, because Recharts
 * writes SVG attributes which cannot resolve a CSS variable. The cache in
 * chartColors.ts is cleared on every change so the next render re-reads the
 * new palette.
 */

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'sc_planner_theme';

interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  setTheme: () => {},
  toggle: () => {},
});

function initialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Blocked or full localStorage must not stop the app booting.
  }
  // No stored choice: follow the operating system rather than assuming light.
  try {
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch {
    /* matchMedia unavailable in some embeds */
  }
  return 'light';
}

function apply(theme: ThemeMode): void {
  const root = document.documentElement;
  if (theme === 'dark') root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
  // Charts hold resolved hex strings, so they must be invalidated here or
  // they keep rendering the previous mode's palette until a full reload.
  resetChartColorCache();
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() =>
    typeof window === 'undefined' ? 'light' : initialTheme());

  useEffect(() => { apply(theme); }, [theme]);

  const setTheme = useCallback((t: ThemeMode) => {
    setThemeState(t);
    try { localStorage.setItem(STORAGE_KEY, t); } catch { /* non-fatal */ }
  }, []);

  const toggle = useCallback(
    () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    [theme, setTheme],
  );

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
