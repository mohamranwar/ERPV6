/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import '@testing-library/jest-dom/vitest';

// jsdom provides a localStorage on the `window` object, but supabaseClient.ts
// reads `localStorage` at module-load time (outside the window), so we need
// to make sure a usable localStorage is on the global before that module
// gets imported. A Proxy-backed shim is enough — the seed data lives in
// module-scope constants and only writes back to localStorage on save.
// We back the shim with a Proxy so `Object.keys(localStorage)` and
// `for (const k in localStorage)` enumerate the stored keys (tests rely
// on this to snapshot/restore the seeded database between cases).
const memoryStore: Record<string, string> = Object.create(null);
const shim = new Proxy(Object.create(null), {
  has(_target, key) {
    if (typeof key === 'string') return key in memoryStore;
    return false;
  },
  get(_target, prop) {
    if (prop === 'getItem') return (k: string) =>
      Object.prototype.hasOwnProperty.call(memoryStore, k) ? memoryStore[k] : null;
    if (prop === 'setItem') return (k: string, v: string) => {
      memoryStore[k] = String(v);
    };
    if (prop === 'removeItem') return (k: string) => {
      delete memoryStore[k];
    };
    if (prop === 'clear') return () => {
      for (const k of Object.keys(memoryStore)) delete memoryStore[k];
    };
    if (prop === 'key') return (i: number) => Object.keys(memoryStore)[i] ?? null;
    if (prop === 'length') return Object.keys(memoryStore).length;
    return undefined;
  },
  ownKeys() {
    return Object.keys(memoryStore);
  },
  getOwnPropertyDescriptor(_target, prop) {
    if (typeof prop === 'string' && prop in memoryStore) {
      return { configurable: true, enumerable: true, value: memoryStore[prop], writable: true };
    }
    return undefined;
  },
}) as unknown as Storage;
(globalThis as any).localStorage = shim;
if (typeof window !== 'undefined') {
  (window as any).localStorage = shim;
}

// supabaseClient.ts seeds the offline mock DB into localStorage once, the
// first time it is imported ("if (!localStorage.getItem(key))"). Vitest
// gives each test *file* its own fresh module registry and jsdom window by
// default, so the seed runs exactly once per file and every test in that
// file shares the same deterministic starting dataset. Do NOT call
// localStorage.clear() globally here - that would wipe the seed before the
// first test in a file re-triggers it (it only auto-seeds when a key is
// missing). Tests that need a clean slate should scope that to themselves.

// ResizeObserver isn't implemented in jsdom, but ScrollableTable.tsx uses it
// to detect table overflow. Stub it out so components using it don't throw.
if (typeof (globalThis as any).ResizeObserver === 'undefined') {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
