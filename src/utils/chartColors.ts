/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Chart colours, read from the CSS custom properties.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * Recharts sets `fill` and `stroke` as SVG attributes, and an SVG attribute
 * cannot resolve `var(--token)`. So every chart in the app had its brand
 * colour written as a literal hex -- seven of them across DashboardScreen and
 * ManagementPack.
 *
 * That is a real trap, not a tidiness complaint. Changing the theme updates
 * 500+ Tailwind utilities instantly and leaves those seven bars on the old
 * colour. The app looks rebranded, a handful of chart bars quietly disagree,
 * and nobody notices for days. This project has already lost time to exactly
 * that class of bug three times.
 *
 * Reading the computed value once at module load gives Recharts a plain hex
 * string while keeping index.css the single source of truth.
 *
 * ── Dark mode ───────────────────────────────────────────────────────────────
 * The values are resolved lazily and cached per theme, because switching to
 * dark changes every one of these tokens. `resetChartColorCache()` is called
 * by the theme toggle so the next render picks the new palette up.
 */

export interface ChartPalette {
  /** Solid fill for actuals -- what happened. */
  actual: string;
  /** Outline for plan -- an intention, drawn as a ghost. */
  planStroke: string;
  planFill: string;
  /** Above / below a target. */
  over: string;
  under: string;
  grid: string;
  axis: string;
  /** Reference lines and target rules. */
  ref: string;
}

/** Shipped values, used when the DOM is unavailable (tests, SSR). */
const FALLBACK: ChartPalette = {
  actual: '#1E3A6B',
  planStroke: '#7A5AF8',
  planFill: 'rgba(122, 90, 248, 0.10)',
  over: '#12B76A',
  under: '#D92D20',
  grid: '#E3E9F1',
  axis: '#7C8CA3',
  ref: '#16223A',
};

let cache: ChartPalette | null = null;

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = styles.getPropertyValue(name).trim();
  return v || fallback;
}

export function chartColors(): ChartPalette {
  if (cache) return cache;

  // jsdom and any non-browser context: fall back rather than crash a chart.
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') {
    return FALLBACK;
  }

  try {
    const s = getComputedStyle(document.documentElement);
    cache = {
      actual: readVar(s, '--chart-actual-fill', FALLBACK.actual),
      planStroke: readVar(s, '--chart-plan-stroke', FALLBACK.planStroke),
      planFill: readVar(s, '--chart-plan-fill', FALLBACK.planFill),
      over: readVar(s, '--chart-over-fill', FALLBACK.over),
      under: readVar(s, '--chart-under-fill', FALLBACK.under),
      grid: readVar(s, '--chart-grid', FALLBACK.grid),
      axis: readVar(s, '--chart-axis', FALLBACK.axis),
      ref: readVar(s, '--chart-ref', FALLBACK.ref),
    };
    return cache;
  } catch {
    return FALLBACK;
  }
}

/** Call when the theme changes so the next chart render re-reads the tokens. */
export function resetChartColorCache(): void {
  cache = null;
}
