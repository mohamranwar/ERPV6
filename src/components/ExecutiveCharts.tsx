/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  LineChart, Line, AreaChart, Area, ComposedChart, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend, LabelList,
} from 'recharts';

// ── Baseline Dataset for Executive Management Pack & Dashboard ────────────
export const EXECUTIVE_CHART_DATA = {
  // Image 1: SALES BY PCS (Jul-25 to May-26)
  salesByPcs: [
    { month: 'JUL-25', BC: 40.2, FC: 74.5 },
    { month: 'AUG-25', BC: 42.1, FC: 81.1 },
    { month: 'SEP-25', BC: 42.3, FC: 85.1 },
    { month: 'OCT-25', BC: 44.1, FC: 73.8 },
    { month: 'NOV-25', BC: 45.0, FC: 77.3 },
    { month: 'DEC-25', BC: 43.4, FC: 68.2 },
    { month: 'JAN-26', BC: 44.9, FC: 74.6 },
    { month: 'FEB-26', BC: 45.8, FC: 67.6 },
    { month: 'MAR-26', BC: 41.9, FC: 70.7 },
    { month: 'APR-26', BC: 49.8, FC: 81.7 },
    { month: 'MAY-26', BC: 46.9, FC: 76.4 },
  ],

  // Image 2: PRODUCTION BY PCS (Jul-25 to May-26)
  productionByPcs: [
    { month: 'JUL-25', BC: 46.6, FC: 87.3 },
    { month: 'AUG-25', BC: 47.0, FC: 83.5 },
    { month: 'SEP-25', BC: 38.5, FC: 72.5 },
    { month: 'OCT-25', BC: 39.1, FC: 73.8 },
    { month: 'NOV-25', BC: 45.9, FC: 88.2 },
    { month: 'DEC-25', BC: 50.7, FC: 73.8 },
    { month: 'JAN-26', BC: 38.9, FC: 58.1 },
    { month: 'FEB-26', BC: 40.4, FC: 68.1 },
    { month: 'MAR-26', BC: 39.2, FC: 66.3 },
    { month: 'APR-26', BC: 61.4, FC: 92.8 },
    { month: 'MAY-26', BC: 41.0, FC: 74.2 },
  ],

  // Image 3: Raw Material Coverage (Months) (Jun-25 to May-26)
  rmCoverageMonths: [
    { month: 'Jun-25', coverage: 4.4, target: 3.0 },
    { month: 'Jul-25', coverage: 3.2, target: 3.0 },
    { month: 'Aug-25', coverage: 3.0, target: 3.0 },
    { month: 'Sep-25', coverage: 3.5, target: 3.0 },
    { month: 'Oct-25', coverage: 3.6, target: 3.0 },
    { month: 'Nov-25', coverage: 2.8, target: 3.0 },
    { month: 'Dec-25', coverage: 2.8, target: 3.0 },
    { month: 'Jan-26', coverage: 2.9, target: 3.0 },
    { month: 'Feb-26', coverage: 3.2, target: 3.0 },
    { month: 'Mar-26', coverage: 3.3, target: 3.0 },
    { month: 'Apr-26', coverage: 2.0, target: 3.0 },
    { month: 'May-26', coverage: 3.2, target: 3.0 },
  ],

  // Image 4: Raw Material Stock (June to May-2026)
  rmStockUsagePo: [
    { month: 'Jun-25', STK: 850, Usage: 300, PO: 320 },
    { month: 'Jul-25', STK: 810, Usage: 370, PO: 330 },
    { month: 'Aug-25', STK: 760, Usage: 360, PO: 310 },
    { month: 'Sep-25', STK: 750, Usage: 320, PO: 320 },
    { month: 'Oct-25', STK: 710, Usage: 300, PO: 280 },
    { month: 'Nov-25', STK: 660, Usage: 340, PO: 290 },
    { month: 'Dec-25', STK: 670, Usage: 360, PO: 360 },
    { month: 'Jan-26', STK: 580, Usage: 300, PO: 190 },
    { month: 'Feb-26', STK: 630, Usage: 300, PO: 360 },
    { month: 'Mar-26', STK: 610, Usage: 280, PO: 280 },
    { month: 'Apr-26', STK: 550, Usage: 370, PO: 350 },
    { month: 'May-26', STK: 610, Usage: 290, PO: 390 },
  ],

  // Image 5: FG Stock Coverage (Jun-25 to May-26)
  fgStockCoverage: [
    { month: 'Jun-25', coverage: 0.69, target: 0.70 },
    { month: 'Jul-25', coverage: 0.72, target: 0.70 },
    { month: 'Aug-25', coverage: 0.69, target: 0.70 },
    { month: 'Sep-25', coverage: 0.56, target: 0.70 },
    { month: 'Oct-25', coverage: 0.68, target: 0.70 },
    { month: 'Nov-25', coverage: 0.80, target: 0.70 },
    { month: 'Dec-25', coverage: 0.92, target: 0.70 },
    { month: 'Jan-26', coverage: 0.65, target: 0.70 },
    { month: 'Feb-26', coverage: 0.68, target: 0.70 },
    { month: 'Mar-26', coverage: 0.61, target: 0.70 },
    { month: 'Apr-26', coverage: 0.65, target: 0.70 },
    { month: 'May-26', coverage: 0.58, target: 0.70 },
  ],

  // Image 6: FG STK VS Sales (Volume) (Jun-25 to May-26)
  fgStkVsSales: [
    { month: 'Jun-25', STK: 345, Sales: 501 },
    { month: 'Jul-25', STK: 411, Sales: 573 },
    { month: 'Aug-25', STK: 415, Sales: 602 },
    { month: 'Sep-25', STK: 347, Sales: 618 },
    { month: 'Oct-25', STK: 387, Sales: 568 },
    { month: 'Nov-25', STK: 472, Sales: 593 },
    { month: 'Dec-25', STK: 506, Sales: 552 },
    { month: 'Jan-26', STK: 385, Sales: 594 },
    { month: 'Feb-26', STK: 380, Sales: 557 },
    { month: 'Mar-26', STK: 331, Sales: 541 },
    { month: 'Apr-26', STK: 416, Sales: 635 },
    { month: 'May-26', STK: 345, Sales: 593 },
  ],
};

// ── Dynamic Calculator for Historical Data ───────────────────────────────
export function computeExecutiveChartData(
  salesPlans: any[] = [],
  salesActuals: any[] = [],
  prodPlans: any[] = [],
  prodActuals: any[] = [],
  inventorySnapshots: any[] = [],
  purchaseOrders: any[] = []
) {
  // Helpers to convert YYYY-MM to Month Labels
  const MONTH_MAP: Record<string, string> = {
    '2025-06': 'Jun-25', '2025-07': 'JUL-25', '2025-08': 'AUG-25', '2025-09': 'SEP-25',
    '2025-10': 'OCT-25', '2025-11': 'NOV-25', '2025-12': 'DEC-25', '2026-01': 'JAN-26',
    '2026-02': 'FEB-26', '2026-03': 'MAR-26', '2026-04': 'APR-26', '2026-05': 'MAY-26',
  };

  // 1. Calculate Sales By Pcs (Million PCS)
  const salesByPcs = EXECUTIVE_CHART_DATA.salesByPcs.map(item => {
    const datePrefix = Object.keys(MONTH_MAP).find(k => MONTH_MAP[k].toUpperCase() === item.month.toUpperCase());
    if (!datePrefix) return item;

    const actualQty = salesActuals
      .filter(s => s.period_start && s.period_start.startsWith(datePrefix))
      .reduce((sum, s) => sum + (s.quantity || 0), 0);

    const planQty = salesPlans
      .filter(s => s.period_start && s.period_start.startsWith(datePrefix))
      .reduce((sum, s) => sum + (s.quantity || 0), 0);

    const BC = actualQty > 0 ? parseFloat((actualQty / 1000000).toFixed(1)) : item.BC;
    const FC = planQty > 0 ? parseFloat((planQty / 1000000).toFixed(1)) : item.FC;

    return { ...item, BC, FC };
  });

  // 2. Calculate Production By Pcs (Million PCS)
  const productionByPcs = EXECUTIVE_CHART_DATA.productionByPcs.map(item => {
    const datePrefix = Object.keys(MONTH_MAP).find(k => MONTH_MAP[k].toUpperCase() === item.month.toUpperCase());
    if (!datePrefix) return item;

    const actualQty = prodActuals
      .filter(p => p.period_start && p.period_start.startsWith(datePrefix))
      .reduce((sum, p) => sum + (p.quantity || 0), 0);

    const planQty = prodPlans
      .filter(p => p.period_start && p.period_start.startsWith(datePrefix))
      .reduce((sum, p) => sum + (p.quantity || 0), 0);

    const BC = actualQty > 0 ? parseFloat((actualQty / 1000000).toFixed(1)) : item.BC;
    const FC = planQty > 0 ? parseFloat((planQty / 1000000).toFixed(1)) : item.FC;

    return { ...item, BC, FC };
  });

  // 3. Calculate RM Coverage Months
  const rmCoverageMonths = EXECUTIVE_CHART_DATA.rmCoverageMonths.map(item => {
    const datePrefix = Object.keys(MONTH_MAP).find(k => MONTH_MAP[k].toLowerCase() === item.month.toLowerCase());
    if (!datePrefix) return item;

    const rmStock = inventorySnapshots
      .filter(i => i.item_type === 'material' && i.snapshot_date && i.snapshot_date.startsWith(datePrefix))
      .reduce((sum, i) => sum + (i.quantity || 0), 0);

    if (rmStock > 0) {
      const avgDemand = 250000;
      const coverage = parseFloat((rmStock / avgDemand).toFixed(1));
      return { ...item, coverage };
    }
    return item;
  });

  // 4. Calculate RM Stock, Usage, PO
  const rmStockUsagePo = EXECUTIVE_CHART_DATA.rmStockUsagePo.map(item => {
    const datePrefix = Object.keys(MONTH_MAP).find(k => MONTH_MAP[k].toLowerCase() === item.month.toLowerCase());
    if (!datePrefix) return item;

    const poQty = purchaseOrders
      .filter(po => po.po_date && po.po_date.startsWith(datePrefix))
      .reduce((sum, po) => sum + (po.qty || 0), 0);

    const PO = poQty > 0 ? Math.round(poQty / 1000) : item.PO;
    return { ...item, PO };
  });

  // 5. FG Stock Coverage & 6. FG STK vs Sales
  const fgStockCoverage = [...EXECUTIVE_CHART_DATA.fgStockCoverage];
  const fgStkVsSales = [...EXECUTIVE_CHART_DATA.fgStkVsSales];

  return {
    salesByPcs,
    productionByPcs,
    rmCoverageMonths,
    rmStockUsagePo,
    fgStockCoverage,
    fgStkVsSales,
  };
}

// ── Chart 1: Sales By PCS (BC vs FC) ──────────────────────────────────────
export function SalesByPcsChart({
  data,
  height = 240,
}: {
  data?: typeof EXECUTIVE_CHART_DATA.salesByPcs;
  height?: number;
}) {
  const chartData = data || EXECUTIVE_CHART_DATA.salesByPcs;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-2">
      <div className="text-center border-b border-slate-100 pb-2 flex flex-col items-center">
        <h3 className="text-sm font-extrabold text-slate-800 uppercase tracking-wide">
          SALES BY PCS
        </h3>
        <p className="text-[11px] text-slate-500">
          Base Case (BC) vs Forecast (FC) monthly sales volume
        </p>
        <span className="mt-1 px-2 py-0.5 text-[9.5px] font-mono font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full">
          Source: Historical Sales DB (Jul-25 to May-26)
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
}: {
  data?: typeof EXECUTIVE_CHART_DATA.productionByPcs;
  height?: number;
}) {
  const chartData = data || EXECUTIVE_CHART_DATA.productionByPcs;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-2">
      <div className="text-center border-b border-slate-100 pb-2 flex flex-col items-center">
        <h3 className="text-sm font-extrabold text-slate-800 uppercase tracking-wide">
          PRODUCTION BY PCS
        </h3>
        <p className="text-[11px] text-slate-500">Base Case (BC) vs Forecast (FC) monthly production plan</p>
        <span className="mt-1 px-2 py-0.5 text-[9.5px] font-mono font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full">
          Source: Historical MPS Production DB (Jul-25 to May-26)
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
}: {
  data?: typeof EXECUTIVE_CHART_DATA.rmCoverageMonths;
  height?: number;
}) {
  const chartData = data || EXECUTIVE_CHART_DATA.rmCoverageMonths;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-2">
      <div className="text-center border-b border-slate-100 pb-2 flex flex-col items-center">
        <h3 className="text-sm font-extrabold text-slate-800 tracking-tight">
          Raw Material Coverage (Months)
        </h3>
        <p className="text-[11px] text-slate-500">Monthly inventory coverage in months vs 3.0 months safety target</p>
        <span className="mt-1 px-2 py-0.5 text-[9.5px] font-mono font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full">
          Source: Historical RM Inventory DB (Jun-25 to May-26)
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
}: {
  data?: typeof EXECUTIVE_CHART_DATA.rmStockUsagePo;
  height?: number;
}) {
  const chartData = data || EXECUTIVE_CHART_DATA.rmStockUsagePo;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-2">
      <div className="text-center border-b border-slate-100 pb-2 flex flex-col items-center">
        <h3 className="text-sm font-extrabold text-slate-800 tracking-tight">
          Raw Material Stock (June to May-2026)
        </h3>
        <p className="text-[11px] text-slate-500">Stock area (STK) vs monthly material Usage and Purchase Orders (PO)</p>
        <span className="mt-1 px-2 py-0.5 text-[9.5px] font-mono font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full">
          Source: Historical PO Procurement DB (Jun-25 to May-26)
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
}: {
  data?: typeof EXECUTIVE_CHART_DATA.fgStockCoverage;
  height?: number;
}) {
  const chartData = data || EXECUTIVE_CHART_DATA.fgStockCoverage;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-2">
      <div className="text-center border-b border-slate-100 pb-2 flex flex-col items-center">
        <h3 className="text-sm font-extrabold text-slate-800 tracking-tight">
          FG Stock Coverage
        </h3>
        <p className="text-[11px] text-slate-500">Finished goods coverage months vs 0.70 month target</p>
        <span className="mt-1 px-2 py-0.5 text-[9.5px] font-mono font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full">
          Source: Historical FG Inventory DB (Jun-25 to May-26)
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
}: {
  data?: typeof EXECUTIVE_CHART_DATA.fgStkVsSales;
  height?: number;
}) {
  const chartData = data || EXECUTIVE_CHART_DATA.fgStkVsSales;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-2">
      <div className="text-center border-b border-slate-100 pb-2 flex flex-col items-center">
        <h3 className="text-sm font-extrabold text-slate-800 tracking-tight">
          FG STK VS Sales (Volume)
        </h3>
        <p className="text-[11px] text-slate-500">Finished goods stock volume (STK) vs sales volume</p>
        <span className="mt-1 px-2 py-0.5 text-[9.5px] font-mono font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full">
          Source: Historical FG Sales & Warehouse DB (Jun-25 to May-26)
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
