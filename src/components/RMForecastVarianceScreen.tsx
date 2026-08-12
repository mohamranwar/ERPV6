/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import {
  AlertCircle, AlertTriangle, CheckCircle2, ChevronDown,
  ChevronRight, HelpCircle, TrendingDown, TrendingUp,
  DollarSign, ShoppingBag, BarChart2, PackageX,
} from 'lucide-react';

import {
  fetchTableData, fetchClosedPeriods, formatPlanningPeriod, getPlanningPeriod,
} from '../supabaseClient';
import type { ClosedPeriod, Material, MRPResult, PurchaseOrder, Supplier } from '../types';
import { useAsyncLoad, type LoadSignal } from '../hooks/useAsyncLoad';
import { useFirstLoad } from '../hooks/useFirstLoad';
import DataStateWrapper from './DataStateWrapper';
import { KpiCard } from './ui';
import SortableHeader from './SortableHeader';
import { useTableSort } from '../hooks/useTableSort';
import ContentHeader from './ContentHeader';
import ChartCard from './charts/ChartCard';
import {
  buildVarianceRows, summariseVariance,
  resolveBaselineRunId, resolveCurrentRunId, resultsForRun,
  type VarianceRow, type VarianceBand,
} from '../services/rmForecastVariance';
import {
  fetchVarianceReasons, saveVarianceReason, deleteVarianceReason,
  VARIANCE_REASON_LABELS,
  type VarianceReason, type VarianceReasonCode,
} from '../supabaseClient';
import { useAppSettings } from '../hooks/useAppSettings';

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
  const [reasons, setReasons] = useState<VarianceReason[]>([]);
  const [reasonForm, setReasonForm] = useState<{
    materialId: string;
    code: VarianceReasonCode;
    notes: string;
    saving: boolean;
  } | null>(null);

  const { isFirstLoad, markLoaded } = useFirstLoad('rm_forecast_variance');
  const { settings } = useAppSettings();
  const tolerance = {
    onPlanPct: settings.thresholds.variance_on_plan_pct,
    watchPct: settings.thresholds.variance_watch_pct,
  };

  async function loadData(signal: LoadSignal = NEVER_CANCELLED) {
    setLoading(true);
    setError(null);
    try {
      const [mats, sups, pos, results, closed, reasonList] = await Promise.all([
        fetchTableData<Material>('materials'),
        fetchTableData<Supplier>('suppliers'),
        fetchTableData<PurchaseOrder>('purchase_orders'),
        fetchTableData<MRPResult>('mrp_results'),
        fetchClosedPeriods(),
        fetchVarianceReasons(period),
      ]);
      if (signal.cancelled) return;
      setMaterials(mats);
      setSuppliers(sups);
      setPurchaseOrders(pos);
      setMrpResults(results);
      setClosedPeriods(closed);
      setReasons(reasonList);
    } catch (e: any) {
      if (signal.cancelled) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!signal.cancelled) { setLoading(false); markLoaded(); }
    }
  }

  useAsyncLoad((signal) => loadData(signal), [refreshKey]);

  // Reload reasons whenever the period selector changes -- they are period-
  // specific and the main load only fires on refreshKey.
  useAsyncLoad(async (signal) => {
    const list = await fetchVarianceReasons(period);
    if (!signal.cancelled) setReasons(list);
  }, [period]);

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
      baselineResults, currentResults, purchaseOrders, materials, suppliers, period, tolerance,
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

  const { sortedItems: sortedRows, sortConfig, handleSort } = useTableSort(
    rows, 'orderVarianceValue', 'desc'
  );

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

  async function handleSaveReason(row: VarianceRow) {
    if (!reasonForm || reasonForm.saving || !reasonForm.notes.trim()) return;
    setReasonForm(f => f ? { ...f, saving: true } : f);
    try {
      const saved = await saveVarianceReason({
        period,
        material_id: row.materialId,
        recorded_by: null,
        reason_code: reasonForm.code,
        notes: reasonForm.notes.trim(),
        baseline_qty: row.baselineQty,
        actual_qty: row.actualQty,
        variance_qty: row.orderVarianceQty,
      });
      setReasons(prev => [saved, ...prev]);
      setReasonForm(null);
    } catch (e: any) {
      alert('Could not save reason: ' + e.message);
      setReasonForm(f => f ? { ...f, saving: false } : f);
    }
  }

  async function handleDeleteReason(id: string) {
    if (!confirm('Delete this reason?')) return;
    try {
      await deleteVarianceReason(id);
      setReasons(prev => prev.filter(r => r.id !== id));
    } catch (e: any) {
      alert('Could not delete: ' + e.message);
    }
  }

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

          {/* KPI cards — same KpiCard component as the Dashboard */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              label="Baseline value"
              value={fmtEgp(totals.baselineValue)}
              sub="What MRP planned to order"
              icon={<DollarSign className="w-4 h-4" />}
              intent="default"
            />
            <KpiCard
              label="Ordered value"
              value={fmtEgp(totals.actualValue)}
              sub="What Procurement actually raised"
              icon={<ShoppingBag className="w-4 h-4" />}
              intent={totals.actualValue === 0 ? 'warning' : 'default'}
            />
            <KpiCard
              label="Variance"
              value={(totals.varianceValue > 0 ? '+' : '') + fmtEgp(totals.varianceValue)}
              sub={totals.variancePct !== null
                ? `${totals.variancePct > 0 ? '+' : ''}${fmt(totals.variancePct, 1)}% vs baseline`
                : 'No baseline'}
              icon={<BarChart2 className="w-4 h-4" />}
              intent={totals.varianceValue === 0 ? 'success'
                : Math.abs(totals.variancePct ?? 999) <= tolerance.onPlanPct ? 'success'
                : Math.abs(totals.variancePct ?? 999) <= tolerance.watchPct ? 'warning'
                : 'danger'}
              trend={totals.variancePct !== null ? -totals.variancePct : undefined}
              trendLabel={totals.variancePct !== null ? `${Math.abs(totals.variancePct).toFixed(1)}%` : undefined}
            />
            <KpiCard
              label="Materials off plan"
              value={totals.materialsOffPlan}
              sub={`${totals.materialsNotOrdered} not ordered · ${totals.materialsUnplanned} unplanned`}
              icon={<PackageX className="w-4 h-4" />}
              intent={totals.materialsOffPlan === 0 ? 'success' : 'danger'}
              badge={totals.materialsNotOrdered > 0 ? {
                label: `${totals.materialsNotOrdered} not ordered`,
                intent: 'danger',
              } : totals.materialsUnplanned > 0 ? {
                label: `${totals.materialsUnplanned} unplanned`,
                intent: 'warning',
              } : undefined}
            />
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
                      <SortableHeader label="Material" sortKey="materialName" sortConfig={sortConfig} onSort={handleSort} align="left" className="px-4 py-2.5" />
                      <SortableHeader label="Baseline qty" sortKey="baselineQty" sortConfig={sortConfig} onSort={handleSort} align="right" className="px-4 py-2.5" />
                      <SortableHeader label="Forecast drift" sortKey="forecastDriftQty" sortConfig={sortConfig} onSort={handleSort} align="right" className="px-4 py-2.5" />
                      <SortableHeader label="Ordered qty" sortKey="actualQty" sortConfig={sortConfig} onSort={handleSort} align="right" className="px-4 py-2.5" />
                      <SortableHeader label="Variance %" sortKey="orderVariancePct" sortConfig={sortConfig} onSort={handleSort} align="right" className="px-4 py-2.5" />
                      <SortableHeader label="Variance value" sortKey="orderVarianceValue" sortConfig={sortConfig} onSort={handleSort} align="right" className="px-4 py-2.5" />
                      <th className="text-center px-4 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {sortedRows.map(row => (
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

                        {/* Drill-down: POs + variance reasons */}
                        {expandedRows.has(row.materialId) && (
                          <tr className="bg-slate-50/80">
                            <td></td>
                            <td colSpan={7} className="px-4 py-3">
                              <div className="space-y-4">

                                {/* Numbers */}
                                <div className="grid grid-cols-3 gap-4">
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

                                {/* PO numbers */}
                                <div>
                                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                                    Purchase orders — {formatPlanningPeriod(period)}
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
                                </div>

                                {/* Variance reasons */}
                                <div className="border-t border-slate-200 pt-3 space-y-2">
                                  <div className="flex items-center justify-between">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                      Variance reasons
                                    </p>
                                    {reasonForm?.materialId !== row.materialId && (
                                      <button
                                        onClick={() => setReasonForm({
                                          materialId: row.materialId,
                                          code: 'other',
                                          notes: '',
                                          saving: false,
                                        })}
                                        className="text-[10px] font-bold text-brand-600 hover:text-brand-700 hover:underline"
                                      >
                                        + Add reason
                                      </button>
                                    )}
                                  </div>

                                  {/* Existing reasons */}
                                  {reasons.filter(r => r.material_id === row.materialId).map(r => (
                                    <div key={r.id} className="flex items-start gap-2 bg-white rounded-lg border border-slate-200 px-3 py-2">
                                      <div className="flex-1 min-w-0">
                                        <span className="text-[10px] font-bold text-brand-700 bg-brand-50 border border-brand-200 px-1.5 py-0.5 rounded mr-2">
                                          {VARIANCE_REASON_LABELS[r.reason_code]}
                                        </span>
                                        <span className="text-xs text-slate-700">{r.notes}</span>
                                      </div>
                                      <button
                                        onClick={() => handleDeleteReason(r.id)}
                                        className="text-[10px] text-slate-400 hover:text-red-600 shrink-0"
                                        aria-label="Delete reason"
                                      >✕</button>
                                    </div>
                                  ))}

                                  {reasons.filter(r => r.material_id === row.materialId).length === 0
                                    && reasonForm?.materialId !== row.materialId && (
                                    <p className="text-[10px] text-slate-400 italic">
                                      No reasons recorded yet. Add one so this variance is explained in the month-close record.
                                    </p>
                                  )}

                                  {/* Add reason form */}
                                  {reasonForm?.materialId === row.materialId && (
                                    <div className="bg-white rounded-lg border border-brand-200 p-3 space-y-2">
                                      <div className="flex gap-2">
                                        <select
                                          value={reasonForm.code}
                                          onChange={e => setReasonForm(f => f ? { ...f, code: e.target.value as VarianceReasonCode } : f)}
                                          className="h-7 rounded-lg border border-slate-300 bg-white px-2 text-[11px] flex-1 focus:outline-none focus:ring-2 focus:ring-brand-500"
                                        >
                                          {(Object.entries(VARIANCE_REASON_LABELS) as [VarianceReasonCode, string][]).map(([code, label]) => (
                                            <option key={code} value={code}>{label}</option>
                                          ))}
                                        </select>
                                      </div>
                                      <textarea
                                        rows={2}
                                        value={reasonForm.notes}
                                        onChange={e => setReasonForm(f => f ? { ...f, notes: e.target.value } : f)}
                                        placeholder="Explain the variance — supplier, quantity impact, action for next month..."
                                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
                                      />
                                      <div className="flex gap-2 justify-end">
                                        <button
                                          onClick={() => setReasonForm(null)}
                                          className="h-7 px-3 rounded-lg border border-slate-300 text-[10px] font-bold text-slate-600 hover:bg-slate-50"
                                        >
                                          Cancel
                                        </button>
                                        <button
                                          onClick={() => handleSaveReason(row)}
                                          disabled={reasonForm.saving || !reasonForm.notes.trim()}
                                          className="h-7 px-3 rounded-lg bg-brand-600 text-[10px] font-bold text-white hover:bg-brand-700 disabled:opacity-50"
                                        >
                                          {reasonForm.saving ? 'Saving…' : 'Save reason'}
                                        </button>
                                      </div>
                                    </div>
                                  )}
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
