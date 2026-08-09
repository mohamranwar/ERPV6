/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorStateProps {
  error: Error | string | null;
  onRetry?: () => void;
  /** Rendered above the message to say what failed to load. */
  context?: string;
}

/**
 * The single error presentation for a failed data load.
 *
 * Extracted from DataStateWrapper so a screen can surface a load failure
 * *without* unmounting its header and toolbar. That matters: replacing the
 * whole screen with an error card takes away the period selector and refresh
 * control the planner needs to recover, and it hides which screen they were
 * even on.
 */
export default function ErrorState({ error, onRetry, context }: ErrorStateProps) {
  if (!error) return null;
  const message =
    typeof error === 'string' ? error : error.message || 'An unexpected database error occurred.';

  return (
    <div
      className="bg-gradient-to-br from-red-50/60 to-white border border-red-200 rounded-2xl p-5 flex items-start gap-4"
      id="data_state_error"
      role="alert"
    >
      <div className="p-2.5 bg-red-100/80 border border-red-200 text-red-600 rounded-xl shrink-0">
        <AlertCircle className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <h3 className="text-[12.5px] font-extrabold text-slate-900 uppercase tracking-wide">
          {context ?? 'Data synchronisation failed'}
        </h3>
        <p className="text-[12px] text-slate-600 leading-relaxed font-medium break-words">
          {message}
        </p>
        <p className="text-[11px] text-slate-500">
          The figures below may be stale or incomplete until this succeeds.
        </p>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="btn-base btn-danger shrink-0">
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      )}
    </div>
  );
}
