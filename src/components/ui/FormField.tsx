/**
 * FormField — label + input/select/textarea wrapper with consistent spacing,
 * error display, and required markers.  Prevents the rampant `flex flex-col
 * gap-1 text-xs font-medium text-slate-600` repetition across modals.
 */
import React from 'react';

interface FormFieldProps {
  label: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}

export function FormField({
  label,
  htmlFor,
  required,
  error,
  hint,
  children,
  className = '',
}: FormFieldProps) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label
        htmlFor={htmlFor}
        className="text-[11.5px] font-semibold text-slate-600 uppercase tracking-wide leading-none"
      >
        {label}
        {required && (
          <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>
        )}
      </label>
      {children}
      {error && (
        <p className="text-[11px] text-red-600 font-medium mt-0.5">{error}</p>
      )}
      {hint && !error && (
        <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>
      )}
    </div>
  );
}

/** Shared input class string — apply to every <input> inside a FormField */
export const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-800 ' +
  'placeholder:text-slate-400 shadow-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-200 ' +
  'disabled:bg-slate-50 disabled:text-slate-400 transition-colors outline-none';

/** Shared select class */
export const selectCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-800 ' +
  'shadow-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-200 ' +
  'disabled:bg-slate-50 disabled:text-slate-400 transition-colors outline-none';
