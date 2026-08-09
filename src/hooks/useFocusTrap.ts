import { useEffect, RefObject } from 'react';

export function useFocusTrap(ref: RefObject<HTMLElement | null>, isOpen: boolean, onClose?: () => void) {
  useEffect(() => {
    if (!isOpen || !ref.current) return;

    const container = ref.current;
    
    // Find focusable elements
    const getFocusableElements = () => {
      return Array.from(
        container.querySelectorAll(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ) as HTMLElement[];
    };

    const focusable = getFocusableElements();
    if (focusable.length > 0) {
      // Focus the first element initially
      focusable[0].focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const els = getFocusableElements();
        if (els.length === 0) {
          e.preventDefault();
          return;
        }

        const first = els[0];
        const last = els[els.length - 1];

        if (e.shiftKey) {
          // Backward tab
          if (document.activeElement === first) {
            last.focus();
            e.preventDefault();
          }
        } else {
          // Forward tab
          if (document.activeElement === last) {
            first.focus();
            e.preventDefault();
          }
        }
      } else if (e.key === 'Escape' && onClose) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, ref, onClose]);
}
