/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';

import {
  fetchTableData, fetchClosedPeriods, getPlanningPeriod,
  fetchVarianceReasons, saveVarianceReason, deleteVarianceReason,
  VARIANCE_REASON_LABELS,
  type VarianceReason, type VarianceReasonCode,
} from '../supabaseClient';
import type { ClosedPeriod, Material, MRPResult, PurchaseOrder, Supplier } from '../types';
import { useAsyncLoad, type LoadSignal } from '../hooks/useAsyncLoad';
import { useFirstLoad } from '../hooks/useFirstLoad';
import { useTableFilters } from '../hooks/useTableFilters';
import { useAppSettings } from '../hooks/useAppSettings';
import DataStateWrapper from './DataStateWrapper';
import ContentHeader from './ContentHeader';
import ScrollableTable from './ScrollableTable';
import SearchBar from './SearchBar';
import {
  buildGrid, resolveGridRunId,
  type GridRow, type ProjectionMode,
} from '../services/rmForecastGrid';

const NEVER_CANCELLED = { cancelled: false };

interface Props {
  searchQuery?: string;
  setSearchQuery?: (q: string) => void;
  refreshKey?: number;
}

const nf = (n: number) => Math.round(n).toLocaleString('en-US');

/**
 * Achievement banding. Matches PlanVsActualScreen exactly rather than
 * inventing a second scale -- a planner reading both screens in one sitting
 * should not have to remember that amber means something different here.
 */
function pctClass(pct: number | null, okAt: number, watchAt: number): string {
  if (pct === null) return 'text-slate-500 bg-slate-100 border-slate-200';
  if (pct >= okAt) return 'text-emerald-700 bg-emerald-100 border-emerald-200';
  if (pct >= watchAt) return 'text-amber-700 bg-amber-100 border-amber-200';
  return 'text-red-700 bg-red-100 border-red-200';
}

export default function RMForecastVarianceScreen({
  searchQuery = '', setSearchQuery, refreshKey = 0,
}: Props) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [mrpResults, setMrpResults] = useState<MRPResult[]>([]);
  const [closedPeriods, setClosedPeriods] = useState<ClosedPeriod[]>([]);
  const [reasons, setReasons] = useState<VarianceReason[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [horizon, setHorizon] = useState(6);
  const [projection, setProjection] = useState<ProjectionMode>('band');
  const [seed, setSeed] = useState(1);
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [reasonForm, setReasonForm] = useState<{
    key: string; materialId: string; period: string;
    code: VarianceReasonCode; notes: string; saving: boolean;
  } | null>(null);

  const { isFirstLoad, markLoaded } = useFirstLoad('rm_forecast_variance');
  const { settings } = useAppSettings();
  const okAt = settings.thresholds.attainment_ok;
  const watchAt = settings.thresholds.attainment_watch;

  const startPeriod = getPlanningPeriod();

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
        fetchVarianceReasons(startPeriod),
      ]);
      if (signal.cancelled) return;
      setMaterials(mats); setSuppliers(sups); setPurchaseOrders(pos);
      setMrpResults(results); setClosedPeriods(closed); setReasons(reasonList);
    } catch (e: any) {
      if (signal.cancelled) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!signal.cancelled) { setLoading(false); markLoaded(); }
    }
  }

  useAsyncLoad((signal) => loadData(signal), [refreshKey]);

  // The forecast comes from ONE frozen run, never a live recalculation --
  // otherwise last month's figures change whenever someone edits an old plan.
  const runId = useMemo(
    () => resolveGridRunId(mrpResults, startPeriod, closedPeriods),
    [mrpResults, startPeriod, closedPeriods],
  );

  const grid = useMemo(() => buildGrid({
    mrpResults, purchaseOrders, materials, suppliers,
    startPeriod, horizonMonths: horizon, projection, runId, seed,
  }), [mrpResults, purchaseOrders, materials, suppliers,
       startPeriod, horizon, projection, runId, seed]);

  const supplierFiltered = useMemo(
    () => supplierFilter === 'all'
      ? grid.rows
      : grid.rows.filter(r => r.supplierId === supplierFilter),
    [grid.rows, supplierFilter],
  );

  const { filtered: rows } = useTableFilters<GridRow>(
    supplierFiltered, ['materialName', 'materialSku', 'supplierName'], {}, searchQuery,
  );

  const supplierOptions = useMemo(() => {
    const ids = new Set(grid.rows.map(r => r.supplierId).filter(Boolean));
    return suppliers.filter(s => ids.has(s.id));
  }, [grid.rows, suppliers]);

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function saveReason(row: GridRow) {
    if (!reasonForm || reasonForm.saving || !reasonForm.notes.trim()) return;
    setReasonForm(f => f ? { ...f, saving: true } : f);
    try {
      const cell = row.cells.find(c => c.periodKey === reasonForm.period);
      const saved = await saveVarianceReason({
        period: reasonForm.period,
        material_id: row.materialId,
        recorded_by: null,
        reason_code: reasonForm.code,
        notes: reasonForm.notes.trim(),
        baseline_qty: cell?.forecastQty ?? 0,
        actual_qty: cell?.actualQty ?? 0,
        variance_qty: (cell?.actualQty ?? 0) - (cell?.forecastQty ?? 0),
      });
      setReasons(prev => [saved, ...prev]);
      setReasonForm(null);
    } catch (e: any) {
      setError(`Could not save reason: ${e.message}`);
      setReasonForm(f => f ? { ...f, saving: false } : f);
    }
  }

  async function removeReason(id: string) {
    try {
      await deleteVarianceReason(id);
      setReasons(prev => prev.filter(r => r.id !== id));
    } catch (e: any) {
      setError(`Could not delete reason: ${e.message}`);
    }
  }

  const hasPlan = grid.periods.some(p => !p.projected);

  const segBtn = (active: boolean) =>
    `h-6 px-2.5 rounded-md text-[10px] font-bold transition ${
      active ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`;

  return (
    <div className="flex flex-col min-h-full bg-surface-1">
      <ContentHeader
        title="RM Forecast vs Actual PO"
        subtitle="What MRP planned to order against what Procurement actually raised"
        actions={
          setSearchQuery ? (
            <SearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search material or supplier…"
            />
          ) : undefined
        }
      />

      <DataStateWrapper
        loading={loading && isFirstLoad}
        error={error}
        isEmpty={false}
        onRetry={() => loadData()}
        emptyMessage=""
      >
        <div className="p-4 lg:p-6 space-y-4">

          {/* Controls */}
          <div className="bg-white rounded-xl border border-slate-200 p-3 flex items-end gap-4 flex-wrap">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">Horizon</p>
              <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
                {[4, 6, 12].map(h => (
                  <button key={h} onClick={() => setHorizon(h)}
                    aria-pressed={horizon === h} className={segBtn(horizon === h)}>
                    {h} months
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Months beyond MRP plan
              </p>
              <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
                {([['band', 'Average ±15%'], ['varied', 'Varied per month'], ['off', 'Hide']] as Array<[ProjectionMode, string]>)
                  .map(([v, t]) => (
                    <button key={v} onClick={() => setProjection(v)}
                      aria-pressed={projection === v} className={segBtn(projection === v)}>
                      {t}
                    </button>
                  ))}
              </div>
            </div>

            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">Supplier</p>
              <select
                value={supplierFilter}
                onChange={e => setSupplierFilter(e.target.value)}
                className="h-7 rounded-lg border border-slate-300 bg-white px-2 text-[11px] font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="all">All suppliers</option>
                {supplierOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            {projection === 'varied' && (
              <button
                onClick={() => setSeed(s => s + 1)}
                className="h-7 px-3 rounded-lg border border-slate-300 bg-white text-[10px] font-bold text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1.5"
                title="Projected figures are stable across page loads; only this button changes them."
              >
                <RefreshCw className="w-3 h-3" /> New scenario
              </button>
            )}

            <div className="ms-auto text-[10px] text-slate-400">
              {rows.length} materials
              {runId && <> · run <span className="font-mono text-slate-600">{runId}</span></>}
            </div>
          </div>

          {!hasPlan && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>
                No MRP run covers this period yet. Run MRP first — every forecast figure
                on this screen comes from planned order releases.
              </p>
            </div>
          )}

          {/* Grid */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <ScrollableTable>
              <table className="min-w-full text-left text-[11px] border-collapse">
                <thead className="bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th rowSpan={2} className="px-3 py-2 border-r border-b border-slate-200 sticky left-0 bg-slate-50 z-20 min-w-[190px]">
                      Material
                    </th>
                    <th rowSpan={2} className="px-3 py-2 border-r border-b border-slate-200 min-w-[110px]">
                      Supplier
                    </th>
                    {grid.periods.map(p => (
                      <th key={p.key} colSpan={3}
                        className={`px-3 py-1.5 text-center border-r border-b border-slate-200 ${
                          p.projected ? 'bg-amber-50/60' : ''}`}>
                        {p.label}
                        <div className="mt-0.5">
                          <span className={`px-1.5 py-px rounded-full border text-[8px] normal-case ${
                            p.projected
                              ? 'bg-amber-100 text-amber-700 border-amber-200'
                              : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                            {p.projected ? 'projected' : 'MRP plan'}
                          </span>
                        </div>
                      </th>
                    ))}
                    <th colSpan={3} className="px-3 py-1.5 text-center border-b border-slate-200 bg-slate-100">
                      Total
                      <div className="mt-0.5">
                        <span className="px-1.5 py-px rounded-full border text-[8px] normal-case bg-slate-200 text-slate-600 border-slate-300">
                          MRP months
                        </span>
                      </div>
                    </th>
                  </tr>
                  <tr>
                    {grid.periods.map(p => (
                      <React.Fragment key={p.key}>
                        <th className={`px-2 py-1.5 text-right border-b border-slate-200 ${p.projected ? 'bg-amber-50/60' : ''}`}>Forecast</th>
                        <th className={`px-2 py-1.5 text-right border-b border-slate-200 ${p.projected ? 'bg-amber-50/60' : ''}`}>{p.projected ? '' : 'Ordered'}</th>
                        <th className={`px-2 py-1.5 text-right border-r border-b border-slate-200 ${p.projected ? 'bg-amber-50/60' : ''}`}>{p.projected ? '±15%' : '%'}</th>
                      </React.Fragment>
                    ))}
                    <th className="px-2 py-1.5 text-right border-b border-slate-200 bg-slate-100">Forecast</th>
                    <th className="px-2 py-1.5 text-right border-b border-slate-200 bg-slate-100">Ordered</th>
                    <th className="px-2 py-1.5 text-right border-b border-slate-200 bg-slate-100">%</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={2 + grid.periods.length * 3 + 3}
                        className="px-4 py-10 text-center text-sm text-slate-400">
                        No materials match.
                      </td>
                    </tr>
                  )}

                  {rows.map(row => (
                    <React.Fragment key={row.materialId}>
                      <tr className="hover:bg-slate-50 transition-colors cursor-pointer"
                        onClick={() => toggle(row.materialId)}>
                        <td className="px-3 py-2 border-r border-slate-200 sticky left-0 bg-white z-10">
                          <div className="flex items-center gap-1.5">
                            {expanded.has(row.materialId)
                              ? <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
                              : <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />}
                            <div className="min-w-0">
                              <div className="font-bold text-slate-900 truncate">{row.materialName}</div>
                              <div className="text-[9px] font-mono text-slate-500">{row.materialSku}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 border-r border-slate-200 text-slate-600">
                          {row.supplierName}
                        </td>

                        {row.cells.map(c => c.projected ? (
                          <React.Fragment key={c.periodKey}>
                            <td className="px-2 py-2 text-right font-mono italic text-slate-500 bg-amber-50/30">
                              {nf(c.forecastQty)}
                            </td>
                            <td className="px-2 py-2 text-right text-slate-300 bg-amber-50/30">—</td>
                            <td className="px-2 py-2 text-right text-[9px] font-mono text-slate-400 border-r border-slate-200 bg-amber-50/30">
                              {c.lowQty !== undefined
                                ? `${nf(c.lowQty)}–${nf(c.highQty!)}`
                                : '±15%'}
                            </td>
                          </React.Fragment>
                        ) : (
                          <React.Fragment key={c.periodKey}>
                            <td className="px-2 py-2 text-right font-mono text-slate-600">
                              {c.forecastQty === 0 ? <span className="text-slate-300">—</span> : nf(c.forecastQty)}
                            </td>
                            <td className="px-2 py-2 text-right font-mono font-bold text-slate-900">
                              {c.actualQty === 0 ? <span className="text-slate-300">—</span> : nf(c.actualQty!)}
                            </td>
                            <td className="px-2 py-2 text-right border-r border-slate-200">
                              <span className={`px-1.5 py-0.5 rounded-[3px] border text-[10px] font-mono font-bold ${pctClass(c.achievementPct, okAt, watchAt)}`}>
                                {c.achievementPct === null ? 'n/a' : `${Math.round(c.achievementPct)}%`}
                              </span>
                            </td>
                          </React.Fragment>
                        ))}

                        <td className="px-2 py-2 text-right font-mono text-slate-600 bg-slate-50">
                          {nf(row.totalForecastQty)}
                        </td>
                        <td className="px-2 py-2 text-right font-mono font-bold text-slate-900 bg-slate-50">
                          {nf(row.totalActualQty)}
                        </td>
                        <td className="px-2 py-2 text-right bg-slate-50">
                          <span className={`px-1.5 py-0.5 rounded-[3px] border text-[10px] font-mono font-bold ${pctClass(row.totalAchievementPct, okAt, watchAt)}`}>
                            {row.totalAchievementPct === null ? 'n/a' : `${Math.round(row.totalAchievementPct)}%`}
                          </span>
                        </td>
                      </tr>

                      {expanded.has(row.materialId) && (
                        <tr className="bg-slate-50/80">
                          <td colSpan={2 + grid.periods.length * 3 + 3} className="px-4 py-3">
                            <div className="space-y-3">
                              <div>
                                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                                  Purchase orders raised
                                </p>
                                <div className="flex flex-wrap gap-3">
                                  {row.cells.filter(c => !c.projected).map(c => (
                                    <div key={c.periodKey} className="text-[10px]">
                                      <span className="text-slate-400">{c.periodLabel}:</span>{' '}
                                      {c.poNumbers.length === 0
                                        ? <span className="text-red-600 font-medium">none</span>
                                        : c.poNumbers.map(n => (
                                            <span key={n} className="ms-1 px-1.5 py-0.5 bg-white border border-slate-200 rounded font-mono">
                                              {n}
                                            </span>
                                          ))}
                                    </div>
                                  ))}
                                </div>
                              </div>

                              <div className="border-t border-slate-200 pt-2">
                                <div className="flex items-center justify-between mb-1.5">
                                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                                    Variance reasons
                                  </p>
                                  {reasonForm?.materialId !== row.materialId && (
                                    <button
                                      onClick={e => {
                                        e.stopPropagation();
                                        const firstReal = row.cells.find(c => !c.projected);
                                        setReasonForm({
                                          key: row.materialId, materialId: row.materialId,
                                          period: firstReal?.periodKey ?? grid.periods[0].key,
                                          code: 'other', notes: '', saving: false,
                                        });
                                      }}
                                      className="text-[10px] font-bold text-brand-600 hover:underline"
                                    >
                                      + Add reason
                                    </button>
                                  )}
                                </div>

                                {reasons.filter(r => r.material_id === row.materialId).map(r => (
                                  <div key={r.id} className="flex items-start gap-2 bg-white rounded-lg border border-slate-200 px-3 py-1.5 mb-1">
                                    <span className="text-[9px] font-bold text-brand-700 bg-brand-50 border border-brand-200 px-1.5 py-0.5 rounded shrink-0">
                                      {VARIANCE_REASON_LABELS[r.reason_code]}
                                    </span>
                                    <span className="text-[11px] text-slate-700 flex-1">{r.notes}</span>
                                    <button onClick={e => { e.stopPropagation(); removeReason(r.id); }}
                                      className="text-[10px] text-slate-400 hover:text-red-600">✕</button>
                                  </div>
                                ))}

                                {reasonForm?.materialId === row.materialId && (
                                  <div className="bg-white rounded-lg border border-brand-200 p-2.5 space-y-2"
                                    onClick={e => e.stopPropagation()}>
                                    <div className="flex gap-2">
                                      <select value={reasonForm.period}
                                        onChange={e => setReasonForm(f => f ? { ...f, period: e.target.value } : f)}
                                        className="h-7 rounded-lg border border-slate-300 px-2 text-[11px]">
                                        {row.cells.filter(c => !c.projected).map(c => (
                                          <option key={c.periodKey} value={c.periodKey}>{c.periodLabel}</option>
                                        ))}
                                      </select>
                                      <select value={reasonForm.code}
                                        onChange={e => setReasonForm(f => f ? { ...f, code: e.target.value as VarianceReasonCode } : f)}
                                        className="h-7 rounded-lg border border-slate-300 px-2 text-[11px] flex-1">
                                        {(Object.entries(VARIANCE_REASON_LABELS) as [VarianceReasonCode, string][])
                                          .map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                                      </select>
                                    </div>
                                    <textarea rows={2} value={reasonForm.notes}
                                      onChange={e => setReasonForm(f => f ? { ...f, notes: e.target.value } : f)}
                                      placeholder="Which supplier, how big the gap, what happens next month…"
                                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-[11px] resize-none focus:outline-none focus:ring-2 focus:ring-brand-500" />
                                    <div className="flex gap-2 justify-end">
                                      <button onClick={() => setReasonForm(null)}
                                        className="h-6 px-2.5 rounded-lg border border-slate-300 text-[10px] font-bold text-slate-600">
                                        Cancel
                                      </button>
                                      <button onClick={() => saveReason(row)}
                                        disabled={reasonForm.saving || !reasonForm.notes.trim()}
                                        className="h-6 px-2.5 rounded-lg bg-brand-600 text-[10px] font-bold text-white disabled:opacity-50">
                                        {reasonForm.saving ? 'Saving…' : 'Save'}
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

                  {/* Totals */}
                  {rows.length > 0 && (
                    <tr className="bg-slate-100 font-bold border-t-2 border-slate-300">
                      <td className="px-3 py-2 border-r border-slate-200 sticky left-0 bg-slate-100 z-10">
                        Total
                      </td>
                      <td className="px-3 py-2 border-r border-slate-200 text-slate-500 font-normal text-[10px]">
                        {supplierFilter === 'all' ? 'All suppliers' : supplierOptions.find(s => s.id === supplierFilter)?.name}
                      </td>
                      {grid.periods.map((p, i) => {
                        const f = rows.reduce((s, r) => s + r.cells[i].forecastQty, 0);
                        const a = rows.reduce((s, r) => s + (r.cells[i].actualQty ?? 0), 0);
                        const pct = p.projected || f <= 0 ? null : (a / f) * 100;
                        return (
                          <React.Fragment key={p.key}>
                            <td className={`px-2 py-2 text-right font-mono ${p.projected ? 'italic text-slate-400 bg-amber-50/30' : 'text-slate-700'}`}>
                              {nf(f)}
                            </td>
                            <td className={`px-2 py-2 text-right font-mono ${p.projected ? 'text-slate-300 bg-amber-50/30' : 'text-slate-900'}`}>
                              {p.projected ? '—' : nf(a)}
                            </td>
                            <td className={`px-2 py-2 text-right border-r border-slate-200 ${p.projected ? 'bg-amber-50/30' : ''}`}>
                              {p.projected ? <span className="text-slate-300 text-[10px]">—</span> : (
                                <span className={`px-1.5 py-0.5 rounded-[3px] border text-[10px] font-mono font-bold ${pctClass(pct, okAt, watchAt)}`}>
                                  {pct === null ? 'n/a' : `${Math.round(pct)}%`}
                                </span>
                              )}
                            </td>
                          </React.Fragment>
                        );
                      })}
                      {(() => {
                        const f = rows.reduce((s, r) => s + r.totalForecastQty, 0);
                        const a = rows.reduce((s, r) => s + r.totalActualQty, 0);
                        const pct = f > 0 ? (a / f) * 100 : null;
                        return (
                          <>
                            <td className="px-2 py-2 text-right font-mono text-slate-700 bg-slate-200">{nf(f)}</td>
                            <td className="px-2 py-2 text-right font-mono text-slate-900 bg-slate-200">{nf(a)}</td>
                            <td className="px-2 py-2 text-right bg-slate-200">
                              <span className={`px-1.5 py-0.5 rounded-[3px] border text-[10px] font-mono font-bold ${pctClass(pct, okAt, watchAt)}`}>
                                {pct === null ? 'n/a' : `${Math.round(pct)}%`}
                              </span>
                            </td>
                          </>
                        );
                      })()}
                    </tr>
                  )}
                </tbody>
              </table>
            </ScrollableTable>
          </div>

          <div className="flex flex-wrap gap-4 text-[10px] text-slate-500">
            <span><strong className="text-slate-700">Forecast</strong> = planned order releases from MRP (lead time already applied)</span>
            <span><strong className="text-slate-700">Ordered</strong> = POs raised in that month</span>
            <span><strong className="text-slate-700">%</strong> = ordered ÷ forecast</span>
            <span className="text-amber-700"><strong>Amber columns</strong> = projected, no MRP plan — excluded from totals</span>
          </div>
        </div>
      </DataStateWrapper>
    </div>
  );
}
