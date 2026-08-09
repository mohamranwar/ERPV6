/**
 * StatusBadge — a small pill that maps a semantic intent to the token-based
 * colour system defined in index.css.  Use this instead of ad-hoc coloured
 * spans so status colours stay consistent and are changeable from one place.
 */
import React from 'react';

export type StatusIntent =
  | 'oos'        // out-of-stock risk  → red
  | 'overstock'  // overstock warning  → amber
  | 'healthy'    // healthy / on-track → green
  | 'transit'    // in-transit         → blue
  | 'cleared'    // customs cleared    → purple
  | 'neutral'    // no signal          → slate
  | 'brand'      // brand highlight    → indigo
  | 'success'    // alias for healthy
  | 'warning'    // alias for overstock
  | 'danger'     // alias for oos
  | 'info';      // alias for transit

const CLASS_MAP: Record<StatusIntent, string> = {
  oos:       'pill pill-oos',
  overstock: 'pill pill-overstock',
  healthy:   'pill pill-healthy',
  transit:   'pill pill-transit',
  cleared:   'pill pill-cleared',
  neutral:   'pill pill-muted',
  brand:     'pill pill-brand',
  success:   'pill pill-healthy',
  warning:   'pill pill-overstock',
  danger:    'pill pill-oos',
  info:      'pill pill-transit',
};

interface StatusBadgeProps {
  intent: StatusIntent;
  children: React.ReactNode;
  /** Prepend a coloured dot indicator */
  dot?: boolean;
  className?: string;
}

export function StatusBadge({ intent, children, dot = false, className = '' }: StatusBadgeProps) {
  return (
    <span className={`${CLASS_MAP[intent]} ${className}`}>
      {dot && (
        <span
          className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: 'currentColor', opacity: 0.75 }}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}

/**
 * Coverage thresholds, matching the engine exactly.
 *
 * The engine sets oos_risk_flag at < 1.0 and overstock_flag at > 3.0
 * (supabaseClient.ts, getVMaterialCoverage). This helper previously used > 4
 * for overstock, so any screen adopting it would have painted a material
 * healthy while the engine flagged it overstocked — the two must agree, since
 * they describe the same row.
 *
 * The 1-2 amber band is presentation only: the engine has no flag for it, it
 * is the watchlist the coverage screen's legend describes.
 */
export const COVERAGE_OOS_MONTHS = 1.0;
export const COVERAGE_OVERSTOCK_MONTHS = 3.0;

export function coverageIntent(months: number): StatusIntent {
  if (months <= 0) return 'oos';
  if (months < COVERAGE_OOS_MONTHS) return 'danger';
  if (months <= 2.0) return 'warning';
  if (months > COVERAGE_OVERSTOCK_MONTHS) return 'overstock';
  return 'healthy';
}
