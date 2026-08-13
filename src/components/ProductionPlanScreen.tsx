/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useFirstLoad } from '../hooks/useFirstLoad';
import { useAsyncLoad, type LoadSignal } from '../hooks/useAsyncLoad';
import { fetchTableData, saveRecord, getVProductCoverage, getPlanningPeriod } from '../supabaseClient';
import { Product, Machine, ProductionPlan, SalesPlan, InventorySnapshot } from '../types';
import { Cpu, RefreshCw, Sparkles, Save, Download, Table, BarChart3, AlertTriangle, Gauge, Layers, TrendingUp } from 'lucide-react';
import CsvImportHelper from './CsvImportHelper';
import { useToast } from '../context/ToastConfirmContext';
import { useAuth } from '../context/AuthContext';
import { useTableFilters } from '../hooks/useTableFilters';
import SearchBar from './SearchBar';
import ScrollableTable from './ScrollableTable';
import { downloadCsv, toCsvText } from '../utils/csv';
import ContentHeader from './ContentHeader';
import ErrorState from './ErrorState';
import DataStateWrapper from './DataStateWrapper';
import EmptyState from './EmptyState';
import { KpiCard } from './ui';

const NEVER_CANCELLED: LoadSignal = { cancelled: false };


type GrainType = 'day' | 'week' | 'month';

interface ProductionPlanScreenProps {
  searchQuery?: string;
  setSearchQuery?: (val: string) => void;
  refreshKey?: number;
}

export default function ProductionPlanScreen({
  searchQuery = '',
  setSearchQuery = () => {},
  refreshKey = 0,
}: ProductionPlanScreenProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [productionPlans, setProductionPlans] = useState<ProductionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const { isFirstLoad, markLoaded } = useFirstLoad('production_plan');
  const [error, setError] = useState<string | null>(null);

  // Screen Tabs
  const [activeTab, setActiveTab] = useState<'schedule' | 'reports'>('schedule');
  const [reportView, setReportView] = useState<'machine' | 'sku'>('machine');

  const [selectedGrain, setSelectedGrain] = useState<GrainType>('month');
  const [columns, setColumns] = useState<string[]>([]);
  const [gridEdits, setGridEdits] = useState<Record<string, number>>({}); // "product_id:period_start" -> quantity

  const { showToast, confirm: askConfirm } = useToast();
  const { hasRole } = useAuth();

  // Line Load Balancer Modal State
  const [isLoadBalancerOpen, setIsLoadBalancerOpen] = useState(false);
  const [balancerProductId, setBalancerProductId] = useState<string>('');
  const [balancerTargetLine, setBalancerTargetLine] = useState<string>('');

  const handleRebalanceLine = async () => {
    if (!hasRole('planner')) {
      showToast('Planner or Admin access is required to modify machine line assignments.', 'error');
      return;
    }
    if (!balancerProductId || !balancerTargetLine) {
      showToast('Please select a product and target machine line.', 'warning');
      return;
    }
    const targetProd = products.find(p => p.id === balancerProductId);
    if (!targetProd) return;

    try {
      const updated = { ...targetProd, product_line: balancerTargetLine };
      await saveRecord('products', updated);
      await loadData();
      setIsLoadBalancerOpen(false);
      showToast(`Re-assigned SKU ${targetProd.sku} (${targetProd.name}) to ${balancerTargetLine} line!`, 'success');
    } catch (e: any) {
      showToast(`Failed to re-assign machine line: ${e.message}`, 'error');
    }
  };

  async function loadData(signal: LoadSignal = NEVER_CANCELLED) {
    setLoading(true);
    setError(null);
    try {
      const [prods, macs, plans] = await Promise.all([
        fetchTableData<Product>('products'),
        fetchTableData<Machine>('machines'),
        fetchTableData<ProductionPlan>('production_plan')
      ]);
      // A newer load has started (or we unmounted). Discard this
      // response rather than writing a stale period into state.
      if (signal.cancelled) return;
      if (signal.cancelled) return;
      setProducts(prods);
      setMachines(macs);
      setProductionPlans(plans);
    } catch (e: any) {
      setError(e instanceof Error ? e.message : String(e));
      showToast("Failed to load production plan dependencies: " + e.message, 'error');
    } finally {
      if (!signal.cancelled) { setLoading(false); markLoaded(); }
    }
  }

  useAsyncLoad(loadData, [refreshKey]);

  // Sync columns based on grain
  useEffect(() => {
    const today = new Date(getPlanningPeriod()); // grid window starts at the active period
    const cols: string[] = [];

    if (selectedGrain === 'month') {
      for (let i = 0; i < 4; i++) {
        const d = new Date(today);
        d.setMonth(today.getMonth() + i);
        cols.push(d.toISOString().slice(0, 7) + '-01');
      }
    } else if (selectedGrain === 'week') {
      for (let i = 0; i < 6; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + (i * 7));
        cols.push(d.toISOString().slice(0, 10));
      }
    } else { // day
      for (let i = 0; i < 10; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        cols.push(d.toISOString().slice(0, 10));
      }
    }
    setColumns(cols);
    setGridEdits({});
  }, [selectedGrain]);

  const handleCellChange = (productId: string, colDate: string, value: string) => {
    const key = `${productId}:${colDate}`;
    setGridEdits(prev => ({
      ...prev,
      [key]: Number(value) || 0
    }));
  };

  const handleSaveGrid = async () => {
    if (!hasRole('planner')) {
      showToast('Your account is read-only - Planner or Admin access is required to save the production plan.', 'error');
      return;
    }
    const keys = Object.keys(gridEdits);
    if (keys.length === 0) return;

    setLoading(true);
    try {
      for (const key of keys) {
        const [productId, periodStart] = key.split(':');
        const quantity = gridEdits[key];

        const product = products.find(p => p.id === productId);
        if (!product) {
          throw new Error(`Product with ID ${productId} not found.`);
        }
        const machineName = product.product_line;
        const matchingMachine = machines.find(m => m.name === machineName);
        if (!matchingMachine) {
          showToast(`Save blocked: Product ${product.sku} has an invalid or unconfigured machine line: "${machineName || 'None'}". Please correct in Master Data.`, "error");
          setLoading(false);
          return;
        }
        const machineId = matchingMachine.id;

        const existing = productionPlans.find(p => 
          p.product_id === productId && 
          p.period_type === selectedGrain && 
          p.period_start === periodStart
        );

        const recordToSave: ProductionPlan = {
          id: existing ? existing.id : `PP_REC_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          product_id: productId,
          machine_id: machineId,
          period_type: selectedGrain,
          period_start: periodStart,
          quantity: quantity
        };

        await saveRecord<ProductionPlan>('production_plan', recordToSave);
      }

      const updatedPlans = await fetchTableData<ProductionPlan>('production_plan');
      setProductionPlans(updatedPlans);
      setGridEdits({});
      showToast("MPS Production Plan saved successfully!", "success");
    } catch (err: any) {
      showToast("Save failed: " + err.message, "error");
    } finally {
      setLoading(false);
      markLoaded();
    }
  };

  const handleSuggestPlans = async () => {
    setLoading(true);
    try {
      const [sales, pCov, inv] = await Promise.all([
        fetchTableData<SalesPlan>('sales_plan'),
        getVProductCoverage(),
        fetchTableData<InventorySnapshot>('inventory_snapshots')
      ]);

      const suggestions: Record<string, number> = {};
      const runningStocks: Record<string, number> = {};
      products.forEach(p => {
        const stockSnap = inv.find(i => i.item_type === 'product' && i.item_id === p.id);
        runningStocks[p.id] = stockSnap ? stockSnap.quantity : 0;
      });

      columns.forEach(col => {
        products.forEach(p => {
          const periodSales = sales
            .filter(s => s.product_id === p.id && s.period_type === selectedGrain && s.period_start === col)
            .reduce((sum, s) => sum + s.quantity, 0);

          const demand = periodSales;
          let safetyStockTarget = 0;
          if (selectedGrain === 'month') {
            safetyStockTarget = Math.round(demand * 1.5);
          } else if (selectedGrain === 'week') {
            safetyStockTarget = Math.round(demand * 1.5 * 4);
          } else {
            safetyStockTarget = Math.round(demand * 1.5 * 30);
          }

          const currentProjStock = runningStocks[p.id];
          const val = Math.max(0, Math.round(safetyStockTarget + demand - currentProjStock));

          if (val > 0) {
            suggestions[`${p.id}:${col}`] = val;
          }

          runningStocks[p.id] = currentProjStock - demand + val;
        });
      });

      setGridEdits(suggestions);
      showToast("Algorithmic suggestions prefilled! Review and click Save Changes.", "success");
    } catch (err: any) {
      showToast("Prefill algorithm failed: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleSuggestPlansClick = async () => {
    if (!hasRole('planner')) {
      showToast('Your account is read-only - Planner or Admin access is required to generate a suggested plan.', 'error');
      return;
    }
    const isConfirmed = await askConfirm(
      "This will overwrite unsaved grid entries with algorithmic suggestions prefilled according to the demand, stock, and safety margins. Would you like to calculate and apply now?",
      "Confirm Suggestion"
    );
    if (isConfirmed) {
      await handleSuggestPlans();
    }
  };

  const handleCsvImport = async (data: any[]) => {
    if (!hasRole('planner')) {
      showToast('Your account is read-only - Planner or Admin access is required to import production plans.', 'error');
      return;
    }
    setLoading(true);
    try {
      for (const row of data) {
        const prod = products.find(p => p.id === row.product_id);
        const machineName = prod ? prod.product_line : 'Pants';
        const machineId = machines.find(m => m.name === machineName)?.id || 'M4';

        const existing = productionPlans.find(p => 
          p.product_id === row.product_id && 
          p.period_type === (row.period_type || selectedGrain) && 
          p.period_start === row.period_start
        );

        const finalRow: ProductionPlan = {
          id: existing ? existing.id : `PP_REC_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          product_id: row.product_id,
          machine_id: row.machine_id || machineId,
          period_type: row.period_type || selectedGrain,
          period_start: row.period_start,
          quantity: Number(row.quantity || 0)
        };
        await saveRecord<ProductionPlan>('production_plan', finalRow);
      }
      await loadData();
      showToast(`Imported ${data.length} production slots successfully!`, "success");
    } catch (err: any) {
      showToast("Import failed: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const getCellValue = (productId: string, colDate: string): string => {
    const editKey = `${productId}:${colDate}`;
    if (gridEdits[editKey] !== undefined) {
      return String(gridEdits[editKey]);
    }

    const rec = productionPlans.find(p => 
      p.product_id === productId && 
      p.period_type === selectedGrain && 
      p.period_start === colDate
    );

    return rec ? String(rec.quantity) : '';
  };

  const calculateMachineColumnSum = (mName: string, colDate: string): number => {
    const mProducts = products.filter(p => p.product_line === mName);
    let total = 0;
    mProducts.forEach(p => {
      total += Number(getCellValue(p.id, colDate)) || 0;
    });
    return total;
  };

  const getAdjustedCapacity = (machineCapacity: number | undefined) => {
    const cap = machineCapacity || 300000;
    if (selectedGrain === 'week') return Math.round(cap / 4);
    if (selectedGrain === 'day') return Math.round(cap / 30);
    return cap;
  };

  const formatHeader = (colDate: string) => {
    if (selectedGrain === 'month') {
      const parts = colDate.split('-');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${months[parseInt(parts[1]) - 1]} ${parts[0]}`;
    }
    const date = new Date(colDate);
    return date.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
  };

  // Filter products matching Search Query using useTableFilters hook
  const { filtered: filteredProducts, hasActiveSearch } = useTableFilters<Product>(
    products,
    ['name', 'sku', 'product_line', 'brand'],
    {},
    searchQuery,
    setSearchQuery
  );

  // Pivot Logic & Capacity Color-Coding for Reports
  const machineReportRows = useMemo(() => {
    return machines.map(mac => {
      const capacity = getAdjustedCapacity(mac.monthly_capacity);
      const colsData = columns.map(col => {
        const sum = calculateMachineColumnSum(mac.name, col);
        const utilization = capacity > 0 ? (sum / capacity) * 100 : 0;
        return { sum, utilization };
      });
      return { machine: mac, capacity, colsData };
    });
  }, [machines, products, columns, productionPlans, gridEdits, selectedGrain]);

  const skuReportRows = useMemo(() => {
    return filteredProducts.map(p => {
      const colsData = columns.map(col => {
        const val = Number(getCellValue(p.id, col)) || 0;
        return val;
      });
      return { product: p, colsData };
    });
  }, [filteredProducts, columns, productionPlans, gridEdits]);

  const capacitySummaryMetrics = useMemo(() => {
    let totalCapacity = 0;
    let totalPlanned = 0;
    let overloadedMachinesCount = 0;

    machineReportRows.forEach(row => {
      totalCapacity += row.capacity * (columns.length || 1);
      row.colsData.forEach(col => {
        totalPlanned += col.sum;
        if (col.utilization > 95) {
          overloadedMachinesCount++;
        }
      });
    });

    const overallUtilization = totalCapacity > 0 ? (totalPlanned / totalCapacity) * 100 : 0;

    return {
      totalCapacity,
      totalPlanned,
      overallUtilization,
      overloadedMachinesCount,
    };
  }, [machineReportRows, columns]);

  // Export CSV function for pivot reports.
  // Routed through the shared writer so machine/product names get RFC 4180
  // escaping and formula-injection neutralising rather than raw concatenation.
  const exportReportToCsv = () => {
    let headers: string[];
    let rows: unknown[][];

    if (reportView === 'machine') {
      headers = ['Machine', 'Base Capacity', ...columns.map(col => formatHeader(col))];
      rows = machineReportRows.map(row => [
        row.machine.name,
        row.capacity,
        ...row.colsData.map(c => `${c.sum} (${c.utilization.toFixed(1)}%)`),
      ]);
    } else {
      headers = ['SKU', 'Name', 'Machine', ...columns.map(col => formatHeader(col))];
      rows = skuReportRows.map(row => [
        row.product.sku,
        row.product.name,
        row.product.product_line,
        ...row.colsData,
      ]);
    }

    if (rows.length === 0) {
      showToast('Nothing to export — no rows match the current filters.', 'error');
      return;
    }

    downloadCsv(toCsvText(headers, rows), `production_report_${reportView}_${selectedGrain}`);
    showToast(
      `${reportView === 'machine' ? 'By Machine' : 'By SKU'} report exported (${rows.length} rows).`,
      'success'
    );
  };

  return (
    <div className="space-y-6" id="production_plan_screen">
      <ContentHeader
        title="Master Production (MPS)"
        actions={
          <div className="flex items-center gap-2.5">
            {activeTab === 'schedule' ? (
              <>
                <button
                  id="btn_suggest_mps"
                  onClick={handleSuggestPlansClick}
                  className="btn-base btn-purple gap-1.5 shadow-sm"
                  title="Pre-fill based on sales demand − stock + SS level"
                >
                  <Sparkles className="w-3.5 h-3.5 text-white animate-pulse" />
                  Suggest From Sales
                </button>
                <CsvImportHelper 
                  fields={[
                    { key: 'product_id', label: 'Product ID *', required: true },
                    { key: 'period_start', label: 'Period Start (YYYY-MM-DD) *', required: true },
                    { key: 'quantity', label: 'Quantity *', required: true, defaultValue: 0 },
                    { key: 'machine_id', label: 'Machine ID (Optional)' },
                    { key: 'period_type', label: 'Grain (Optional: day/week/month)' }
                  ]}
                  onImport={handleCsvImport}
                  title="Import MPS Plan"
                />
                <button
                  id="btn_save_prod_grid"
                  onClick={handleSaveGrid}
                  disabled={Object.keys(gridEdits).length === 0}
                  className="btn-base btn-emerald gap-1.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save className="w-4 h-4 text-white" />
                  Save Changes ({Object.keys(gridEdits).length})
                </button>
              </>
            ) : (
              <button
                id="btn_export_prod_report"
                onClick={exportReportToCsv}
                className="btn-base btn-sky gap-1.5 shadow-sm"
              >
                <Download className="w-4 h-4 text-white" />
                Export CSV Report
              </button>
            )}
          </div>
        }
      />

      {/* Executive Capacity Overview KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-sans">
        <KpiCard
          label="Total Plant Capacity"
          value={`${capacitySummaryMetrics.totalCapacity.toLocaleString()} Pcs`}
          sub={`${machines.length} Active Lines (${selectedGrain})`}
          icon={<Cpu className="w-4 h-4 text-brand-600" />}
          intent="info"
        />
        <KpiCard
          label="Total Scheduled Volume"
          value={`${capacitySummaryMetrics.totalPlanned.toLocaleString()} Pcs`}
          sub={`${products.length} Scheduled SKUs`}
          icon={<Layers className="w-4 h-4 text-brand-600" />}
          intent="info"
        />
        <KpiCard
          label="Plant Capacity Utilization"
          value={`${capacitySummaryMetrics.overallUtilization.toFixed(1)}%`}
          sub={
            capacitySummaryMetrics.overallUtilization > 95
              ? 'Over capacity - re-balancing recommended'
              : capacitySummaryMetrics.overallUtilization > 80
              ? 'High utilization - optimal throughput'
              : 'Sufficient buffer capacity available'
          }
          icon={<Gauge className="w-4 h-4" />}
          intent={
            capacitySummaryMetrics.overallUtilization > 95
              ? 'danger'
              : capacitySummaryMetrics.overallUtilization > 80
              ? 'warning'
              : 'success'
          }
        />
        <KpiCard
          label="Machine Bottlenecks"
          value={
            capacitySummaryMetrics.overloadedMachinesCount > 0
              ? `${capacitySummaryMetrics.overloadedMachinesCount} Overloaded Periods`
              : '0 Bottlenecks'
          }
          sub="Periods exceeding >95% line capacity"
          icon={<AlertTriangle className="w-4 h-4" />}
          intent={capacitySummaryMetrics.overloadedMachinesCount > 0 ? 'danger' : 'success'}
        />
      </div>

      <ErrorState error={error} onRetry={loadData} />

      {/* Primary Tab Switcher */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab('schedule')}
          className={`px-4 py-2 text-xs font-bold flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
            activeTab === 'schedule'
              ? 'border-brand-600 text-brand-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Table className="w-4 h-4" />
          Interactive Schedule
        </button>
        <button
          onClick={() => setActiveTab('reports')}
          className={`px-4 py-2 text-xs font-bold flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
            activeTab === 'reports'
              ? 'border-brand-600 text-brand-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          Production Reports & Pivots
        </button>
      </div>

      {/* Control row */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs font-sans">
        <div className="flex flex-wrap items-center gap-3">
          {/* Grain Switcher */}
          <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-lg border border-slate-200" id="mps_grain_switcher">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-1">Grain:</span>
            {(['day', 'week', 'month'] as GrainType[]).map(grain => (
              <button
                key={grain}
                id={`mps_grain_${grain}`}
                onClick={() => setSelectedGrain(grain)}
                className={`px-3 py-1 text-xs font-bold capitalize rounded-md transition-all cursor-pointer ${
                  selectedGrain === grain 
                    ? 'bg-brand-600 text-white shadow-2xs' 
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {grain}
              </button>
            ))}
          </div>

          {/* View mode switcher for report tab */}
          {activeTab === 'reports' && (
            <div className="flex bg-slate-50 p-1 rounded-lg border border-slate-200" id="report_view_switcher">
              <button
                onClick={() => setReportView('machine')}
                className={`px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                  reportView === 'machine'
                    ? 'bg-brand-600 text-white shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                By Machine
              </button>
              <button
                onClick={() => setReportView('sku')}
                className={`px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                  reportView === 'sku'
                    ? 'bg-brand-600 text-white shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                By SKU
              </button>
            </div>
          )}

          {/* Search input */}
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search SKUs/products..."
            className="w-48"
            hasActiveSearch={hasActiveSearch}
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (products.length > 0) {
                setBalancerProductId(products[0].id);
                setBalancerTargetLine(machines[0]?.name || 'VOXY');
              }
              setIsLoadBalancerOpen(true);
            }}
            className="btn-base btn-secondary gap-1.5"
            title="Open Machine Line Load Balancer"
          >
            <Cpu className="w-3.5 h-3.5 text-brand-600" /> Re-balance Machine Load
          </button>
          <button onClick={loadData} aria-label="Refresh data" className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors cursor-pointer" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {(loading && isFirstLoad) ? (
        <div className="flex justify-center items-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600"></div>
        </div>
      ) : activeTab === 'schedule' ? (
        /* MAIN INTERACTIVE MPS GRID TAB */
        <div className="space-y-6 font-sans" id="mps_machines_blocks_container">
          {machines.map(mac => {
            const mProducts = products.filter(p => 
              p.product_line === mac.name &&
              (searchQuery === '' || 
               p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
               p.sku.toLowerCase().includes(searchQuery.toLowerCase()))
            );

            const dynamicCapacity = getAdjustedCapacity(mac.monthly_capacity);

            return (
              <div key={mac.id} className="card-elevated overflow-hidden">
                {/* Machine Header */}
                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-brand-600" />
                    <div>
                      <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">{mac.name} Line</h3>
                      <p className="text-[10px] text-slate-400 font-sans">{mac.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-700 border border-slate-200 rounded-md text-[10px] font-bold">
                      Capacity: {dynamicCapacity.toLocaleString()} / period
                    </span>
                    <span className="px-2 py-0.5 bg-brand-50 text-brand-700 rounded-md text-[10px] font-bold">
                      {mProducts.length} SKUs Assigned
                    </span>
                  </div>
                </div>

                {/* SKU Grid */}
                <div className="overflow-x-auto">
                  <ScrollableTable>
                    <table className="min-w-full divide-y divide-slate-200 text-left text-xs font-sans">
                      <thead className="bg-slate-100/90 text-[10px] font-extrabold text-slate-600 uppercase tracking-wider border-b border-slate-200">
                        <tr>
                          <th className="px-4 py-3 min-w-[260px]">Finished Product / SKU</th>
                          <th className="px-4 py-3 min-w-[130px]">Pack / Size</th>
                          {columns.map(col => (
                            <th key={col} className="px-4 py-3 text-right font-mono min-w-[140px] text-slate-700">
                              {formatHeader(col)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-xs text-slate-900 bg-white">
                        {mProducts.map(p => (
                          <tr key={p.id} className="hover:bg-brand-50/20 transition-colors">
                            <td className="px-4 py-2.5">
                              <div className="font-bold text-slate-900 text-xs leading-snug">{p.name}</div>
                              <div className="font-mono text-[10px] font-bold text-brand-700 bg-brand-50/80 px-1.5 py-0.5 rounded border border-brand-200/60 inline-block mt-0.5">
                                {p.sku}
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-slate-600 font-medium">
                              {p.pack_type || '-'} <span className="text-slate-400">({p.size || '-'})</span>
                            </td>
                            {columns.map(col => (
                              <td key={col} className="px-3 py-1.5 text-right">
                                <input
                                  type="number"
                                  placeholder="0"
                                  // Each grid cell is a product x period intersection, so a
                                  // static label would announce every cell identically.
                                  aria-label={`Production quantity for ${p.sku}, ${formatHeader(col)}`}
                                  value={getCellValue(p.id, col)}
                                  onChange={(e) => handleCellChange(p.id, col, e.target.value)}
                                  className="w-full text-right p-2 border border-slate-200/80 rounded-lg bg-slate-50/30 hover:border-brand-400 focus:border-brand-600 focus:bg-white focus:ring-2 focus:ring-brand-100 focus:outline-hidden font-bold font-mono text-xs text-slate-900 transition-all shadow-3xs"
                                />
                              </td>
                            ))}
                          </tr>
                        ))}

                        {mProducts.length === 0 && (
                          <tr>
                            <td colSpan={2 + columns.length} className="px-4 py-8">
                              <EmptyState
                                title="No Assigned SKUs"
                                message="No products assigned to this machine line match your search filter."
                              />
                            </td>
                          </tr>
                        )}

                        {mProducts.length > 0 && (
                          <tr className="bg-brand-50/80 border-t-2 border-brand-300 font-bold text-slate-900">
                            <td colSpan={2} className="px-4 py-3 uppercase text-[10px] tracking-wider text-brand-950 font-black font-sans">
                              <div className="flex items-center gap-1.5">
                                <TrendingUp className="w-3.5 h-3.5 text-brand-600" />
                                Total {mac.name} Production Volume
                              </div>
                            </td>
                            {columns.map(col => {
                              const totalVol = calculateMachineColumnSum(mac.name, col);
                              return (
                                <td key={col} className="px-4 py-3 text-right">
                                  <span className="font-mono font-black text-xs text-brand-900 bg-white px-2.5 py-1 rounded-md border border-brand-200 shadow-2xs inline-block">
                                    {totalVol.toLocaleString()}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        )}

                        {mProducts.length > 0 && (
                          <tr className="bg-slate-100/90 font-semibold border-t border-b-2 border-slate-300 text-slate-800">
                            <td colSpan={2} className="px-4 py-3 uppercase text-[10px] tracking-wider text-slate-800 font-extrabold font-sans">
                              Machine Capacity Utilization
                            </td>
                            {columns.map(col => {
                              const sum = calculateMachineColumnSum(mac.name, col);
                              const utilization = dynamicCapacity > 0 ? (sum / dynamicCapacity) * 100 : 0;
                              
                              let statusBg = 'bg-emerald-50 border-emerald-200 text-emerald-950';
                              let textClass = 'text-emerald-700 font-black';
                              let barBg = 'bg-emerald-500';
                              let badgeText = '✓ OPTIMAL';
                              let badgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-300';

                              if (utilization > 95) {
                                statusBg = 'bg-red-50 border-red-300 text-red-950';
                                textClass = 'text-red-700 font-black';
                                barBg = 'bg-red-600 animate-pulse';
                                badgeText = '⚠️ OVERLOAD';
                                badgeClass = 'bg-red-100 text-red-800 border-red-300 font-black';
                              } else if (utilization > 80) {
                                statusBg = 'bg-amber-50 border-amber-200 text-amber-950';
                                textClass = 'text-amber-800 font-black';
                                barBg = 'bg-amber-500';
                                badgeText = '⚡ HIGH LOAD';
                                badgeClass = 'bg-amber-100 text-amber-900 border-amber-300 font-bold';
                              } else if (utilization < 30 && utilization > 0) {
                                statusBg = 'bg-sky-50 border-sky-200 text-sky-900';
                                textClass = 'text-sky-700 font-bold';
                                barBg = 'bg-sky-400';
                                badgeText = 'LOW LOAD';
                                badgeClass = 'bg-sky-100 text-sky-800 border-sky-200';
                              } else if (utilization === 0) {
                                statusBg = 'bg-slate-50 border-slate-200 text-slate-500';
                                textClass = 'text-slate-400 font-bold';
                                barBg = 'bg-slate-300';
                                badgeText = 'IDLE';
                                badgeClass = 'bg-slate-100 text-slate-500 border-slate-200';
                              }

                              return (
                                <td key={col} className="px-3 py-2.5 text-right font-mono text-xs">
                                  <div className={`p-2 rounded-lg border shadow-3xs flex flex-col items-end gap-1 ${statusBg}`}>
                                    <div className="flex items-center justify-between w-full gap-1 text-[11px]">
                                      <span className="font-sans text-[9px] font-bold text-slate-500 uppercase tracking-wide">util:</span>
                                      <span className={`font-mono text-xs ${textClass}`}>
                                        {utilization.toFixed(1)}%
                                      </span>
                                    </div>
                                    
                                    <div className="w-full bg-slate-200/80 rounded-full h-2 overflow-hidden border border-slate-300/40">
                                      <div 
                                        className={`h-full rounded-full transition-all ${barBg}`} 
                                        style={{ width: `${Math.min(100, utilization)}%` }}
                                      ></div>
                                    </div>

                                    <span className={`inline-block px-1.5 py-0.5 border text-[9px] font-extrabold rounded-md font-sans tracking-wide uppercase mt-0.5 ${badgeClass}`}>
                                      {badgeText}
                                    </span>
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </ScrollableTable>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* REPORTS AND PIVOTS TAB */
        <div className="card-elevated overflow-hidden font-sans p-4 space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              {reportView === 'machine' ? 'Production Capacity Audit Pivot (By Machine)' : 'Finished Goods Production Plan Pivot (By SKU)'}
            </h3>
            <span className="text-[10px] text-slate-400 font-mono">Grain: {selectedGrain}</span>
          </div>

          <div className="overflow-x-auto">
            <ScrollableTable>
              {reportView === 'machine' ? (
                /* BY MACHINE REPORT TABLE */
                <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Machine</th>
                      <th className="px-4 py-3 text-right">Base Capacity</th>
                      {columns.map(col => (
                        <th key={col} className="px-4 py-3 text-right font-mono min-w-[140px]">
                          {formatHeader(col)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {machineReportRows.map(row => (
                      <tr key={row.machine.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-4">
                          <span className="font-bold text-slate-800">{row.machine.name}</span>
                          <span className="block text-[10px] text-slate-400 mt-0.5">{row.machine.description}</span>
                        </td>
                        <td className="px-4 py-4 text-right font-mono font-bold text-slate-500">
                          {row.capacity.toLocaleString()}
                        </td>
                        {row.colsData.map((col, idx) => {
                          let colorClass = "text-emerald-700 bg-emerald-50/40 border border-emerald-100";
                          if (col.utilization > 100) {
                            colorClass = "text-red-700 bg-red-50/50 border border-red-200 font-bold";
                          } else if (col.utilization > 80) {
                            colorClass = "text-amber-700 bg-amber-50/40 border border-amber-100";
                          }

                          return (
                            <td key={idx} className="px-4 py-3 text-right">
                              <div className="flex flex-col items-end gap-1">
                                <span className="font-mono font-extrabold text-slate-800">
                                  {col.sum.toLocaleString()}
                                </span>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-mono ${colorClass}`}>
                                  {col.utilization.toFixed(1)}% util
                                </span>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                /* BY SKU REPORT TABLE */
                <table className="min-w-full divide-y divide-slate-200 text-left text-xs font-sans">
                  <thead className="bg-slate-100/90 text-[10px] font-extrabold text-slate-600 uppercase tracking-wider border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 min-w-[260px]">Finished Product / SKU</th>
                      <th className="px-4 py-3 min-w-[120px]">Machine Line</th>
                      {columns.map(col => (
                        <th key={col} className="px-4 py-3 text-right font-mono min-w-[130px] text-slate-700">
                          {formatHeader(col)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs bg-white">
                    {skuReportRows.map(row => (
                      <tr key={row.product.id} className="hover:bg-brand-50/20 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-bold text-slate-900 text-xs leading-snug">{row.product.name}</div>
                          <div className="font-mono text-[10px] font-bold text-brand-700 bg-brand-50/80 px-1.5 py-0.5 rounded border border-brand-200/60 inline-block mt-0.5">
                            {row.product.sku}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-700 border border-slate-200 rounded-md text-[10px] font-bold font-mono">
                            {row.product.product_line}
                          </span>
                        </td>
                        {row.colsData.map((val, idx) => (
                          <td key={idx} className="px-4 py-3 text-right font-mono font-bold text-slate-800">
                            {val > 0 ? val.toLocaleString() : "-"}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {skuReportRows.length === 0 && (
                      <tr>
                        <td colSpan={2 + columns.length} className="px-4 py-8 text-center text-slate-400">
                          No matching SKUs found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </ScrollableTable>
          </div>
        </div>
      )}

      {/* RE-BALANCE MACHINE LINE LOAD MODAL */}
      {isLoadBalancerOpen && (
        <div className="fixed inset-0 z-[4600] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Re-balance machine line capacity">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden flex flex-col border border-slate-100 font-sans animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-brand-50">
              <h3 className="text-sm font-bold text-brand-950 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-brand-600" /> Plant Machinery Load Balancer
              </h3>
              <button 
                onClick={() => setIsLoadBalancerOpen(false)} 
                className="text-slate-400 hover:text-slate-600 font-bold p-1 bg-white border border-slate-200 rounded-md shadow-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs leading-relaxed">
              <div className="p-3 bg-brand-50 border border-brand-200 text-brand-900 rounded-lg">
                Re-assign SKU production routing between machine lines (SOFY, VOXY, Atlas, Pants) to relieve machine line overloads (&gt;95% capacity).
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Select Finished Product (SKU):</label>
                  <select
                    value={balancerProductId}
                    onChange={(e) => setBalancerProductId(e.target.value)}
                    className="w-full p-2 text-xs border border-slate-300 rounded-lg bg-white font-mono font-semibold text-slate-800 focus:ring-2 focus:ring-brand-500"
                  >
                    {products.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name} (Current: {p.product_line})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Target Machine Line:</label>
                  <select
                    value={balancerTargetLine}
                    onChange={(e) => setBalancerTargetLine(e.target.value)}
                    className="w-full p-2 text-xs border border-slate-300 rounded-lg bg-white font-bold text-slate-800 focus:ring-2 focus:ring-brand-500"
                  >
                    {machines.map(m => (
                      <option key={m.id} value={m.name}>
                        {m.name} Line ({m.description})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50">
              <button 
                onClick={() => setIsLoadBalancerOpen(false)}
                className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold rounded-lg text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button 
                onClick={handleRebalanceLine}
                className="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg text-xs shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                <Cpu className="w-3.5 h-3.5" /> Re-Assign Machine Line
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
