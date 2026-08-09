/**
 * Modal — a focus-trapped, escape-dismissible overlay that works on both
 * desktop and mobile.  On mobile it slides up from the bottom (sheet style);
 * on lg+ it centres as a dialog.
 *
 * Uses the existing useFocusTrap hook so the same tested behaviour applies.
 */
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Width class on lg+ (default: 'max-w-lg') */
  width?: string;
  /** Footer slot — rendered below content inside the modal */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  width = 'max-w-lg',
  footer,
  children,
}: ModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, open, onClose);

  // Prevent body scroll while open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end lg:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={containerRef}
        className={`relative w-full ${width} bg-white rounded-t-2xl lg:rounded-2xl shadow-[var(--shadow-elev-4)]
          flex flex-col max-h-[90dvh] lg:max-h-[85vh]
          animate-slide-up lg:animate-fade-in`}
      >
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 shrink-0">
            <h2
              id="modal-title"
              className="text-[14px] font-semibold text-slate-800 leading-none"
            >
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 transition-colors p-1 rounded-md hover:bg-slate-100"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2 shrink-0 bg-slate-50/70">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
