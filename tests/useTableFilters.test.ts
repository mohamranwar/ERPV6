/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useTableFilters } from '../src/hooks/useTableFilters';

interface Item {
  id: string;
  name: string;
  status: string;
}

const items: Item[] = [
  { id: '1', name: 'Alpha Widget', status: 'active' },
  { id: '2', name: 'Beta Widget', status: 'inactive' },
  { id: '3', name: 'Gamma Widget', status: 'active' },
];

describe('useTableFilters', () => {
  it('applies dropdown filters as AND conditions when there is no active search', () => {
    const { result } = renderHook(() =>
      useTableFilters(items, ['name'], { status: 'active' })
    );
    expect(result.current.filtered.map(i => i.id)).toEqual(['1', '3']);
    expect(result.current.hasActiveSearch).toBe(false);
  });

  it('ignores an empty-string dropdown value (treats it as "All")', () => {
    const { result } = renderHook(() =>
      useTableFilters(items, ['name'], { status: '' })
    );
    expect(result.current.filtered).toHaveLength(3);
  });

  it('applies a customFilter in addition to dropdown filters', () => {
    const { result } = renderHook(() =>
      useTableFilters(items, ['name'], {}, undefined, undefined, (i) => i.name !== 'Gamma Widget')
    );
    expect(result.current.filtered.map(i => i.id)).toEqual(['1', '2']);
  });

  it('bypasses dropdown filters once the debounced search query becomes active (the README "Override Principle")', async () => {
    const { result, rerender } = renderHook(
      ({ query }: { query: string }) =>
        useTableFilters(items, ['name'], { status: 'active' }, query, () => {}),
      { initialProps: { query: '' } }
    );

    expect(result.current.filtered.map(i => i.id)).toEqual(['1', '3']);

    rerender({ query: 'beta' });

    // "Beta Widget" has status 'inactive' - it would be excluded by the
    // active dropdown filter, but a live search query must override that.
    await waitFor(() => expect(result.current.hasActiveSearch).toBe(true), { timeout: 1000 });
    expect(result.current.filtered.map(i => i.id)).toEqual(['2']);
  });

  it('falls back to internal state when no externalQuery/setExternalQuery is supplied', () => {
    const { result } = renderHook(() => useTableFilters(items, ['name'], {}));
    act(() => {
      result.current.setSearchQuery('gamma');
    });
    expect(result.current.searchQuery).toBe('gamma');
  });

  it('treats null/undefined field values as non-matches instead of throwing', () => {
    const withNulls = [...items, { id: '4', name: undefined as any, status: 'active' }];
    const { result } = renderHook(() => useTableFilters(withNulls, ['name'], {}));
    expect(() => result.current.filtered).not.toThrow();
  });
});

describe('useTableFilters - search behaviour', () => {
  interface Material {
    id: string;
    name: string;
    sku: string;
    supplier: string;
  }
  const materials: Material[] = [
    { id: '1', name: 'GP Bleached Fluff Pulp', sku: 'RM-PLP-01', supplier: 'Saudi Pulp Co' },
    { id: '2', name: 'Spunbond Top Sheet 15gsm', sku: 'RM-NWT-18', supplier: 'Global Polymers Ltd' },
    { id: '3', name: 'Teemo Printed Polybag Large', sku: 'PK-PLB-28', supplier: 'Al-Aman Packaging' },
  ];

  const search = (query: string) =>
    renderHook(() =>
      useTableFilters<Material>(materials, ['name', 'sku', 'supplier'], {}, query, () => {})
    );

  it('matches terms that are not adjacent in the source string', async () => {
    // "bleached pulp" is not a substring of "GP Bleached Fluff Pulp" - a single
    // whole-query includes() test found nothing, which made multi-word search
    // look broken to anyone who typed naturally.
    const { result } = search('bleached pulp');
    await waitFor(() => expect(result.current.filtered).toHaveLength(1));
    expect(result.current.filtered[0].id).toBe('1');
  });

  it('matches terms spread across different fields', async () => {
    const { result } = search('pulp saudi');
    await waitFor(() => expect(result.current.filtered).toHaveLength(1));
    expect(result.current.filtered[0].supplier).toBe('Saudi Pulp Co');
  });

  it('requires every term, not just one', async () => {
    const { result } = search('bleached polybag');
    await waitFor(() => expect(result.current.hasActiveSearch).toBe(true));
    expect(result.current.filtered).toHaveLength(0);
  });

  it('ignores case and collapses extra whitespace', async () => {
    const { result } = search('   SPUNBOND    top   ');
    await waitFor(() => expect(result.current.filtered).toHaveLength(1));
    expect(result.current.filtered[0].id).toBe('2');
  });

  it('still matches a plain single-term query', async () => {
    const { result } = search('RM-NWT-18');
    await waitFor(() => expect(result.current.filtered).toHaveLength(1));
    expect(result.current.filtered[0].id).toBe('2');
  });

  it('filters immediately when mounted with a query already set', () => {
    // App restores a per-screen query on navigation. Seeding the debounced
    // copy from empty showed every row for 200ms before the filter caught up.
    const { result } = search('polybag');
    expect(result.current.hasActiveSearch).toBe(true);
    expect(result.current.filtered).toHaveLength(1);
    expect(result.current.filtered[0].id).toBe('3');
  });

  it('treats a whitespace-only query as no search at all', async () => {
    const { result } = search('    ');
    await waitFor(() => expect(result.current.hasActiveSearch).toBe(false));
    expect(result.current.filtered).toHaveLength(3);
  });
});
