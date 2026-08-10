import React from 'react';
import { Download } from 'lucide-react';

interface ContentHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  onExportCsv?: () => void;
  actionsPosition?: 'right' | 'below';
}

export default function ContentHeader({
  title,
  subtitle,
  actions,
  children,
  onExportCsv,
  actionsPosition = 'right',
}: ContentHeaderProps) {
  const headerActions = actions || children;
  const isBelow = actionsPosition === 'below';

  return (
    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 border-b-2 border-slate-200/90 pb-4 mb-6 pt-1">
      <div className="space-y-2 text-start min-w-0 pr-4 flex-1">
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-none">
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs sm:text-sm text-slate-600 font-medium leading-relaxed max-w-2xl">{subtitle}</p>
        )}
        {isBelow && headerActions && (
          <div className="pt-1.5">
            {headerActions}
          </div>
        )}
      </div>
      {(!isBelow && headerActions || onExportCsv) && (
        <div className="flex flex-wrap items-center gap-3 md:justify-end shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
          {onExportCsv && (
            <button onClick={onExportCsv} className="btn-base btn-emerald shadow-sm" title="Export view data to CSV">
              <Download className="w-4 h-4 text-white" />
              <span>Export CSV</span>
            </button>
          )}
          {!isBelow && headerActions}
        </div>
      )}
    </div>
  );
}
