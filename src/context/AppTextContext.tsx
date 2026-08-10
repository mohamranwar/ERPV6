/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { supabase, isSupabaseConnected } from '../supabaseClient';

/**
 * Editable app text.
 *
 * ── The contract ────────────────────────────────────────────────────────────
 * Components ask for a KEY and get back a STRING. The key is compiled in and
 * never changes; the string is data and can be edited from Settings by anyone
 * with planner rights.
 *
 *   const t = useText();
 *   <h1>{t('page.dashboard.title')}</h1>
 *
 * This separation is the entire point. Renaming "MPS Production" to
 * "Production Plan" must not touch a ScreenID, a database column, an export
 * header, or a test selector. Those all keep their original names.
 *
 * ── Fallback order ──────────────────────────────────────────────────────────
 *   1. Edited value from the database (or localStorage when offline)
 *   2. The shipped default compiled in below
 *   3. The key itself
 *
 * Step 3 matters: a missing key renders as `page.foo.title` rather than an
 * empty string, so a typo is visible on screen in development instead of
 * silently blanking a heading in production.
 */

export type TextKey = string;

/**
 * Shipped wording. Kept in sync with the seed block in
 * migrations/001_app_text_and_snapshots.sql.
 *
 * Duplicating it here is deliberate: the app must render correct labels before
 * the first network round-trip, and must keep rendering them if the request
 * fails. A control tower that shows blank menu items when the database is slow
 * is worse than one that shows slightly stale wording.
 */
export const DEFAULT_TEXT: Record<TextKey, string> = {
  'app.name': 'Sanita Supply Chain Planner',
  'app.tagline': 'Planning & logistics control tower',
  'app.header.period': 'Rolling 12 months',
  'app.footer.left': 'Sanita Egypt · Planning Department',
  'app.footer.center': 'Data refreshed every 15 minutes',
  'app.footer.right': 'Support: planning@sanita.example',
  'app.footer.version': 'v2.4',

  'nav.group.planning': 'Planning Desk',
  'nav.group.supply': 'Supply & Logistics',
  'nav.group.controls': 'Controls',

  'nav.dashboard': 'Dashboard',
  'nav.bom': 'BOM',
  'nav.sales_plan': 'Sales Demand',
  'nav.export_forecast': 'Export Order',
  'nav.production_plan': 'MPS Production',
  'nav.mrp': 'MRP Engine',
  'nav.coverage': 'Stock Coverage',
  'nav.logistics': 'Purchase Orders (PO)',
  'nav.customs_clearance': 'Customs Clearance',
  'nav.plan_vs_actual': 'Plan vs Actuals',
  'nav.master_data': 'Master Data',
  'nav.csv_importer': 'Import Hub',
  'nav.settings': 'Settings',
  'nav.month_close': 'Month Close',

  'page.dashboard.title': 'Supply chain dashboard',
  'page.dashboard.sub': 'Live position across demand, supply and logistics',
  'page.mrp.title': 'Material Requirements Planning',
  'page.coverage.title': 'Stock Coverage',
  'page.logistics.title': 'Purchase Order Follow-up',
  'page.close.title': 'Month Close',
  'page.close.sub': 'Freeze a period so history stops moving',

  'col.sku': 'SKU',
  'col.material': 'Material',
  'col.supplier': 'Supplier',
  'col.onhand': 'On hand',
  'col.intransit': 'In transit',
  'col.coverage': 'Coverage',
  'col.plan': 'Plan',
  'col.actual': 'Actual',
  'col.variance': 'Variance',
  'col.attainment': 'Attainment',
  'col.required_date': 'Required date',

  'btn.save': 'Save changes',
  'btn.discard': 'Discard',
  'btn.export': 'Export',
  'btn.import': 'Import data',
  'btn.run_mrp': 'Run MRP',
  'btn.close_month': 'Close month',
  'btn.reopen': 'Reopen',

  'status.ok': 'On target',
  'status.watch': 'Watch',
  'status.risk': 'Short',
  'status.oos': 'Stockout risk',
  'status.transit': 'In transit',
  'status.pending': 'Pending',
  'status.cleared': 'Cleared',
  'status.delayed': 'Delayed',

  'empty.no_data': 'Nothing to show yet',
  'empty.no_data.sub': 'Import a plan or adjust your filters to see rows here.',
  'empty.no_results': 'No matches',
  'msg.saved': 'Changes saved',
  'msg.readonly': 'This view is read-only while All Channels is selected',
  'msg.close_warn': 'Closing writes a permanent snapshot. An admin can reopen it.',
};

export interface AppTextRow {
  key: string;
  group_name: string;
  description: string;
  value_en: string;
  value_ar: string | null;
  default_en: string;
  sort_order: number;
}

interface AppTextValue {
  /** Resolve a key to its current wording. */
  t: (key: TextKey) => string;
  /** Full rows, for the Settings editor. Empty until loaded. */
  rows: AppTextRow[];
  /** Overrides currently in force, keyed by text key. */
  overrides: Record<string, string>;
  loading: boolean;
  /** Persist edits. Only changed keys are written. */
  save: (next: Record<string, string>, userId: string) => Promise<void>;
  /** Clear every override and fall back to shipped wording. */
  resetAll: (userId: string) => Promise<void>;
  language: 'en' | 'ar';
  setLanguage: (lang: 'en' | 'ar') => void;
}

const LOCAL_KEY = 'sc_planner_app_text';
const LOCAL_LANG_KEY = 'sc_planner_language';

const AppTextContext = createContext<AppTextValue | null>(null);

function readLocalOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    // A corrupt cache should degrade to shipped wording, not crash the shell.
    return {};
  }
}

export function AppTextProvider({ children }: { children: React.ReactNode }) {
  const [overrides, setOverrides] = useState<Record<string, string>>(readLocalOverrides);
  const [rows, setRows] = useState<AppTextRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [language, setLanguageState] = useState<'en' | 'ar'>(
    () => (localStorage.getItem(LOCAL_LANG_KEY) as 'en' | 'ar') || 'en',
  );

  // Load from the database when connected. The local cache has already
  // rendered by this point, so this is a refresh rather than a blocking fetch.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!isSupabaseConnected() || !supabase) {
        setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from('app_text')
        .select('*')
        .order('group_name')
        .order('sort_order');

      if (cancelled) return;

      if (error || !data) {
        // Offline or permission-denied: keep the cached overrides. Surfacing
        // an error here would block the whole shell over a cosmetic concern.
        setLoading(false);
        return;
      }

      const next: Record<string, string> = {};
      for (const row of data as AppTextRow[]) {
        const value = language === 'ar' && row.value_ar ? row.value_ar : row.value_en;
        if (value !== row.default_en || language === 'ar') next[row.key] = value;
      }

      setRows(data as AppTextRow[]);
      setOverrides(next);
      localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [language]);

  // RTL is a document-level concern, not a component one. Setting `dir` here
  // means every grid, drawer and dropdown flips together instead of each
  // component needing its own conditional.
  useEffect(() => {
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [language]);

  const t = useCallback(
    (key: TextKey) => overrides[key] ?? DEFAULT_TEXT[key] ?? key,
    [overrides],
  );

  const setLanguage = useCallback((lang: 'en' | 'ar') => {
    localStorage.setItem(LOCAL_LANG_KEY, lang);
    setLanguageState(lang);
  }, []);

  const save = useCallback(async (next: Record<string, string>, userId: string) => {
    // Write only what actually changed. Upserting all ~70 rows on every save
    // makes the audit log unreadable and masks the one edit that mattered.
    const changed = Object.entries(next).filter(
      ([key, value]) => value !== (overrides[key] ?? DEFAULT_TEXT[key] ?? key),
    );

    setOverrides(next);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(next));

    if (!isSupabaseConnected() || !supabase || changed.length === 0) return;

    const column = language === 'ar' ? 'value_ar' : 'value_en';

    await supabase.from('app_text').upsert(
      changed.map(([key, value]) => ({
        key,
        [column]: value,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      })),
      { onConflict: 'key' },
    );

    await supabase.from('settings_audit').insert(
      changed.map(([key, value]) => ({
        changed_by: userId,
        scope: 'app_text',
        target_key: key,
        old_value: overrides[key] ?? DEFAULT_TEXT[key] ?? null,
        new_value: value,
      })),
    );
  }, [overrides, language]);

  const resetAll = useCallback(async (userId: string) => {
    const previous = overrides;
    setOverrides({});
    localStorage.removeItem(LOCAL_KEY);

    if (!isSupabaseConnected() || !supabase) return;

    const keys = Object.keys(previous);
    if (keys.length === 0) return;

    // Reset restores default_en rather than deleting rows: the row carries the
    // group, description and sort order the Settings editor needs to render.
    await Promise.all(
      keys.map(key =>
        supabase!.from('app_text')
          .update({ value_en: DEFAULT_TEXT[key], updated_by: userId })
          .eq('key', key),
      ),
    );

    await supabase.from('settings_audit').insert(
      keys.map(key => ({
        changed_by: userId,
        scope: 'app_text',
        target_key: key,
        old_value: previous[key],
        new_value: DEFAULT_TEXT[key] ?? null,
      })),
    );
  }, [overrides]);

  const value = useMemo<AppTextValue>(
    () => ({ t, rows, overrides, loading, save, resetAll, language, setLanguage }),
    [t, rows, overrides, loading, save, resetAll, language, setLanguage],
  );

  return <AppTextContext.Provider value={value}>{children}</AppTextContext.Provider>;
}

/**
 * Text resolver.
 *
 * Returns the shipped defaults when used outside the provider rather than
 * throwing. A label is not worth crashing a screen over, and it keeps unit
 * tests from needing the provider just to render a button.
 */
export function useText(): (key: TextKey) => string {
  const ctx = useContext(AppTextContext);
  if (!ctx) return (key: TextKey) => DEFAULT_TEXT[key] ?? key;
  return ctx.t;
}

/** Full context, for the Settings editor. Throws — that one does need it. */
export function useAppText(): AppTextValue {
  const ctx = useContext(AppTextContext);
  if (!ctx) throw new Error('useAppText must be used inside <AppTextProvider>');
  return ctx;
}
