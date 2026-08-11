import React from 'react';
import { Database, LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  title?: string;
  message?: string;
  icon?: LucideIcon;
  actionLabel?: string;
  onAction?: () => void;
}

export default function EmptyState({
  title = 'No data available',
  message = 'No records match your criteria or the table is currently empty.',
  icon: Icon = Database,
  actionLabel = 'Go to CSV Importer',
  onAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-10 text-center bg-gradient-to-br from-slate-50 to-white border border-dashed border-slate-300 rounded-2xl max-w-md mx-auto my-6 space-y-3.5">
      <div className="p-3.5 bg-brand-50 text-brand-600 rounded-2xl border border-brand-100 shadow-sm">
        <Icon className="w-7 h-7" />
      </div>
      <div className="space-y-1">
        <h3 className="text-[14px] font-extrabold text-slate-900 tracking-tight">{title}</h3>
        <p className="text-[12px] text-slate-500 max-w-sm leading-relaxed">{message}</p>
      </div>
      {onAction && (
        <button
          type="button"
          onClick={onAction}
          className="btn-base btn-primary"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
