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
  type GridRow, type ProjectionMode, type Grain,
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

  const [grain, setGrain] = useState<Grain>('month');
  const [horizon, setHorizon] = useState(6);
  const [projection, setProjection] = useState<ProjectionMode>('band');
  const [seed, setSeed] = useState(1);
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reasonForm, setReasonForm] = useState<{
    key: string; materialId: string; period: string;
    code: VarianceReasonCode; notes: string; saving: boolean;
  } | null>(null);

  const { isFirstLoad, markLoaded } = useFirstLoad('rm_forecast_variance');
  const { settings } = useAppSettings();
  const okAt = settings.thresholds.attainment_ok;
  const watchAt = settings.thresholds.attainment_watch;

  // Monthly columns start at the month; weekly columns must start on a real
  // date, because the week buckets step 7 days from it.
  const startPeriod = grain === 'month'
    ? getPlanningPeriod()
    : `${getPlanningPeriod().slice(0, 7)}-01`;

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
    startPeriod, horizonMonths: horizon, projection, runId, seed, grain,
  }), [mrpResults, purchaseOrders, materials, suppliers,
       startPeriod, horizon, projection, runId, seed, grain]);

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

  // The list keeps a selection at all times once data exists, so the detail
  // pane is never blank on arrival. Falling back to the first row rather than
  // holding a stale id matters when a filter removes whatever was selected.
  const selected = rows.find(r => r.materialId === selectedId) ?? rows[0] ?? null;

  /** Worst achievement across the real months -- what the list dot reflects. */
  const worstPct = (r: GridRow): number | null => {
    const real = r.cells.filter(c => !c.projected && c.achievementPct !== null);
    if (!real.length) return null;
    return Math.min(...real.map(c => c.achievementPct as number));
  };

  const dotClass = (pct: number | null) =>
    pct === null ? 'bg-slate-300'
    : pct >= okAt ? 'bg-emerald-500'
    : pct >= watchAt ? 'bg-amber-500'
    : 'bg-red-500';

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
        <div className="p-4 lg:p-6 space-y-3">

          {/* Controls */}
          <div className="bg-white rounded-xl border border-slate-200 p-3 flex items-end gap-4 flex-wrap">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">Grain</p>
              <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
                {([['month', 'Month'], ['week', 'Week']] as Array<[Grain, string]>).map(([v, t]) => (
                  <button key={v}
                    onClick={() => { setGrain(v); setHorizon(v === 'month' ? 6 : 8); }}
                    aria-pressed={grain === v} className={segBtn(grain === v)}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">Horizon</p>
              <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
                {(grain === 'month' ? [4, 6, 12] : [8, 13, 26]).map(h => (
                  <button key={h} onClick={() => setHorizon(h)}
                    aria-pressed={horizon === h} className={segBtn(horizon === h)}>
                    {h} {grain === 'month' ? 'months' : 'weeks'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                {grain === 'month' ? 'Months' : 'Weeks'} beyond MRP plan
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
                No {grain === 'month' ? 'monthly' : 'weekly'} MRP run covers this period.
                Run MRP at {grain} grain first — every forecast figure here comes from
                planned order releases, and a run executed at a different grain will not
                line up with these columns.
              </p>
            </div>
          )}

          {/*
            Master–detail rather than one very wide grid.

            The grid put every month across the page, so reading a single
            material meant scrolling sideways and losing the row you were on.
            Here the list stays fixed while the detail pane carries the
            month-by-month breakdown at a size that can actually be read, and
            the reason capture gets room instead of being squeezed into an
            expanded table row spanning twenty columns.
          */}
          <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-3 items-start">

            {/* ── Master list ─────────────────────────────────────────── */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                  Materials
                </span>
                <span className="text-[9px] font-bold text-slate-400">
                  {rows.filter(r => {
                    const w = worstPct(r);
                    return w !== null && w < watchAt;
                  }).length} off plan
                </span>
              </div>

              <div className="max-h-[560px] overflow-y-auto divide-y divide-slate-100">
                {rows.length === 0 && (
                  <p className="px-3 py-6 text-center text-xs text-slate-400">No materials match.</p>
                )}
                {rows.map(r => {
                  const w = worstPct(r);
                  const active = selected?.materialId === r.materialId;
                  return (
                    <button
                      key={r.materialId}
                      onClick={() => setSelectedId(r.materialId)}
                      aria-current={active}
                      className={`w-full text-start px-3 py-2 flex items-center gap-2 transition-colors ${
                        active ? 'bg-brand-50 border-s-2 border-brand-600' : 'border-s-2 border-transparent hover:bg-slate-50'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass(w)}`} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[11px] font-semibold text-slate-900 truncate">
                          {r.materialName}
                        </span>
                        <span className="block text-[9px] font-mono text-slate-400">{r.materialSku}</span>
                      </span>
                      <span className={`text-[10px] font-mono font-bold shrink-0 ${
                        w === null ? 'text-slate-400'
                        : w >= okAt ? 'text-emerald-700'
                        : w >= watchAt ? 'text-amber-700' : 'text-red-700'
                      }`}>
                        {w === null ? 'n/a' : `${Math.round(w)}%`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Detail pane ─────────────────────────────────────────── */}
            {selected ? (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 flex items-start gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-slate-900">{selected.materialName}</h3>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      <span className="font-mono">{selected.materialSku}</span>
                      {' · '}{selected.supplierName}
                    </p>
                  </div>
                  <span className="ms-auto">
                    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-mono font-bold ${
                      pctClass(selected.totalAchievementPct, okAt, watchAt)}`}>
                      {selected.totalAchievementPct === null
                        ? 'n/a' : `${Math.round(selected.totalAchievementPct)}% overall`}
                    </span>
                  </span>
                </div>

                {/* Headline figures */}
                <div className="px-4 py-3 grid grid-cols-3 gap-4 border-b border-slate-100">
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Forecast</p>
                    <p className="text-lg font-bold font-mono text-slate-900">{nf(selected.totalForecastQty)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Ordered</p>
                    <p className="text-lg font-bold font-mono text-slate-900">{nf(selected.totalActualQty)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Gap</p>
                    <p className={`text-lg font-bold font-mono ${
                      selected.totalActualQty - selected.totalForecastQty < 0 ? 'text-red-600'
                      : selected.totalActualQty - selected.totalForecastQty > 0 ? 'text-emerald-700'
                      : 'text-slate-400'}`}>
                      {selected.totalActualQty === selected.totalForecastQty ? '0'
                        : `${selected.totalActualQty > selected.totalForecastQty ? '+' : '−'}${
                            nf(Math.abs(selected.totalActualQty - selected.totalForecastQty))}`}
                    </p>
                  </div>
                </div>

                {/* Period breakdown — vertical, so it reads without sideways scrolling */}
                <ScrollableTable>
                  <table className="min-w-full text-[11px]">
                    <thead className="bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                      <tr>
                        <th className="px-3 py-2 text-start border-b border-slate-200">
                          {grain === 'month' ? 'Month' : 'Week'}
                        </th>
                        <th className="px-3 py-2 text-end border-b border-slate-200">Forecast</th>
                        <th className="px-3 py-2 text-end border-b border-slate-200">Ordered</th>
                        <th className="px-3 py-2 text-end border-b border-slate-200">%</th>
                        <th className="px-3 py-2 text-start border-b border-slate-200">Purchase orders</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selected.cells.map(c => (
                        <tr key={c.periodKey} className={c.projected ? 'bg-amber-50/40' : ''}>
                          <td className="px-3 py-2 font-semibold text-slate-900">
                            {c.periodLabel}
                            {c.projected && (
                              <span className="ms-1.5 px-1.5 py-px rounded-full border border-amber-200 bg-amber-100 text-amber-700 text-[8px] font-bold">
                                projected
                              </span>
                            )}
                          </td>
                          <td className={`px-3 py-2 text-end font-mono ${c.projected ? 'italic text-slate-500' : 'text-slate-600'}`}>
                            {nf(c.forecastQty)}
                          </td>
                          <td className="px-3 py-2 text-end font-mono font-bold text-slate-900">
                            {c.projected ? <span className="text-slate-300">—</span>
                              : c.actualQty === 0 ? <span className="text-slate-300">—</span>
                              : nf(c.actualQty as number)}
                          </td>
                          <td className="px-3 py-2 text-end">
                            {c.projected ? (
                              <span className="text-[9px] font-mono text-slate-400">
                                {c.lowQty !== undefined ? `${nf(c.lowQty)}–${nf(c.highQty as number)}` : '±15%'}
                              </span>
                            ) : (
                              <span className={`px-1.5 py-0.5 rounded-[3px] border text-[10px] font-mono font-bold ${
                                pctClass(c.achievementPct, okAt, watchAt)}`}>
                                {c.achievementPct === null ? 'n/a' : `${Math.round(c.achievementPct)}%`}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {c.projected ? <span className="text-slate-300 text-[10px]">—</span>
                              : c.poNumbers.length === 0
                                ? <span className="text-[10px] text-red-600 font-medium">none raised</span>
                                : (
                                  <span className="flex flex-wrap gap-1">
                                    {c.poNumbers.map(n => (
                                      <span key={n} className="px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded text-[9px] font-mono text-slate-700">
                                        {n}
                                      </span>
                                    ))}
                                  </span>
                                )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollableTable>

                {/* Variance reasons */}
                <div className="px-4 py-3 border-t border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                      Variance reasons
                    </p>
                    {reasonForm?.materialId !== selected.materialId && (
                      <button
                        onClick={() => {
                          const firstReal = selected.cells.find(c => !c.projected);
                          setReasonForm({
                            key: selected.materialId, materialId: selected.materialId,
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

                  {reasons.filter(r => r.material_id === selected.materialId).map(r => (
                    <div key={r.id} className="flex items-start gap-2 bg-slate-50 rounded-lg border border-slate-200 px-3 py-1.5">
                      <span className="text-[9px] font-bold text-brand-700 bg-brand-50 border border-brand-200 px-1.5 py-0.5 rounded shrink-0">
                        {VARIANCE_REASON_LABELS[r.reason_code]}
                      </span>
                      <span className="text-[11px] text-slate-700 flex-1">{r.notes}</span>
                      <button onClick={() => removeReason(r.id)}
                        className="text-[10px] text-slate-400 hover:text-red-600">✕</button>
                    </div>
                  ))}

                  {reasons.filter(r => r.material_id === selected.materialId).length === 0
                    && reasonForm?.materialId !== selected.materialId && (
                    <p className="text-[10px] text-slate-400 italic">
                      None recorded. A gap without a reason gets re-asked every month.
                    </p>
                  )}

                  {reasonForm?.materialId === selected.materialId && (
                    <div className="bg-white rounded-lg border border-brand-200 p-2.5 space-y-2">
                      <div className="flex gap-2">
                        <select value={reasonForm.period}
                          onChange={e => setReasonForm(f => f ? { ...f, period: e.target.value } : f)}
                          className="h-7 rounded-lg border border-slate-300 px-2 text-[11px]">
                          {selected.cells.filter(c => !c.projected).map(c => (
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
                        <button onClick={() => saveReason(selected)}
                          disabled={reasonForm.saving || !reasonForm.notes.trim()}
                          className="h-6 px-2.5 rounded-lg bg-brand-600 text-[10px] font-bold text-white disabled:opacity-50">
                          {reasonForm.saving ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-400">
                No material selected.
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-4 text-[10px] text-slate-500">
            <span><strong className="text-slate-700">Forecast</strong> = planned order releases from MRP (lead time already applied)</span>
            <span><strong className="text-slate-700">Ordered</strong> = POs raised in that {grain}</span>
            <span><strong className="text-slate-700">%</strong> = ordered ÷ forecast</span>
            <span className="text-amber-700"><strong>Amber rows</strong> = projected, no MRP plan — excluded from totals</span>
          </div>
        </div>
      </DataStateWrapper>
    </div>
  );
}
