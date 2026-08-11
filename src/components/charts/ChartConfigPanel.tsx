/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { RotateCcw } from 'lucide-react';
import {
  DEFAULT_CHART_CONFIG,
  type AxisMode, type ChartConfig, type ChartType, type LabelMode, type Measure, type ScaleMode,
} from './ChartBuilder';

/**
 * Chart format panel.
 *
 * The Excel "Format Chart Area" pane, reduced to the controls that actually
 * matter for plan-versus-actual reporting. Everything writes to one
 * `ChartConfig` object, which is what gets persisted per user per chart —
 * so a saved view is a small JSON blob, not a bespoke table.
 *
 * ── Two controls that are not cosmetic ──────────────────────────────────────
 *
 * `axis` is the row/column swap. One data cube, two questions: months on X
 * asks *when* did we miss; series on X asks *who* missed. Same numbers.
 *
 * `scale` defaults to 'zero' rather than 'auto'. Auto-scaling clips the Y axis
 * to the data range, which visually inflates a 3% miss into what looks like a
 * collapse. That is how a healthy month gets escalated in a board meeting.
 * Auto remains available; it is just not what a chart opens with.
 */

export interface ChartConfigPanelProps {
  config: ChartConfig;
  onChange: (next: ChartConfig) => void;
  /** Series names for the transpose label, e.g. ['SOFY','VOXY']. */
  seriesLabel?: string;
  /** Hide controls that make no sense for this chart. */
  hide?: Array<keyof ChartConfig>;
  className?: string;
}

const sel =
  'h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-[11px] ' +
  'text-slate-900 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500';
const lbl = 'text-[10px] font-bold text-slate-600';
const group = 'space-y-1.5';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details open className="border-b border-slate-100 last:border-b-0">
      <summary className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-600 cursor-pointer hover:bg-slate-50 select-none">
        {title}
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-2.5">{children}</div>
    </details>
  );
}

function Toggle({
  id, label, checked, onChange,
}: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-[11px] text-slate-700 cursor-pointer py-0.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="w-3.5 h-3.5 accent-brand-600 cursor-pointer"
      />
      {label}
    </label>
  );
}

function Slider({
  id, label, value, min, max, step = 1, suffix = '', onChange,
}: {
  id: string; label: string; value: number; min: number; max: number;
  step?: number; suffix?: string; onChange: (v: number) => void;
}) {
  return (
    <div className={group}>
      <label htmlFor={id} className={lbl}>
        {label} <span className="font-mono text-slate-800">{value}{suffix}</span>
      </label>
      <input
        id={id} type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-brand-600 h-5 cursor-pointer"
      />
    </div>
  );
}

export default function ChartConfigPanel({
  config, onChange, seriesLabel = 'Series', hide = [], className = '',
}: ChartConfigPanelProps) {
  const set = <K extends keyof ChartConfig>(key: K, value: ChartConfig[K]) =>
    onChange({ ...config, [key]: value });

  const shown = (key: keyof ChartConfig) => !hide.includes(key);

  return (
    <aside
      className={`bg-white border border-slate-200 rounded-xl overflow-hidden ${className}`}
      aria-label="Chart format options"
    >
      <div className="px-3 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-slate-900">Format chart</p>
          <p className="text-[10px] text-slate-400">Saved per user, per chart</p>
        </div>
        <button
          onClick={() => onChange(DEFAULT_CHART_CONFIG)}
          className="h-6 px-2 rounded-md border border-slate-300 bg-white text-[10px] font-bold text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1"
        >
          <RotateCcw className="w-2.5 h-2.5" /> Reset
        </button>
      </div>

      <Section title="Data">
        <div className={group}>
          <label htmlFor="cfg-measure" className={lbl}>Measure</label>
          <select id="cfg-measure" className={sel} value={config.measure}
            onChange={e => set('measure', e.target.value as Measure)}>
            <option value="pva">Plan vs actual</option>
            <option value="actual">Actual only</option>
            <option value="plan">Plan only</option>
            <option value="variance">Variance (actual − plan)</option>
            <option value="attainment">Attainment %</option>
          </select>
        </div>

        {shown('axis') && (
          <div className={group}>
            <label className={lbl}>Categories on X axis</label>
            <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5" role="group" aria-label="Axis">
              {([['period', 'Months'], ['series', seriesLabel]] as Array<[AxisMode, string]>).map(([v, t]) => (
                <button
                  key={v}
                  onClick={() => set('axis', v)}
                  aria-pressed={config.axis === v}
                  className={`flex-1 h-6 rounded-md text-[10px] font-bold transition ${
                    config.axis === v ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 leading-snug">
              {config.axis === 'period'
                ? 'Months on X; series are summed into each bar.'
                : `${seriesLabel} on X; the selected months are summed into each bar.`}
            </p>
          </div>
        )}
      </Section>

      <Section title="Chart type">
        <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5" role="group" aria-label="Chart type">
          {([['grouped', 'Grouped'], ['stacked', 'Stacked'], ['line', 'Line']] as Array<[ChartType, string]>).map(([v, t]) => (
            <button
              key={v}
              onClick={() => set('type', v)}
              aria-pressed={config.type === v}
              className={`flex-1 h-6 rounded-md text-[10px] font-bold transition ${
                config.type === v ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        {config.type !== 'line' && (
          <Slider id="cfg-barw" label="Bar width" suffix="%" min={25} max={95}
            value={config.barWidthPct} onChange={v => set('barWidthPct', v)} />
        )}
        <Slider id="cfg-h" label="Chart height" suffix=" px" min={200} max={560} step={20}
          value={config.height} onChange={v => set('height', v)} />
      </Section>

      <Section title="Data labels">
        <div className={group}>
          <label htmlFor="cfg-labels" className={lbl}>Show</label>
          <select id="cfg-labels" className={sel} value={config.labels}
            onChange={e => set('labels', e.target.value as LabelMode)}>
            <option value="none">None</option>
            <option value="value">Value</option>
            <option value="percent">Attainment %</option>
            <option value="both">Value + %</option>
          </select>
        </div>
        {config.labels !== 'none' && (
          <>
            <Slider id="cfg-labsize" label="Label size" suffix=" px" min={7} max={15}
              value={config.labelSize} onChange={v => set('labelSize', v)} />
            <Toggle id="cfg-labplan" label="Label the plan series too"
              checked={config.labelPlan} onChange={v => set('labelPlan', v)} />
            <p className="text-[10px] text-slate-400 leading-snug">
              Off by default — labelling both series doubles the ink for a number the
              reader already has from the bar height. Turn it on for the management pack.
            </p>
          </>
        )}
      </Section>

      <Section title="Target line">
        <Toggle id="cfg-target" label="Show target line"
          checked={config.showTarget} onChange={v => set('showTarget', v)} />
        {config.showTarget && (
          <>
            <div className={group}>
              <label htmlFor="cfg-tval" className={lbl}>Target value</label>
              <input id="cfg-tval" type="number" step="any" className={sel} value={config.targetValue}
                onChange={e => set('targetValue', Number(e.target.value))} />
            </div>
            <div className={group}>
              <label htmlFor="cfg-tcap" className={lbl}>Caption</label>
              <input id="cfg-tcap" type="text" className={sel} value={config.targetCaption}
                onChange={e => set('targetCaption', e.target.value)} />
            </div>
            <Toggle id="cfg-tcolor" label="Colour bars by target"
              checked={config.colorByTarget} onChange={v => set('colorByTarget', v)} />
            <p className="text-[10px] text-slate-400 leading-snug">
              {config.measure === 'attainment'
                ? 'In attainment view the target is a percentage — 100 means plan was met exactly.'
                : 'The target reads in the same unit as the bars.'}
            </p>
          </>
        )}
      </Section>

      <Section title="Axis & grid">
        <div className={group}>
          <label className={lbl}>Y axis scale</label>
          <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5" role="group" aria-label="Y axis scale">
            {([['auto', 'Auto'], ['zero', 'From zero'], ['manual', 'Manual']] as Array<[ScaleMode, string]>).map(([v, t]) => (
              <button
                key={v}
                onClick={() => set('scale', v)}
                aria-pressed={config.scale === v}
                className={`flex-1 h-6 rounded-md text-[10px] font-bold transition ${
                  config.scale === v ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          {config.scale === 'auto' && (
            <p className="text-[10px] text-amber-700 leading-snug">
              Auto clips the axis to the data range, which makes a small variance look
              much larger than it is. Prefer "from zero" for anything going in front of
              management.
            </p>
          )}
        </div>

        {config.scale === 'manual' && (
          <div className="flex gap-2">
            <div className={`${group} flex-1`}>
              <label htmlFor="cfg-ymin" className={lbl}>Min</label>
              <input id="cfg-ymin" type="number" className={sel} value={config.yMin}
                onChange={e => set('yMin', Number(e.target.value))} />
            </div>
            <div className={`${group} flex-1`}>
              <label htmlFor="cfg-ymax" className={lbl}>Max</label>
              <input id="cfg-ymax" type="number" className={sel} value={config.yMax}
                onChange={e => set('yMax', Number(e.target.value))} />
            </div>
          </div>
        )}

        <Slider id="cfg-grid" label="Gridlines" min={2} max={10}
          value={config.gridCount} onChange={v => set('gridCount', v)} />
        <Toggle id="cfg-showgrid" label="Show gridlines"
          checked={config.showGrid} onChange={v => set('showGrid', v)} />
        <Toggle id="cfg-showy" label="Show Y axis values"
          checked={config.showYAxis} onChange={v => set('showYAxis', v)} />
        <Toggle id="cfg-rotate" label="Rotate X labels 45°"
          checked={config.rotateLabels} onChange={v => set('rotateLabels', v)} />
      </Section>
    </aside>
  );
}

// ── Persistence ─────────────────────────────────────────────────────────────

const STORE_KEY = 'sc_planner_chart_configs';

/**
 * Chart configs are stored per user per chart under one key.
 *
 * Merged over `DEFAULT_CHART_CONFIG` on read, so a config saved by an older
 * build is missing any option added since — spreading defaults first means the
 * new option arrives with its shipped value instead of `undefined`, which
 * would render as a blank axis or a zero-height chart.
 */
export function loadChartConfig(
  chartId: string,
  screenDefaults?: Partial<ChartConfig>,
): ChartConfig {
  // `screenDefaults` lets a caller suggest sensible first-open values --
  // e.g. a coverage chart's real target of 3.0 months rather than the
  // generic DEFAULT_CHART_CONFIG value of 100 -- without ever overriding
  // something the user has actually customised and saved. Precedence is
  // shipped defaults, then the screen's suggestion, then the user's save.
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const all = raw ? JSON.parse(raw) : {};
    return { ...DEFAULT_CHART_CONFIG, ...screenDefaults, ...(all[chartId] ?? {}) };
  } catch {
    return { ...DEFAULT_CHART_CONFIG, ...screenDefaults };
  }
}

export function saveChartConfig(chartId: string, config: ChartConfig): void {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const all = raw ? JSON.parse(raw) : {};
    all[chartId] = config;
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    // A full or blocked localStorage must not take the chart down with it.
    // The chart still renders; the preference just does not persist.
  }
}
