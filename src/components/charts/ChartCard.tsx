/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Download, Settings2, X } from 'lucide-react';
import ChartBuilder, { transpose, type AxisMode, type ChartConfig, type ChartDatum } from './ChartBuilder';
import ChartConfigPanel, { loadChartConfig, saveChartConfig } from './ChartConfigPanel';
import { toCsvText, downloadCsv } from '../../utils/csv';

/**
 * A chart with its format pane.
 *
 * This is the drop-in: a screen supplies the cube and a stable `chartId`, and
 * gets a configurable chart whose settings persist per user per chart.
 *
 * The format pane is collapsed by default. A planner reading the dashboard
 * should see the chart, not a wall of controls; the controls are one click
 * away for the person building the management pack.
 */

export interface ChartCardProps {
  /** Stable ID. The saved format is keyed on this, so do not derive it from
   *  a filter or the user's preferences reset every time they change a filter. */
  chartId: string;
  title: string;
  subtitle?: string;
  /** Period labels, oldest first. */
  periods: readonly string[];
  /** Series names — machine lines, categories, channels. */
  seriesNames: readonly string[];
  /** [seriesIndex][periodIndex] */
  plan: readonly number[][];
  actual: readonly number[][];
  unit?: string;
  precision?: number;
  /** Label for the transpose toggle, e.g. 'Lines' or 'Categories'. */
  seriesLabel?: string;
  /**
   * Pin the axis and hide the row/column swap.
   *
   * A single-period chart has nothing to transpose: swapping would sum every
   * series into one bar. Offering a control that cannot produce a meaningful
   * result is worse than not offering it.
   */
  fixedAxis?: AxisMode;
  /**
   * Suggested first-open values, e.g. a coverage chart's real target of 3.0
   * months rather than the generic default of 100. Only applies before the
   * user has customised and saved this specific chart -- it can never
   * override an existing save.
   */
  defaultConfig?: Partial<ChartConfig>;
  className?: string;
}

export default function ChartCard({
  chartId, title, subtitle, periods, seriesNames, plan, actual,
  unit = '', precision = 1, seriesLabel = 'Series', fixedAxis, defaultConfig,
  className = '',
}: ChartCardProps) {
  const [config, setConfigState] = useState<ChartConfig>(
    () => ({ ...loadChartConfig(chartId, defaultConfig), ...(fixedAxis ? { axis: fixedAxis } : {}) }));
  const [showPanel, setShowPanel] = useState(false);

  const setConfig = useCallback((next: ChartConfig) => {
    setConfigState(next);
    saveChartConfig(chartId, next);
  }, [chartId]);

  const data: ChartDatum[] = useMemo(
    () => transpose(periods, seriesNames, plan, actual, (fixedAxis ?? config.axis) as AxisMode),
    [periods, seriesNames, plan, actual, config.axis, fixedAxis],
  );

  const exportCsv = useCallback(() => {
    const headers = ['Category', 'Plan', 'Actual', 'Variance', 'Attainment %'];
    const rows = data.map(d => [
      d.category,
      d.plan,
      d.actual,
      d.actual - d.plan,
      d.plan > 0 ? ((d.actual / d.plan) * 100).toFixed(1) : '',
    ]);
    downloadCsv(toCsvText(headers, rows), `${chartId}.csv`);
  }, [data, chartId]);

  return (
    <div className={`bg-white rounded-xl border border-slate-200/70 shadow-[var(--shadow-elev-2)] overflow-hidden ${className}`}>
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <div className="min-w-0">
          <h3 className="text-xs font-bold text-slate-900 tracking-tight">{title}</h3>
          {subtitle && <p className="text-[10px] text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={exportCsv}
            aria-label="Export chart data as CSV"
            className="h-7 px-2 rounded-lg border border-slate-300 bg-white text-[10px] font-bold text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1"
          >
            <Download className="w-3 h-3" /> Data
          </button>
          <button
            onClick={() => setShowPanel(v => !v)}
            aria-expanded={showPanel}
            aria-label={showPanel ? 'Hide chart format options' : 'Show chart format options'}
            className={`h-7 px-2 rounded-lg border text-[10px] font-bold inline-flex items-center gap-1 transition ${
              showPanel
                ? 'bg-brand-600 border-brand-600 text-white'
                : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {showPanel ? <X className="w-3 h-3" /> : <Settings2 className="w-3 h-3" />} Format
          </button>
        </div>
      </div>

      <div className={`grid gap-0 ${showPanel ? 'lg:grid-cols-[1fr_248px]' : 'grid-cols-1'}`}>
        <div className="p-4 min-w-0">
          <ChartBuilder data={data} config={config} unit={unit} precision={precision} />
        </div>
        {showPanel && (
          <div className="border-t lg:border-t-0 lg:border-s border-slate-100 max-h-[520px] overflow-y-auto">
            <ChartConfigPanel
              config={config}
              onChange={setConfig}
              seriesLabel={seriesLabel}
              hide={fixedAxis ? ['axis'] : undefined}
              className="border-0 rounded-none"
            />
          </div>
        )}
      </div>
    </div>
  );
}
