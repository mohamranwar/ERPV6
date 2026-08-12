/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { chartColors } from '../../utils/chartColors';
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line,
  LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

/**
 * Configurable plan-vs-actual chart.
 *
 * ── The one rule that makes these readable ──────────────────────────────────
 * PLAN is drawn as a ghost: dashed outline, 10% wash, no solid fill.
 * ACTUAL is drawn as substance: solid fill.
 *
 * A plan is an intention; an actual is a thing that happened. Drawing them
 * with the same visual weight forces the reader back to the legend on every
 * glance, which is exactly the wrong cost to impose on someone reading a chart
 * from the back of a meeting room. The asymmetry also survives greyscale
 * printing and the ~8% of male planners with red-green colour vision
 * deficiency, neither of which a two-colour solid scheme does.
 *
 * Never invert it, including in stacked and line modes.
 */

// ── Palette ────────────────────────────────────────────────────────────────
// Recharts needs literal colours for SVG fills -- an SVG attribute cannot
// resolve `var(--token)`. These previously held hardcoded copies of the
// theme, with a comment saying they "mirror" it, which is precisely how a
// rebrand leaves a handful of chart bars on the old palette while the rest
// of the app changes. They now read the real tokens at render time, so
// index.css stays the single source of truth and dark mode works too.
const c = () => chartColors();
const PLAN_STROKE = () => c().planStroke;
const PLAN_FILL = () => c().planFill;
const ACTUAL_FILL = () => c().actual;
const OVER_FILL = () => c().over;
const UNDER_FILL = () => c().under;
const GRID = () => c().grid;
const AXIS = () => c().axis;
const REF = () => c().ref;
const INK = () => c().ref;

export type ChartType = 'grouped' | 'stacked' | 'line';
export type Measure = 'pva' | 'actual' | 'plan' | 'variance' | 'attainment';
export type AxisMode = 'period' | 'series';
export type LabelMode = 'none' | 'value' | 'percent' | 'both';
export type ScaleMode = 'auto' | 'zero' | 'manual';

export interface ChartConfig {
  type: ChartType;
  measure: Measure;
  /** 'period' puts time on X. 'series' transposes — the Excel row/column swap. */
  axis: AxisMode;
  labels: LabelMode;
  labelSize: number;
  /** Label the plan series too. Off by default: it doubles the ink. */
  labelPlan: boolean;
  showTarget: boolean;
  targetValue: number;
  targetCaption: string;
  /** Recolour actual green above / red below the target. */
  colorByTarget: boolean;
  scale: ScaleMode;
  yMin: number;
  yMax: number;
  gridCount: number;
  showGrid: boolean;
  showYAxis: boolean;
  rotateLabels: boolean;
  barWidthPct: number;
  height: number;
}

export const DEFAULT_CHART_CONFIG: ChartConfig = {
  type: 'grouped',
  measure: 'pva',
  axis: 'period',
  labels: 'value',
  labelSize: 10,
  labelPlan: false,
  showTarget: true,
  targetValue: 100,
  targetCaption: 'Target',
  colorByTarget: true,
  // 'zero' rather than 'auto' on purpose. Auto-scaling a plan-vs-actual chart
  // clips the Y axis to the data range, which visually inflates a 3% miss into
  // something that looks like a collapse. That is how a healthy month gets
  // escalated in a board meeting.
  scale: 'zero',
  yMin: 0,
  yMax: 100,
  gridCount: 4,
  showGrid: true,
  showYAxis: true,
  rotateLabels: false,
  barWidthPct: 70,
  height: 300,
};

/** One category with its plan and actual figure. */
export interface ChartDatum {
  category: string;
  plan: number;
  actual: number;
}

export interface ChartBuilderProps {
  data: ChartDatum[];
  config: ChartConfig;
  /** Appended to tooltip figures, e.g. 'M pcs' or 'ctn'. */
  unit?: string;
  /** Decimal places for labels and tooltips. */
  precision?: number;
  className?: string;
}

interface Row {
  category: string;
  plan: number;
  actual: number;
  variance: number;
  attainment: number | null;
  planLabel: string;
  actualLabel: string;
}

const fmt = (v: number, d: number) =>
  v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Attainment is null when plan is zero — there is no ratio against nothing.
 * Returning 0 or Infinity here is how "∞%" reaches a slide.
 */
const attainmentOf = (plan: number, actual: number): number | null =>
  plan > 0 ? (actual / plan) * 100 : null;

export function ChartBuilder({
  data,
  config,
  unit = '',
  precision = 1,
  className,
}: ChartBuilderProps) {
  const rows = useMemo<Row[]>(
    () => data.map(d => ({
      category: d.category,
      plan: d.plan,
      actual: d.actual,
      variance: d.actual - d.plan,
      attainment: attainmentOf(d.plan, d.actual),
      planLabel: fmt(d.plan, precision),
      actualLabel: fmt(d.actual, precision),
    })),
    [data, precision],
  );

  // Which keys actually render, given the measure.
  const series = useMemo(() => {
    switch (config.measure) {
      case 'pva':
        return [
          { key: 'plan', name: 'Plan', ghost: true },
          { key: 'actual', name: 'Actual', ghost: false },
        ];
      case 'plan':       return [{ key: 'plan', name: 'Plan', ghost: true }];
      case 'actual':     return [{ key: 'actual', name: 'Actual', ghost: false }];
      case 'variance':   return [{ key: 'variance', name: 'Variance', ghost: false }];
      case 'attainment': return [{ key: 'attainment', name: 'Attainment', ghost: false }];
    }
  }, [config.measure]);

  const domain = useMemo<[number | 'auto', number | 'auto']>(() => {
    if (config.scale === 'manual') return [config.yMin, config.yMax];

    const values = rows.flatMap(r =>
      series.map(s => Number(r[s.key as keyof Row] ?? 0)).filter(Number.isFinite));
    if (values.length === 0) return [0, 'auto'];

    const min = Math.min(0, ...values);
    const max = Math.max(...values, config.showTarget ? config.targetValue : -Infinity);

    if (config.scale === 'zero') return [Math.min(0, min), Math.ceil(max * 1.12)];
    const pad = (max - min) * 0.12 || 1;
    return [min < 0 ? min - pad : Math.max(0, min - pad), max + pad];
  }, [rows, series, config.scale, config.yMin, config.yMax, config.showTarget, config.targetValue]);

  /** Fill for one actual bar, honouring the colour-by-target switch. */
  const actualFill = (row: Row): string => {
    if (!config.colorByTarget || !config.showTarget) return ACTUAL_FILL();
    if (config.measure === 'attainment') {
      return (row.attainment ?? 0) >= config.targetValue ? OVER_FILL() : UNDER_FILL();
    }
    if (config.measure === 'pva') {
      return row.actual >= row.plan ? ACTUAL_FILL() : UNDER_FILL();
    }
    return ACTUAL_FILL();
  };

  const labelFor = (row: Row, key: string): string => {
    if (config.labels === 'none') return '';
    if (key === 'plan' && !config.labelPlan) return '';

    const raw = Number(row[key as keyof Row] ?? 0);
    const pct = row.attainment === null ? '—' : `${row.attainment.toFixed(0)}%`;

    if (config.labels === 'percent') return pct;
    if (config.labels === 'both') return `${fmt(raw, precision)} · ${pct}`;
    return fmt(raw, precision);
  };

  const tooltip = (
    <Tooltip
      cursor={{ fill: 'rgba(20, 90, 103, 0.05)' }}
      contentStyle={{
        background: chartColors().ref, border: 'none', borderRadius: 8,
        padding: '8px 11px', fontSize: 11, color: '#fff',
        boxShadow: '0 6px 16px -4px rgba(6,23,27,.3)',
      }}
      labelStyle={{ color: '#fff', fontWeight: 700, marginBottom: 4 }}
      formatter={(value: number, name: string) => [
        `${fmt(value, precision)} ${unit}`.trim(), name,
      ]}
    />
  );

  const axes = (
    <>
      {config.showGrid && (
        <CartesianGrid stroke={GRID()} vertical={false}
          strokeDasharray={config.gridCount > 6 ? '2 2' : undefined} />
      )}
      <XAxis
        dataKey="category"
        tick={{ fontSize: 10, fill: AXIS(), fontFamily: 'var(--font-mono)' }}
        tickLine={false}
        axisLine={{ stroke: GRID() }}
        angle={config.rotateLabels ? -45 : 0}
        textAnchor={config.rotateLabels ? 'end' : 'middle'}
        height={config.rotateLabels ? 56 : 28}
        interval={0}
      />
      <YAxis
        hide={!config.showYAxis}
        domain={domain}
        tickCount={config.gridCount + 1}
        tick={{ fontSize: 10, fill: AXIS(), fontFamily: 'var(--font-mono)' }}
        tickLine={false}
        axisLine={false}
        width={46}
      />
      {tooltip}
      {series.length > 1 && (
        <Legend
          verticalAlign="top" align="right" height={26}
          wrapperStyle={{ fontSize: 11, fontWeight: 600, color: AXIS() }}
        />
      )}
      {config.showTarget && (
        <ReferenceLine
          y={config.targetValue}
          stroke={REF()}
          strokeWidth={1.6}
          strokeDasharray="6 4"
          label={{
            value: `${config.targetCaption} ${config.targetValue}`,
            position: 'insideTopRight',
            fill: REF(), fontSize: 10, fontWeight: 700,
            fontFamily: 'var(--font-mono)',
          }}
        />
      )}
    </>
  );

  const barSize = Math.max(6, Math.round((config.barWidthPct / 100) * 46 / series.length));

  const renderBars = () => series.map(s => (
    <Bar
      key={s.key}
      dataKey={s.key}
      name={s.name}
      stackId={config.type === 'stacked' ? 'a' : undefined}
      barSize={barSize}
      radius={[2, 2, 0, 0]}
      isAnimationActive={false}
      fill={s.ghost ? PLAN_FILL() : ACTUAL_FILL()}
      stroke={s.ghost ? PLAN_STROKE() : undefined}
      strokeWidth={s.ghost ? 1.3 : 0}
      strokeDasharray={s.ghost ? '4 3' : undefined}
    >
      {/* Per-cell fills carry the variance colouring. Plan keeps its ghost
          treatment in every case — never coloured by outcome, because a plan
          has no outcome. */}
      {!s.ghost && rows.map((row, i) => (
        <Cell
          key={i}
          fill={
            config.measure === 'variance'
              ? (row.variance >= 0 ? OVER_FILL() : UNDER_FILL())
              : actualFill(row)
          }
        />
      ))}

      {config.labels !== 'none' && (
        <LabelList
          dataKey={s.key}
          position="top"
          content={(props: any) => {
            const { x, y, width, index } = props;
            const text = labelFor(rows[index], s.key);
            if (!text) return null;
            return (
              <text
                x={x + width / 2}
                y={Math.max(y - 5, 10)}
                textAnchor="middle"
                fontSize={config.labelSize}
                fontWeight={700}
                fontFamily="var(--font-mono)"
                fill={s.ghost ? PLAN_STROKE() : INK()}
              >
                {text}
              </text>
            );
          }}
        />
      )}
    </Bar>
  ));

  const renderLines = () => series.map(s => (
    <Line
      key={s.key}
      type="monotone"
      dataKey={s.key}
      name={s.name}
      stroke={s.ghost ? PLAN_STROKE() : ACTUAL_FILL()}
      strokeWidth={2.4}
      strokeDasharray={s.ghost ? '5 4' : undefined}
      dot={{ r: 3.2, fill: s.ghost ? '#fff' : ACTUAL_FILL(),
             stroke: s.ghost ? PLAN_STROKE() : '#fff', strokeWidth: 1.8 }}
      activeDot={{ r: 5 }}
      isAnimationActive={false}
      // A gap is a gap. Bridging null points draws a line through months that
      // never reported, implying output that did not happen.
      connectNulls={false}
    >
      {config.labels !== 'none' && (!s.ghost || config.labelPlan) && (
        <LabelList
          dataKey={s.key}
          position="top"
          offset={9}
          fontSize={config.labelSize}
          fontWeight={700}
          fontFamily="var(--font-mono)"
          fill={s.ghost ? PLAN_STROKE() : INK()}
          formatter={(v: number) => fmt(v, precision)}
        />
      )}
    </Line>
  ));

  if (rows.length === 0) {
    return (
      <div
        className={className}
        style={{
          height: config.height, display: 'grid', placeItems: 'center',
          color: AXIS(), fontSize: 12,
        }}
      >
        Nothing to chart for this selection.
      </div>
    );
  }

  const Chart = config.type === 'line' ? LineChart : BarChart;

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={config.height}>
        <Chart data={rows} margin={{ top: 22, right: 16, bottom: 4, left: 0 }}>
          {axes}
          {config.type === 'line' ? renderLines() : renderBars()}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Transpose a period × series matrix — the Excel switch-row/column swap.
 *
 * `byPeriod` puts time on X with each series summed into the bucket.
 * `bySeries` puts the series on X with the periods summed.
 *
 * One cube, two questions: *when* did we miss, and *who* missed.
 */
export function transpose(
  periods: readonly string[],
  seriesNames: readonly string[],
  plan: readonly number[][],      // [seriesIndex][periodIndex]
  actual: readonly number[][],
  mode: AxisMode,
): ChartDatum[] {
  if (mode === 'period') {
    return periods.map((p, pi) => ({
      category: p,
      plan: plan.reduce((sum, row) => sum + (row[pi] ?? 0), 0),
      actual: actual.reduce((sum, row) => sum + (row[pi] ?? 0), 0),
    }));
  }
  return seriesNames.map((name, si) => ({
    category: name,
    plan: (plan[si] ?? []).reduce((a, b) => a + b, 0),
    actual: (actual[si] ?? []).reduce((a, b) => a + b, 0),
  }));
}

export default ChartBuilder;
