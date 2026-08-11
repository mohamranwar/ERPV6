/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  LineChart, Line, AreaChart, Area, ComposedChart, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend, LabelList,
} from 'recharts';

/**
 * Presentational executive charts.
 *
 * The data these render now comes from utils/executiveCharts.ts, computed from
 * live rows. This file previously carried a hardcoded EXECUTIVE_CHART_DATA
 * seed and a compute function that merged real values into it -- which meant
 * any month outside a literal MONTH_MAP, any genuinely-zero month, and two of
 * the six series entirely, rendered demo figures with no error raised.
 *
 * The seed is deliberately gone rather than kept "as a fallback": a fallback
 * that renders silently is indistinguishable from real data, which is exactly
 * how the charts came to show fiction on a board-room projector.
 *
 * A series value of null means no data for that month. Charts pass
 * connectNulls={false} so a gap renders as a gap, rather than a line drawn
 * through months that never reported.
 */
import type {
  VolumePoint, CoveragePoint, StockFlowPoint, StockVsSalesPoint,
} from '../utils/executiveCharts';

export function SalesByPcsChart({
  data,
  height = 240,
  caption,
}: {
  data: VolumePoint[];
  height?: number;
  caption?: string;
}) {
  const chartData = data;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-2">
      <div className="text-center border-b border-slate-100 pb-2 flex flex-col items-center">
        <h3 className="text-sm font-extrabold text-slate-800 uppercase tracking-wide">
          SALES BY PCS
        </h3>
        <p className="text-[11px] text-slate-500">
          Base Case (BC) vs Forecast (FC) monthly sales volume
        </p>
        <span className="mt-1 px-2 py-0.5 text-[9.5px] font-mono font-bold bg-brand-50 text-brand-700 border border-brand-200 rounded-full">
          {caption ?? 'Live data'}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData} margin={{ top: 22, right: 16, left: -15, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 10, fontWeight: 700, fill: '#475569' }}
            axisLine={{ stroke: '#cbd5e1' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            domain={[0, 100]}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="bg-slate-900 text-white rounded-lg px-3 py-2 text-[11px] shadow-lg font-sans">
                  <p className="font-bold text-slate-200 border-b border-slate-700 pb-1 mb-1">{label}</p>
                  {payload.map((p: any) => (
                    <div key={p.dataKey} className="flex items-center justify-between gap-4">
                      <span style={{ color: p.color }} className="font-semibold">{p.name}:</span>
                      <span className="font-mono font-bold">{p.value} M PCS</span>
                    </div>
                  ))}
                </div>
              );
            }}
          />
          <Legend
            verticalAlign="bottom"
            align="center"
            wrapperStyle={{ fontSize: 11, fontWeight: 700, paddingTop: 8 }}
          />
          {/* Base Case Line (Teal with diamond markers) */}
          <Line
            type="monotone"
            dataKey="BC"
            name="BC"
            stroke="#0e7490"
            strokeWidth={2.5}
            dot={{ r: 4, fill: '#0e7490', strokeWidth: 1, stroke: '#ffffff' }}
            activeDot={{ r: 6 }}
          >
            <LabelList dataKey="BC" position="bottom" offset={8} style={{ fontSize: '9.5px', fontWeight: 'bold', fill: '#1e293b' }} />
          </Line>
          {/* Forecast Line (Pink/Magenta with square markers) */}
          <Line
            type="monotone"
            dataKey="FC"
            name="FC"
            stroke="#d946ef"
            strokeWidth={2.5}
            dot={{ r: 4, fill: '#d946ef', strokeWidth: 1, stroke: '#ffffff' }}
            activeDot={{ r: 6 }}
          >
            <LabelList dataKey="FC" position="top" offset={8} style={{ fontSize: '9.5px', fontWeight: 'bold', fill: '#1e293b' }} />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Chart 2: Production By PCS (BC vs FC) ─────────────────────────────────
export function ProductionByPcsChart({
  data,
  height = 240,
  caption,
}: {
  data: VolumePoint[];
  height?: number;
  caption?: string;
}) {
  const chartData = data;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-2">
      <div className="text-center border-b border-slate-100 pb-2 flex flex-col items-center">
        <h3 className="text-sm font-extrabold text-slate-800 uppercase tracking-wide">
          PRODUCTION BY PCS
        </h3>
        <p className="text-[11px] text-slate-500">Base Case (BC) vs Forecast (FC) monthly production plan</p>
        <span className="mt-1 px-2 py-0.5 text-[9.5px] font-mono font-bold bg-brand-50 text-brand-700 border border-brand-200 rounded-full">
          {caption ?? 'Live data'}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData} margin={{ top: 22, right: 16, left: -15, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 10, fontWeight: 700, fill: '#475569' }}
            axisLine={{ stroke: '#cbd5e1' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            domain={[0, 110]}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="bg-slate-900 text-white rounded-lg px-3 py-2 text-[11px] shadow-lg font-sans">
                  <p className="font-bold text-slate-200 border-b border-slate-700 pb-1 mb-1">{label}</p>
                  {payload.map((p: any) => (
                    <div key={p.dataKey} className="flex items-center justify-between gap-4">
                      <span style={{ color: p.color }} className="font-semibold">{p.name}:</span>
                      <span className="font-mono font-bold">{p.value} M PCS</span>
                    </div>
                  ))}
                </div>
              );
            }}
          />
          <Legend
            verticalAlign="bottom"
            align="center"
            wrapperStyle={{ fontSize: 11, fontWeight: 700, paddingTop: 8 }}
          />
          <Line
            type="monotone"
            dataKey="BC"
            name="BC"
            stroke="#0e7490"
            strokeWidth={2.5}
            dot={{ r: 4, fill: '#0e7490', strokeWidth: 1, stroke: '#ffffff' }}
            activeDot={{ r: 6 }}
          >
            <LabelList dataKey="BC" position="bottom" offset={8} style={{ fontSize: '9.5px', fontWeight: 'bold', fill: '#1e293b' }} />
          </Line>
          <Line
            type="monotone"
            dataKey="FC"
            name="FC"
            stroke="#d946ef"
            strokeWidth={2.5}
            dot={{ r: 4, fill: '#d946ef', strokeWidth: 1, stroke: '#ffffff' }}
            activeDot={{ r: 6 }}
          >
            <LabelList dataKey="FC" position="top" offset={8} style={{ fontSize: '9.5px', fontWeight: 'bold', fill: '#1e293b' }} />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Chart 3: Raw Material Coverage (Months) ──────────────────────────────
export function RawMaterialCoverageChart({
  data,
  height = 240,
  caption,
}: {
  data: CoveragePoint[];
  height?: number;
  caption?: string;
}) {
  const chartData = data;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-2">
      <div className="text-center border-b border-slate-100 pb-2 flex flex-col items-center">
        <h3 className="text-sm font-extrabold text-slate-800 tracking-tight">
          Raw Material Coverage (Months)
        </h3>
        <p className="text-[11px] text-slate-500">Monthly inventory coverage in months vs 3.0 months safety target</p>
        <span className="mt-1 px-2 py-0.5 text-[9.5px] font-mono font-bold bg-brand-50 text-brand-700 border border-brand-200 rounded-full">
          {caption ?? 'Live data'}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData} margin={{ top: 22, right: 16, left: -15, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={true} horizontal={true} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 10, fontWeight: 600, fill: '#475569' }}
            axisLine={{ stroke: '#cbd5e1' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            domain={[0, 10.0]}
            tickFormatter={(v) => v.toFixed(1)}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="bg-slate-900 text-white rounded-lg px-3 py-2 text-[11px] shadow-lg font-sans">
                  <p className="font-bold text-slate-200 border-b border-slate-700 pb-1 mb-1">{label}</p>
                  <p className="text-sky-300 font-semibold">
                    Coverage: <b className="text-white font-mono">{payload[0]?.value} months</b>
                  </p>
                  <p className="text-red-400 font-semibold">
                    Target: <b className="text-white font-mono">3.0 months</b>
                  </p>
                </div>
              );
            }}
          />
          <ReferenceLine
            y={3.0}
            stroke="#ef4444"
            strokeWidth={2.5}
            strokeDasharray="6 4"
            label={{ value: 'Target (3.0)', fill: '#ef4444', fontSize: 10, position: 'insideTopLeft' }}
          />
          <Line
            type="monotone"
            dataKey="coverage"
            name="Coverage"
            stroke="#0284c7"
            strokeWidth={3}
            dot={{ r: 4, fill: '#0284c7', strokeWidth: 1.5, stroke: '#ffffff' }}
            activeDot={{ r: 6 }}
          >
            <LabelList dataKey="coverage" position="top" offset={8} style={{ fontSize: '11px', fontWeight: '800', fill: '#1e293b' }} />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Chart 4: Raw Material Stock (June to May-2026) ───────────────────────
export function RawMaterialStockChart({
  data,
  height = 240,
  caption,
}: {
  data: StockFlowPoint[];
  height?: number;
  caption?: string;
}) {
  const chartData = data;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-2">
      <div className="text-center border-b border-slate-100 pb-2 flex flex-col items-center">
        <h3 className="text-sm font-extrabold text-slate-800 tracking-tight">
          Raw Material Stock (June to May-2026)
        </h3>
        <p className="text-[11px] text-slate-500">Stock area (STK) vs monthly material Usage and Purchase Orders (PO)</p>
        <span className="mt-1 px-2 py-0.5 text-[9.5px] font-mono font-bold bg-brand-50 text-brand-700 border border-brand-200 rounded-full">
          {caption ?? 'Live data'}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={chartData} margin={{ top: 16, right: 16, left: -15, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 10, fontWeight: 600, fill: '#475569' }}
            axisLine={{ stroke: '#cbd5e1' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            hide={false}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="bg-slate-900 text-white rounded-lg px-3 py-2 text-[11px] shadow-lg font-sans">
                  <p className="font-bold text-slate-200 border-b border-slate-700 pb-1 mb-1">{label}</p>
                  {payload.map((p: any) => (
                    <div key={p.dataKey} className="flex items-center justify-between gap-4">
                      <span style={{ color: p.color }} className="font-semibold">{p.name}:</span>
                      <span className="font-mono font-bold">{p.value.toLocaleString()} Tons</span>
                    </div>
                  ))}
                </div>
              );
            }}
          />
          <Legend
            verticalAlign="bottom"
            align="center"
            wrapperStyle={{ fontSize: 11, fontWeight: 700, paddingTop: 8 }}
          />
          {/* Filled Area for STK */}
          <Area
            type="monotone"
            dataKey="STK"
            name="STK"
            fill="#0f4c81"
            fillOpacity={0.88}
            stroke="#0b3861"
            strokeWidth={1.5}
          />
          {/* Usage Line (Orange) */}
          <Line
            type="monotone"
            dataKey="Usage"
            name="Usage"
            stroke="#ea580c"
            strokeWidth={2.5}
            dot={{ r: 4, fill: '#ea580c', strokeWidth: 1, stroke: '#ffffff' }}
          />
          {/* PO Line (Yellow) */}
          <Line
            type="monotone"
            dataKey="PO"
            name="PO"
            stroke="#facc15"
            strokeWidth={2.5}
            dot={{ r: 4, fill: '#facc15', strokeWidth: 1, stroke: '#ffffff' }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Chart 5: FG Stock Coverage ───────────────────────────────────────────
export function FGStockCoverageChart({
  data,
  height = 240,
  caption,
}: {
  data: CoveragePoint[];
  height?: number;
  caption?: string;
}) {
  const chartData = data;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-2">
      <div className="text-center border-b border-slate-100 pb-2 flex flex-col items-center">
        <h3 className="text-sm font-extrabold text-slate-800 tracking-tight">
          FG Stock Coverage
        </h3>
        <p className="text-[11px] text-slate-500">Finished goods coverage months vs 0.70 month target</p>
        <span className="mt-1 px-2 py-0.5 text-[9.5px] font-mono font-bold bg-brand-50 text-brand-700 border border-brand-200 rounded-full">
          {caption ?? 'Live data'}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData} margin={{ top: 22, right: 16, left: -15, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={true} horizontal={true} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 10, fontWeight: 600, fill: '#475569' }}
            axisLine={{ stroke: '#cbd5e1' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            domain={[0.40, 1.10]}
            tickFormatter={(v) => v.toFixed(2)}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="bg-slate-900 text-white rounded-lg px-3 py-2 text-[11px] shadow-lg font-sans">
                  <p className="font-bold text-slate-200 border-b border-slate-700 pb-1 mb-1">{label}</p>
                  <p className="text-sky-300 font-semibold">
                    Coverage: <b className="text-white font-mono">{payload[0]?.value} months</b>
                  </p>
                  <p className="text-red-400 font-semibold">
                    Target: <b className="text-white font-mono">0.70 months</b>
                  </p>
                </div>
              );
            }}
          />
          {/* Target Solid Red Line */}
          <ReferenceLine
            y={0.70}
            stroke="#ef4444"
            strokeWidth={3}
            label={{ value: 'Target (0.70)', fill: '#ef4444', fontSize: 10, position: 'insideTopRight' }}
          />
          <Line
            type="monotone"
            dataKey="coverage"
            name="Coverage"
            stroke="#0f4c81"
            strokeWidth={3}
            dot={{ r: 4, fill: '#0f4c81', strokeWidth: 1.5, stroke: '#ffffff' }}
            activeDot={{ r: 6 }}
          >
            <LabelList dataKey="coverage" position="top" offset={8} style={{ fontSize: '10px', fontWeight: 'bold', fill: '#1e293b' }} />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Chart 6: FG STK VS Sales (Volume) ────────────────────────────────────
export function FGStockVsSalesChart({
  data,
  height = 240,
  caption,
}: {
  data: StockVsSalesPoint[];
  height?: number;
  caption?: string;
}) {
  const chartData = data;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-2">
      <div className="text-center border-b border-slate-100 pb-2 flex flex-col items-center">
        <h3 className="text-sm font-extrabold text-slate-800 tracking-tight">
          FG STK VS Sales (Volume)
        </h3>
        <p className="text-[11px] text-slate-500">Finished goods stock volume (STK) vs sales volume</p>
        <span className="mt-1 px-2 py-0.5 text-[9.5px] font-mono font-bold bg-brand-50 text-brand-700 border border-brand-200 rounded-full">
          {caption ?? 'Live data'}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData} margin={{ top: 22, right: 16, left: -10, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={true} horizontal={true} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 10, fontWeight: 600, fill: '#475569' }}
            axisLine={{ stroke: '#cbd5e1' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            domain={[200000, 700000]}
            tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="bg-slate-900 text-white rounded-lg px-3 py-2 text-[11px] shadow-lg font-sans">
                  <p className="font-bold text-slate-200 border-b border-slate-700 pb-1 mb-1">{label}</p>
                  {payload.map((p: any) => (
                    <div key={p.dataKey} className="flex items-center justify-between gap-4">
                      <span style={{ color: p.color }} className="font-semibold">{p.name}:</span>
                      <span className="font-mono font-bold">{p.value}k PCS</span>
                    </div>
                  ))}
                </div>
              );
            }}
          />
          <Legend
            verticalAlign="bottom"
            align="center"
            wrapperStyle={{ fontSize: 11, fontWeight: 700, paddingTop: 8 }}
          />
          {/* STK Line (Dark Blue) */}
          <Line
            type="monotone"
            dataKey="STK"
            name="STK"
            stroke="#0f4c81"
            strokeWidth={3}
            dot={{ r: 4, fill: '#0f4c81', strokeWidth: 1, stroke: '#ffffff' }}
          >
            <LabelList dataKey="STK" position="bottom" offset={8} style={{ fontSize: '9.5px', fontWeight: 'bold', fill: '#0f4c81' }} />
          </Line>
          {/* Sales Line (Orange) */}
          <Line
            type="monotone"
            dataKey="Sales"
            name="Sales"
            stroke="#ea580c"
            strokeWidth={3}
            dot={{ r: 4, fill: '#ea580c', strokeWidth: 1, stroke: '#ffffff' }}
          >
            <LabelList dataKey="Sales" position="top" offset={8} style={{ fontSize: '9.5px', fontWeight: 'bold', fill: '#ea580c' }} />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
