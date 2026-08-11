import React from 'react';
import { motion } from 'motion/react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { StatusBadge, type StatusIntent } from './StatusBadge';

export interface KpiCardProps {
  label: string;
  value: string | number;
  /** Second-line detail below the value */
  sub?: string;
  /** Positive = green up-arrow, negative = red down-arrow, zero = flat */
  trend?: number;
  /** Label to show next to trend icon, e.g. "+5.2% vs last mo" */
  trendLabel?: string;
  /** Unit appended to the value, e.g. "mo" or "%" */
  unit?: string;
  icon?: React.ReactNode;
  /** Semantic colour override for the value text */
  intent?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  /** 0-100. Renders a progress rail under the figure when supplied. */
  progress?: number;
  /** Short status chip beside the figure, e.g. "Critical", "Watchlist". */
  badge?: { label: string; intent: StatusIntent };
  /** Secondary highlight metric, e.g. "(72 Days)" */
  secondaryValue?: string;
  /**
   * Arbitrary content below the figure — country chips, a mini legend, a
   * drill-down link. Exists so screens with a one-off flourish can still use
   * the shared card instead of hand-rolling the whole tile around it.
   */
  footer?: React.ReactNode;
  /** Makes the whole tile activate, for tiles that drill into a screen. */
  onClick?: () => void;
  className?: string;
}

const INTENT_CLASS: Record<NonNullable<KpiCardProps['intent']>, string> = {
  default: 'text-slate-900',
  success: 'text-emerald-700',
  warning: 'text-amber-700',
  danger:  'text-red-700',
  info:    'text-sky-700',
};

const ICON_BG_CLASS: Record<NonNullable<KpiCardProps['intent']>, string> = {
  default: 'bg-slate-100 text-slate-600',
  success: 'bg-emerald-50 text-emerald-600 border border-emerald-100',
  warning: 'bg-amber-50 text-amber-600 border border-amber-100',
  danger:  'bg-red-50 text-red-600 border border-red-100',
  info:    'bg-sky-50 text-sky-600 border border-sky-100',
};

const PROGRESS_CLASS: Record<NonNullable<KpiCardProps['intent']>, string> = {
  default: 'bg-brand-600',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger:  'bg-red-500',
  info:    'bg-sky-500',
};

export function KpiCard({
  label,
  value,
  sub,
  trend,
  trendLabel,
  unit,
  icon,
  intent = 'default',
  progress,
  badge,
  secondaryValue,
  footer,
  onClick,
  className = '',
}: KpiCardProps) {
  const TrendIcon =
    trend == null ? null
    : trend > 0   ? TrendingUp
    : trend < 0   ? TrendingDown
                  : Minus;

  const trendClass =
    trend == null ? ''
    : trend > 0   ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
    : trend < 0   ? 'text-red-600 bg-red-50 border-red-200'
                  : 'text-slate-500 bg-slate-100 border-slate-200';

  const isInteractive = Boolean(onClick);
  const Element = isInteractive ? motion.button : motion.div;

  return (
    <Element
      {...(isInteractive ? { onClick, type: 'button' as const } : {})}
      whileHover={isInteractive ? { y: -2, transition: { duration: 0.15 } } : undefined}
      className={`bg-white rounded-xl border border-slate-200/80 shadow-[0_2px_4px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_16px_rgba(0,0,0,0.06)] p-4 flex flex-col justify-between gap-2.5 text-start transition-all ${
        isInteractive ? 'cursor-pointer hover:border-slate-300' : ''
      } ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider leading-tight">
          {label}
        </span>
        {icon && (
          <div className={`p-1.5 rounded-lg shrink-0 ${ICON_BG_CLASS[intent]}`}>
            {icon}
          </div>
        )}
      </div>

      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className={`text-2xl font-black font-mono tracking-tight leading-none ${INTENT_CLASS[intent]}`}>
          {value}
        </span>
        {unit && (
          <span className="text-xs font-semibold text-slate-500">{unit}</span>
        )}
        {secondaryValue && (
          <span className="text-xs font-mono font-medium text-slate-500 ms-0.5">
            {secondaryValue}
          </span>
        )}
        {badge && (
          <span className="ms-auto">
            <StatusBadge intent={badge.intent}>{badge.label}</StatusBadge>
          </span>
        )}
      </div>

      {(sub || TrendIcon || trendLabel) && (
        <div className="flex items-center gap-1.5 flex-wrap text-[11.5px]">
          {TrendIcon && (
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-mono font-medium text-[10.5px] ${trendClass}`}>
              <TrendIcon className="w-3 h-3" />
              {trendLabel && <span>{trendLabel}</span>}
            </span>
          )}
          {sub && (
            <span className="text-slate-500 font-medium">{sub}</span>
          )}
        </div>
      )}

      {progress !== undefined && (
        <div className="flex items-center gap-2 pt-0.5">
          <div className="flex-1 bg-slate-100 h-1.5 rounded-full overflow-hidden">
            <div
              className={`h-1.5 rounded-full transition-all duration-500 ${PROGRESS_CLASS[intent]}`}
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
          <span className="text-[11px] font-bold font-mono text-slate-600">
            {Math.round(progress)}%
          </span>
        </div>
      )}

      {footer}
    </Element>
  );
}

