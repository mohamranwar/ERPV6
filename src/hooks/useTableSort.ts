import { useState, useMemo } from 'react';

export type SortDirection = 'asc' | 'desc' | null;

export interface SortConfig {
  key: string | null;
  direction: SortDirection;
}

export function useTableSort<T>(
  items: T[],
  defaultKey: string | null = null,
  defaultDirection: SortDirection = 'asc'
) {
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: defaultKey,
    direction: defaultDirection,
  });

  const handleSort = (key: string) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        if (prev.direction === 'asc') {
          return { key, direction: 'desc' };
        } else if (prev.direction === 'desc') {
          return { key: null, direction: null };
        } else {
          return { key, direction: 'asc' };
        }
      }
      return { key, direction: 'asc' };
    });
  };

  const sortedItems = useMemo(() => {
    if (!sortConfig.key || !sortConfig.direction) return items;

    const key = sortConfig.key;
    const direction = sortConfig.direction === 'asc' ? 1 : -1;

    return [...items].sort((a, b) => {
      // Support nested paths like 'item.name' if needed
      let valA: any;
      let valB: any;

      if (key.includes('.')) {
        valA = key.split('.').reduce((obj, k) => (obj ? (obj as any)[k] : undefined), a);
        valB = key.split('.').reduce((obj, k) => (obj ? (obj as any)[k] : undefined), b);
      } else {
        valA = (a as any)[key];
        valB = (b as any)[key];
      }

      if (valA === undefined || valA === null) valA = '';
      if (valB === undefined || valB === null) valB = '';

      if (typeof valA === 'number' && typeof valB === 'number') {
        return (valA - valB) * direction;
      }

      const strA = String(valA).toLowerCase();
      const strB = String(valB).toLowerCase();

      return strA.localeCompare(strB, undefined, { numeric: true, sensitivity: 'base' }) * direction;
    });
  }, [items, sortConfig]);

  return {
    sortedItems,
    sortConfig,
    handleSort,
    setSortConfig,
  };
}
