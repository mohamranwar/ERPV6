/**
 * FilterBar — a horizontal row of filter controls (search + dropdowns) with
 * a consistent height and gap.  Wraps onto two rows on small screens.
 */
import React from 'react';

interface FilterBarProps {
  children: React.ReactNode;
  className?: string;
}

export function FilterBar({ children, className = '' }: FilterBarProps) {
  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${className}`}
      role="search"
    >
      {children}
    </div>
  );
}

/** A single pill-shaped <select> filter inside a FilterBar */
interface FilterSelectProps {
  label?: string;
  id?: string;
  value?: string;
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function FilterSelect({
  label,
  className = '',
  children,
  ...props
}: FilterSelectProps) {
  return (
    <label className="flex items-center gap-1.5">
      {label && (
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
          {label}
        </span>
      )}
      <select
        {...props}
        className={`rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[12.5px] font-medium
          text-slate-700 shadow-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-200
          transition-colors outline-none ${className}`}
      >
        {children}
      </select>
    </label>
  );
}
