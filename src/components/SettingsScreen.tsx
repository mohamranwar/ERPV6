/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Check, Globe, Languages, RotateCcw, Save, Search, Settings as Cog,
} from 'lucide-react';
import { Card, StatusBadge } from './ui';
import ContentHeader from './ContentHeader';
import { useAppText, DEFAULT_TEXT } from '../context/AppTextContext';
import {
  useAppSettings, bandAttainment, formatQty,
  type AppSettings, type AttainmentBand,
} from '../hooks/useAppSettings';
import { useAuth } from '../context/AuthContext';

/**
 * Settings.
 *
 * Five sections, but only two carry real risk:
 *
 *   App text  — cosmetic. Changing a label cannot break anything downstream,
 *               because keys, ScreenIDs and column names are untouched.
 *   Thresholds — dangerous. Two keystrokes silently repaint every badge in the
 *               app. This is why the threshold section carries an effect
 *               preview and why every write is audited.
 */

type Section = 'text' | 'thresholds' | 'calendar' | 'formats' | 'audit';

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'text', label: 'App text' },
  { id: 'thresholds', label: 'Planning thresholds' },
  { id: 'calendar', label: 'Period & calendar' },
  { id: 'formats', label: 'Numbers & units' },
  { id: 'audit', label: 'Change log' },
];

const GROUP_LABELS: Record<string, string> = {
  header_footer: 'Header & footer',
  nav_groups: 'Side menu — groups',
  nav_items: 'Side menu — items',
  page_titles: 'Page titles & subtitles',
  columns: 'Table headings',
  buttons: 'Buttons & actions',
  statuses: 'Status labels',
  messages: 'Empty states & messages',
};

const BAND_INTENT: Record<AttainmentBand, 'success' | 'warning' | 'danger' | 'neutral'> = {
  ok: 'success', watch: 'warning', short: 'danger', none: 'neutral',
};

const BAND_LABEL: Record<AttainmentBand, string> = {
  ok: 'On target', watch: 'Watch', short: 'Short', none: '—',
};

const inputCls =
  'h-8 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs ' +
  'text-slate-900 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500';

const labelCls = 'text-[11px] font-bold text-slate-600';

/** Sample rows for the threshold preview. Replace with live category data. */
export interface PreviewRow { label: string; attainment: number }

export interface SettingsScreenProps {
  /**
   * Rows shown in the threshold effect preview. Pass the current month's
   * category attainment so a planner sees the real consequence of a change,
   * not a synthetic example.
   */
  previewRows?: PreviewRow[];
}

export default function SettingsScreen({ previewRows = [] }: SettingsScreenProps) {
  const { rows, overrides, save: saveText, resetAll } = useAppText();
  const { settings, save: saveSettings } = useAppSettings();
  const { user } = useAuth();

  const [section, setSection] = useState<Section>('text');
  const [query, setQuery] = useState('');
  const [draftText, setDraftText] = useState<Record<string, string>>({});
  const [draftSettings, setDraftSettings] = useState<AppSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Keep the draft in step when the loaded settings arrive.
  useEffect(() => { setDraftSettings(settings); }, [settings]);

  const userId = user?.id ?? 'unknown';

  /** Current value of a text key: draft first, then saved override, then default. */
  const valueOf = (key: string): string =>
    draftText[key] ?? overrides[key] ?? DEFAULT_TEXT[key] ?? key;

  const defaultOf = (key: string): string => {
    const row = rows.find(r => r.key === key);
    return row?.default_en ?? DEFAULT_TEXT[key] ?? key;
  };

  /**
   * Rows to render. Falls back to DEFAULT_TEXT when the database has not
   * loaded, so the editor is usable offline rather than showing an empty list.
   */
  const editorRows = useMemo(() => {
    const source = rows.length > 0
      ? rows.map(r => ({ key: r.key, group: r.group_name, description: r.description }))
      : Object.keys(DEFAULT_TEXT).map(key => ({
          key,
          group: key.split('.')[0] === 'nav' ? 'nav_items' : 'messages',
          description: key,
        }));

    const q = query.trim().toLowerCase();
    const filtered = q
      ? source.filter(r =>
          r.description.toLowerCase().includes(q) ||
          r.key.toLowerCase().includes(q) ||
          valueOf(r.key).toLowerCase().includes(q))
      : source;

    const grouped = new Map<string, typeof filtered>();
    for (const r of filtered) {
      const list = grouped.get(r.group) ?? [];
      list.push(r);
      grouped.set(r.group, list);
    }
    return grouped;
  }, [rows, query, draftText, overrides]);

  const editedCount = Object.keys(draftText).filter(
    k => draftText[k] !== (overrides[k] ?? DEFAULT_TEXT[k] ?? k),
  ).length;

  const settingsDirty = JSON.stringify(draftSettings) !== JSON.stringify(settings);
  const dirty = editedCount > 0 || settingsDirty;

  async function handleSave() {
    setSaving(true);
    try {
      if (editedCount > 0) {
        const merged = { ...overrides, ...draftText };
        await saveText(merged, userId);
        setDraftText({});
      }
      if (settingsDirty) await saveSettings(draftSettings, userId);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard() {
    setDraftText({});
    setDraftSettings(settings);
  }

  const t = draftSettings.thresholds;
  const setThreshold = (key: keyof typeof t, value: number) =>
    setDraftSettings(s => ({ ...s, thresholds: { ...s.thresholds, [key]: value } }));

  return (
    <div>
      <ContentHeader
        title="Settings"
        subtitle="Changes apply to everyone. Every edit is recorded in the change log."
        actions={
          <div className="flex items-center gap-2">
            {dirty && (
              <span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full">
                Unsaved changes
              </span>
            )}
            <button
              onClick={handleDiscard}
              disabled={!dirty}
              className="h-8 px-3 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Discard
            </button>
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="h-8 px-3 rounded-lg bg-brand-600 text-white text-xs font-bold hover:bg-brand-700 disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              {saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
              {saved ? 'Saved' : 'Save changes'}
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[190px_1fr] gap-5">
        <nav className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible" aria-label="Settings sections">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              aria-current={section === s.id}
              className={`text-start px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition ${
                section === s.id
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="space-y-4 min-w-0">

          {/* ── APP TEXT ─────────────────────────────────────────────── */}
          {section === 'text' && (
            <>
              <Card
                title="App text"
                actions={
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-slate-500">
                      {editedCount > 0 ? `${editedCount} edited` : 'No edits'}
                    </span>
                    <button
                      onClick={() => resetAll(userId)}
                      className="h-7 px-2.5 rounded-lg border border-slate-300 bg-white text-[11px] font-bold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" /> Reset all
                    </button>
                  </div>
                }
              >
                <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                  Every visible string in the app. Renaming changes only what people read —
                  screen IDs, database columns and export headers keep their original names,
                  so nothing downstream breaks.
                </p>

                <div className="relative mb-4">
                  <Search className="w-3.5 h-3.5 absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search text…"
                    aria-label="Search app text"
                    className={`${inputCls} ps-8`}
                  />
                </div>

                <div className="space-y-2">
                  {[...editorRows.entries()].map(([group, items]) => (
                    <details key={group} open={!!query || group === 'nav_items'} className="rounded-xl border border-slate-200 overflow-hidden">
                      <summary className="px-3 py-2 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-600 cursor-pointer hover:bg-slate-100 flex items-center justify-between">
                        <span>{GROUP_LABELS[group] ?? group}</span>
                        <span className="font-mono text-slate-400">{items.length}</span>
                      </summary>
                      <div className="p-3 space-y-2">
                        {items.map(item => {
                          const edited = valueOf(item.key) !== defaultOf(item.key);
                          return (
                            <div key={item.key} className="grid grid-cols-1 sm:grid-cols-[1fr_1.15fr] gap-2 items-center">
                              <label htmlFor={`t_${item.key}`} className="text-[11px] text-slate-500 leading-tight">
                                {item.description}
                                <span className="block font-mono text-[9px] text-slate-300">{item.key}</span>
                              </label>
                              <input
                                id={`t_${item.key}`}
                                type="text"
                                value={valueOf(item.key)}
                                onChange={e => setDraftText(d => ({ ...d, [item.key]: e.target.value }))}
                                className={`${inputCls} ${edited ? 'border-brand-400 bg-brand-50' : ''}`}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  ))}
                  {editorRows.size === 0 && (
                    <p className="text-xs text-slate-400 py-6 text-center">No text matches that search.</p>
                  )}
                </div>
              </Card>

              <Card title={<span className="inline-flex items-center gap-1.5"><Languages className="w-3.5 h-3.5" /> Language</span>}>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Arabic switches the interface to right-to-left. Numbers, dates and SKUs stay
                  left-to-right so tabular columns still align. Each label above can hold an
                  Arabic value alongside the English one — one text store, two columns, rather
                  than a translation layer bolted on later.
                </p>
              </Card>
            </>
          )}

          {/* ── THRESHOLDS ───────────────────────────────────────────── */}
          {section === 'thresholds' && (
            <>
              <div className="flex gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-amber-800">These numbers move every status badge in the app</p>
                  <p className="text-[11px] text-amber-700 leading-relaxed mt-0.5">
                    Raising the attainment floor from 95% to 98% can reclassify dozens of rows
                    overnight. The preview below shows exactly which ones flip before you save.
                  </p>
                </div>
              </div>

              <Card title="Attainment bands">
                <p className="text-xs text-slate-500 mb-3">Actual ÷ plan. Colours every bar, KPI and ribbon.</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="th_ok" className={labelCls}>On target at or above</label>
                    <input id="th_ok" type="number" className={`${inputCls} mt-1`} value={t.attainment_ok}
                      onChange={e => setThreshold('attainment_ok', Number(e.target.value))} />
                    <p className="text-[10px] text-slate-400 mt-1">Green</p>
                  </div>
                  <div>
                    <label htmlFor="th_watch" className={labelCls}>Watch at or above</label>
                    <input id="th_watch" type="number" className={`${inputCls} mt-1`} value={t.attainment_watch}
                      onChange={e => setThreshold('attainment_watch', Number(e.target.value))} />
                    <p className="text-[10px] text-slate-400 mt-1">Amber</p>
                  </div>
                  <div>
                    <label htmlFor="th_cap" className={labelCls}>Capacity warning</label>
                    <input id="th_cap" type="number" className={`${inputCls} mt-1`} value={t.capacity_warning_pct}
                      onChange={e => setThreshold('capacity_warning_pct', Number(e.target.value))} />
                    <p className="text-[10px] text-slate-400 mt-1">% of line capacity</p>
                  </div>
                </div>
              </Card>

              <Card title="Coverage targets">
                <p className="text-xs text-slate-500 mb-3">
                  Raw material coverage is value-based: inventory value ÷ monthly consumption value.
                  Finished goods coverage is stock ÷ monthly sales.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="th_rm" className={labelCls}>RM healthy at or above</label>
                    <input id="th_rm" type="number" step="0.1" className={`${inputCls} mt-1`} value={t.rm_coverage_ok_months}
                      onChange={e => setThreshold('rm_coverage_ok_months', Number(e.target.value))} />
                    <p className="text-[10px] text-slate-400 mt-1">Months</p>
                  </div>
                  <div>
                    <label htmlFor="th_fg" className={labelCls}>FG healthy at or above</label>
                    <input id="th_fg" type="number" step="0.1" className={`${inputCls} mt-1`} value={t.fg_coverage_ok_months}
                      onChange={e => setThreshold('fg_coverage_ok_months', Number(e.target.value))} />
                    <p className="text-[10px] text-slate-400 mt-1">Months</p>
                  </div>
                  <div>
                    <label htmlFor="th_po" className={labelCls}>PO on-time target</label>
                    <input id="th_po" type="number" className={`${inputCls} mt-1`} value={t.po_on_time_target_pct}
                      onChange={e => setThreshold('po_on_time_target_pct', Number(e.target.value))} />
                    <p className="text-[10px] text-slate-400 mt-1">%</p>
                  </div>

                  <div>
                    <label htmlFor="th_var_ok" className={labelCls}>RM variance — on plan</label>
                    <input id="th_var_ok" type="number" step="0.5" className={`${inputCls} mt-1`} value={t.variance_on_plan_pct}
                      onChange={e => setThreshold('variance_on_plan_pct', Number(e.target.value))} />
                    <p className="text-[10px] text-slate-400 mt-1">% — ordered within this of baseline = on plan</p>
                  </div>

                  <div>
                    <label htmlFor="th_var_watch" className={labelCls}>RM variance — watch</label>
                    <input id="th_var_watch" type="number" step="0.5" className={`${inputCls} mt-1`} value={t.variance_watch_pct}
                      onChange={e => setThreshold('variance_watch_pct', Number(e.target.value))} />
                    <p className="text-[10px] text-slate-400 mt-1">% — beyond this = off plan</p>
                  </div>
                </div>
              </Card>

              <Card title="Effect preview">
                {previewRows.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4">
                    No current-period data to preview against.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50">
                          <th className="text-start px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Item</th>
                          <th className="text-end px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Attainment</th>
                          <th className="text-start px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Now</th>
                          <th className="text-start px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">After save</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map(row => {
                          const now = bandAttainment(row.attainment, settings.thresholds);
                          const next = bandAttainment(row.attainment, t);
                          const changed = now !== next;
                          return (
                            <tr key={row.label} className="border-t border-slate-100">
                              <td className="px-3 py-2 font-semibold text-slate-700">{row.label}</td>
                              <td className="px-3 py-2 text-end font-mono font-bold">{row.attainment.toFixed(1)}%</td>
                              <td className="px-3 py-2"><StatusBadge intent={BAND_INTENT[now]}>{BAND_LABEL[now]}</StatusBadge></td>
                              <td className="px-3 py-2">
                                {changed ? (
                                  <span className="inline-flex items-center gap-1.5">
                                    <StatusBadge intent={BAND_INTENT[next]}>{BAND_LABEL[next]}</StatusBadge>
                                    <span className="text-[10px] font-bold text-amber-700">changed</span>
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-slate-400">no change</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </>
          )}

          {/* ── CALENDAR ─────────────────────────────────────────────── */}
          {section === 'calendar' && (
            <Card title={<span className="inline-flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> Planning calendar</span>}>
              <p className="text-xs text-slate-500 mb-3">Drives every period bucket in sales, MPS and MRP.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="cal_fy" className={labelCls}>Fiscal year starts</label>
                  <select id="cal_fy" className={`${inputCls} mt-1`} value={draftSettings.calendar.fiscal_year_start_month}
                    onChange={e => setDraftSettings(s => ({ ...s, calendar: { ...s.calendar, fiscal_year_start_month: Number(e.target.value) } }))}>
                    {['January','February','March','April','May','June','July','August','September','October','November','December']
                      .map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="cal_wk" className={labelCls}>Week starts on</label>
                  <select id="cal_wk" className={`${inputCls} mt-1`} value={draftSettings.calendar.week_starts_on}
                    onChange={e => setDraftSettings(s => ({ ...s, calendar: { ...s.calendar, week_starts_on: Number(e.target.value) } }))}>
                    <option value={0}>Sunday</option>
                    <option value={1}>Monday</option>
                    <option value={6}>Saturday</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="cal_hz" className={labelCls}>Planning horizon</label>
                  <select id="cal_hz" className={`${inputCls} mt-1`} value={draftSettings.calendar.planning_horizon_months}
                    onChange={e => setDraftSettings(s => ({ ...s, calendar: { ...s.calendar, planning_horizon_months: Number(e.target.value) } }))}>
                    {[6, 12, 18, 24].map(n => <option key={n} value={n}>{n} months</option>)}
                  </select>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed mt-3">
                The horizon is a rolling window anchored to the open month. No month range is
                ever stored as a literal — that is what caused the executive charts to keep
                reporting a fixed range long after it stopped being the last twelve months.
              </p>
            </Card>
          )}

          {/* ── FORMATS ──────────────────────────────────────────────── */}
          {section === 'formats' && (
            <Card title="Numbers, dates and units">
              <p className="text-xs text-slate-500 mb-3">Applies to every grid, chart label and export.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="f_sep" className={labelCls}>Thousands separator</label>
                  <select id="f_sep" className={`${inputCls} mt-1`} value={draftSettings.formats.thousands_separator}
                    onChange={e => setDraftSettings(s => ({ ...s, formats: { ...s.formats, thousands_separator: e.target.value } }))}>
                    <option value=",">Comma — 1,250,000</option>
                    <option value=" ">Space — 1 250 000</option>
                    <option value=".">Period — 1.250.000</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="f_dec" className={labelCls}>Decimal places</label>
                  <select id="f_dec" className={`${inputCls} mt-1`} value={draftSettings.formats.decimal_places}
                    onChange={e => setDraftSettings(s => ({ ...s, formats: { ...s.formats, decimal_places: Number(e.target.value) } }))}>
                    {[0, 1, 2].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="f_scale" className={labelCls}>Large numbers</label>
                  <select id="f_scale" className={`${inputCls} mt-1`} value={draftSettings.formats.large_number_scale}
                    onChange={e => setDraftSettings(s => ({ ...s, formats: { ...s.formats, large_number_scale: Number(e.target.value) } }))}>
                    <option value={1}>Full</option>
                    <option value={1000}>Thousands — K</option>
                    <option value={1000000}>Millions — M</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="f_unit" className={labelCls}>Default quantity unit</label>
                  <select id="f_unit" className={`${inputCls} mt-1`} value={draftSettings.formats.default_quantity_unit}
                    onChange={e => setDraftSettings(s => ({ ...s, formats: { ...s.formats, default_quantity_unit: e.target.value as 'pcs' | 'ctn' } }))}>
                    <option value="pcs">Pieces</option>
                    <option value="ctn">Cartons</option>
                  </select>
                  <p className="text-[10px] text-slate-400 mt-1">Scorecard and charts open in this unit</p>
                </div>
              </div>
              <div className="mt-4 rounded-xl bg-ink-950 p-3" style={{ background: 'var(--color-brand-950)' }}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Sample</p>
                <p className="font-mono text-xs text-slate-200 mt-1.5">
                  RM-POLY-02&nbsp;&nbsp;&nbsp;{formatQty(74_200_000, draftSettings.formats)} pcs&nbsp;&nbsp;&nbsp;31-Jul-26
                </p>
              </div>
            </Card>
          )}

          {/* ── AUDIT ────────────────────────────────────────────────── */}
          {section === 'audit' && (
            <Card title={<span className="inline-flex items-center gap-1.5"><Cog className="w-3.5 h-3.5" /> Change log</span>}>
              <p className="text-xs text-slate-500 leading-relaxed">
                Every settings change is recorded permanently, one row per changed field.
                When a chart looks wrong six weeks from now, this is the first place to look —
                "attainment_watch 95 → 98" answers the question that "thresholds changed" cannot.
              </p>
              <p className="text-[11px] text-slate-400 mt-3">
                Reads from <code className="font-mono">settings_audit</code>. The table has select
                and insert policies only — no update, no delete. An audit log you can edit is not
                an audit log.
              </p>
            </Card>
          )}

        </div>
      </div>
    </div>
  );
}
