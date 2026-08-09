/**
 * Card — a surface container with consistent elevation, padding, and an
 * optional header slot. Replace ad-hoc `bg-white rounded-xl shadow` divs
 * throughout the app with this component.
 */
import React from 'react';

interface CardProps {
  key?: React.Key;
  /** Optional heading rendered in the card header band */
  title?: React.ReactNode;
  /** Rendered in the top-right of the header alongside title */
  actions?: React.ReactNode;
  /** Padding size: 'none' | 'sm' | 'md' (default) | 'lg' */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** Extra classes on the outer wrapper */
  className?: string;
  children: React.ReactNode;
}

const PADDING: Record<NonNullable<CardProps['padding']>, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4 sm:p-5',
  lg: 'p-6',
};

export function Card({
  title,
  actions,
  padding = 'md',
  className = '',
  children,
}: CardProps) {
  return (
    <div
      className={`bg-white rounded-xl border border-slate-200/70 shadow-[var(--shadow-elev-2)] overflow-hidden ${className}`}
    >
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
          {title && (
            <h3 className="text-[13px] font-semibold text-slate-700 leading-none truncate">
              {title}
            </h3>
          )}
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      <div className={PADDING[padding]}>{children}</div>
    </div>
  );
}
