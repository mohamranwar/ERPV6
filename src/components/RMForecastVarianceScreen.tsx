/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import {
  AlertCircle, AlertTriangle, CheckCircle2, ChevronDown,
  ChevronRight, HelpCircle, TrendingDown, TrendingUp,
} from 'lucide-react';

import {
  fetchTableData, fetchClosedPeriods, formatPlanningPeriod, getPlanningPeriod,
} from '../supabaseClient';
import type { ClosedPeriod, Material, MRPResult, PurchaseOrder, Supplier } from '../types';
import { useAsyncLoad, type LoadSignal } from '../hooks/useAsyncLoad';
import { useFirstLoad } from '../hooks/useFirstLoad';
import DataStateWrapper from './DataStateWrapper';
import ContentHeader from './ContentHeader';
import ChartCard from './charts/ChartCard';
import {
  buildVarianceRows, summariseVariance,
  resolveBaselineRunId, resolveCurrentRunId, resultsForRun,
  type VarianceRow, type VarianceBand,
} from '../services/rmForecastVariance';

const NEVER_CANCELLED = { cancelled: false };

interface Props {
  refreshKey?: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const fmt = (n: number, dp = 0) =>
  n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

const fmtEgp = (n: number) =>
  `EGP ${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

const BAND_META: Record<VarianceBand, { label: string; cls: string; icon: React.ReactNode }> = {
  on_plan: {
    label: 'On plan',
    cls: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    icon: <CheckCircle2 className="w-3 h-3" />,
  },
  watch: {
    label: 'Watch',
    cls: 'text-amber-700 bg-amber-50 border-amber-200',
    icon: <AlertTriangle className="w-3 h-3" />,
  },
  off_plan: {
    label: 'Off plan',
    cls: 'text-red-700 bg-red-50 border-red-200',
    icon: <AlertCircle className="w-3 h-3" />,
  },
  none: {
    label: '—',
    cls: 'text-slate-400 bg-slate-50 border-slate-200',
    icon: <HelpCircle className="w-3 h-3" />,
  },
};

function BandBadge({ band }: { band: VarianceBand }) {
  const m = BAND_META[band];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${m.cls}`}>
      {m.icon}{m.label}
    </span>
  );
}

function DeltaBadge({ qty, pct }: { qty: number; pct: number | null }) {
  if (qty === 0) return <span className="text-slate-400 text-xs">—</span>;
  const up = qty > 0;
  const cls = up ? 'text-red-600' : 'text-emerald-700';
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-xs ${cls}`}>
      <Icon className="w-3 h-3" />
      {up ? '+' : ''}{fmt(qty)}
      {pct !== null && ` (${up ? '+' : ''}${fmt(pct, 1)}%)`}
    </span>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────

export default function RMForecastVarianceScreen({ refreshKey = 0 }: Props) {
  const [period, setPeriod] = useState(() => getPlanningPeriod());
  const [materials, setMaterials] = useState<Material[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [mrpResults, setMrpResults] = useState<MRPResult[]>([]);
  const [closedPeriods, setClosedPeriods] = useState<ClosedPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const { isFirstLoad, markLoaded } = useFirstLoad('rm_forecast_variance');

  async function loadData(signal: LoadSignal = NEVER_CANCELLED) {
    setLoading(true);
    setError(null);
    try {
      const [mats, sups, pos, results, closed] = await Promise.all([
        fetchTableData<Material>('materials'),
        fetchTableData<Supplier>('suppliers'),
        fetchTableData<PurchaseOrder>('purchase_orders'),
        fetchTableData<MRPResult>('mrp_results'),
        fetchClosedPeriods(),
      ]);
      if (signal.cancelled) return;
      setMaterials(mats);
      setSuppliers(sups);
      setPurchaseOrders(pos);
      setMrpResults(results);
      setClosedPeriods(closed);
    } catch (e: any) {
      if (signal.cancelled) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!signal.cancelled) { setLoading(false); markLoaded(); }
    }
  }

  useAsyncLoad((signal) => loadData(signal), [refreshKey]);

  // ── Variance computation ─────────────────────────────────────────────────

  const closedForPeriod = useMemo(
    () => closedPeriods.find(cp => cp.period?.slice(0, 7) === period.slice(0, 7)),
    [closedPeriods, period],
  );

  const baselineRunId = useMemo(
    () => resolveBaselineRunId(mrpResults, period, closedForPeriod?.run_id),
    [mrpResults, period, closedForPeriod],
  );

  const currentRunId = useMemo(
    () => resolveCurrentRunId(mrpResults, period),
    [mrpResults, period],
  );

  const baselineResults = useMemo(
    () => resultsForRun(mrpResults, baselineRunId),
    [mrpResults, baselineRunId],
  );

  const currentResults = useMemo(
    () => resultsForRun(mrpResults, currentRunId),
    [mrpResults, currentRunId],
  );

  const rows = useMemo(
    () => buildVarianceRows({
      baselineResults, currentResults, purchaseOrders, materials, suppliers, period,
    }),
    [baselineResults, currentResults, purchaseOrders, materials, suppliers, period],
  );

  const totals = useMemo(() => summariseVariance(rows), [rows]);

  // ── Chart cube (top 10 by absolute variance value) ──────────────────────

  const chartCube = useMemo(() => {
    const top = rows.slice(0, 10);
    return {
      periods: [formatPlanningPeriod(period)],
      seriesNames: top.map(r => r.materialSku || r.materialName),
      plan: top.map(r => [r.baselineValue]),
      actual: top.map(r => [r.actualValue]),
    };
  }, [rows, period]);

  // ── Available periods (months represented in MRP results or POs) ─────────

  const availablePeriods = useMemo(() => {
    const seen = new Set<string>();
    for (const r of mrpResults) {
      if (r.week_start_date) seen.add(r.week_start_date.slice(0, 7));
    }
    for (const po of purchaseOrders) {
      if (po.po_date) seen.add(po.po_date.slice(0, 7));
    }
    return Array.from(seen).sort().reverse();
  }, [mrpResults, purchaseOrders]);

  // ── Toggle drill-down ────────────────────────────────────────────────────

  function toggleRow(id: string) {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const hasNoBaseline = baselineRunId === null;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-full bg-surface-1">
      <ContentHeader
        title="RM Forecast vs Actual PO"
        subtitle="Compare what MRP said to order against what Procurement actually raised"
        actions={
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            className="h-8 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
            aria-label="Reporting period"
          >
            {availablePeriods.length === 0 && (
              <option value={period}>{formatPlanningPeriod(period)}</option>
            )}
            {availablePeriods.map(p => (
              <option key={p} value={p}>{formatPlanningPeriod(p)}</option>
            ))}
          </select>
        }
      />

      <DataStateWrapper
        loading={loading && isFirstLoad}
        error={error}
        isEmpty={false}
        onRetry={() => loadData()}
        emptyMessage=""
      >
        <div className="p-4 lg:p-6 space-y-6">

          {/* Baseline notice */}
          {hasNoBaseline ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>
                No MRP run found for <strong>{formatPlanningPeriod(period)}</strong>.
                Run MRP for this period first — the baseline is pinned to the earliest
                run in the month so it cannot drift as new runs are added.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-500 flex items-center gap-4">
              <span>
                <span className="font-semibold text-slate-700">Baseline run:</span>{' '}
                {baselineRunId}
                {closedForPeriod ? ' (from month close)' : ' (earliest run in month)'}
              </span>
              {currentRunId !== baselineRunId && (
                <span>
                  <span className="font-semibold text-slate-700">Current run:</span>{' '}
                  {currentRunId}
                </span>
              )}
            </div>
          )}

          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              {
                label: 'Baseline value',
                value: fmtEgp(totals.baselineValue),
                sub: 'What MRP planned to order',
                cls: 'text-slate-900',
              },
              {
                label: 'Ordered value',
                value: fmtEgp(totals.actualValue),
                sub: 'What Procurement actually raised',
                cls: 'text-slate-900',
              },
              {
                label: 'Variance',
                value: (totals.varianceValue > 0 ? '+' : '') + fmtEgp(totals.varianceValue),
                sub: totals.variancePct !== null
                  ? `${totals.variancePct > 0 ? '+' : ''}${fmt(totals.variancePct, 1)}% vs baseline`
                  : 'No baseline',
                cls: totals.varianceValue === 0 ? 'text-slate-900'
                  : totals.varianceValue > 0 ? 'text-red-600' : 'text-emerald-700',
              },
              {
                label: 'Materials off plan',
                value: String(totals.materialsOffPlan),
                sub: `${totals.materialsNotOrdered} not ordered · ${totals.materialsUnplanned} unplanned`,
                cls: totals.materialsOffPlan > 0 ? 'text-red-600' : 'text-emerald-700',
              },
            ].map(({ label, value, sub, cls }) => (
              <div key={label} className="bg-white rounded-xl border border-slate-200 p-4 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
                <p className={`text-xl font-bold font-mono ${cls}`}>{value}</p>
                <p className="text-[10px] text-slate-400">{sub}</p>
              </div>
            ))}
          </div>

          {/* Chart */}
          {rows.length > 0 && (
            <ChartCard
              chartId="rm-variance-by-material"
              title="Variance by material — top 10"
              subtitle={`Baseline (ghost) vs ordered (solid) · ${formatPlanningPeriod(period)} · EGP value`}
              periods={chartCube.periods}
              seriesNames={chartCube.seriesNames}
              plan={chartCube.plan}
              actual={chartCube.actual}
              unit="EGP"
              precision={0}
              fixedAxis="series"
              seriesLabel="Materials"
            />
          )}

          {/* Table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-slate-900">Material detail</h3>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Sorted by absolute variance value · click a row to see matched POs
                </p>
              </div>
              <span className="text-xs text-slate-500">{rows.length} materials</span>
            </div>

            {rows.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400">
                No variance data for {formatPlanningPeriod(period)}.
                {hasNoBaseline && ' Run MRP first to establish a baseline.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      <th className="text-left px-4 py-2.5 w-6"></th>
                      <th className="text-left px-4 py-2.5">Material</th>
                      <th className="text-right px-4 py-2.5">Baseline qty</th>
                      <th className="text-right px-4 py-2.5">Forecast drift</th>
                      <th className="text-right px-4 py-2.5">Ordered qty</th>
                      <th className="text-right px-4 py-2.5">Variance</th>
                      <th className="text-right px-4 py-2.5">Variance value</th>
                      <th className="text-center px-4 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {rows.map(row => (
                      <React.Fragment key={row.materialId}>
                        <tr
                          className={`hover:bg-slate-50 cursor-pointer transition-colors ${
                            row.flag === 'not_ordered' ? 'bg-red-50/40' :
                            row.flag === 'unplanned' ? 'bg-amber-50/40' : ''
                          }`}
                          onClick={() => toggleRow(row.materialId)}
                        >
                          <td className="px-4 py-2.5 text-slate-400">
                            {expandedRows.has(row.materialId)
                              ? <ChevronDown className="w-3.5 h-3.5" />
                              : <ChevronRight className="w-3.5 h-3.5" />}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-slate-900">{row.materialSku}</div>
                            <div className="text-slate-500 text-[10px]">{row.materialName}</div>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-slate-700">
                            {fmt(row.baselineQty)}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <DeltaBadge qty={row.forecastDriftQty} pct={null} />
                          </td>
                          <td className={`px-4 py-2.5 text-right font-mono ${
                            row.flag === 'not_ordered' ? 'text-red-600 font-bold' : 'text-slate-700'
                          }`}>
                            {row.flag === 'not_ordered' ? '—' : fmt(row.actualQty)}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <DeltaBadge qty={row.orderVarianceQty} pct={row.orderVariancePct} />
                          </td>
                          <td className={`px-4 py-2.5 text-right font-mono font-medium ${
                            row.orderVarianceValue > 0 ? 'text-red-600' :
                            row.orderVarianceValue < 0 ? 'text-emerald-700' : 'text-slate-400'
                          }`}>
                            {row.orderVarianceValue === 0 ? '—' :
                              `${row.orderVarianceValue > 0 ? '+' : ''}${fmtEgp(row.orderVarianceValue)}`}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <BandBadge band={row.band} />
                          </td>
                        </tr>

                        {/* PO drill-down */}
                        {expandedRows.has(row.materialId) && (
                          <tr className="bg-slate-50/80">
                            <td></td>
                            <td colSpan={7} className="px-4 py-3">
                              <div className="space-y-2">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                  Purchase orders raised in {formatPlanningPeriod(period)}
                                </p>
                                {row.matchedPoNumbers.length === 0 ? (
                                  <p className="text-xs text-red-600 font-medium">
                                    No POs found for this period.
                                    {row.flag === 'not_ordered' && ' This is why the full planned quantity shows as a gap.'}
                                  </p>
                                ) : (
                                  <div className="flex flex-wrap gap-2">
                                    {row.matchedPoNumbers.map(n => (
                                      <span key={n} className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-[10px] font-mono font-medium text-slate-700">
                                        {n}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <div className="grid grid-cols-3 gap-4 pt-1">
                                  <div>
                                    <p className="text-[10px] text-slate-400">Baseline (frozen)</p>
                                    <p className="text-xs font-bold text-slate-900">{fmt(row.baselineQty)} units · {fmtEgp(row.baselineValue)}</p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] text-slate-400">Current forecast</p>
                                    <p className="text-xs font-bold text-slate-900">
                                      {fmt(row.currentForecastQty)} units
                                      {row.forecastDriftQty !== 0 && (
                                        <span className={`ml-1 ${row.forecastDriftQty > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                                          ({row.forecastDriftQty > 0 ? '+' : ''}{fmt(row.forecastDriftQty)})
                                        </span>
                                      )}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] text-slate-400">Ordered</p>
                                    <p className="text-xs font-bold text-slate-900">{fmt(row.actualQty)} units · {fmtEgp(row.actualValue)}</p>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-4 text-[10px] text-slate-500 border-t border-slate-100 pt-4">
            <span><strong className="text-slate-700">Forecast drift</strong> = current run − baseline. Planning's number.</span>
            <span><strong className="text-slate-700">Variance</strong> = ordered − baseline. Procurement's number.</span>
            <span className="text-amber-700"><strong>Amber rows</strong> = unplanned buys (no baseline).</span>
            <span className="text-red-700"><strong>Red rows</strong> = planned but not ordered.</span>
          </div>
        </div>
      </DataStateWrapper>
    </div>
  );
}
