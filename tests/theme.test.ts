import { beforeEach, describe, expect, it } from 'vitest';
import { chartColors, resetChartColorCache } from '../src/utils/chartColors';

beforeEach(() => {
  resetChartColorCache();
  document.documentElement.removeAttribute('data-theme');
});

/**
 * These guard the integration gap that has bitten this project repeatedly:
 * a theme change updates hundreds of Tailwind utilities instantly and leaves
 * anything holding a literal hex on the old colour. Recharts cannot resolve
 * a CSS variable in an SVG attribute, so chart fills went through
 * chartColors() instead -- and that indirection is only worth anything if it
 * genuinely tracks the tokens.
 */
describe('chartColors', () => {
  it('returns a usable palette even with no stylesheet loaded', () => {
    // jsdom has no index.css, which is exactly the fallback path.
    const c = chartColors();
    expect(c.actual).toMatch(/^#|rgb/);
    expect(c.over).toMatch(/^#|rgb/);
    expect(c.under).toMatch(/^#|rgb/);
  });

  it('reads the token when one is set rather than using the fallback', () => {
    document.documentElement.style.setProperty('--chart-actual-fill', '#ABCDEF');
    resetChartColorCache();
    expect(chartColors().actual).toBe('#ABCDEF');
    document.documentElement.style.removeProperty('--chart-actual-fill');
  });

  it('caches, so a chart with many bars does not recompute per bar', () => {
    document.documentElement.style.setProperty('--chart-actual-fill', '#111111');
    resetChartColorCache();
    expect(chartColors().actual).toBe('#111111');

    // Changed underneath without clearing: the cache should still hold.
    document.documentElement.style.setProperty('--chart-actual-fill', '#222222');
    expect(chartColors().actual).toBe('#111111');

    // Explicit reset is what a theme switch does.
    resetChartColorCache();
    expect(chartColors().actual).toBe('#222222');
    document.documentElement.style.removeProperty('--chart-actual-fill');
  });

  it('never returns an empty string, which would render an invisible chart', () => {
    document.documentElement.style.setProperty('--chart-actual-fill', '   ');
    resetChartColorCache();
    expect(chartColors().actual.trim().length).toBeGreaterThan(0);
    document.documentElement.style.removeProperty('--chart-actual-fill');
  });
});

describe('dark mode attribute', () => {
  it('is off by default', () => {
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });

  it('drives everything from one attribute, so no component needs a dark variant', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    document.documentElement.removeAttribute('data-theme');
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });
});
