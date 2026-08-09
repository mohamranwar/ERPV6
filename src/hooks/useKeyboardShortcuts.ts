import { useEffect, useRef } from 'react';

interface KeyboardShortcutProps {
  onNavigate: (screen: any) => void;
  onCloseModals: () => void;
}

export function useKeyboardShortcuts({ onNavigate, onCloseModals }: KeyboardShortcutProps) {
  const gPressedRef = useRef(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // If user is typing in an input/textarea/select, don't trigger shortcuts (except Esc, which should blur or close modals)
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;

      if (e.key === 'Escape') {
        onCloseModals();
        if (isInput) {
          target.blur();
        }
        return;
      }

      if (isInput) {
        return;
      }

      // '/' shortcut to focus search input
      if (e.key === '/') {
        e.preventDefault();
        const searchInput = document.querySelector('input[type="search"], input[placeholder*="Search"], input[placeholder*="search"]') as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      // Handle g prefix
      if (e.key.toLowerCase() === 'g') {
        gPressedRef.current = true;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          gPressedRef.current = false;
        }, 1000); // 1-second window for the sequence
        return;
      }

      if (gPressedRef.current) {
        const char = e.key.toLowerCase();
        let navigated = true;

        switch (char) {
          case 'd':
            onNavigate('dashboard');
            break;
          case 'b':
            onNavigate('bom');
            break;
          case 's':
            onNavigate('sales_plan');
            break;
          case 'e':
          case 'x':
            onNavigate('export_forecast');
            break;
          case 'p':
            onNavigate('production_plan');
            break;
          case 'm':
            onNavigate('mrp');
            break;
          case 'c':
            onNavigate('coverage');
            break;
          case 'l':
            onNavigate('logistics');
            break;
          case 'v':
            onNavigate('psi');
            break;
          case 'a':
            onNavigate('plan_vs_actual');
            break;
          case 't':
            onNavigate('master_data');
            break;
          case 'i':
            onNavigate('csv_importer');
            break;
          default:
            navigated = false;
        }

        if (navigated) {
          e.preventDefault();
          gPressedRef.current = false;
          if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [onNavigate, onCloseModals]);
}
