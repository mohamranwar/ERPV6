/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, isSupabaseConnected } from '../supabaseClient';

/**
 * Planning thresholds, calendar and number formats.
 *
 * ── Why these are data and not constants ────────────────────────────────────
 * The attainment bands, coverage targets and capacity warning level were
 * previously literals scattered across screens. That meant a planner who
 * wanted "watch" to start at 98% instead of 95% had to file a ticket, and it
 * meant two screens could disagree about what "healthy" meant.
 *
 * ── The part that is easy to get wrong ──────────────────────────────────────
 * Changing a band silently repaints every badge in the app. Someone opens the
 * dashboard the next morning and sees red where there was amber, with no way
 * to find out why. So every write goes to `settings_audit`, and the Settings
 * screen shows an effect preview before saving.
 *
 * A closed month stores the bands that were in force at close, so editing a
 * threshold today never rewrites the colour of last year's history. That
 * happens in the month-close writer, not here.
 */

export interface Thresholds {
  /** Attainment at or above this is "on target". */
  attainment_ok: number;
  /** Attainment at or above this is "watch"; below is "short". */
  attainment_watch: number;
  rm_coverage_ok_months: number;
  fg_coverage_ok_months: number;
  capacity_warning_pct: number;
  po_on_time_target_pct: number;
}

export interface CalendarSettings {
  /** 1-12. Egypt's fiscal year commonly starts in July. */
  fiscal_year_start_month: number;
  /** 0 = Sunday. Egypt's working week starts Sunday. */
  week_starts_on: number;
  planning_horizon_months: number;
  history_retention_months: number;
}

export interface FormatSettings {
  thousands_separator: string;
  decimal_places: number;
  /** 1 | 1000 | 1000000 */
  large_number_scale: number;
  date_format: string;
  currency: string;
  default_quantity_unit: 'pcs' | 'ctn';
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  attainment_ok: 100,
  attainment_watch: 95,
  rm_coverage_ok_months: 3,
  fg_coverage_ok_months: 1.5,
  capacity_warning_pct: 95,
  po_on_time_target_pct: 95,
};

export const DEFAULT_CALENDAR: CalendarSettings = {
  fiscal_year_start_month: 7,
  week_starts_on: 0,
  planning_horizon_months: 12,
  history_retention_months: 36,
};

export const DEFAULT_FORMATS: FormatSettings = {
  thousands_separator: ',',
  decimal_places: 1,
  large_number_scale: 1_000_000,
  date_format: 'DD-MMM-YY',
  currency: 'EGP',
  default_quantity_unit: 'pcs',
};

export interface AppSettings {
  thresholds: Thresholds;
  calendar: CalendarSettings;
  formats: FormatSettings;
}

const LOCAL_KEY = 'sc_planner_app_settings';

const DEFAULTS: AppSettings = {
  thresholds: DEFAULT_THRESHOLDS,
  calendar: DEFAULT_CALENDAR,
  formats: DEFAULT_FORMATS,
};

function readLocal(): AppSettings {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    // Merge rather than replace. A settings blob written by an older build is
    // missing any key added since; spreading defaults first means a new
    // threshold arrives with its shipped value instead of undefined, which
    // would compare false against every number and mark everything "short".
    return {
      thresholds: { ...DEFAULT_THRESHOLDS, ...(parsed.thresholds ?? {}) },
      calendar: { ...DEFAULT_CALENDAR, ...(parsed.calendar ?? {}) },
      formats: { ...DEFAULT_FORMATS, ...(parsed.formats ?? {}) },
    };
  } catch {
    return DEFAULTS;
  }
}

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(readLocal);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!isSupabaseConnected() || !supabase) { setLoading(false); return; }

      const { data, error } = await supabase.from('app_settings').select('key, value');
      if (cancelled) return;

      if (error || !data) { setLoading(false); return; }

      const next = { ...DEFAULTS };
      for (const row of data as Array<{ key: string; value: unknown }>) {
        if (row.key === 'thresholds') next.thresholds = { ...DEFAULT_THRESHOLDS, ...(row.value as object) };
        if (row.key === 'calendar')   next.calendar   = { ...DEFAULT_CALENDAR,   ...(row.value as object) };
        if (row.key === 'formats')    next.formats    = { ...DEFAULT_FORMATS,    ...(row.value as object) };
      }

      setSettings(next);
      localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const save = useCallback(async (next: AppSettings, userId: string) => {
    const previous = settings;
    setSettings(next);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(next));

    if (!isSupabaseConnected() || !supabase) return;

    await supabase.from('app_settings').upsert(
      [
        { key: 'thresholds', value: next.thresholds, updated_by: userId, updated_at: new Date().toISOString() },
        { key: 'calendar',   value: next.calendar,   updated_by: userId, updated_at: new Date().toISOString() },
        { key: 'formats',    value: next.formats,    updated_by: userId, updated_at: new Date().toISOString() },
      ],
      { onConflict: 'key' },
    );

    // Audit one row per changed field, not one per settings group. "thresholds
    // changed" six weeks later tells you nothing; "attainment_watch 95 -> 98"
    // tells you exactly why the dashboard went amber.
    const rows: Array<Record<string, unknown>> = [];
    for (const group of ['thresholds', 'calendar', 'formats'] as const) {
      // Cast through unknown: these are closed interfaces without an index
      // signature, so TS rightly refuses the direct assertion.
      const before = previous[group] as unknown as Record<string, unknown>;
      const after = next[group] as unknown as Record<string, unknown>;
      for (const key of Object.keys(after)) {
        if (String(before[key]) !== String(after[key])) {
          rows.push({
            changed_by: userId,
            scope: 'app_settings',
            target_key: `${group}.${key}`,
            old_value: String(before[key] ?? ''),
            new_value: String(after[key] ?? ''),
          });
        }
      }
    }
    if (rows.length > 0) await supabase.from('settings_audit').insert(rows);
  }, [settings]);

  return useMemo(
    () => ({ settings, thresholds: settings.thresholds, loading, save }),
    [settings, loading, save],
  );
}

/** Band an attainment percentage. Null plan yields 'none'. */
export type AttainmentBand = 'ok' | 'watch' | 'short' | 'none';

export function bandAttainment(
  pct: number | null | undefined,
  t: Thresholds = DEFAULT_THRESHOLDS,
): AttainmentBand {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return 'none';
  if (pct >= t.attainment_ok) return 'ok';
  if (pct >= t.attainment_watch) return 'watch';
  return 'short';
}

/**
 * Format a quantity for display.
 *
 * Scale is applied before the separator so 74,200,000 at millions renders as
 * "74.2M" rather than "74,200,000M".
 */
export function formatQty(value: number, f: FormatSettings = DEFAULT_FORMATS): string {
  if (!Number.isFinite(value)) return '—';
  const scaled = value / (f.large_number_scale || 1);
  const [intPart, decPart] = scaled.toFixed(f.decimal_places).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, f.thousands_separator);
  const suffix = f.large_number_scale === 1_000_000 ? 'M'
    : f.large_number_scale === 1_000 ? 'K' : '';
  return `${grouped}${decPart ? '.' + decPart : ''}${suffix}`;
}
