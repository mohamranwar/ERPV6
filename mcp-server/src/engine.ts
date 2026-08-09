/**
 * Engine bootstrap.
 *
 * This server deliberately does NOT reimplement any planning maths. It imports
 * the application's own calculation engine (../../src/supabaseClient.ts) so
 * that coverage, BOM cost, safety stock and MRP figures reported here are the
 * same numbers the planners see on screen. Reimplementing them would guarantee
 * drift the first time either side changed.
 *
 * Two things have to happen before that module is imported:
 *
 *   1. A `localStorage` shim must exist on globalThis. The engine reads
 *      localStorage at module-evaluation time (it seeds the offline dataset and
 *      resolves Supabase credentials), and Node has no localStorage.
 *
 *   2. Supabase credentials must already be in that shim. The engine creates
 *      its client once, at module scope:
 *          export const supabase = creds.url && creds.key ? createClient(...) : null
 *      so credentials written after the import would be ignored and the server
 *      would silently run on seed data while appearing connected.
 *
 * Both are why the engine is pulled in with a dynamic `await import()` at the
 * bottom of this file rather than a static top-level import.
 */

const memoryStore: Record<string, string> = Object.create(null);

/**
 * Proxy-backed Storage shim. A plain object is not enough: the engine's
 * migration code enumerates keys, so `Object.keys(localStorage)` and
 * `for (const k in localStorage)` have to work.
 */
const storageShim = new Proxy(Object.create(null), {
  has(_t, key) {
    return typeof key === 'string' && key in memoryStore;
  },
  get(_t, prop) {
    switch (prop) {
      case 'getItem':
        return (k: string): string | null =>
          Object.prototype.hasOwnProperty.call(memoryStore, k) ? memoryStore[k]! : null;
      case 'setItem':
        return (k: string, v: string): void => {
          memoryStore[k] = String(v);
        };
      case 'removeItem':
        return (k: string): void => {
          delete memoryStore[k];
        };
      case 'clear':
        return (): void => {
          for (const k of Object.keys(memoryStore)) delete memoryStore[k];
        };
      case 'key':
        return (i: number): string | null => Object.keys(memoryStore)[i] ?? null;
      case 'length':
        return Object.keys(memoryStore).length;
      default:
        return undefined;
    }
  },
  ownKeys() {
    return Object.keys(memoryStore);
  },
  getOwnPropertyDescriptor(_t, prop) {
    if (typeof prop === 'string' && prop in memoryStore) {
      return { configurable: true, enumerable: true, value: memoryStore[prop], writable: true };
    }
    return undefined;
  },
}) as unknown as Storage;

(globalThis as unknown as { localStorage: Storage }).localStorage = storageShim;

// Keys the engine uses to locate Supabase credentials.
const STORAGE_URL_KEY = 'sc_planner_supabase_url';
const STORAGE_KEY_KEY = 'sc_planner_supabase_anon_key';

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseKey = process.env.SUPABASE_ANON_KEY?.trim();

/** True when the server is talking to a real database rather than seed data. */
export const isLiveDatabase = Boolean(supabaseUrl && supabaseKey);

if (isLiveDatabase) {
  storageShim.setItem(STORAGE_URL_KEY, supabaseUrl!);
  storageShim.setItem(STORAGE_KEY_KEY, supabaseKey!);
}

/**
 * Where the data is coming from, surfaced in tool output so a planner is never
 * misled into thinking demo numbers are live ones.
 */
export const dataSource: 'supabase' | 'seed' = isLiveDatabase ? 'supabase' : 'seed';

export const dataSourceNote = isLiveDatabase
  ? 'Live Supabase database.'
  : 'Offline seed dataset (demo data). Set SUPABASE_URL and SUPABASE_ANON_KEY to use the live database.';

// Imported dynamically so the shim above is installed first — see file header.
export const engine = await import('../../src/supabaseClient');
export type Engine = typeof engine;
