/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';
import { AlertCircle, CheckCircle2, XCircle, X, HelpCircle } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { motion, AnimatePresence } from 'motion/react';

export interface Toast {
  id: string;
  message: string;
  variant: 'success' | 'error';
}

interface ConfirmState {
  isOpen: boolean;
  message: string;
  title: string;
  resolve: (value: boolean) => void;
}

interface ToastConfirmContextType {
  showToast: (message: string, variant?: 'success' | 'error') => void;
  confirm: (message: string, title?: string) => Promise<boolean>;
}

const ToastConfirmContext = createContext<ToastConfirmContextType | undefined>(undefined);

export function ToastConfirmProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    isOpen: false,
    message: '',
    title: '',
    resolve: () => {},
  });

  const showToast = useCallback((message: string, variant: 'success' | 'error' = 'success') => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    setToasts((prev) => [...prev, { id, message, variant }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const confirm = useCallback((message: string, title?: string) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({
        isOpen: true,
        message,
        title: title || 'Confirm Action',
        resolve,
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setConfirmState((prev) => {
      prev.resolve(true);
      return { ...prev, isOpen: false };
    });
  }, []);

  const handleCancel = useCallback(() => {
    setConfirmState((prev) => {
      prev.resolve(false);
      return { ...prev, isOpen: false };
    });
  }, []);

  // Trap focus inside the confirm dialog while it's open, and let Escape
  // act as Cancel (consistent with how the Supabase config modal behaves).
  const confirmModalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(confirmModalRef, confirmState.isOpen, handleCancel);

  return (
    <ToastConfirmContext.Provider value={{ showToast, confirm }}>
      {children}

      {/* Global Toast Stack */}
      <div
        className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none"
        id="global_toast_stack"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: -10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.96 }}
              transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
              className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl bg-white border text-[12.5px] font-medium leading-relaxed break-words ${
                toast.variant === 'success'
                  ? 'border-emerald-100 text-slate-800 shadow-lg shadow-emerald-500/10'
                  : 'border-red-100 text-slate-800 shadow-lg shadow-red-500/10'
              }`}
            >
              <div
                className={`shrink-0 mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center ${
                  toast.variant === 'success'
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'bg-red-50 text-red-600'
                }`}
              >
                {toast.variant === 'success' ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <XCircle className="w-4 h-4" />
                )}
              </div>
              <div className="flex-1 text-slate-700">{toast.message}</div>
              <button
                onClick={() => dismissToast(toast.id)}
                className="shrink-0 text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-100 transition-colors"
                aria-label="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Global Confirmation Dialog Modal */}
      <AnimatePresence>
        {confirmState.isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-slate-900/45 backdrop-blur-sm"
            id="global_confirm_modal"
          >
            <motion.div
              ref={confirmModalRef}
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col border border-slate-200 font-sans"
            >
              <div className="px-6 py-5 border-b border-slate-100 bg-gradient-to-r from-amber-50 via-white to-rose-50 flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-100 text-amber-700 shrink-0">
                  <HelpCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-[13px] font-extrabold text-slate-900 tracking-tight">
                    {confirmState.title}
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">This action cannot be undone</p>
                </div>
              </div>

              <div className="p-6 text-[13px] text-slate-700 font-medium leading-relaxed">
                {confirmState.message}
              </div>

              <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5">
                <button
                  id="global_confirm_cancel"
                  onClick={handleCancel}
                  className="btn-base btn-secondary"
                >
                  Cancel
                </button>
                <button
                  id="global_confirm_proceed"
                  onClick={handleConfirm}
                  className="btn-base btn-primary"
                >
                  Confirm
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ToastConfirmContext.Provider>
  );
}

export function useToastConfirm() {
  const context = useContext(ToastConfirmContext);
  if (!context) {
    throw new Error('useToastConfirm must be used within a ToastConfirmProvider');
  }
  return context;
}

// Support simple alias import
export const useToast = useToastConfirm;
