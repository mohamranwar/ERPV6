import { useState, useEffect, useTransition } from 'react';

export function useTableFilters<T>(
  items: T[],
  searchFields: (keyof T)[],
  dropdowns: Record<string, string>,
  externalQuery?: string,
  setExternalQuery?: (val: string) => void,
  customFilter?: (item: T) => boolean
) {
  const [internalQuery, setInternalQuery] = useState('');
  const searchQuery = externalQuery !== undefined ? externalQuery : internalQuery;
  const setSearchQuery = setExternalQuery !== undefined ? setExternalQuery : setInternalQuery;

  // Seeded from the live query rather than from empty. App keeps a search box
  // per screen, so navigating back to one restores its query - starting the
  // debounced copy blank showed a flash of unfiltered rows before catching up.
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
  const [, startTransition] = useTransition();

  // Debounce logic (200ms)
  useEffect(() => {
    const handler = setTimeout(() => {
      startTransition(() => {
        setDebouncedQuery(searchQuery);
      });
    }, 200);

    return () => {
      clearTimeout(handler);
    };
  }, [searchQuery]);

  const activeQuery = debouncedQuery.trim();
  const hasActiveSearch = activeQuery.length > 0;
  const searchTerms = activeQuery.toLowerCase().split(/\s+/).filter(Boolean);

  const filtered = items.filter((item) => {
    if (customFilter) {
      if (!customFilter(item)) {
        return false;
      }
    }

    if (hasActiveSearch) {
      // Ignore dropdown filters if search query is active.
      //
      // Terms are matched independently: a single substring test against the
      // whole query meant "bleached pulp" failed to find "GP Bleached Fluff
      // Pulp", because the words are not adjacent in the source string. Every
      // term must appear somewhere in the row, though not in the same field,
      // so "pulp saudi" can match a name in one column and a supplier in
      // another.
      const haystack = searchFields
        .map((field) => item[field])
        .filter((val) => val !== null && val !== undefined)
        .map((val) => String(val).toLowerCase())
        .join(' ');
      return searchTerms.every((term) => haystack.includes(term));
    }

    // Apply active dropdown filters as AND filters
    return Object.entries(dropdowns).every(([key, value]) => {
      if (!value) return true; // All option or unselected
      const val = item[key as keyof T];
      if (val === null || val === undefined) return false;
      return String(val) === String(value);
    });
  });

  return {
    filtered,
    searchQuery,
    setSearchQuery,
    activeQuery,
    hasActiveSearch,
  };
}
