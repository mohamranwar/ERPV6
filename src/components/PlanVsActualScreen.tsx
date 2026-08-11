/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useAsyncLoad, type LoadSignal } from '../hooks/useAsyncLoad';
import { getVPlanVsActual, fetchTableData, getPlanningPeriod, formatPlanningPeriod } from '../supabaseClient';
import { VPlanVsActual, Product, Machine, Channel } from '../types';
import { RefreshCw, AlertCircle, Cpu } from 'lucide-react';
import { useTableFilters } from '../hooks/useTableFilters';
import { useTableSort } from '../hooks/useTableSort';
import SortableHeader from './SortableHeader';
import ChartCard from './charts/ChartCard';
import EmptyState from './EmptyState';
import SearchBar from './SearchBar';
import ScrollableTable from './ScrollableTable';
import ContentHeader from './ContentHeader';
import ErrorState from './ErrorState';
import DataStateWrapper from './DataStateWrapper';
import { toCartons, formatQty, unitLabel, type QtyUnit } from '../utils/uom';

const NEVER_CANCELLED: LoadSignal = { cancelled: false };


interface PlanVsActualScreenProps {
  searchQuery?: string;
  setSearchQuery?: (val: string) => void;
  refreshKey?: number;
}

export default function PlanVsActualScreen({
  searchQuery = '',
  setSearchQuery = () => {},
  refreshKey = 0,
}: PlanVsActualScreenProps) {
  const [activeTab, setActiveTab] = useState<'sales' | 'production' | 'export'>('sales');
  /** Display unit for quantity columns. Achievement % is a ratio and is
      identical in either unit, so it is never converted. */
  const [viewUnit, setViewUnit] = useState<QtyUnit>('pcs');
  const period = getPlanningPeriod();
  const [salesCompare, setSalesCompare] = useState<VPlanVsActual[]>([]);
  const [productionCompare, setProductionCompare] = useState<VPlanVsActual[]>([]);
  const [exportCompare, setExportCompare] = useState<VPlanVsActual[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Machine metrics
  const [machines, setMachines] = useState<Machine[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productionPlans, setProductionPlans] = useState<any[]>([]);
  const [productionActuals, setProductionActuals] = useState<any[]>([]);
  const [machineCompare, setMachineCompare] = useState<any[]>([]);

  const getProductionRate = (lineName: string): number => {
    switch (lineName) {
      case 'SOFY': return 900;
      case 'VOXY': return 600;
      case 'Atlas': return 500;
      case 'Pants': return 600;
      default: return 500;
    }
  };

  async function loadData(signal: LoadSignal = NEVER_CANCELLED) {
    setLoading(true);
    setError(null);
    try {
      const [salesData, prodData, allSalesPlans, allSalesActuals, productsData, machinesData, prodPlans, prodActuals, channelsData] = await Promise.all([
        getVPlanVsActual('sales'),
        getVPlanVsActual('production'),
        fetchTableData<any>('sales_plan'),
        fetchTableData<any>('sales_actual'),
        fetchTableData<Product>('products'),
        fetchTableData<Machine>('machines'),
        fetchTableData<any>('production_plan'),
        fetchTableData<any>('production_actual'),
        fetchTableData<Channel>('channels')
      ]);
      // A newer load has started (or we unmounted). Discard this
      // response rather than writing a stale period into state.
      if (signal.cancelled) return;

      // Resolve the Export channel by name rather than a hardcoded id - the
      // literal 'C4' would silently start returning all-zero rows if that
      // channel's id ever changed in master data.
      const exportChannelId = channelsData.find(c => c.name === 'Export Global')?.id;

      setSalesCompare(salesData);
      setProductionCompare(prodData);
      setProducts(productsData);
      setMachines(machinesData);
      setProductionPlans(prodPlans);
      setProductionActuals(prodActuals);

      // Compute Machine Compare stats
      const computedMachineCompare = machinesData.map(mac => {
        const mProducts = productsData.filter(p => p.product_line === mac.name);
        const speed = getProductionRate(mac.name);
        const availableHours = mac.monthly_capacity ? (mac.monthly_capacity / speed) : 600;

        let plannedHours = 0;
        let actualHours = 0;
        // Volumes as well as hours. Cartons are accumulated per product, since
        // each SKU has its own pack configuration — a machine total cannot be
        // converted with a single divisor.
        let plannedPcs = 0;
        let actualPcs = 0;
        let plannedCtn = 0;
        let actualCtn = 0;
        let cartonsDerivable = true;

        mProducts.forEach(p => {
          const planQty = prodPlans
            .filter(pl => pl.product_id === p.id && pl.period_start === period)
            .reduce((sum, pl) => sum + pl.quantity, 0);
          plannedHours += planQty / speed;
          plannedPcs += planQty;

          const actualQty = prodActuals
            .filter(ac => ac.product_id === p.id && ac.period_start === period)
            .reduce((sum, ac) => sum + ac.quantity, 0);
          actualHours += actualQty / speed;
          actualPcs += actualQty;

          const planCtn = toCartons(planQty, p);
          const actCtn = toCartons(actualQty, p);
          if (planCtn === null || actCtn === null) {
            // One unconfigured SKU makes the machine's carton total incomplete,
            // so the card says so rather than reporting a partial sum as if it
            // were the whole.
            cartonsDerivable = false;
          } else {
            plannedCtn += planCtn;
            actualCtn += actCtn;
          }
        });

        const plannedUtil = availableHours > 0 ? (plannedHours / availableHours) * 100 : 0;
        const actualUtil = availableHours > 0 ? (actualHours / availableHours) * 100 : 0;

        return {
          id: mac.id,
          name: mac.name,
          description: mac.description,
          available_hours: parseFloat(availableHours.toFixed(1)),
          planned_hours: parseFloat(plannedHours.toFixed(1)),
          actual_hours: parseFloat(actualHours.toFixed(1)),
          planned_util: parseFloat(plannedUtil.toFixed(1)),
          actual_util: parseFloat(actualUtil.toFixed(1)),
          variance_hours: parseFloat((actualHours - plannedHours).toFixed(1)),
          planned_pcs: Math.round(plannedPcs),
          actual_pcs: Math.round(actualPcs),
          variance_pcs: Math.round(actualPcs - plannedPcs),
          planned_ctn: cartonsDerivable ? parseFloat(plannedCtn.toFixed(1)) : null,
          actual_ctn: cartonsDerivable ? parseFloat(actualCtn.toFixed(1)) : null,
          cartons_derivable: cartonsDerivable,
          // Volume achievement, distinct from hours utilisation: a line can be
          // at 100% of its hours and still short of its planned volume.
          volume_achievement: plannedPcs > 0
            ? parseFloat(((actualPcs / plannedPcs) * 100).toFixed(1))
            : null,
        };
      });

      setMachineCompare(computedMachineCompare);

      // Compute export comparisons (channel resolved by name above, not hardcoded)
      const exportRows: VPlanVsActual[] = productsData.map(p => {
        const pPlans = allSalesPlans.filter(s => s.product_id === p.id && s.channel_id === exportChannelId && s.period_start === period);
        const pActuals = allSalesActuals.filter(s => s.product_id === p.id && s.channel_id === exportChannelId && s.period_start === period);

        const plan_qty = pPlans.reduce((sum, s) => sum + s.quantity, 0);
        const actual_qty = pActuals.reduce((sum, s) => sum + s.quantity, 0);
        const variance_qty = actual_qty - plan_qty;
        // No plan means there is nothing to achieve against - see getVPlanVsActual.
        const achievement_percent = plan_qty > 0 ? (actual_qty / plan_qty) * 100 : null;

        return {
          item_id: p.id,
          item_name: p.name,
          sku: p.sku,
          period: period.slice(0, 7),
          plan_qty,
          actual_qty,
          variance_qty,
          achievement_percent: achievement_percent === null ? null : parseFloat(achievement_percent.toFixed(1))
        };
      });

      setExportCompare(exportRows);
    } catch (e) {
      if (signal.cancelled) return;
      setError(e instanceof Error ? e.message : String(e));
      console.error("Failed to load plan vs actual comparison datasets", e);
    } finally {
      if (!signal.cancelled) { setLoading(false); setHasLoadedOnce(true); }
    }
  }

  useAsyncLoad(loadData, [refreshKey]);

  const activeDataset = useMemo((): VPlanVsActual[] => {
    if (activeTab === 'sales') return salesCompare;
    if (activeTab === 'production') return productionCompare;
    return exportCompare;
  }, [activeTab, salesCompare, productionCompare, exportCompare]);

  /**
   * Chart cube.
   *
   * This screen reports a SINGLE period, so the categories are items, not
   * months. An earlier version passed the SKUs in as `periods` and a lone
   * "Plan vs actual" string as the series, which made the row/column swap
   * collapse all twelve bars into one meaningless total -- and labelled the
   * item axis "Months". Items are now the series, so the swap is coherent and
   * the axis control is hidden rather than offering a transpose that cannot
   * mean anything with one period.
   *
   * Top 12 by planned volume: a bar chart over 96 SKUs is unreadable at any
   * size, and the long tail is exactly what the table below is for.
   */
  const chartCube = useMemo(() => {
    const top = [...activeDataset]
      .sort((a, b) => b.plan_qty - a.plan_qty)
      .slice(0, 12);
    return {
      periods: [formatPlanningPeriod(period)],
      seriesNames: top.map(d => d.sku || d.item_name),
      plan: top.map(d => [d.plan_qty]),
      actual: top.map(d => [d.actual_qty]),
    };
  }, [activeDataset, period]);

  const getAchievementColor = (pct: number | null) => {
    if (pct === null) return 'text-slate-500 bg-slate-100 border-slate-200';
    if (pct >= 100) return 'text-emerald-700 bg-emerald-100 border-emerald-200';
    if (pct >= 85) return 'text-amber-700 bg-amber-100 border-amber-200';
    return 'text-red-700 bg-red-100 border-red-200';
  };

  // Filtration using useTableFilters hook
  const { filtered: filteredData, hasActiveSearch } = useTableFilters<VPlanVsActual>(
    activeDataset,
    ['item_name', 'sku'],
    {},
    searchQuery,
    setSearchQuery
  );

  const { sortedItems, sortConfig, handleSort } = useTableSort(filteredData, 'sku');

  /** Product lookup for pack configuration, keyed by the row's item_id. */
  const productById = useMemo(() => {
    const m = new Map<string, Product>();
    products.forEach(p => m.set(p.id, p));
    return m;
  }, [products]);

  return (
    <div className="space-y-6" id="plan_vs_actual_screen">
      <ContentHeader
        title="Plan vs Actual Analytics"
        actions={
          <div className="flex items-center gap-1.5 bg-slate-100 p-0.5 rounded-lg" id="pva_tab_selector">
            {(['sales', 'production', 'export'] as const).map(tab => (
              <button
                key={tab}
                id={`pva_tab_btn_${tab}`}
                onClick={() => { setActiveTab(tab); setSearchQuery(''); }}
                className={`px-3 py-1.5 text-xs font-bold rounded-md capitalize flex items-center gap-1.5 transition-colors cursor-pointer ${
                  activeTab === tab ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab === 'export' ? 'Export Shipments' : `${tab} Plan`}
              </button>
            ))}
          </div>
        }
      />

      <ErrorState error={error} onRetry={loadData} />

      {/* Stats Summary Cards for the active planning period */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card-elevated p-5 space-y-1">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Overall Plan Target</span>
          <h4 className="text-xl font-bold text-slate-900 font-mono">
            {activeDataset.reduce((sum, d) => sum + d.plan_qty, 0).toLocaleString()} <span className="text-xs text-slate-400 font-sans">units</span>
          </h4>
        </div>
        <div className="card-elevated p-5 space-y-1">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Overall Actual Achieved</span>
          <h4 className="text-xl font-bold text-slate-900 font-mono">
            {activeDataset.reduce((sum, d) => sum + d.actual_qty, 0).toLocaleString()} <span className="text-xs text-slate-400 font-sans">units</span>
          </h4>
        </div>
        <div className="card-elevated p-5 space-y-1">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Variance & Achievement Rate</span>
          {(() => {
            const plan = activeDataset.reduce((sum, d) => sum + d.plan_qty, 0);
            const act = activeDataset.reduce((sum, d) => sum + d.actual_qty, 0);
            const varQty = act - plan;
            // No plan means there is no ratio to report. This previously
            // returned 100, so a selection with nothing planned showed a
            // perfect achievement rate on the summary card -- the most
            // reassuring number available, for the least informative state.
            // Line 152 already gets this right by returning null.
            const ach = plan > 0 ? (act / plan) * 100 : null;
            return (
              <div className="flex items-center gap-2">
                <h4 className="text-xl font-bold text-slate-900 font-mono">
                  {ach === null ? '\u2014' : `${ach.toFixed(1)}%`}
                </h4>
                <span className={`text-xs px-2 py-0.5 rounded-sm font-semibold ${varQty >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                  {varQty >= 0 ? '+' : ''}{varQty.toLocaleString()}
                </span>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200 font-sans">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search items by name or SKU..."
          className="flex-1 max-w-sm"
          hasActiveSearch={hasActiveSearch}
        />

        <div className="flex items-center gap-1.5 text-xs text-brand-800 bg-brand-50 px-3 py-1.5 rounded-lg border border-brand-100 ml-auto">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span><b>Target Period:</b> {formatPlanningPeriod(period)}</span>
        </div>

        <button onClick={loadData} aria-label="Refresh data" className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors cursor-pointer" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {!loading && activeDataset.length > 0 && (
        <ChartCard
          chartId={`plan-vs-actual-${activeTab}`}
          title={`${activeTab === 'sales' ? 'Sales' : activeTab === 'production' ? 'Production' : 'Export'} — plan vs actual`}
          subtitle={`Top 12 by planned volume · ${formatPlanningPeriod(period)} · units`}
          periods={chartCube.periods}
          seriesNames={chartCube.seriesNames}
          plan={chartCube.plan}
          actual={chartCube.actual}
          unit="units"
          precision={0}
          seriesLabel="Items"
          fixedAxis="series"
          className="mb-4"
        />
      )}

      {(loading && !hasLoadedOnce) ? (
        <div className="flex justify-center items-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600"></div>
        </div>
      ) : (
        <div className="space-y-6">
          {activeTab === 'production' && (
            <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4 font-sans">
              <div className="flex items-center gap-2">
                <Cpu className="w-5 h-5 text-brand-600 shrink-0" />
                <div>
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Machine Capacity & Hours Utilization Control Tower</h3>
                  <p className="text-[10px] text-slate-500">Maps production volumes to actual machine hours based on standard line speeds compared to available capacity limits.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                {machineCompare.map(mac => {
                  const isOverloaded = mac.actual_util > 95;
                  return (
                    <div key={mac.id} className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-slate-800 uppercase tracking-tight">{mac.name} Line</span>
                          <span className={`text-[10px] font-mono font-bold px-1 rounded ${isOverloaded ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            {mac.actual_util}%
                          </span>
                        </div>
                        <p className="text-[9px] text-slate-400 font-sans line-clamp-1">{mac.description}</p>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                          <span>Avail:</span>
                          <span className="font-bold">{mac.available_hours} hrs</span>
                        </div>
                        <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                          <span>Planned:</span>
                          <span className="font-bold text-brand-600">{mac.planned_hours} hrs ({mac.planned_util}%)</span>
                        </div>
                        <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                          <span>Actual:</span>
                          <span className={`font-bold ${isOverloaded ? 'text-red-600' : 'text-slate-800'}`}>{mac.actual_hours} hrs</span>
                        </div>
                      </div>

                      {/* Volume, in both units. Hours utilisation alone can sit
                          at 100% while the line is short of its planned volume,
                          so the two are shown separately. */}
                      <div className="border-t border-slate-200 pt-1.5 space-y-1">
                        <div className="flex justify-between text-[9px] font-mono">
                          <span className="text-slate-500">Plan:</span>
                          <span className="font-bold text-slate-700">
                            {mac.planned_pcs.toLocaleString()} PCS
                            {mac.cartons_derivable && <span className="text-slate-400"> · {mac.planned_ctn.toLocaleString()} CTN</span>}
                          </span>
                        </div>
                        <div className="flex justify-between text-[9px] font-mono">
                          <span className="text-slate-500">Made:</span>
                          <span className="font-bold text-emerald-700">
                            {mac.actual_pcs.toLocaleString()} PCS
                            {mac.cartons_derivable && <span className="text-emerald-600/70"> · {mac.actual_ctn.toLocaleString()} CTN</span>}
                          </span>
                        </div>
                        <div className="flex justify-between text-[9px] font-mono">
                          <span className="text-slate-500">Volume ach.:</span>
                          <span className={`font-bold ${
                            mac.volume_achievement === null ? 'text-slate-400'
                            : mac.volume_achievement >= 95 ? 'text-emerald-700'
                            : mac.volume_achievement >= 80 ? 'text-amber-600' : 'text-red-600'
                          }`}>
                            {mac.volume_achievement === null ? 'no plan' : `${mac.volume_achievement}%`}
                          </span>
                        </div>
                        {!mac.cartons_derivable && (
                          <p className="text-[8.5px] text-amber-600 font-semibold">
                            Cartons unavailable — a SKU on this line has no pack config
                          </p>
                        )}
                      </div>

                      <div className="w-full bg-slate-200 h-1 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full transition-all ${
                            isOverloaded ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'
                          }`}
                          style={{ width: `${Math.min(100, mac.actual_util)}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs font-sans">
            <div className="p-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">
                {activeTab === 'sales' ? 'SKU Sales Demand Achievement' : activeTab === 'export' ? 'SKU Export Orders Variance' : 'SKU Production Volume Achievement'}
              </h3>
              {/* Quantities in either unit. Achievement % is unit-independent,
                  so it is unaffected by the toggle. */}
              <div className="flex bg-white rounded-lg border border-slate-300 p-0.5">
                {(['pcs', 'cartons'] as QtyUnit[]).map(u => (
                  <button
                    key={u}
                    onClick={() => setViewUnit(u)}
                    className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-colors cursor-pointer ${
                      viewUnit === u ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {unitLabel(u)}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <ScrollableTable>
                <table className="min-w-full text-left text-[11px] border-collapse">
                  <thead className="bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                    <tr>
                      <SortableHeader label="Item (Name & SKU)" sortKey="item_name" sortConfig={sortConfig} onSort={handleSort} className="px-3 py-2 border-r border-slate-200" />
                      <SortableHeader label="Plan Quantity" sortKey="plan_qty" sortConfig={sortConfig} onSort={handleSort} align="right" className="px-3 py-2 border-r border-slate-200" />
                      <SortableHeader label="Actual Volume" sortKey="actual_qty" sortConfig={sortConfig} onSort={handleSort} align="right" className="px-3 py-2 border-r border-slate-200" />
                      <SortableHeader label="Variance Balance" sortKey="variance_qty" sortConfig={sortConfig} onSort={handleSort} align="right" className="px-3 py-2 border-r border-slate-200" />
                      <SortableHeader label="Achievement %" sortKey="achievement_percent" sortConfig={sortConfig} onSort={handleSort} align="right" className="px-3 py-2 border-r border-slate-200" />
                      <th className="px-3 py-2 min-w-[120px]">Gauge</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-900">
                    {sortedItems.map(d => {
                      const isPositive = d.variance_qty >= 0;
                      const prod = productById.get(d.item_id) ?? null;
                      // Achievement % is a ratio and therefore identical in
                      // either unit; only the quantities are converted.
                      const q = (n: number) => formatQty(n, prod, viewUnit);

                      return (
                        <tr key={d.item_id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-3 py-2 border-r border-slate-200">
                            <div className="font-bold text-slate-900">{d.item_name}</div>
                            <div className="text-[10px] font-mono text-slate-500 font-medium">{d.sku}</div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-slate-600 border-r border-slate-200">
                            {q(d.plan_qty)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-extrabold text-slate-900 border-r border-slate-200">
                            {q(d.actual_qty)}
                          </td>
                          <td className={`px-3 py-2 text-right font-mono font-bold border-r border-slate-200 ${
                            isPositive ? 'text-emerald-600' : 'text-red-600'
                          }`}>
                            {(() => {
                              const mag = q(Math.abs(d.variance_qty));
                              if (mag === 'n/a') return 'n/a';
                              return `${isPositive ? '+' : '−'}${mag}`;
                            })()}
                          </td>
                          <td className="px-3 py-2 text-right border-r border-slate-200">
                            <span className={`px-1.5 py-0.5 rounded-[3px] border text-[10px] font-mono font-bold ${getAchievementColor(d.achievement_percent)}`}>
                              {d.achievement_percent === null ? 'No plan' : `${d.achievement_percent}%`}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                              {d.achievement_percent !== null && (
                                <div
                                  className={`h-full rounded-full ${
                                    d.achievement_percent >= 100 ? 'bg-emerald-500' :
                                    d.achievement_percent >= 85 ? 'bg-amber-500' : 'bg-red-500'
                                  }`}
                                  style={{ width: `${Math.min(100, d.achievement_percent)}%` }}
                                ></div>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {sortedItems.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-3 py-8">
                          <EmptyState
                            title="No Items Found"
                            message="No items match your active search filter."
                          />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </ScrollableTable>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
