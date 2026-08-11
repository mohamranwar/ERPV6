/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Layers } from 'lucide-react';
import ErrorState from './ErrorState';

interface DataStateWrapperProps {
  loading: boolean;
  error: Error | string | null;
  isEmpty: boolean;
  onRetry?: () => void;
  children: React.ReactNode;
  emptyMessage?: string;
  loadingHeightClass?: string;
}

export default function DataStateWrapper({
  loading,
  error,
  isEmpty,
  onRetry,
  children,
  emptyMessage = 'No data records found.',
  loadingHeightClass = 'h-64',
}: DataStateWrapperProps) {
  if (loading) {
    return (
      <div
        className={`flex flex-col items-center justify-center ${loadingHeightClass} w-full`}
        id="data_state_loading"
      >
        <div className="relative flex items-center justify-center">
          <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-slate-200 border-t-brand-600"></div>
        </div>
        <p className="mt-3.5 text-[12px] font-semibold text-slate-500 animate-pulse">
          Loading system workspace data…
        </p>
      </div>
    );
  }

  if (error) {
    // Presentation lives in ErrorState so screens that surface a failure
    // without unmounting their toolbar render exactly the same thing.
    return (
      <div className="max-w-xl mx-auto my-8">
        <ErrorState error={error} onRetry={onRetry} />
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div
        className="bg-gradient-to-br from-slate-50/80 to-white border border-dashed border-slate-200 rounded-2xl p-10 flex flex-col items-center justify-center text-center max-w-xl mx-auto my-8 space-y-3.5"
        id="data_state_empty"
      >
        <div className="p-3 bg-slate-100 text-slate-500 border border-slate-200 rounded-2xl">
          <Layers className="w-5 h-5" />
        </div>
        <div className="space-y-1">
          <h4 className="text-[12px] font-extrabold text-slate-900 uppercase tracking-wider">
            No records located
          </h4>
          <p className="text-[11.5px] text-slate-500 leading-relaxed max-w-xs mx-auto font-medium">
            {emptyMessage}
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
