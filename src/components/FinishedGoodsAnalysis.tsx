/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  fetchTableData, getPlanningPeriod, getPlannedPeriods, formatPlanningPeriod,
  getVFGPSIAnalysis, isInPeriod
} from '../supabaseClient';
import {
  Product, ProductGroup, ProductCategory, SalesPlan, ProductionPlan,
  InventorySnapshot, SalesActual, ProductionActual, VFGPSIAnalysis
} from '../types';
import { 
  RefreshCw, ChevronRight, ChevronDown, SlidersHorizontal, 
  BarChart3, Tag, ShoppingBag, Eye, EyeOff, X 
} from 'lucide-react';
import { useToast } from '../context/ToastConfirmContext';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useTableFilters } from '../hooks/useTableFilters';
import SearchBar from './SearchBar';
import ScrollableTable from './ScrollableTable';
import ContentHeader from './ContentHeader';
import ErrorState from './ErrorState';
import DataStateWrapper from './DataStateWrapper';
import EmptyState from './EmptyState';
import { pcsPerCarton, CURRENCY } from '../utils/uom';

type GroupByOption = 'category' | 'group' | 'brand' | 'product_line' | 'pack_type' | 'size';
type UnitOption = 'pieces' | 'cartons' | 'value';

interface PSIMonthRow {
  monthStr: string;
  beginningInventory: number;
  production: number;
  sales: number;
  endingInventory: number;
}

interface FinishedGoodsAnalysisProps {
  searchQuery?: string;
  setSearchQuery?: (val: string) => void;
  refreshKey?: number;
}

export default function FinishedGoodsAnalysis({
  searchQuery = '',
  setSearchQuery = () => {},
  refreshKey = 0,
}: FinishedGoodsAnalysisProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [salesPlans, setSalesPlans] = useState<SalesPlan[]>([]);
  const [productionPlans, setProductionPlans] = useState<ProductionPlan[]>([]);
  const [inventorySnapshots, setInventorySnapshots] = useState<InventorySnapshot[]>([]);
  const [salesActuals, setSalesActuals] = useState<SalesActual[]>([]);
  const [productionActuals, setProductionActuals] = useState<ProductionActual[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Options
  const [groupBy, setGroupBy] = useState<GroupByOption>('category');
  const [unit, setUnit] = useState<UnitOption>('pieces');
  const [showObsolete, setShowObsolete] = useState(false);
  const [filterProductLine, setFilterProductLine] = useState('');
  const [filterPackType, setFilterPackType] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(getPlanningPeriod());

  // Months the dataset actually plans for, so the picker cannot offer a month
  // that resolves to an empty matrix. The active period is always included
  // even if nothing is planned for it yet.
  const monthOptions = useMemo(() => {
    const planned = getPlannedPeriods();
    return [...new Set([...planned, selectedMonth])].sort();
  }, [selectedMonth, refreshKey]);

  // Expanded Nodes state (e.g. "PC1" -> true)
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});

  // SKU detail modal state
  const [selectedSkuProduct, setSelectedSkuProduct] = useState<Product | null>(null);
  const [skuLedgerData, setSkuLedgerData] = useState<PSIMonthRow[]>([]);

  // Confines Tab to the ledger dialog and closes it on Escape.
  const skuLedgerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(skuLedgerRef, selectedSkuProduct !== null, () => setSelectedSkuProduct(null));

  // Period totals come from the engine rather than being summed again here.
  // This screen used to carry its own copy of the aggregation, which is how it
  // ended up matching periods differently from every other screen.
  const [psiRows, setPsiRows] = useState<VFGPSIAnalysis[]>([]);
  const psiByProduct = useMemo(() => {
    const map = new Map<string, VFGPSIAnalysis>();
    psiRows.forEach(r => map.set(r.row_id, r));
    return map;
  }, [psiRows]);

  const { showToast } = useToast();

  async function loadAllData() {
    setLoading(true);
    setError(null);
    try {
      const [prods, cats, grps, sales, prodPlans, inv, salesAct, prodAct] = await Promise.all([
        fetchTableData<Product>('products'),
        fetchTableData<ProductCategory>('product_categories'),
        fetchTableData<ProductGroup>('product_groups'),
        fetchTableData<SalesPlan>('sales_plan'),
        fetchTableData<ProductionPlan>('production_plan'),
        fetchTableData<InventorySnapshot>('inventory_snapshots'),
        fetchTableData<SalesActual>('sales_actual'),
        fetchTableData<ProductionActual>('production_actual')
      ]);
      setPsiRows(await getVFGPSIAnalysis(selectedMonth));

      setProducts(prods);
      setCategories(cats);
      setGroups(grps);
      setSalesPlans(sales);
      setProductionPlans(prodPlans);
      setInventorySnapshots(inv);
      setSalesActuals(salesAct);
      setProductionActuals(prodAct);
    } catch (e: any) {
      setError(e instanceof Error ? e.message : String(e));
      showToast('Failed to load PSI Analysis data: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAllData();
  }, [refreshKey, selectedMonth]);

  // Compute 4-month ledger for the selected SKU detail view
  useEffect(() => {
    if (!selectedSkuProduct) return;

    // Anchor the ledger to whichever month is currently selected in the main
    // matrix, not a hardcoded July 2026 - otherwise drilling into a SKU while
    // viewing August/September data would still show a ledger starting from
    // July, silently disagreeing with what's on screen.
    const [baseYear, baseMonth] = selectedMonth.split('-').map(Number);
    const ledger: PSIMonthRow[] = [];
    let runningInventory = 0;

    const initialSnap = inventorySnapshots.find(
      i => i.item_type === 'product' && i.item_id === selectedSkuProduct.id
    );
    runningInventory = initialSnap ? initialSnap.quantity : 0;

    for (let i = 0; i < 4; i++) {
      // Stepped on the calendar rather than through a UTC Date: parsing
      // "2026-08-01" gives UTC midnight, and reading it back with
      // toISOString() in a negative-offset zone returns the previous month.
      const targetDate = new Date(baseYear, baseMonth - 1 + i, 1);
      const mStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;

      const monthProd = productionPlans
        .filter(p => p.product_id === selectedSkuProduct.id && isInPeriod(p.period_start, mStr))
        .reduce((sum, p) => sum + p.quantity, 0);

      const monthSales = salesPlans
        .filter(s => s.product_id === selectedSkuProduct.id && isInPeriod(s.period_start, mStr))
        .reduce((sum, s) => sum + s.quantity, 0);

      const begInv = runningInventory;
      const endInv = begInv + monthProd - monthSales;

      ledger.push({
        monthStr: mStr,
        beginningInventory: begInv,
        production: monthProd,
        sales: monthSales,
        endingInventory: endInv
      });

      runningInventory = endInv;
    }

    setSkuLedgerData(ledger);
  }, [selectedSkuProduct, productionPlans, salesPlans, inventorySnapshots, selectedMonth]);

  const getProductValueMultiplier = (p: Product, mode: UnitOption): number => {
    if (mode === 'cartons') {
      // Was (pcs_per_bag || 10) * (bags_per_carton || 4), which invented a
      // 40-piece carton for any product missing its pack configuration and
      // reported a confident, wrong carton count. Now the shared helper
      // returns null and the row shows as unconvertible instead.
      const per = pcsPerCarton(p);
      return per === null ? 0 : 1 / per;
    }
    if (mode === 'value') {
      return p.selling_price || 0;
    }
    return 1;
  };

  const getProductMetrics = (p: Product) => {
    // Engine figures are in pieces; this screen's only addition is converting
    // them to the selected unit.
    const row = psiByProduct.get(p.id);
    const mult = getProductValueMultiplier(p, unit);

    if (!row) {
      return {
        startStock: 0, salesForecast: 0, actualSales: 0, productionPlan: 0,
        actualProduction: 0, expectedStock: 0, salesValue: 0,
      };
    }

    return {
      startStock: row.start_stock * mult,
      salesForecast: row.sales_forecast * mult,
      actualSales: row.actual_sales * mult,
      productionPlan: row.production_plan * mult,
      actualProduction: row.actual_production * mult,
      expectedStock: row.expected_stock * mult,
      // Value is always money, so it does not take the unit multiplier.
      salesValue: row.sales_value,
    };
  };

  // Filter products using useTableFilters hook & search bypass logic
  const { filtered: activeProductsList, hasActiveSearch } = useTableFilters<Product>(
    products,
    ['name', 'sku'],
    {},
    searchQuery,
    setSearchQuery,
    (p) => {
      const obsoleteMatch = showObsolete ? true : p.status !== 'obsolete';
      if (!obsoleteMatch) return false;

      // If there's an active search query, categorical filters are bypassed (enforced via useTableFilters)
      if (searchQuery.trim() !== '') {
        return true;
      }

      const plMatch = filterProductLine ? p.product_line === filterProductLine : true;
      const packMatch = filterPackType ? p.pack_type === filterPackType : true;
      return plMatch && packMatch;
    }
  );

  const productLines = useMemo(() => Array.from(new Set(products.map(p => p.product_line))).filter(Boolean), [products]);
  const packTypes = useMemo(() => Array.from(new Set(products.map(p => p.pack_type))).filter(Boolean), [products]);

  // Nodes generator types & structure
  interface PSINode {
    id: string;
    name: string;
    type: 'category' | 'group' | 'brand' | 'product_line' | 'pack_type' | 'size' | 'sku';
    children?: PSINode[];
    product?: Product;
    metrics: {
      startStock: number;
      salesForecast: number;
      actualSales: number;
      productionPlan: number;
      actualProduction: number;
      expectedStock: number;
      salesValue: number;
    };
  }

  const sumMetrics = (nodes: PSINode[]) => {
    const result = {
      startStock: 0,
      salesForecast: 0,
      actualSales: 0,
      productionPlan: 0,
      actualProduction: 0,
      expectedStock: 0,
      salesValue: 0
    };
    nodes.forEach(n => {
      result.startStock += n.metrics.startStock;
      result.salesForecast += n.metrics.salesForecast;
      result.actualSales += n.metrics.actualSales;
      result.productionPlan += n.metrics.productionPlan;
      result.actualProduction += n.metrics.actualProduction;
      result.expectedStock += n.metrics.expectedStock;
      result.salesValue += n.metrics.salesValue;
    });
    return result;
  };

  // Generate Pivot Nodes based on Group By
  const pivotNodes = useMemo((): PSINode[] => {
    const skuNodes = activeProductsList.map(p => {
      const node: PSINode = {
        id: `sku_${p.id}`,
        name: `${p.sku} - ${p.name}`,
        type: 'sku',
        product: p,
        metrics: getProductMetrics(p)
      };
      return node;
    });

    if (groupBy === 'category') {
      return categories.map(cat => {
        const catGroups = groups.filter(g => g.category_id === cat.id);
        const groupNodes = catGroups.map(g => {
          const gSkus = skuNodes.filter(s => s.product?.group_id === g.id);
          const metrics = sumMetrics(gSkus);
          return {
            id: `group_${g.id}`,
            name: g.name,
            type: 'group' as const,
            children: gSkus,
            metrics
          };
        }).filter(g => g.children.length > 0);

        const directSkus = skuNodes.filter(s => s.product?.category_id === cat.id);
        const metrics = sumMetrics(directSkus);

        return {
          id: `cat_${cat.id}`,
          name: cat.name,
          type: 'category' as const,
          children: groupNodes,
          metrics
        };
      }).filter(c => c.children.length > 0);
    }

    if (groupBy === 'group') {
      return groups.map(g => {
        const gSkus = skuNodes.filter(s => s.product?.group_id === g.id);
        const metrics = sumMetrics(gSkus);
        return {
          id: `group_${g.id}`,
          name: g.name,
          type: 'group' as const,
          children: gSkus,
          metrics
        };
      }).filter(g => g.children.length > 0);
    }

    const keysMap: Record<GroupByOption, keyof Product> = {
      category: 'category_id',
      group: 'group_id',
      brand: 'brand',
      product_line: 'product_line',
      pack_type: 'pack_type',
      size: 'size'
    };

    const key = keysMap[groupBy];
    const uniqueValues = Array.from(new Set(activeProductsList.map(p => p[key] as string))).filter(Boolean);

    return uniqueValues.map(val => {
      const gSkus = skuNodes.filter(s => s.product && s.product[key] === val);
      const metrics = sumMetrics(gSkus);
      return {
        id: `custom_${val}`,
        name: String(val),
        type: groupBy as any,
        children: gSkus,
        metrics
      };
    }).sort((a, b) => b.metrics.salesValue - a.metrics.salesValue);
  }, [activeProductsList, categories, groups, selectedMonth, groupBy, unit, salesPlans, productionPlans, inventorySnapshots, salesActuals, productionActuals]);

  // Aggregate total for final footer row
  const globalTotalMetrics = useMemo(() => sumMetrics(pivotNodes), [pivotNodes]);

  const toggleNode = (nodeId: string) => {
    setExpandedNodes(prev => ({
      ...prev,
      [nodeId]: !prev[nodeId]
    }));
  };

  const getMonthName = (dateStr: string) => {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const parts = dateStr.split('-');
    return `${months[parseInt(parts[1]) - 1]} ${parts[0]}`;
  };

  // Rendering row helper
  const renderNodeRow = (node: PSINode, depth: number) => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = !!expandedNodes[node.id];
    
    const salesPct = node.metrics.salesForecast > 0 
      ? (node.metrics.actualSales / node.metrics.salesForecast) * 100 
      : 0;
    const prodPct = node.metrics.productionPlan > 0 
      ? (node.metrics.actualProduction / node.metrics.productionPlan) * 100 
      : 0;
    const coverage = node.metrics.salesForecast > 0 
      ? node.metrics.expectedStock / node.metrics.salesForecast 
      : 0;

    return (
      <React.Fragment key={node.id}>
        <tr className={`hover:bg-slate-50 transition-colors ${depth === 0 ? 'bg-slate-50/50 font-semibold' : depth === 1 ? 'bg-slate-50/20' : ''}`}>
          <td className="px-4 py-3" style={{ paddingLeft: `${Math.max(12, depth * 24)}px` }}>
            <div className="flex items-center gap-2">
              {hasChildren ? (
                <button onClick={() => toggleNode(node.id)} className="p-0.5 hover:bg-slate-200 rounded text-slate-500 cursor-pointer">
                  {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
              ) : (
                <span className="w-5"></span>
              )}
              {node.type === 'sku' ? (
                <button 
                  onClick={() => setSelectedSkuProduct(node.product || null)}
                  className="text-left font-bold text-blue-600 hover:underline flex items-center gap-1.5 cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span className="truncate max-w-[200px] text-xs font-mono">{node.name}</span>
                </button>
              ) : (
                <span className="text-xs text-slate-700 capitalize flex items-center gap-1.5">
                  {node.type === 'category' ? <Tag className="w-3.5 h-3.5 text-indigo-500" /> : <ShoppingBag className="w-3.5 h-3.5 text-blue-500" />}
                  {node.name}
                </span>
              )}
            </div>
          </td>
          <td className="px-4 py-3 text-right font-mono text-xs text-slate-600">{Math.round(node.metrics.startStock).toLocaleString()}</td>
          <td className="px-4 py-3 text-right font-mono text-xs text-slate-700">{Math.round(node.metrics.salesForecast).toLocaleString()}</td>
          <td className="px-4 py-3 text-right font-mono text-xs text-slate-700">{Math.round(node.metrics.actualSales).toLocaleString()}</td>
          <td className={`px-4 py-3 text-right font-mono text-xs ${salesPct >= 95 ? 'text-emerald-600 font-bold' : salesPct >= 80 ? 'text-amber-600' : 'text-red-600'}`}>
            {salesPct.toFixed(1)}%
          </td>
          <td className="px-4 py-3 text-right font-mono text-xs text-slate-700">{Math.round(node.metrics.productionPlan).toLocaleString()}</td>
          <td className="px-4 py-3 text-right font-mono text-xs text-slate-700">{Math.round(node.metrics.actualProduction).toLocaleString()}</td>
          <td className={`px-4 py-3 text-right font-mono text-xs ${prodPct >= 95 ? 'text-emerald-600 font-bold' : prodPct >= 80 ? 'text-amber-600' : 'text-red-600'}`}>
            {prodPct.toFixed(1)}%
          </td>
          <td className={`px-4 py-3 text-right font-mono text-xs font-bold ${node.metrics.expectedStock < 0 ? 'text-red-600 bg-red-50' : 'text-slate-800'}`}>
            {Math.round(node.metrics.expectedStock).toLocaleString()}
          </td>
          <td className={`px-4 py-3 text-right font-mono text-xs font-bold ${coverage < 1 ? 'text-red-600 bg-red-50' : coverage > 3 ? 'text-amber-600' : 'text-emerald-600'}`}>
            {node.metrics.salesForecast > 0 ? `${coverage.toFixed(1)}m` : 'N/A'}
          </td>
          <td className="px-4 py-3 text-right font-mono text-xs font-bold text-slate-900">{CURRENCY} {Math.round(node.metrics.salesValue).toLocaleString()}</td>
        </tr>
        {hasChildren && isExpanded && node.children?.map(child => renderNodeRow(child, depth + 1))}
      </React.Fragment>
    );
  };

  // Horizontal SVG Chart data
  const chartData = useMemo(() => {
    return pivotNodes.slice(0, 10).map(n => ({
      name: n.name,
      value: n.metrics.salesValue
    }));
  }, [pivotNodes]);

  const maxValue = useMemo(() => {
    return Math.max(...chartData.map(d => d.value), 1);
  }, [chartData]);

  return (
    <div className="space-y-6" id="finished_goods_psi_screen">
      <ContentHeader
        title="PSI Analysis"
        actions={
          <button 
            onClick={loadAllData} 
            className="btn-base btn-teal gap-1.5 shadow-sm"
          >
            <RefreshCw className="w-3.5 h-3.5 text-white" />
            Refresh Data
          </button>
        }
      />

      <ErrorState error={error} onRetry={loadAllData} />

      {/* Control Panel / Filters Row */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-wrap items-center gap-4 text-xs font-sans">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search SKUs or names..."
          className="w-48 font-medium text-slate-700"
          hasActiveSearch={hasActiveSearch}
        />

        <div className="h-4 w-[1px] bg-slate-200"></div>

        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-slate-500 uppercase">Group By:</span>
          <select aria-label="Group by" 
            value={groupBy} 
            onChange={(e) => { setGroupBy(e.target.value as GroupByOption); setExpandedNodes({}); }}
            className="px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-hidden font-medium text-slate-700 cursor-pointer"
          >
            <option value="category">Category</option>
            <option value="group">Group</option>
            <option value="brand">Brand</option>
            <option value="product_line">Product Line</option>
            <option value="pack_type">Pack Type</option>
            <option value="size">Size</option>
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-slate-500 uppercase">Unit:</span>
          <select aria-label="Unit" 
            value={unit} 
            onChange={(e) => setUnit(e.target.value as UnitOption)}
            className="px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-hidden font-medium text-slate-700 cursor-pointer"
          >
            <option value="pieces">Pieces</option>
            <option value="cartons">Cartons</option>
            <option value="value">Value</option>
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-slate-500 uppercase">Month:</span>
          <select aria-label="Select month" 
            value={selectedMonth} 
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-hidden font-medium text-slate-700 cursor-pointer"
          >
            {monthOptions.map(m => (
              <option key={m} value={m}>{formatPlanningPeriod(m)}</option>
            ))}
          </select>
        </div>

        <div className="h-4 w-[1px] bg-slate-200"></div>

        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-slate-500 uppercase">Line:</span>
          <select aria-label="Filter by product line" 
            value={filterProductLine} 
            onChange={(e) => setFilterProductLine(e.target.value)}
            className="px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-hidden font-medium text-slate-700 cursor-pointer"
          >
            <option value="">All Lines</option>
            {productLines.map(line => <option key={line} value={line}>{line}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-slate-500 uppercase">Pack:</span>
          <select aria-label="Filter by pack type" 
            value={filterPackType} 
            onChange={(e) => setFilterPackType(e.target.value)}
            className="px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-hidden font-medium text-slate-700 cursor-pointer"
          >
            <option value="">All Packs</option>
            {packTypes.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <button 
          onClick={() => setShowObsolete(!showObsolete)}
          className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
            showObsolete 
              ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100' 
              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          {showObsolete ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          {showObsolete ? 'Showing Obsolete' : 'Obsolete Hidden'}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-48 bg-white border border-slate-100 rounded-xl">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          
          {/* Left / Main Table */}
          <div className="xl:col-span-2 bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                PSI Pivot Matrix — {getMonthName(selectedMonth)}
              </h3>
              <span className="text-[10px] bg-blue-50 text-blue-700 font-bold px-2 py-0.5 rounded uppercase">
                {unit} unit mode
              </span>
            </div>

            <div className="overflow-x-auto">
              <ScrollableTable>
                <table className="min-w-full divide-y divide-slate-200 text-left text-xs font-sans">
                  <thead className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3 min-w-[200px]">Node Tree</th>
                      <th className="px-4 py-3 text-right">Start Stock</th>
                      <th className="px-4 py-3 text-right">Sales Fcast</th>
                      <th className="px-4 py-3 text-right">Actual Sales</th>
                      <th className="px-4 py-3 text-right">Sales %</th>
                      <th className="px-4 py-3 text-right">Prod Plan</th>
                      <th className="px-4 py-3 text-right">Actual Prod</th>
                      <th className="px-4 py-3 text-right">Prod %</th>
                      <th className="px-4 py-3 text-right">Exp Stock</th>
                      <th className="px-4 py-3 text-right">Cover</th>
                      <th className="px-4 py-3 text-right">Sales Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-800">
                    {pivotNodes.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="px-4 py-8">
                          <EmptyState
                            title="No Products Found"
                            message="No active products match your selected filters."
                          />
                        </td>
                      </tr>
                    ) : (
                      pivotNodes.map(node => renderNodeRow(node, 0))
                    )}
                  </tbody>
                  <tfoot className="bg-slate-100 font-bold border-t-2 border-slate-300">
                    <tr>
                      <td className="px-4 py-3">Total Rollup ({getMonthName(selectedMonth)})</td>
                      <td className="px-4 py-3 text-right font-mono">{Math.round(globalTotalMetrics.startStock).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono">{Math.round(globalTotalMetrics.salesForecast).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono">{Math.round(globalTotalMetrics.actualSales).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono text-blue-700">
                        {(globalTotalMetrics.salesForecast > 0 ? (globalTotalMetrics.actualSales / globalTotalMetrics.salesForecast) * 100 : 0).toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{Math.round(globalTotalMetrics.productionPlan).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono">{Math.round(globalTotalMetrics.actualProduction).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono text-emerald-700">
                        {(globalTotalMetrics.productionPlan > 0 ? (globalTotalMetrics.actualProduction / globalTotalMetrics.productionPlan) * 100 : 0).toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{Math.round(globalTotalMetrics.expectedStock).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono text-indigo-700">
                        {(globalTotalMetrics.salesForecast > 0 ? (globalTotalMetrics.expectedStock / globalTotalMetrics.salesForecast) : 0).toFixed(1)}m
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-900">{CURRENCY} {Math.round(globalTotalMetrics.salesValue).toLocaleString()}</td>
                    </tr>
                  </tfoot>
                </table>
              </ScrollableTable>
            </div>
          </div>

          {/* Right / Visualisations Panel */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-6 font-sans">
            <div>
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-3 flex items-center gap-1.5">
                <BarChart3 className="w-4 h-4 text-blue-600" /> July Sales Value by Group
              </h3>
              <p className="text-[11px] text-slate-500 mt-1">Horizontal distribution of forecasted sales value across the selected group-by dimension.</p>
            </div>

            {chartData.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-12">No data to display</p>
            ) : (
              <div className="space-y-4">
                {chartData.map((d, i) => {
                  const pct = Math.max(2, (d.value / maxValue) * 100);
                  return (
                    <div key={i} className="space-y-1 text-xs">
                      <div className="flex justify-between items-center text-slate-600">
                        <span className="font-semibold truncate max-w-[160px]">{d.name}</span>
                        <span className="font-mono font-bold">{CURRENCY} {Math.round(d.value).toLocaleString()}</span>
                      </div>
                      <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
                        <div 
                          className="bg-blue-600 h-full rounded-full transition-all duration-500" 
                          style={{ width: `${pct}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-lg text-xs leading-relaxed text-blue-800 space-y-1">
              <h4 className="font-bold flex items-center gap-1">
                <SlidersHorizontal className="w-3.5 h-3.5" /> Drill Down Tip
              </h4>
              <p>Click any row folder arrow to expand sub-nodes. Deep-drill into a SKU row and click its code to show the 4-month rolling monthly balance sheet.</p>
            </div>
          </div>

        </div>
      )}

      {/* SKU MONTHLY LEDGER DETAIL DRAWER / MODAL */}
      {selectedSkuProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs font-sans" role="dialog" aria-modal="true" aria-label="SKU monthly ledger detail">
          <div ref={skuLedgerRef} className="bg-white rounded-xl shadow-xl w-full max-w-4xl overflow-hidden flex flex-col border border-slate-100">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div>
                <span className="text-[10px] text-blue-600 font-bold uppercase tracking-wider font-mono">Monthly PSI Balance Sheet</span>
                <h3 className="text-sm font-bold text-slate-900 mt-0.5">
                  {selectedSkuProduct.sku} - {selectedSkuProduct.name}
                </h3>
              </div>
              <button 
                onClick={() => setSelectedSkuProduct(null)} 
                className="text-slate-400 hover:text-slate-600 p-1 bg-white border border-slate-200 rounded-lg shadow-sm cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              {/* Product Target Details Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <span className="text-slate-400 block mb-0.5">Product Line</span>
                  <span className="font-bold text-slate-700">{selectedSkuProduct.product_line}</span>
                </div>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <span className="text-slate-400 block mb-0.5">Pack Type & Size</span>
                  <span className="font-bold text-slate-700">{selectedSkuProduct.pack_type} ({selectedSkuProduct.size})</span>
                </div>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <span className="text-slate-400 block mb-0.5">Pcs/Bag × Bags/Carton</span>
                  <span className="font-bold text-slate-700 font-mono">
                    {selectedSkuProduct.pcs_per_bag} × {selectedSkuProduct.bags_per_carton} ({selectedSkuProduct.pcs_per_bag * selectedSkuProduct.bags_per_carton} pcs)
                  </span>
                </div>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <span className="text-slate-400 block mb-0.5">Selling Unit Price</span>
                  <span className="font-bold text-emerald-600 font-mono">EGP {selectedSkuProduct.selling_price.toFixed(2)}</span>
                </div>
              </div>

              {/* Monthly Ledger Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                <ScrollableTable>
                  <table className="min-w-full divide-y divide-slate-200 text-xs">
                    <thead className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      <tr>
                        <th className="px-5 py-3">PSI Metric (Pcs)</th>
                        {skuLedgerData.map(d => (
                          <th key={d.monthStr} className="px-5 py-3 text-right font-mono min-w-[140px]">
                            {getMonthName(d.monthStr + '-01').split(' ')[0]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-slate-800">
                      <tr className="hover:bg-slate-50">
                        <td className="px-5 py-4 font-semibold text-slate-600 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                          Beginning Inventory
                        </td>
                        {skuLedgerData.map(d => (
                          <td key={d.monthStr} className="px-5 py-4 text-right font-semibold font-mono text-slate-700">
                            {d.beginningInventory.toLocaleString()}
                          </td>
                        ))}
                      </tr>

                      <tr className="bg-emerald-50/20 hover:bg-emerald-50/35">
                        <td className="px-5 py-4 font-semibold text-emerald-800 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                          Production Schedule (MPS)
                        </td>
                        {skuLedgerData.map(d => (
                          <td key={d.monthStr} className="px-5 py-4 text-right font-bold font-mono text-emerald-700">
                            +{d.production.toLocaleString()}
                          </td>
                        ))}
                      </tr>

                      <tr className="bg-red-50/20 hover:bg-red-50/35">
                        <td className="px-5 py-4 font-semibold text-red-800 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-red-500"></span>
                          Forecasted Demand
                        </td>
                        {skuLedgerData.map(d => (
                          <td key={d.monthStr} className="px-5 py-4 text-right font-bold font-mono text-red-600">
                            -{d.sales.toLocaleString()}
                          </td>
                        ))}
                      </tr>

                      <tr className="bg-indigo-50/30 border-t-2 border-indigo-100 font-bold">
                        <td className="px-5 py-4 uppercase text-[10px] tracking-wider text-indigo-900 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
                          Ending Inventory Balance
                        </td>
                        {skuLedgerData.map(d => {
                          const isOos = d.endingInventory < 0;
                          return (
                            <td 
                              key={d.monthStr} 
                              className={`px-5 py-4 text-right font-extrabold font-mono text-sm ${
                                isOos ? 'text-red-600 bg-red-100' : 'text-blue-600'
                              }`}
                            >
                              {d.endingInventory.toLocaleString()}
                              {isOos && <span className="block text-[8px] font-bold text-red-500 mt-0.5">OOS RISK</span>}
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </ScrollableTable>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex justify-end bg-slate-50">
              <button 
                onClick={() => setSelectedSkuProduct(null)}
                className="px-4 py-2 bg-slate-800 text-white hover:bg-slate-950 font-semibold rounded-lg text-xs cursor-pointer"
              >
                Close Detail
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
