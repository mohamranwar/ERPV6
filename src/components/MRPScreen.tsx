/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  fetchTableData,
  runMRP,
  saveRecord,
  getPlanningPeriod,
  getSafetyStockMonths,
  SAFETY_SERVICE_FACTOR,
  MS_PER_DAY,
  toDateStr,
  fetchClosedPeriods,
  closePlanningPeriod
} from '../supabaseClient';
import { Material, Supplier, PurchaseOrder, MRPResult, SubstitutionProposal, ClosedPeriod } from '../types';
import {
  Play, Calendar, ClipboardCheck, LayoutGrid, ListTodo, ShoppingBag,
  ShieldAlert, CheckCircle2, Truck, Plus, X, Info, ChevronDown, ChevronRight, Repeat,
  Eye, EyeOff, AlertTriangle, Layers, ArrowUpDown, Filter, HelpCircle, Package, DollarSign, Lock, Sparkles
} from 'lucide-react';

/**
 * Cell styling for a projected stock figure against its safety level.
 * Red once the buffer is breached, amber while it is within 15% of it -
 * that band is the window where a planner can still act before it bites.
 */
function stockCellClass(projected: number, safetyStock: number): string {
  if (safetyStock <= 0) return 'text-blue-700';
  if (projected < safetyStock) return 'text-red-600 bg-red-50/60';
  if (projected < safetyStock * 1.15) return 'text-amber-700 bg-amber-50/50';
  return 'text-blue-700';
}
import { useToast } from '../context/ToastConfirmContext';
import { useAuth } from '../context/AuthContext';
import { useTableFilters } from '../hooks/useTableFilters';
import { useFocusTrap } from '../hooks/useFocusTrap';
import SearchBar from './SearchBar';
import ScrollableTable from './ScrollableTable';
import ContentHeader from './ContentHeader';
import { KpiCard } from './ui';
import { CURRENCY } from '../utils/uom';
import ErrorState from './ErrorState';
import DataStateWrapper from './DataStateWrapper';
import WhatIfSimulator from './WhatIfSimulator';

interface MRPScreenProps {
  searchQuery?: string;
  setSearchQuery?: (val: string) => void;
  onNavigate?: (screen: any) => void;
  refreshKey?: number;
}

export default function MRPScreen({
  searchQuery = '',
  setSearchQuery = () => {},
  onNavigate,
  refreshKey = 0
}: MRPScreenProps) {
  const { showToast } = useToast();
  const { hasRole } = useAuth();
  
  const [materials, setMaterials] = useState<Material[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [mrpResults, setMrpResults] = useState<MRPResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWhatIf, setShowWhatIf] = useState(false);

  // MRP Run Input States. The run starts from the period selected in the app
  // header, so the MRP and every other screen describe the same window.
  const [startDate, setStartDate] = useState(() => getPlanningPeriod());
  
  // Persist grain and horizon to localStorage
  const [grain, setGrain] = useState<'day' | 'week' | 'month'>(() => {
    return (localStorage.getItem('mrp_grain') as 'day' | 'week' | 'month') || 'month';
  });
  const [horizon, setHorizon] = useState<number>(() => {
    const saved = localStorage.getItem('mrp_horizon');
    if (saved) return Number(saved);
    return grain === 'month' ? 4 : grain === 'week' ? 8 : 14;
  });

  const [mrpRunId, setMrpRunId] = useState<string | null>(null);

  // Closed Periods / Archives State
  const [closedPeriods, setClosedPeriods] = useState<ClosedPeriod[]>([]);
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [closeNotes, setCloseNotes] = useState('');

  // Tab State
  const [activeTab, setActiveTab] = useState<'grid' | 'orders' | 'po_board' | 'subs'>('grid');

  // Substitution proposals come back with the run rather than being stored, so
  // they live alongside the run rather than in the results table.
  const [substitutions, setSubstitutions] = useState<SubstitutionProposal[]>([]);

  // Filters
  const [filterController, setFilterController] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');

  // PO Modal State
  const [poModalData, setPoModalData] = useState<{
    material: Material;
    supplier: Supplier;
    qty: number;
    requiredDate: string;
    suggestedReleaseDate: string;
  } | null>(null);

  // Persist settings
  useEffect(() => {
    localStorage.setItem('mrp_grain', grain);
  }, [grain]);

  useEffect(() => {
    localStorage.setItem('mrp_horizon', String(horizon));
  }, [horizon]);

  async function loadData(selectLatestRun = false) {
    setLoading(true);
    setError(null);
    try {
      const [mats, sups, pos, results, closed] = await Promise.all([
        fetchTableData<Material>('materials'),
        fetchTableData<Supplier>('suppliers'),
        fetchTableData<PurchaseOrder>('purchase_orders'),
        fetchTableData<MRPResult>('mrp_results'),
        fetchClosedPeriods()
      ]);
      setMaterials(mats);
      setSuppliers(sups);
      setPurchaseOrders(pos);
      setMrpResults(results);
      setClosedPeriods(closed);

      // Unique runs
      const uniqueRuns = Array.from(new Set(results.map(r => r.run_id)));
      if (uniqueRuns.length > 0) {
        if (selectLatestRun || !mrpRunId || !uniqueRuns.includes(mrpRunId)) {
          setMrpRunId(uniqueRuns[0]);
        }
      }
    } catch (e: any) {
      setError(e instanceof Error ? e.message : String(e));
      showToast('Failed to load MRP data: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // A period change in the header bumps refreshKey; follow it so the next
    // solver run covers the window the rest of the app is showing.
    setStartDate(getPlanningPeriod());
    loadData();
  }, [refreshKey]);

  const handleRunMRP = async () => {
    setLoading(true);
    try {
      const { run_id, substitutions: subs } = await runMRP(startDate, horizon, grain);
      setSubstitutions(subs);
      setMrpRunId(run_id);
      await loadData(true);
      showToast(`MRP completed successfully! Run ID: ${run_id}`, 'success');
    } catch (err: any) {
      showToast("MRP execution failed: " + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleClosePeriod = async () => {
    if (!mrpRunId) {
      showToast('No active MRP run to close.', 'error');
      return;
    }
    try {
      await closePlanningPeriod({
        period: startDate,
        run_id: mrpRunId,
        closed_by: 'Planner User',
        grain,
        horizon,
        notes: closeNotes,
        total_materials: totalMaterialsCount,
        at_risk_count: atRiskCount,
        planned_value: totalPlannedValue
      });
      showToast(`Period (${startDate}) closed & archived successfully!`, 'success');
      setIsCloseModalOpen(false);
      setCloseNotes('');
      await loadData();
    } catch (err: any) {
      showToast('Failed to close period: ' + err.message, 'error');
    }
  };

  // Unique runs with date info and closed period tags
  const runOptions = useMemo(() => {
    const closedRunIds = new Set(closedPeriods.map(c => c.run_id));
    return Array.from(new Set(mrpResults.map(r => r.run_id))).map(runId => {
      const firstMatch = mrpResults.find(r => r.run_id === runId);
      const closedMatch = closedPeriods.find(c => c.run_id === runId);
      let runDateStr = '';
      if (firstMatch && firstMatch.run_date) {
        const d = new Date(firstMatch.run_date);
        runDateStr = d.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      }
      const isClosed = closedRunIds.has(runId);
      return {
        runId,
        isClosed,
        closedPeriod: closedMatch,
        label: `${isClosed ? '🔒 [CLOSED] ' : ''}${runId} (${runDateStr || 'No Timestamp'})`
      };
    });
  }, [mrpResults, closedPeriods]);

  // Check if active run belongs to a closed period
  const activeClosedPeriod = useMemo(() => {
    return closedPeriods.find(c => c.run_id === mrpRunId);
  }, [closedPeriods, mrpRunId]);

  // Extract unique periods for the active run
  const activeRunResults = useMemo(() => {
    return mrpResults.filter(r => r.run_id === mrpRunId);
  }, [mrpResults, mrpRunId]);

  const buckets = useMemo(() => {
    return (Array.from(new Set(activeRunResults.map(r => r.week_start_date))) as string[])
      .sort((a, b) => a.localeCompare(b));
  }, [activeRunResults]);

  /**
   * Inclusive start/end labels per bucket. A bucket runs until the next one
   * begins, so the last one is closed off using the run's own grain.
   */
  const bucketRanges = useMemo(() => {
    return buckets.map((start, i) => {
      const startDateObj = new Date(start);
      const nextStart = i + 1 < buckets.length
        ? new Date(buckets[i + 1])
        : grain === 'month'
          ? new Date(startDateObj.getFullYear(), startDateObj.getMonth() + 1, 1)
          : grain === 'week'
            ? new Date(startDateObj.getTime() + 7 * MS_PER_DAY)
            : new Date(startDateObj.getTime() + MS_PER_DAY);
      const endDateObj = new Date(nextStart.getTime() - MS_PER_DAY);
      const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      const label = grain === 'day'
        ? fmt(startDateObj)
        : `${fmt(startDateObj)} - ${fmt(endDateObj)}`;
      return {
        start,
        end: toDateStr(endDateObj),
        label,
        year: startDateObj.getFullYear()
      };
    });
  }, [buckets, grain]);

  /** Rows keyed by material and bucket, so cells are a lookup instead of a scan. */
  const resultLookup = useMemo(() => {
    const map = new Map<string, MRPResult>();
    activeRunResults.forEach(r => map.set(`${r.material_id}|${r.week_start_date}`, r));
    return map;
  }, [activeRunResults]);

  /** Materials the planner has opened to see the full metric breakdown. */
  const [expandedMaterials, setExpandedMaterials] = useState<Set<string>>(new Set());

  const toggleMaterial = (id: string) => {
    setExpandedMaterials(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectedRunTimestamp = () => {
    const firstMatch = activeRunResults[0];
    if (firstMatch && firstMatch.run_date) {
      return new Date(firstMatch.run_date).toLocaleString('en-US');
    }
    return null;
  };

  // Filter materials using the useTableFilters hook
  const { filtered: filteredMaterials, hasActiveSearch } = useTableFilters<Material>(
    materials.filter(m => m.status !== 'obsolete'),
    ['name', 'sku'],
    { controller: filterController, supplier_id: filterSupplier },
    searchQuery,
    setSearchQuery
  );

  // Calculate planned orders list for active run
  const allPlannedOrders = useMemo(() => {
    return activeRunResults
      .filter(r => r.planned_order_releases > 0)
      .map(r => {
        const mat = materials.find(m => m.id === r.material_id);
        const sup = suppliers.find(s => s.id === mat?.supplier_id);

        // The engine already placed this release in the bucket it must be
        // ordered in, so the bucket date *is* the release date. The arrival
        // it covers is a lead time later.
        const offsetDays = mat ? mat.total_lead_time_days : 15;
        const arrival = new Date(new Date(r.week_start_date).getTime() + offsetDays * MS_PER_DAY);

        return {
          id: r.id,
          material_id: r.material_id,
          material_name: mat ? mat.name : 'Unknown',
          sku: mat ? mat.sku : '',
          quantity: r.planned_order_releases,
          supplier_id: mat ? mat.supplier_id : '',
          supplier_name: sup ? sup.name : 'Unknown',
          required_date: toDateStr(arrival),
          release_date: r.week_start_date,
          controller: mat ? mat.controller : ''
        };
      })
      .sort((a, b) => a.release_date.localeCompare(b.release_date));
  }, [activeRunResults, materials, suppliers]);

  // Filter planned orders list using the hook
  const { filtered: plannedOrdersList } = useTableFilters<any>(
    allPlannedOrders,
    ['material_name', 'sku'],
    { controller: filterController, supplier_id: filterSupplier },
    searchQuery,
    setSearchQuery
  );

  // MRP Summary KPI Statistics
  const totalMaterialsCount = filteredMaterials.length;

  const atRiskMaterials = useMemo(() => {
    return filteredMaterials.filter(m => {
      return buckets.some(wk => {
        const r = resultLookup.get(`${m.id}|${wk}`);
        return r ? r.projected_available < r.safety_stock || (r.past_due_releases || 0) > 0 : false;
      });
    });
  }, [filteredMaterials, buckets, resultLookup]);

  const atRiskCount = atRiskMaterials.length;
  const onPlanCount = Math.max(0, totalMaterialsCount - atRiskCount);

  const totalPlannedValue = useMemo(() => {
    return allPlannedOrders.reduce((acc, po) => {
      const mat = materials.find(m => m.id === po.material_id);
      const cost = mat?.standard_cost || 0;
      return acc + (po.quantity * cost);
    }, 0);
  }, [allPlannedOrders, materials]);

  // Aggregate Bucket Totals (Gross Requirements & Planned Releases)
  const bucketTotals = useMemo(() => {
    const totals: Record<string, { gross: number; release: number }> = {};
    buckets.forEach(wk => {
      let grossSum = 0;
      let releaseSum = 0;
      filteredMaterials.forEach(m => {
        const r = resultLookup.get(`${m.id}|${wk}`);
        if (r) {
          grossSum += r.gross_requirements || 0;
          releaseSum += r.planned_order_releases || 0;
        }
      });
      totals[wk] = { gross: grossSum, release: releaseSum };
    });
    return totals;
  }, [buckets, filteredMaterials, resultLookup]);

  // Expand / Collapse All Materials
  const handleExpandAll = () => {
    setExpandedMaterials(new Set(filteredMaterials.map(m => m.id)));
  };

  const handleCollapseAll = () => {
    setExpandedMaterials(new Set());
  };

  // Timing style helpers
  const getTimingColor = (timing: string) => {
    if (timing === 'Check with Proc.') return 'bg-red-50 text-red-700 border-red-200';
    if (timing === 'Need to be Closed') return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-slate-50 text-slate-700 border-slate-200';
  };

  // Open the purchase order pre-creation dialog
  const openCreatePoDialog = (materialId: string, qty: number, releaseDate: string) => {
    if (!hasRole('planner')) {
      showToast('Your account is read-only - Planner or Admin access is required to raise purchase orders.', 'error');
      return;
    }
    const mat = materials.find(m => m.id === materialId);
    if (!mat) return;
    const sup = suppliers.find(s => s.id === mat.supplier_id);
    if (!sup) {
      showToast(`Cannot create PO. No supplier assigned to material: ${mat.name}`, 'error');
      return;
    }

    // The grid cell is the release bucket; the goods are needed a lead time
    // after it, which is the date the PO must be satisfied by.
    const offsetDays = mat.total_lead_time_days || 15;
    const arrival = new Date(new Date(releaseDate).getTime() + offsetDays * MS_PER_DAY);

    setPoModalData({
      material: mat,
      supplier: sup,
      qty,
      requiredDate: toDateStr(arrival),
      suggestedReleaseDate: releaseDate
    });
  };

  // Execute actual PO creation
  const handleConfirmCreatePO = async () => {
    if (!hasRole('planner')) {
      showToast('Your account is read-only - Planner or Admin access is required to raise purchase orders.', 'error');
      return;
    }
    if (!poModalData) return;
    setLoading(true);

    try {
      const { material, supplier, qty, requiredDate } = poModalData;
      const orderNo = `PO-${Date.now().toString().slice(-6)}`;
      const newPO: PurchaseOrder = {
        id: `PO_REC_${Date.now()}`,
        material_id: material.id,
        supplier_id: supplier.id,
        order_no: orderNo,
        qty: qty,
        remaining_qty: qty,
        required_date: requiredDate,
        status: 'pending',
        timing: 'Normal',
        po_date: new Date().toISOString().slice(0, 10),
        unit_price: material.standard_cost || 0
      };

      await saveRecord('purchase_orders', newPO);
      
      // Auto re-run MRP solver so grid is instantly rebuilt with the new scheduled receipts
      const rerun = await runMRP(startDate, horizon, grain);
      setSubstitutions(rerun.substitutions);
      await loadData();

      setPoModalData(null);
      showToast(`Purchase Order ${orderNo} created successfully!`, 'success');
    } catch (e: any) {
      showToast('Failed to create Purchase Order: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const poModalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(poModalRef, poModalData !== null, () => setPoModalData(null));

  const closePeriodRef = useRef<HTMLDivElement>(null);
  useFocusTrap(closePeriodRef, isCloseModalOpen, () => setIsCloseModalOpen(false));



  return (
    <div className="space-y-6" id="mrp_screen">
      <ContentHeader
        title="Material Requirements Planner (MRP)"
      />

      {/* Executive KPI Overview Cards */}
      {/* Shared KpiCard: this screen previously used its own type scale
          (text-xl / shadow-2xs / icon chip) which read a size smaller than the
          identical tiles on Logistics and the Dashboard. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Planned Components"
          value={totalMaterialsCount}
          sub="Active raw materials"
          icon={<Package className="w-4 h-4" />}
        />
        <KpiCard
          label="On-Plan / Healthy"
          value={onPlanCount}
          sub={`Buffers intact (${totalMaterialsCount ? Math.round((onPlanCount / totalMaterialsCount) * 100) : 0}%)`}
          intent="success"
          icon={<CheckCircle2 className="w-4 h-4" />}
        />
        <KpiCard
          label="Shortage / Safety Risk"
          value={atRiskCount}
          sub="Needs expedite or PO"
          intent={atRiskCount > 0 ? 'danger' : 'success'}
          icon={<ShieldAlert className="w-4 h-4" />}
        />
        <KpiCard
          label="Planned Order Value"
          value={`EGP ${totalPlannedValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          sub={`${plannedOrdersList.length} order releases`}
          intent="info"
          icon={<DollarSign className="w-4 h-4" />}
        />
      </div>

      {/* MRP Control Parameters Bar */}
      <div className="bg-white border border-slate-200 p-3 rounded-2xl flex items-center flex-wrap justify-between gap-3 shadow-xs text-xs font-sans">
        <div className="flex items-center flex-wrap gap-3">
          <div className="flex items-center gap-1.5 font-semibold text-slate-700 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-xl">
            <Calendar className="w-3.5 h-3.5 text-blue-600" /> Start Date:
            <input aria-label="Start date" 
              type="date" 
              value={startDate} 
              onChange={e => setStartDate(e.target.value)} 
              className="px-1.5 py-0.5 border border-slate-300 rounded-lg bg-white text-xs font-mono text-slate-800 focus:outline-hidden focus:border-blue-500" 
            />
          </div>

          <div className="flex items-center gap-1.5 font-semibold text-slate-700 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-xl">
            Grain:
            <div className="flex bg-slate-200/70 border border-slate-300 p-0.5 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setGrain('day');
                  setHorizon(14);
                }}
                className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                  grain === 'day' 
                    ? 'bg-white text-blue-600 shadow-2xs' 
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Daily
              </button>
              <button
                type="button"
                onClick={() => {
                  setGrain('week');
                  setHorizon(8);
                }}
                className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                  grain === 'week' 
                    ? 'bg-white text-blue-600 shadow-2xs' 
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Weekly
              </button>
              <button
                type="button"
                onClick={() => {
                  setGrain('month');
                  setHorizon(4);
                }}
                className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                  grain === 'month' 
                    ? 'bg-white text-blue-600 shadow-2xs' 
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Monthly
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5 font-semibold text-slate-700 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-xl">
            Horizon:
            <select aria-label="Horizon" 
              value={horizon} 
              onChange={e => setHorizon(Number(e.target.value))} 
              className="px-1.5 py-0.5 border border-slate-300 rounded-lg bg-white text-xs text-slate-700 cursor-pointer focus:outline-hidden"
            >
              {grain === 'month' ? (
                <>
                  <option value={2}>2 Months</option>
                  <option value={3}>3 Months</option>
                  <option value={4}>4 Months</option>
                  <option value={6}>6 Months</option>
                  <option value={12}>12 Months</option>
                </>
              ) : grain === 'week' ? (
                <>
                  <option value={4}>4 Weeks</option>
                  <option value={6}>6 Weeks</option>
                  <option value={8}>8 Weeks</option>
                  <option value={12}>12 Weeks</option>
                  <option value={16}>16 Weeks</option>
                </>
              ) : (
                <>
                  <option value={7}>7 Days</option>
                  <option value={14}>14 Days</option>
                  <option value={30}>30 Days</option>
                  <option value={60}>60 Days</option>
                </>
              )}
            </select>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2.5">
          <button
            id="btn_run_mrp_execution"
            onClick={handleRunMRP}
            className="btn-base btn-purple gap-1 shadow-sm"
          >
            <Play className="w-3.5 h-3.5 fill-current text-white" />
            Run Solver
          </button>

          <button
            type="button"
            onClick={() => setShowWhatIf(prev => !prev)}
            className={`btn-base gap-1 shadow-sm transition-all ${
              showWhatIf
                ? 'btn-emerald font-bold ring-2 ring-emerald-300'
                : 'btn-teal'
            }`}
            title="Toggle what-if production scenario simulator"
          >
            <Sparkles className="w-3.5 h-3.5 text-white" />
            {showWhatIf ? 'Close Simulator' : 'What-If Simulation'}
          </button>

          <button
            id="btn_close_period"
            onClick={() => setIsCloseModalOpen(true)}
            className="btn-base btn-amber gap-1 shadow-sm"
            title="Close current planning period and archive MRP snapshot"
          >
            <Lock className="w-3.5 h-3.5 text-white" />
            Close Period
          </button>
        </div>
      </div>

      <ErrorState error={error} onRetry={loadData} />

      {showWhatIf && (
        <div className="bg-white border border-indigo-200 rounded-2xl p-4 shadow-sm space-y-4">
          <WhatIfSimulator searchQuery={searchQuery} setSearchQuery={setSearchQuery} onNavigate={onNavigate} refreshKey={refreshKey} />
        </div>
      )}

      {/* Mode selectors and filters bar */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-200 pb-2 font-sans">
        <div className="flex flex-wrap gap-2">
          <button
            id="mrp_tab_grid"
            onClick={() => setActiveTab('grid')}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg border flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'grid' 
                ? 'bg-blue-600 border-blue-600 text-white shadow-xs font-extrabold' 
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            Time-Phased Grid
          </button>
          <button
            id="mrp_tab_orders"
            onClick={() => setActiveTab('orders')}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg border flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'orders' 
                ? 'bg-blue-600 border-blue-600 text-white shadow-xs font-extrabold' 
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <ListTodo className="w-3.5 h-3.5" />
            Planned Releases ({plannedOrdersList.length})
          </button>
          <button
            id="mrp_tab_po_board"
            onClick={() => setActiveTab('po_board')}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg border flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'po_board' 
                ? 'bg-blue-600 border-blue-600 text-white shadow-xs font-extrabold' 
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            PO Board
          </button>
          <button
            id="mrp_tab_subs"
            onClick={() => setActiveTab('subs')}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg border flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'subs'
                ? 'bg-blue-600 border-blue-600 text-white shadow-xs font-extrabold'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Repeat className="w-3.5 h-3.5" />
            Substitutions ({substitutions.length})
          </button>
        </div>

        {/* Filters, Search and Run Picker */}
        <div className="flex flex-wrap items-center gap-2.5">
          {runOptions.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500 uppercase">Run:</span>
              <select aria-label="Mrp run id"
                value={mrpRunId || ''}
                onChange={(e) => setMrpRunId(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-700 font-semibold focus:outline-hidden cursor-pointer"
              >
                {runOptions.map(opt => (
                  <option key={opt.runId} value={opt.runId}>{opt.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Search Box */}
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search components..."
            className="w-40"
            hasActiveSearch={hasActiveSearch}
          />

          {!hasActiveSearch && (
            <>
              <select aria-label="Filter by controller"
                value={filterController}
                onChange={(e) => setFilterController(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-hidden text-slate-600 cursor-pointer"
              >
                <option value="">All Controllers</option>
                <option value="Mohamed Amr">Mohamed Amr</option>
                <option value="Amr Anwar">Amr Anwar</option>
              </select>

              <select aria-label="Filter by supplier"
                value={filterSupplier}
                onChange={(e) => setFilterSupplier(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-hidden text-slate-600 cursor-pointer"
              >
                <option value="">All Suppliers</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </>
          )}
        </div>
      </div>

      {/* Show active run timestamp */}
      {selectedRunTimestamp() && (
        <div className="flex items-center justify-between text-xs text-slate-400 font-mono px-1">
          <span>Active Run ID: <strong className="text-blue-600">{mrpRunId}</strong></span>
          <span>Calculated on: {selectedRunTimestamp()}</span>
        </div>
      )}

      {/* Active Closed Period Archived Snapshot Banner */}
      {activeClosedPeriod && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-950 font-sans shadow-xs">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-200/80 rounded-lg text-amber-800">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-amber-950 text-xs">Archived Closed Period Snapshot</span>
                <span className="px-2 py-0.5 bg-amber-200/90 text-amber-900 text-[10px] font-extrabold rounded-full uppercase tracking-wider">
                  🔒 Read-Only
                </span>
              </div>
              <p className="text-amber-800 text-[11px] mt-0.5 font-medium">
                Period: <strong className="font-mono text-amber-950">{activeClosedPeriod.period}</strong> | Run ID: <strong className="font-mono text-amber-950">{activeClosedPeriod.run_id}</strong> | Grain: <span className="uppercase font-mono text-[10px] bg-amber-100 px-1 rounded">{activeClosedPeriod.grain}</span>
              </p>
              <p className="text-amber-700/90 text-[10px] mt-0.5">
                Closed on {new Date(activeClosedPeriod.closed_at).toLocaleString()} by {activeClosedPeriod.closed_by}
                {activeClosedPeriod.notes ? ` — Note: "${activeClosedPeriod.notes}"` : ''}
              </p>
            </div>
          </div>
          <div className="text-right text-[11px] text-amber-900 font-mono">
            <div>Materials: <strong>{activeClosedPeriod.total_materials}</strong> | At Risk: <strong className="text-red-700">{activeClosedPeriod.at_risk_count}</strong></div>
            <div>Planned Value: <strong>EGP {activeClosedPeriod.planned_value.toLocaleString()}</strong></div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center items-center h-48 bg-white border border-slate-100 rounded-xl">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <div id="mrp_tab_content_wrapper" className="font-sans">
          {/* 1. Time-Phased Grid Tab */}
          {activeTab === 'grid' && (
            <div className="space-y-3">
              {/* Grid Control Toolbar & Legend */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-700 flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-blue-600" /> Views:
                  </span>
                  <button
                    onClick={handleExpandAll}
                    className="px-2.5 py-1 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold rounded-md shadow-2xs transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5 text-slate-500" /> Expand All Lines
                  </button>
                  <button
                    onClick={handleCollapseAll}
                    className="px-2.5 py-1 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold rounded-md shadow-2xs transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <EyeOff className="w-3.5 h-3.5 text-slate-500" /> Collapse to Summary
                  </button>
                </div>

                {/* Color Legend */}
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600 font-medium">
                  <span className="text-slate-400 font-bold uppercase text-[9px] tracking-wider">Legend:</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-400"></span> Gross Req</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> Inbound POs</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400"></span> Safety Target</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500"></span> Projected Stock</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500"></span> Net Deficit</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-600"></span> Order Release</span>
                </div>
              </div>

              <div className="card-elevated overflow-hidden">
                {buckets.length === 0 ? (
                  <div className="p-12 text-center text-slate-400">
                    <ClipboardCheck className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="text-xs">No active MRP plans found. Click <b>"Run Solver"</b> above to trigger calculations.</p>
                  </div>
                ) : (
                  <ScrollableTable>
                    <table className="min-w-full divide-y divide-slate-200 text-left text-xs font-sans">
                      <thead className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        <tr>
                          <th className="px-4 py-3 sticky left-0 bg-slate-50 z-10 min-w-[280px] border-r border-slate-100">Material Component / Code</th>
                          <th className="px-4 py-3 min-w-[180px] border-r border-slate-100">
                            Metric
                            <span className="block text-[9px] text-blue-600 font-normal normal-case">(Summary = Projected Stock)</span>
                          </th>
                          {bucketRanges.map(b => (
                            <th key={b.start} className="px-4 py-3 text-right min-w-[150px]">
                              <span className="block font-mono text-[11px] text-slate-700 normal-case">{b.label}</span>
                              <span className="block font-mono text-[9px] text-slate-400 font-normal normal-case">{b.year}</span>
                              {bucketTotals[b.start] && (
                                <div className="mt-1 pt-1 border-t border-slate-200/60 font-mono text-[9px] text-slate-500 normal-case font-normal flex flex-col items-end gap-0.5">
                                  <span>Gross: {bucketTotals[b.start].gross.toLocaleString()}</span>
                                  {bucketTotals[b.start].release > 0 && (
                                    <span className="text-amber-700 font-bold">Rel: +{bucketTotals[b.start].release.toLocaleString()}</span>
                                  )}
                                </div>
                              )}
                            </th>
                          ))}
                        </tr>
                      </thead>
                    <tbody className="divide-y divide-slate-200 text-xs">
                      {filteredMaterials.map(m => {
                        const isExpanded = expandedMaterials.has(m.id);
                        const rowFor = (wk: string) => resultLookup.get(`${m.id}|${wk}`);
                        const shortfallBuckets = buckets.filter(wk => {
                          const r = rowFor(wk);
                          return r ? r.projected_available < r.safety_stock : false;
                        }).length;
                        const pastDue = buckets.reduce(
                          (sum, wk) => sum + (rowFor(wk)?.past_due_releases || 0), 0
                        );

                        return (
                          <React.Fragment key={m.id}>
                            {/* Material summary line - always visible, click to expand */}
                            <tr
                              className="bg-slate-50/60 font-semibold border-t border-slate-200/80 hover:bg-slate-100/70 cursor-pointer transition-colors"
                              onClick={() => toggleMaterial(m.id)}
                            >
                              <td className="px-4 py-2 sticky left-0 bg-slate-50/95 z-10 font-bold text-slate-800 border-r border-slate-100">
                                <div className="flex items-center gap-1.5">
                                  {isExpanded
                                    ? <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                    : <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
                                  <span>{m.name}</span>
                                </div>
                                <span className="block text-[10px] text-slate-400 font-mono font-normal mt-0.5 pl-5">
                                  {m.sku} | MOQ {m.moq.toLocaleString()} | Lead {m.total_lead_time_days}d
                                </span>
                              </td>
                              <td className="px-4 py-2 border-r border-slate-100 align-middle">
                                {/* Netting tops stock up to the safety level, so a bucket rarely
                                    reads short. The real exposure is an order that had to be
                                    placed before this run began - it cannot arrive on time. */}
                                {pastDue > 0 ? (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-50 border border-red-200 text-red-700 text-[10px] font-bold">
                                    <ShieldAlert className="w-3 h-3" />
                                    Order late
                                  </span>
                                ) : shortfallBuckets > 0 ? (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-bold">
                                    <ShieldAlert className="w-3 h-3" />
                                    {shortfallBuckets} short
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold">
                                    <CheckCircle2 className="w-3 h-3" />
                                    On plan
                                  </span>
                                )}
                                {pastDue > 0 && (
                                  <span className="block mt-1 text-[9px] font-bold text-red-600 font-mono">
                                    {pastDue.toLocaleString()} to expedite
                                  </span>
                                )}
                              </td>
                              {buckets.map(wk => {
                                const r = rowFor(wk);
                                const proj = r ? r.projected_available : 0;
                                const ss = r ? r.safety_stock : 0;
                                return (
                                  <td key={wk} className={`px-4 py-2 text-right font-mono font-bold ${stockCellClass(proj, ss)}`}>
                                    {proj.toLocaleString()}
                                  </td>
                                );
                              })}
                            </tr>

                            {isExpanded && (
                              <>
                                {/* 1. Gross Requirements */}
                                <tr className="hover:bg-slate-50/30 transition-colors">
                                  <td className="px-4 py-1.5 sticky left-0 bg-white z-10 border-r border-slate-100"></td>
                                  <td className="px-4 py-1.5 text-slate-500 font-medium border-r border-slate-100">
                                    <span className="flex items-center gap-1.5">
                                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                                      Gross Requirements
                                    </span>
                                  </td>
                                  {buckets.map(wk => {
                                    const gross = rowFor(wk)?.gross_requirements || 0;
                                    return (
                                      <td key={wk} className="px-4 py-1.5 text-right font-mono text-slate-600">
                                        {gross > 0 ? gross.toLocaleString() : '-'}
                                      </td>
                                    );
                                  })}
                                </tr>

                                {/* 2. Scheduled Receipts */}
                                <tr className="hover:bg-slate-50/30 transition-colors">
                                  <td className="px-4 py-1.5 sticky left-0 bg-white z-10 border-r border-slate-100"></td>
                                  <td className="px-4 py-1.5 text-emerald-800 font-medium border-r border-slate-100">
                                    <span className="flex items-center gap-1.5">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                      Scheduled Receipts
                                    </span>
                                  </td>
                                  {buckets.map(wk => {
                                    const receipts = rowFor(wk)?.scheduled_receipts || 0;
                                    return (
                                      <td key={wk} className="px-4 py-1.5 text-right font-mono text-emerald-700 font-semibold">
                                        {receipts > 0 ? `+${receipts.toLocaleString()}` : '-'}
                                      </td>
                                    );
                                  })}
                                </tr>

                                {/* 3. Safety Stock - the level the plan is netted against */}
                                <tr className="hover:bg-slate-50/30 transition-colors bg-amber-50/20">
                                  <td className="px-4 py-1.5 sticky left-0 bg-white z-10 border-r border-slate-100"></td>
                                  <td className="px-4 py-1.5 text-amber-900 font-medium border-r border-slate-100">
                                    <span className="flex items-center gap-1.5">
                                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                                      Safety Stock
                                      <span
                                        className="text-[9px] text-amber-600 font-mono font-normal"
                                        title={`${m.total_lead_time_days} days lead time x ${SAFETY_SERVICE_FACTOR} service factor`}
                                      >
                                        ({getSafetyStockMonths(m).toFixed(1)}mo)
                                      </span>
                                    </span>
                                  </td>
                                  {buckets.map(wk => {
                                    const ss = rowFor(wk)?.safety_stock || 0;
                                    return (
                                      <td key={wk} className="px-4 py-1.5 text-right font-mono text-amber-800 border-b border-dashed border-amber-200">
                                        {ss > 0 ? ss.toLocaleString() : '-'}
                                      </td>
                                    );
                                  })}
                                </tr>

                                {/* 4. Projected Available Stock */}
                                <tr className="hover:bg-slate-50/30 transition-colors">
                                  <td className="px-4 py-1.5 sticky left-0 bg-white z-10 border-r border-slate-100"></td>
                                  <td className="px-4 py-1.5 text-blue-800 font-semibold border-r border-slate-100">
                                    <span className="flex items-center gap-1.5">
                                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                                      Projected Stock
                                    </span>
                                  </td>
                                  {buckets.map(wk => {
                                    const r = rowFor(wk);
                                    const proj = r ? r.projected_available : 0;
                                    const ss = r ? r.safety_stock : 0;
                                    const below = proj < ss;
                                    return (
                                      <td key={wk} className={`px-4 py-1.5 text-right font-mono font-bold ${stockCellClass(proj, ss)}`}>
                                        {proj.toLocaleString()}
                                        {below && (
                                          <span className="block text-[8px] font-extrabold text-red-500 font-sans tracking-wide uppercase mt-0.5">
                                            {(ss - proj).toLocaleString()} below SS
                                          </span>
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>

                                {/* 5. Net Requirements - the shortfall before MOQ rounding */}
                                <tr className="hover:bg-slate-50/30 transition-colors">
                                  <td className="px-4 py-1.5 sticky left-0 bg-white z-10 border-r border-slate-100"></td>
                                  <td className="px-4 py-1.5 text-red-800 font-medium border-r border-slate-100">
                                    <span className="flex items-center gap-1.5">
                                      <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                                      Net Requirements
                                    </span>
                                  </td>
                                  {buckets.map(wk => {
                                    const net = rowFor(wk)?.net_requirements || 0;
                                    return (
                                      <td key={wk} className="px-4 py-1.5 text-right font-mono text-red-700">
                                        {net > 0 ? net.toLocaleString() : '-'}
                                      </td>
                                    );
                                  })}
                                </tr>

                                {/* 6. Planned Receipts - when stock has to land */}
                                <tr className="hover:bg-slate-50/30 transition-colors">
                                  <td className="px-4 py-1.5 sticky left-0 bg-white z-10 border-r border-slate-100"></td>
                                  <td className="px-4 py-1.5 text-indigo-800 font-medium border-r border-slate-100">
                                    <span className="flex items-center gap-1.5">
                                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                                      Planned Receipts
                                    </span>
                                  </td>
                                  {buckets.map(wk => {
                                    const rec = rowFor(wk)?.planned_order_receipts || 0;
                                    return (
                                      <td key={wk} className="px-4 py-1.5 text-right font-mono text-indigo-700">
                                        {rec > 0 ? rec.toLocaleString() : '-'}
                                      </td>
                                    );
                                  })}
                                </tr>

                                {/* 7. Planned Order Releases - when to place the order */}
                                <tr className="hover:bg-slate-50/30 transition-colors border-b border-slate-100 bg-amber-50/5">
                                  <td className="px-4 py-2 sticky left-0 bg-white z-10 border-r border-slate-100"></td>
                                  <td className="px-4 py-2 text-amber-800 font-bold border-r border-slate-100">
                                    <span className="flex items-center gap-1.5">
                                      <span className="w-1.5 h-1.5 rounded-full bg-amber-600"></span>
                                      Planned Releases
                                    </span>
                                  </td>
                                  {buckets.map((wk, bIdx) => {
                                    const release = rowFor(wk)?.planned_order_releases || 0;
                                    // Releases whose date has already passed still have to be
                                    // raised - later than ideal, but they are the most urgent
                                    // thing on the screen. Surface them in the first bucket so
                                    // the planner can act instead of only being told they exist.
                                    const late = bIdx === 0 ? pastDue : 0;
                                    if (release === 0 && late === 0) {
                                      return <td key={wk} className="px-4 py-2 text-right font-mono text-slate-400">-</td>;
                                    }
                                    return (
                                      <td key={wk} className={`px-4 py-2 text-right font-mono ${late > 0 ? 'bg-red-50/60' : ''}`}>
                                        <div className="flex flex-col items-end gap-1">
                                          {late > 0 && (
                                            <>
                                              <span className="text-[8px] font-extrabold text-red-600 font-sans tracking-wide uppercase">
                                                Past due - expedite
                                              </span>
                                              <span className="text-red-700 font-bold">{late.toLocaleString()}</span>
                                              <button
                                                onClick={() => openCreatePoDialog(m.id, late, wk)}
                                                className="px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded text-[9px] font-bold flex items-center gap-0.5 shadow-sm transition-all cursor-pointer"
                                              >
                                                <Plus className="w-2.5 h-2.5" />
                                                Expedite PO
                                              </button>
                                            </>
                                          )}
                                          {release > 0 && (
                                            <>
                                              <span className="text-amber-700 font-bold">+{release.toLocaleString()}</span>
                                              <button
                                                onClick={() => openCreatePoDialog(m.id, release, wk)}
                                                className="px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-[9px] font-bold flex items-center gap-0.5 shadow-sm transition-all cursor-pointer"
                                              >
                                                <Plus className="w-2.5 h-2.5" />
                                                Create PO
                                              </button>
                                            </>
                                          )}
                                        </div>
                                      </td>
                                    );
                                  })}
                                </tr>
                              </>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </ScrollableTable>
              )}
            </div>
          </div>
        )}

          {/* 2. Planned Orders Tab */}
          {activeTab === 'orders' && (
            <div className="card-elevated overflow-hidden">
              <ScrollableTable>
                <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Suggested Release Date</th>
                      <th className="px-4 py-3">Material Required</th>
                      <th className="px-4 py-3 text-right">Planned Qty</th>
                      <th className="px-4 py-3">Supplier Assigned</th>
                      <th className="px-4 py-3">Required Arrival Date</th>
                      <th className="px-4 py-3">Buyer / Controller</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-900">
                    {plannedOrdersList.map(order => (
                      <tr key={order.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-semibold text-blue-600 font-mono">{order.release_date}</td>
                        <td className="px-4 py-3">
                          <p className="font-semibold">{order.material_name}</p>
                          <p className="text-[10px] text-slate-400 font-mono">{order.sku}</p>
                        </td>
                        <td className="px-4 py-3 text-right font-bold font-mono">{order.quantity.toLocaleString()}</td>
                        <td className="px-4 py-3 text-slate-600">{order.supplier_name}</td>
                        <td className="px-4 py-3 font-mono text-slate-500">{order.required_date}</td>
                        <td className="px-4 py-3 text-slate-500">{order.controller || 'Mohamed Amr'}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => openCreatePoDialog(order.material_id, order.quantity, order.required_date)}
                            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-bold shadow-xs transition-all cursor-pointer"
                          >
                            Create PO
                          </button>
                        </td>
                      </tr>
                    ))}
                    {plannedOrdersList.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-slate-400">No planned orders generated for this period. Run MRP or adjust MPS production metrics.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </ScrollableTable>
            </div>
          )}

          {/* 4. Substitution proposals */}
          {activeTab === 'subs' && (
            <div className="card-elevated overflow-hidden">
              {substitutions.length === 0 ? (
                <div className="p-12 text-center text-slate-400">
                  <Repeat className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs max-w-md mx-auto leading-relaxed">
                    No substitutions to propose. Either nothing is arriving late, or the
                    materials that are have no approved alternate in their BOM slot.
                  </p>
                </div>
              ) : (
                <>
                  <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/70">
                    <p className="text-[11px] text-slate-500 leading-relaxed max-w-3xl">
                      Where a material cannot arrive in time, these are the approved
                      alternates from the same BOM slot whose lead time still can.
                      Quantities are converted through both BOM lines. Substituting a
                      component is a quality and commercial decision, so nothing here is
                      applied to the plan automatically.
                    </p>
                  </div>
                  <ScrollableTable>
                    <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                      <thead className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        <tr>
                          <th className="px-4 py-3 min-w-[240px]">Short Material</th>
                          <th className="px-4 py-3 min-w-[240px]">Approved Alternate</th>
                          <th className="px-4 py-3 text-right min-w-[110px]">Shortfall</th>
                          <th className="px-4 py-3 text-right min-w-[130px]">Alternate Qty</th>
                          <th className="px-4 py-3 text-right min-w-[120px]">Not Rescued</th>
                          <th className="px-4 py-3 min-w-[150px]">Serves From</th>
                          <th className="px-4 py-3 text-right min-w-[130px]">Cost / Unit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {substitutions.map(sp => (
                          <tr key={sp.id} className="hover:bg-slate-50/60 transition-colors">
                            <td className="px-4 py-3">
                              <div className="font-bold text-slate-800">{sp.material_name}</div>
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                lead {sp.primary_lead_time_days}d
                              </div>
                              <div className="text-[10px] text-slate-500 mt-1">
                                <span className="font-semibold text-slate-600">{sp.product_name}</span>
                                <span className="text-slate-400"> · {sp.slot_name}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-bold text-emerald-700">{sp.alternate_material_name}</div>
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                lead {sp.alternate_lead_time_days}d · {sp.alternate_on_hand.toLocaleString()} on hand
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-red-600 font-bold">
                              {sp.shortfall_qty.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-right font-mono">
                              <span className="font-bold text-emerald-700">{sp.alternate_qty.toLocaleString()}</span>
                              <span className="block text-[9px] text-slate-400">
                                covers {sp.coverable_qty.toLocaleString()}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-mono">
                              {sp.uncoverable_qty > 0 ? (
                                <span className="text-amber-700 font-bold">{sp.uncoverable_qty.toLocaleString()}</span>
                              ) : (
                                <span className="text-emerald-600 font-bold">All covered</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {sp.covers_from_period ? (
                                <>
                                  <span className="font-mono text-slate-700">{sp.covers_from_period}</span>
                                  <span className="block text-[9px] text-slate-400 font-mono">
                                    arrives {sp.earliest_arrival}
                                  </span>
                                </>
                              ) : (
                                <span className="text-[10px] font-bold text-red-600 uppercase tracking-wide">
                                  Too late as well
                                </span>
                              )}
                            </td>
                            <td className={`px-4 py-3 text-right font-mono font-bold ${
                              sp.unit_cost_delta <= 0 ? 'text-emerald-700' : 'text-amber-700'
                            }`}>
                              {sp.unit_cost_delta <= 0 ? '' : '+'}
                              {CURRENCY} {sp.unit_cost_delta.toFixed(3)}
                              <span className="block text-[9px] text-slate-400 font-sans font-normal">
                                {sp.unit_cost_delta <= 0 ? 'cheaper' : 'dearer'} per unit
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollableTable>
                </>
              )}
            </div>
          )}

          {/* 3. Purchase Orders Board Tab */}
          {activeTab === 'po_board' && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4" id="po_board_grids_container">
              {/* Column 1: Planned / NO PO */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 flex flex-col h-[65vh]">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <h4 className="text-xs font-bold text-red-700 uppercase tracking-wider flex items-center gap-1">
                    <ShieldAlert className="w-3.5 h-3.5" /> No PO (Planned)
                  </h4>
                  <span className="px-1.5 py-0.5 bg-red-100 text-red-800 text-[10px] font-bold rounded-full">
                    {plannedOrdersList.length}
                  </span>
                </div>
                <div className="space-y-3 overflow-y-auto flex-1 pr-1">
                  {plannedOrdersList.map(order => (
                    <div key={order.id} className="bg-white p-3 rounded-lg border border-red-100 shadow-2xs space-y-2 animate-in fade-in zoom-in-95 duration-150">
                      <div>
                        <h5 className="font-semibold text-xs text-slate-900">{order.material_name}</h5>
                        <p className="text-[9px] text-slate-400 font-mono">{order.sku}</p>
                      </div>
                      <div className="flex justify-between items-baseline">
                        <span className="text-[10px] text-slate-500 font-semibold uppercase font-sans">Suggested Qty:</span>
                        <span className="font-bold font-mono text-xs">{order.quantity.toLocaleString()}</span>
                      </div>
                      <div className="text-[9px] text-slate-500 flex justify-between border-t border-slate-100 pt-1.5">
                        <span>Release: {order.release_date}</span>
                        <span>Assign: {order.supplier_name.split(' ')[0]}</span>
                      </div>
                      <button
                        onClick={() => openCreatePoDialog(order.material_id, order.quantity, order.required_date)}
                        className="w-full mt-1.5 py-1 text-[10px] bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded border border-blue-200 transition-all cursor-pointer"
                      >
                        Create Purchase Order
                      </button>
                    </div>
                  ))}
                  {plannedOrdersList.length === 0 && (
                    <div className="p-6 text-center text-[11px] text-slate-400">All planned stock arrivals are covered by open supplier POs. No shortage gaps found.</div>
                  )}
                </div>
              </div>

              {/* Column 2: Pending (ordered, not shipped) */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 flex flex-col h-[65vh]">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <h4 className="text-xs font-bold text-amber-700 uppercase tracking-wider flex items-center gap-1">
                    <ClipboardCheck className="w-3.5 h-3.5" /> Pending POs
                  </h4>
                  <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded-full">
                    {purchaseOrders.filter(p => p.status === 'pending').length}
                  </span>
                </div>
                <div className="space-y-3 overflow-y-auto flex-1 pr-1">
                  {purchaseOrders.filter(p => p.status === 'pending').map(po => {
                    const mat = materials.find(m => m.id === po.material_id);
                    const sup = suppliers.find(s => s.id === po.supplier_id);
                    return (
                      <div key={po.id} className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs space-y-2 animate-in fade-in zoom-in-95 duration-150">
                        <div className="flex justify-between items-start">
                          <h5 className="font-semibold text-xs text-slate-900">{mat ? mat.name : 'Unknown'}</h5>
                          <span className={`px-1.5 py-0.5 rounded-sm border text-[9px] font-bold ${getTimingColor(po.timing)}`}>
                            {po.timing}
                          </span>
                        </div>
                        <p className="text-[9px] text-slate-400 font-mono">{po.order_no}</p>
                        <div className="flex justify-between items-baseline text-xs">
                          <span className="text-[10px] text-slate-400">Order Qty:</span>
                          <span className="font-bold font-mono">{po.remaining_qty.toLocaleString()}</span>
                        </div>
                        <div className="text-[9px] text-slate-500 flex justify-between border-t border-slate-100 pt-1.5">
                          <span>Required: {po.required_date}</span>
                          <span>Supplier: {sup ? sup.name.split(' ')[0] : 'Unknown'}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Column 3: In Transit */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 flex flex-col h-[65vh]">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <h4 className="text-xs font-bold text-indigo-700 uppercase tracking-wider flex items-center gap-1">
                    <Truck className="w-3.5 h-3.5" /> In Transit
                  </h4>
                  <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-800 text-[10px] font-bold rounded-full">
                    {purchaseOrders.filter(p => p.status === 'in_transit').length}
                  </span>
                </div>
                <div className="space-y-3 overflow-y-auto flex-1 pr-1">
                  {purchaseOrders.filter(p => p.status === 'in_transit').map(po => {
                    const mat = materials.find(m => m.id === po.material_id);
                    const sup = suppliers.find(s => s.id === po.supplier_id);
                    return (
                      <div key={po.id} className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs space-y-2 animate-in fade-in zoom-in-95 duration-150">
                        <h5 className="font-semibold text-xs text-slate-900">{mat ? mat.name : 'Unknown'}</h5>
                        <p className="text-[9px] text-slate-400 font-mono">{po.order_no}</p>
                        <div className="flex justify-between items-baseline text-xs">
                          <span className="text-[10px] text-slate-400 font-sans">Ship Qty:</span>
                          <span className="font-bold font-mono text-indigo-600">{po.qty.toLocaleString()}</span>
                        </div>
                        <div className="text-[9px] text-slate-500 flex justify-between border-t border-slate-100 pt-1.5">
                          <span>Required: {po.required_date}</span>
                          <span>Supplier: {sup ? sup.name.split(' ')[0] : 'Unknown'}</span>
                        </div>
                      </div>
                    );
                  })}
                  {purchaseOrders.filter(p => p.status === 'in_transit').length === 0 && (
                    <div className="p-6 text-center text-[11px] text-slate-400">No active orders currently tracked in transit. Convert open POs in the Logistics tab.</div>
                  )}
                </div>
              </div>

              {/* Column 4: Completed */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 flex flex-col h-[65vh]">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <h4 className="text-xs font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Completed
                  </h4>
                  <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-full">
                    {purchaseOrders.filter(p => p.status === 'completed').length}
                  </span>
                </div>
                <div className="space-y-3 overflow-y-auto flex-1 pr-1">
                  {purchaseOrders.filter(p => p.status === 'completed').map(po => {
                    const mat = materials.find(m => m.id === po.material_id);
                    const sup = suppliers.find(s => s.id === po.supplier_id);
                    return (
                      <div key={po.id} className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs space-y-2 opacity-80 animate-in fade-in zoom-in-95 duration-150">
                        <h5 className="font-semibold text-xs text-slate-900">{mat ? mat.name : 'Unknown'}</h5>
                        <p className="text-[9px] text-slate-400 font-mono">{po.order_no}</p>
                        <div className="flex justify-between items-baseline text-xs">
                          <span className="text-[10px] text-slate-400 font-sans">Received Qty:</span>
                          <span className="font-bold font-mono text-emerald-600">{po.qty.toLocaleString()}</span>
                        </div>
                        <div className="text-[9px] text-slate-500 flex justify-between border-t border-slate-100 pt-1.5">
                          <span>Received: {po.required_date}</span>
                          <span>Supplier: {sup ? sup.name.split(' ')[0] : 'Unknown'}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CREATE PURCHASE ORDER CONFIRMATION MODAL */}
      {poModalData && (
        <div className="fixed inset-0 z-[4600] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" ref={poModalRef} role="dialog" aria-modal="true" aria-label="Create purchase order from MRP">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden flex flex-col border border-slate-100 font-sans">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-blue-600" /> Confirm Purchase Order
              </h3>
              <button 
                onClick={() => setPoModalData(null)} 
                className="text-slate-400 hover:text-slate-600 font-bold p-1 bg-white border border-slate-200 rounded-md shadow-xs cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs leading-relaxed">
              <div className="p-3 bg-blue-50 border border-blue-100 text-blue-800 rounded-lg">
                Confirming this action will generate a pending Purchase Order and register a corresponding Scheduled Receipt in future MRP runs.
              </div>

              <div className="space-y-2.5">
                <div className="flex justify-between border-b border-slate-100 pb-1.5">
                  <span className="text-slate-400">Material Name</span>
                  <span className="font-semibold text-slate-800 text-right max-w-[200px] truncate">{poModalData.material.name}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 pb-1.5">
                  <span className="text-slate-400">Material SKU</span>
                  <span className="font-semibold font-mono text-slate-800">{poModalData.material.sku}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 pb-1.5">
                  <span className="text-slate-400">Supplier Assigned</span>
                  <span className="font-semibold text-slate-800">{poModalData.supplier.name}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 pb-1.5">
                  <span className="text-slate-400">Suggested Qty</span>
                  <span className="font-bold text-slate-800 font-mono">{poModalData.qty.toLocaleString()}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 pb-1.5">
                  <span className="text-slate-400">Lead-Time (Supplier + Transit)</span>
                  <span className="font-semibold text-slate-800 font-mono">{poModalData.material.total_lead_time_days} days</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 pb-1.5">
                  <span className="text-slate-400">Required Date</span>
                  <span className="font-semibold text-blue-600 font-mono">{poModalData.requiredDate}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 pb-1.5">
                  <span className="text-slate-400">Suggested Release Date</span>
                  <span className="font-semibold text-amber-600 font-mono">{poModalData.suggestedReleaseDate}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 pb-1.5">
                  <span className="text-slate-400">Unit Price</span>
                  <span className="font-semibold text-emerald-600 font-mono">EGP {(poModalData.material.standard_cost || 0).toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Estimated Total Value</span>
                  <span className="font-extrabold text-emerald-600 font-mono text-sm">EGP {((poModalData.material.standard_cost || 0) * poModalData.qty).toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50">
              <button 
                onClick={() => setPoModalData(null)}
                className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold rounded-lg text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button 
                onClick={handleConfirmCreatePO}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-xs shadow-xs cursor-pointer"
              >
                Confirm & Create PO
              </button>
            </div>
          </div>
        </div>
      )}
      {/* CLOSE PERIOD ARCHIVE MODAL */}
      {isCloseModalOpen && (
        <div className="fixed inset-0 z-[4600] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Close planning period">
          <div ref={closePeriodRef} className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden flex flex-col border border-slate-100 font-sans animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-amber-50">
              <h3 className="text-sm font-bold text-amber-950 flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-700" /> Close & Archive Planning Period
              </h3>
              <button 
                onClick={() => setIsCloseModalOpen(false)} 
                className="text-slate-400 hover:text-slate-600 font-bold p-1 bg-white border border-slate-200 rounded-md shadow-xs cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs leading-relaxed">
              <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg">
                Closing period <strong>{startDate}</strong> will tag the current MRP Run (<strong>{mrpRunId}</strong>) as an official closed snapshot. You can retrieve and view this historical snapshot at any time from the Run selector.
              </div>

              <div className="space-y-2.5 bg-slate-50 p-3 rounded-lg border border-slate-200 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-500">Planning Period:</span>
                  <span className="font-bold text-slate-900">{startDate}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Active Run ID:</span>
                  <span className="font-bold text-blue-600">{mrpRunId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Time Grain / Horizon:</span>
                  <span className="font-bold text-slate-800 uppercase">{grain} ({horizon} buckets)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Total Components Analyzed:</span>
                  <span className="font-bold text-slate-800">{totalMaterialsCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Shortage / Risk Items:</span>
                  <span className="font-bold text-red-600">{atRiskCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Total Planned Order Value:</span>
                  <span className="font-bold text-emerald-700">EGP {totalPlannedValue.toLocaleString()}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700">Closure Notes / References (Optional):</label>
                <textarea aria-label="Close notes"
                  value={closeNotes}
                  onChange={e => setCloseNotes(e.target.value)}
                  placeholder="e.g., End of Month 08/2026 official close - Approved by Plant Director..."
                  rows={3}
                  className="w-full p-2.5 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-hidden text-slate-800"
                />
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50">
              <button 
                onClick={() => setIsCloseModalOpen(false)}
                className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold rounded-lg text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button 
                onClick={handleClosePeriod}
                className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                <Lock className="w-3.5 h-3.5" /> Confirm & Archive Period
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}
