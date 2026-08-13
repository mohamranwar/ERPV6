/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useAsyncLoad, type LoadSignal } from '../hooks/useAsyncLoad';
import { useFirstLoad } from '../hooks/useFirstLoad';
import { getVMaterialCoverage, getVProductCoverage, getVFGPSIAnalysis, getPlanningPeriod, fetchTableData, isInPeriod } from '../supabaseClient';
import {
  VMaterialCoverage, VProductCoverage, VFGPSIAnalysis, Shipment, ClearanceContainer,
  ClearanceJob, ExportForecast, Product, ProductionActual, SalesActual,
  ProductCategory, Machine, ProductionPlan, PurchaseOrder, SalesPlan, InventorySnapshot,
  Material,
} from '../types';
import {
  BarChart2,
  AlertOctagon,
  PackageCheck,
  TrendingUp,
  Target,
  Layers as LayersIcon,
  Printer,
  Monitor,
  Presentation,
  Ship,
  Container,
  Globe,
  Factory,
  Cpu,
  ShoppingBag,
  Boxes,
  Clock,
  Calendar,
  DollarSign,
  CheckCircle2,
  Truck,
  ArrowUpRight,
  ShieldAlert,
  Sparkles,
  AlertTriangle,
  SlidersHorizontal,
  LayoutGrid,
  GripVertical,
  Maximize2,
  Minimize2,
  X,
  Plus,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  RotateCcw,
  Bookmark,
  Save,
  Trash2,
  ChevronDown,
  Check,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell, Legend, LineChart, Line, ComposedChart, Area, AreaChart,
} from 'recharts';
import { useTableFilters } from '../hooks/useTableFilters';
import SearchBar from './SearchBar';
import ContentHeader from './ContentHeader';
import ManagementPack from './ManagementPack';
import ErrorState from './ErrorState';
import { toCartons, formatQtyCompact } from '../utils/uom';
import { KpiCard, type StatusIntent, Modal } from './ui';
import {
  RawMaterialStockChart,
  FGStockVsSalesChart,
} from './ExecutiveCharts';
import { computeExecutiveChartData, chartCaption } from '../utils/executiveCharts';
import ChartCard from './charts/ChartCard';
import { volumePointsToCube, coveragePointsToCube } from './dashboardChartAdapters';
import { chartColors } from '../utils/chartColors';
import DashboardCustomizerModal, {

  DEFAULT_WIDGET_CONFIGS,
  BUILTIN_PRESETS,
  DEFAULT_WIDGET_TITLES,
  type WidgetConfig,
  type DashboardPreset,
} from './DashboardCustomizerModal';

const NEVER_CANCELLED: LoadSignal = { cancelled: false };

interface DashboardScreenProps {
  searchQuery?: string;
  setSearchQuery?: (val: string) => void;
  refreshKey?: number;
  onNavigate?: (screen: any) => void;
}

export default function DashboardScreen({
  searchQuery = '',
  setSearchQuery = () => {},
  refreshKey = 0,
  onNavigate,
}: DashboardScreenProps) {
  const [materialCoverages, setMaterialCoverages] = useState<VMaterialCoverage[]>([]);
  const [productCoverages, setProductCoverages] = useState<VProductCoverage[]>([]);
  const [fgPsi, setFgPsi] = useState<VFGPSIAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const { isFirstLoad, markLoaded } = useFirstLoad('dashboard');
  const [presentationMode, setPresentationMode] = useState(false);
  const [customizerOpen, setCustomizerOpen] = useState(false);

  // Drag and drop customizable widget layout state
  const [widgetConfigs, setWidgetConfigs] = useState<WidgetConfig[]>(() => {
    try {
      const saved = localStorage.getItem('sc_dashboard_layout_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Merge missing defaults if new widgets were added
          const savedIds = new Set(parsed.map((w: WidgetConfig) => w.id));
          const missing = DEFAULT_WIDGET_CONFIGS.filter(w => !savedIds.has(w.id));
          return [...parsed, ...missing];
        }
      }
    } catch (e) {
      console.warn('Failed to parse saved layout', e);
    }
    return DEFAULT_WIDGET_CONFIGS;
  });

  const saveLayout = (newConfigs: WidgetConfig[]) => {
    setWidgetConfigs(newConfigs);
    try {
      localStorage.setItem('sc_dashboard_layout_v1', JSON.stringify(newConfigs));
    } catch (e) {
      console.warn('Failed to save layout to localStorage', e);
    }
  };

  const resetLayout = () => {
    setWidgetConfigs(DEFAULT_WIDGET_CONFIGS);
    setActivePresetId('default_all');
    try {
      localStorage.removeItem('sc_dashboard_layout_v1');
      localStorage.setItem('sc_dashboard_active_preset_id', 'default_all');
    } catch (e) {
      console.warn('Failed to reset layout', e);
    }
  };

  // Customize Mode Toggle State
  const [isCustomizing, setIsCustomizing] = useState(false);

  // Dashboard Layout Presets State
  const [activePresetId, setActivePresetId] = useState<string>(() => {
    return localStorage.getItem('sc_dashboard_active_preset_id') || 'default_all';
  });

  const [customPresets, setCustomPresets] = useState<DashboardPreset[]>(() => {
    try {
      const saved = localStorage.getItem('sc_dashboard_presets_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.warn('Failed to parse saved presets', e);
    }
    return [];
  });

  const [presetDropdownOpen, setPresetDropdownOpen] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');

  const allPresets = useMemo(() => {
    return [...BUILTIN_PRESETS, ...customPresets];
  }, [customPresets]);

  const activePreset = useMemo(() => {
    return allPresets.find(p => p.id === activePresetId) || BUILTIN_PRESETS[0];
  }, [allPresets, activePresetId]);

  const handleSelectPreset = (preset: DashboardPreset) => {
    saveLayout(preset.configs);
    setActivePresetId(preset.id);
    try {
      localStorage.setItem('sc_dashboard_active_preset_id', preset.id);
    } catch (e) {
      console.warn('Failed to save active preset id', e);
    }
    setPresetDropdownOpen(false);
  };

  const handleSaveNewPreset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPresetName.trim()) return;
    const newPreset: DashboardPreset = {
      id: 'custom_' + Date.now(),
      name: newPresetName.trim(),
      description: `Custom layout with ${widgetConfigs.filter(w => w.visible).length} active components`,
      isBuiltIn: false,
      configs: [...widgetConfigs],
    };
    const updatedCustom = [...customPresets, newPreset];
    setCustomPresets(updatedCustom);
    setActivePresetId(newPreset.id);
    try {
      localStorage.setItem('sc_dashboard_presets_v1', JSON.stringify(updatedCustom));
      localStorage.setItem('sc_dashboard_active_preset_id', newPreset.id);
    } catch (err) {
      console.warn('Failed to save custom presets', err);
    }
    setNewPresetName('');
    setSaveModalOpen(false);
    setPresetDropdownOpen(false);
  };

  const handleDeleteCustomPreset = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updatedCustom = customPresets.filter(p => p.id !== id);
    setCustomPresets(updatedCustom);
    try {
      localStorage.setItem('sc_dashboard_presets_v1', JSON.stringify(updatedCustom));
    } catch (err) {
      console.warn('Failed to update presets', err);
    }
    if (activePresetId === id) {
      handleSelectPreset(BUILTIN_PRESETS[0]);
    }
  };

  const handleCycleWidgetHeight = (id: string) => {
    const next = widgetConfigs.map(w => {
      if (w.id !== id) return w;
      const cur = w.height || 'md';
      const nextHeight: 'sm' | 'md' | 'lg' = cur === 'sm' ? 'md' : cur === 'md' ? 'lg' : 'sm';
      return { ...w, height: nextHeight };
    });
    saveLayout(next);
  };

  // Drag and drop live grid management
  const [draggedWidgetId, setDraggedWidgetId] = useState<string | null>(null);
  const [dragOverWidgetId, setDragOverWidgetId] = useState<string | null>(null);

  const handleGridDragStart = (e: React.DragEvent, id: string) => {
    setDraggedWidgetId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const handleGridDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (draggedWidgetId && draggedWidgetId !== id) {
      setDragOverWidgetId(id);
    }
  };

  const handleGridDragLeave = (e: React.DragEvent, id: string) => {
    if (dragOverWidgetId === id) {
      setDragOverWidgetId(null);
    }
  };

  const handleGridDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDragOverWidgetId(null);
    if (!draggedWidgetId || draggedWidgetId === targetId) return;

    const sourceIdx = widgetConfigs.findIndex(w => w.id === draggedWidgetId);
    const targetIdx = widgetConfigs.findIndex(w => w.id === targetId);

    if (sourceIdx !== -1 && targetIdx !== -1) {
      const next = [...widgetConfigs];
      const [moved] = next.splice(sourceIdx, 1);
      next.splice(targetIdx, 0, moved);
      saveLayout(next);
    }
    setDraggedWidgetId(null);
  };

  const handleGridDragEnd = () => {
    setDraggedWidgetId(null);
    setDragOverWidgetId(null);
  };

  const handleToggleWidgetWidth = (id: string) => {
    const next = widgetConfigs.map(w =>
      w.id === id ? { ...w, width: (w.width === 'full' ? 'half' : 'full') as 'full' | 'half' } : w
    );
    saveLayout(next);
  };

  const handleRemoveWidget = (id: string) => {
    const next = widgetConfigs.map(w =>
      w.id === id ? { ...w, visible: false } : w
    );
    saveLayout(next);
  };

  const handleMoveWidget = (id: string, direction: 'prev' | 'next') => {
    const visibleConfigs = widgetConfigs.filter(w => w.visible);
    const visIdx = visibleConfigs.findIndex(w => w.id === id);
    if (visIdx === -1) return;

    const targetVisIdx = direction === 'prev' ? visIdx - 1 : visIdx + 1;
    if (targetVisIdx < 0 || targetVisIdx >= visibleConfigs.length) return;

    const targetWidget = visibleConfigs[targetVisIdx];
    const sourceIdx = widgetConfigs.findIndex(w => w.id === id);
    const targetIdx = widgetConfigs.findIndex(w => w.id === targetWidget.id);

    const next = [...widgetConfigs];
    const [moved] = next.splice(sourceIdx, 1);
    next.splice(targetIdx, 0, moved);
    saveLayout(next);
  };

  // Operational data behind the live board
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [containers, setContainers] = useState<ClearanceContainer[]>([]);
  const [clearanceJobs, setClearanceJobs] = useState<ClearanceJob[]>([]);
  const [exportOrders, setExportOrders] = useState<ExportForecast[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [prodActuals, setProdActuals] = useState<ProductionActual[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [prodPlans, setProdPlans] = useState<ProductionPlan[]>([]);
  const [salesActuals, setSalesActuals] = useState<SalesActual[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [salesPlans, setSalesPlans] = useState<SalesPlan[]>([]);
  const [inventorySnapshots, setInventorySnapshots] = useState<InventorySnapshot[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadData(signal: LoadSignal = NEVER_CANCELLED) {
    setLoading(true);
    setError(null);
    try {
      const [mCov, pCov, psi, shps, ctrs, jobs, exps, prods, pAct, sAct, cats, macs, pPlans, pos, sPlans, invSnaps, mats] = await Promise.all([
        getVMaterialCoverage(),
        getVProductCoverage(),
        getVFGPSIAnalysis(),
        fetchTableData<Shipment>('shipments'),
        fetchTableData<ClearanceContainer>('clearance_containers'),
        fetchTableData<ClearanceJob>('clearance_jobs'),
        fetchTableData<ExportForecast>('export_forecasts'),
        fetchTableData<Product>('products'),
        fetchTableData<ProductionActual>('production_actual'),
        fetchTableData<SalesActual>('sales_actual'),
        fetchTableData<ProductCategory>('product_categories'),
        fetchTableData<Machine>('machines'),
        fetchTableData<ProductionPlan>('production_plan'),
        fetchTableData<PurchaseOrder>('purchase_orders'),
        fetchTableData<SalesPlan>('sales_plan'),
        fetchTableData<InventorySnapshot>('inventory_snapshots'),
        fetchTableData<Material>('materials'),
      ]);
      // A newer load has started (or we unmounted). Discard this
      // response rather than writing a stale period into state.
      if (signal.cancelled) return;
      if (signal.cancelled) return;
      setMaterialCoverages(mCov);
      setProductCoverages(pCov);
      setFgPsi(psi);
      setShipments(shps);
      setContainers(ctrs);
      setClearanceJobs(jobs);
      setExportOrders(exps);
      setProducts(prods);
      setProdActuals(pAct);
      setSalesActuals(sAct);
      setCategories(cats);
      setMachines(macs);
      setProdPlans(pPlans);
      setPurchaseOrders(pos);
      setSalesPlans(sPlans);
      setInventorySnapshots(invSnaps);
      setMaterials(mats);
    } catch (e) {
      if (signal.cancelled) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!signal.cancelled) { setLoading(false); markLoaded(); }
    }
  }

  const executiveChartData = useMemo(() => computeExecutiveChartData({
    anchor: getPlanningPeriod(),
    months: 12,
    salesPlans,
    salesActuals,
    productionPlans: prodPlans,
    productionActuals: prodActuals,
    inventory: inventorySnapshots,
    purchaseOrders,
    materials,
  }), [salesPlans, salesActuals, prodPlans, prodActuals, inventorySnapshots, purchaseOrders, materials, refreshKey]);

  // Cubes for the four executive charts that genuinely are a plan-vs-actual
  // pair -- see dashboardChartAdapters.ts for why the other two (RM stock
  // flow, FG stock vs sales) are not included here.
  const salesCube = useMemo(
    () => volumePointsToCube(executiveChartData.salesByPcs), [executiveChartData.salesByPcs]);
  const productionCube = useMemo(
    () => volumePointsToCube(executiveChartData.productionByPcs), [executiveChartData.productionByPcs]);
  const rmCoverage = useMemo(
    () => coveragePointsToCube(executiveChartData.rmCoverageMonths), [executiveChartData.rmCoverageMonths]);
  const fgCoverage = useMemo(
    () => coveragePointsToCube(executiveChartData.fgStockCoverage), [executiveChartData.fgStockCoverage]);

  useAsyncLoad(loadData, [refreshKey]);

  // Rule 2A: Search query overrides category/status dropdown filters
  const { filtered: filteredMaterialCoverages, hasActiveSearch } = useTableFilters<VMaterialCoverage>(
    materialCoverages,
    ['material_name', 'sku'],
    {},
    searchQuery,
    setSearchQuery
  );

  // ── 1. Total Raw Material Stock & Coverage Analytics ─────────────────
  const totalRmStockQty = useMemo(
    () => materialCoverages.reduce((sum, m) => sum + m.opening_stock, 0),
    [materialCoverages]
  );
  const totalRmMonthlyDemand = useMemo(
    () => materialCoverages.reduce((sum, m) => sum + m.monthly_demand, 0),
    [materialCoverages]
  );
  const totalRmCoverageMonths = useMemo(
    () => (totalRmMonthlyDemand > 0 ? totalRmStockQty / totalRmMonthlyDemand : 0),
    [totalRmStockQty, totalRmMonthlyDemand]
  );
  const totalRmCoverageDays = useMemo(
    () => Math.round(totalRmCoverageMonths * 30),
    [totalRmCoverageMonths]
  );

  // Weighted Total Cover (Stock + In-Transit + Pending POs)
  const totalRmWithTransitMonths = useMemo(() => {
    if (materialCoverages.length === 0) return 0;
    const avg = materialCoverages.reduce((sum, m) => sum + m.coverage_months, 0);
    return avg / materialCoverages.length;
  }, [materialCoverages]);

  const oosRiskCount = useMemo(
    () => materialCoverages.filter((m) => m.coverage_months < 1.0).length,
    [materialCoverages]
  );
  const overstockCount = useMemo(
    () => materialCoverages.filter((m) => m.coverage_months > 3.0).length,
    [materialCoverages]
  );

  // Raw Material Coverage Breakdown by Category (for management graph)
  const rmCategoryCoverageGraph = useMemo(() => {
    const catMap = new Map<string, { category: string; stock: number; demand: number; itemsCount: number; stockOnlyCover: number; totalCover: number }>();
    materialCoverages.forEach(m => {
      const name = m.category_name || 'Uncategorized';
      const row = catMap.get(name) ?? { category: name, stock: 0, demand: 0, itemsCount: 0, stockOnlyCover: 0, totalCover: 0 };
      row.stock += m.opening_stock;
      row.demand += m.monthly_demand;
      row.itemsCount += 1;
      catMap.set(name, row);
    });

    return [...catMap.values()].map(c => ({
      ...c,
      stockOnlyCover: c.demand > 0 ? parseFloat((c.stock / c.demand).toFixed(2)) : 0,
      totalCover: c.itemsCount > 0
        ? parseFloat((materialCoverages.filter(m => (m.category_name || 'Uncategorized') === c.category).reduce((s, m) => s + m.coverage_months, 0) / c.itemsCount).toFixed(2))
        : 0,
    })).sort((a, b) => b.demand - a.demand);
  }, [materialCoverages]);


  // ── 2. Monthly PO Count & Procurement Analytics ──────────────────────
  const activePeriod = getPlanningPeriod(); // e.g. "2026-08-01"

  const monthlyPosThisPeriod = useMemo(() => {
    // Current period POs or active POs
    const periodPrefix = activePeriod.substring(0, 7);
    return purchaseOrders.filter(p => p.po_date && p.po_date.startsWith(periodPrefix));
  }, [purchaseOrders, activePeriod]);

  const monthlyPoCount = useMemo(
    () => (monthlyPosThisPeriod.length > 0 ? monthlyPosThisPeriod.length : purchaseOrders.length),
    [monthlyPosThisPeriod, purchaseOrders]
  );

  const pendingPoCount = useMemo(
    () => purchaseOrders.filter(p => p.status === 'pending').length,
    [purchaseOrders]
  );
  const inTransitPoCount = useMemo(
    () => purchaseOrders.filter(p => p.status === 'in_transit').length,
    [purchaseOrders]
  );
  const completedPoCount = useMemo(
    () => purchaseOrders.filter(p => p.status === 'completed').length,
    [purchaseOrders]
  );
  const pendingPoQty = useMemo(
    () => purchaseOrders.filter(p => p.status === 'pending').reduce((sum, p) => sum + p.remaining_qty, 0),
    [purchaseOrders]
  );

  // Monthly PO Count & Status Trend (by Month)
  const monthlyPoTrendGraph = useMemo(() => {
    const monthsMap = new Map<string, { month: string; totalPos: number; pending: number; inTransit: number; completed: number; totalQty: number }>();

    purchaseOrders.forEach(p => {
      const monthKey = p.po_date ? p.po_date.substring(0, 7) : '2026-08';
      const row = monthsMap.get(monthKey) ?? { month: monthKey, totalPos: 0, pending: 0, inTransit: 0, completed: 0, totalQty: 0 };
      row.totalPos += 1;
      row.totalQty += p.qty;
      if (p.status === 'pending') row.pending += 1;
      else if (p.status === 'in_transit') row.inTransit += 1;
      else if (p.status === 'completed') row.completed += 1;
      monthsMap.set(monthKey, row);
    });

    return [...monthsMap.values()].sort((a, b) => a.month.localeCompare(b.month));
  }, [purchaseOrders]);


  // ── 3. Finished Goods (FG) Coverage Analytics ─────────────────────────
  const totalFgStockQty = useMemo(
    () => productCoverages.reduce((sum, p) => sum + p.opening_stock, 0),
    [productCoverages]
  );
  const totalFgMonthlyDemand = useMemo(
    () => productCoverages.reduce((sum, p) => sum + p.monthly_demand, 0),
    [productCoverages]
  );
  const totalFgCoverageMonths = useMemo(
    () => (totalFgMonthlyDemand > 0 ? totalFgStockQty / totalFgMonthlyDemand : 0),
    [totalFgStockQty, totalFgMonthlyDemand]
  );
  const totalFgCoverageDays = useMemo(
    () => Math.round(totalFgCoverageMonths * 30),
    [totalFgCoverageMonths]
  );

  const fgBelowSafetyCount = useMemo(
    () => productCoverages.filter((p) => p.coverage_months < 1.0).length,
    [productCoverages]
  );

  const productById = useMemo(() => {
    const m = new Map<string, Product>();
    products.forEach(p => m.set(p.id, p));
    return m;
  }, [products]);

  const totalFgCartons = useMemo(() => {
    let ctn = 0;
    productCoverages.forEach(p => {
      const prod = productById.get(p.product_id);
      const c = toCartons(p.opening_stock, prod);
      if (c !== null) ctn += c;
    });
    return ctn;
  }, [productCoverages, productById]);

  // Finished Goods Coverage Breakdown by Product Category (Management Graph)
  const fgCategoryCoverageGraph = useMemo(() => {
    const catMap = new Map<string, { category: string; stock: number; forecast: number; expectedStock: number; avgCoverageMonths: number; itemCount: number }>();

    fgPsi.forEach(p => {
      const name = p.category_name || 'Uncategorized';
      const row = catMap.get(name) ?? { category: name, stock: 0, forecast: 0, expectedStock: 0, avgCoverageMonths: 0, itemCount: 0 };
      row.stock += p.start_stock;
      row.forecast += p.sales_forecast;
      row.expectedStock += p.expected_stock;
      row.avgCoverageMonths += p.coverage_months;
      row.itemCount += 1;
      catMap.set(name, row);
    });

    return [...catMap.values()].map(c => ({
      ...c,
      coverageMonths: c.itemCount > 0 ? parseFloat((c.avgCoverageMonths / c.itemCount).toFixed(2)) : 0,
    })).sort((a, b) => b.forecast - a.forecast);
  }, [fgPsi]);


  // ── 4. Sales & Production Performance Indicators ─────────────────────
  const totalSalesForecast = useMemo(
    () => fgPsi.reduce((sum, item) => sum + item.sales_forecast, 0),
    [fgPsi]
  );
  const totalSalesActual = useMemo(
    () => fgPsi.reduce((sum, item) => sum + item.actual_sales, 0),
    [fgPsi]
  );
  const hasSalesActuals = useMemo(
    () => fgPsi.some((item) => item.sales_actual_records > 0),
    [fgPsi]
  );

  const salesAchievement = useMemo(
    () => (totalSalesForecast > 0 ? (totalSalesActual / totalSalesForecast) * 100 : null),
    [totalSalesForecast, totalSalesActual]
  );

  type AchievementState = 'no-plan' | 'awaiting' | 'on-target' | 'behind';
  const achievementState: AchievementState =
    salesAchievement === null
      ? 'no-plan'
      : !hasSalesActuals
        ? 'awaiting'
        : salesAchievement >= 85
          ? 'on-target'
          : 'behind';

  const ACHIEVEMENT_STYLE: Record<
    AchievementState,
    { value: string; badge: string; badgeIntent: StatusIntent }
  > = {
    'no-plan': {
      value: 'No plan',
      badge: 'Nothing planned',
      badgeIntent: 'neutral',
    },
    awaiting: {
      value: '—',
      badge: 'Awaiting actuals',
      badgeIntent: 'neutral',
    },
    'on-target': {
      value: `${(salesAchievement ?? 0).toFixed(1)}%`,
      badge: 'On target',
      badgeIntent: 'success',
    },
    behind: {
      value: `${(salesAchievement ?? 0).toFixed(1)}%`,
      badge: 'Behind',
      badgeIntent: 'warning',
    },
  };
  const achievement = ACHIEVEMENT_STYLE[achievementState];

  const lowestMaterials = useMemo(() => {
    return [...filteredMaterialCoverages]
      .sort((a, b) => a.coverage_months - b.coverage_months)
      .slice(0, 20);
  }, [filteredMaterialCoverages]);

  const maxCoverageVal = useMemo(() => {
    return Math.max(...lowestMaterials.map((m) => m.coverage_months), 3.5);
  }, [lowestMaterials]);

  const pendingShipments = useMemo(
    () => shipments.filter(s => s.factory_arrival_date === null),
    [shipments]
  );

  const containerFunnel = useMemo(() => {
    const stage = (s: ClearanceContainer['status']) => containers.filter(c => c.status === s).length;
    return [
      { stage: 'At port', count: stage('pending') },
      { stage: 'Under exam', count: stage('under_exam') },
      { stage: 'Released', count: stage('released') },
      { stage: 'Delivered', count: stage('delivered') },
    ];
  }, [containers]);

  const demurrageDays = useMemo(
    () => containers.reduce((s, c) => s + (c.demurrage_days ?? 0), 0),
    [containers]
  );

  const openExportOrders = useMemo(
    () => exportOrders.filter(o => o.order_status !== 'shipped' && o.order_status !== 'delivered'),
    [exportOrders]
  );

  const mtd = useMemo(() => {
    const period = getPlanningPeriod();
    const sum = (rows: { product_id: string; period_start: string; quantity: number }[]) => {
      let pcs = 0, ctn = 0, allConvertible = true;
      rows.filter(r => isInPeriod(r.period_start, period)).forEach(r => {
        pcs += r.quantity;
        const c = toCartons(r.quantity, productById.get(r.product_id));
        if (c === null) allConvertible = false; else ctn += c;
      });
      return { pcs, ctn, allConvertible };
    };
    return { production: sum(prodActuals), sales: sum(salesActuals) };
  }, [prodActuals, salesActuals, productById]);

  const byCategory = useMemo(() => {
    const period = getPlanningPeriod();
    const catName = new Map<string, string>(categories.map(c => [c.id, c.name] as const));
    const acc = new Map<string, { category: string; planned: number; actual: number }>();

    const row = (pid: string) => {
      const name = catName.get(productById.get(pid)?.category_id ?? '') ?? 'Uncategorised';
      const r = acc.get(name) ?? { category: name, planned: 0, actual: 0 };
      acc.set(name, r);
      return r;
    };
    fgPsi.forEach(p => { row(p.row_id).planned += p.sales_forecast; });
    salesActuals
      .filter(r => isInPeriod(r.period_start, period))
      .forEach(r => { row(r.product_id).actual += r.quantity; });

    return [...acc.values()]
      .map(c => ({
        ...c,
        achievement: c.planned > 0 ? Math.round((c.actual / c.planned) * 100) : null,
      }))
      .sort((a, b) => b.planned - a.planned);
  }, [categories, fgPsi, salesActuals, productById]);

  const machineLoad = useMemo(() => {
    const period = getPlanningPeriod();
    const rate = (line: string) =>
      ({ SOFY: 900, VOXY: 600, Atlas: 500, Pants: 600 } as Record<string, number>)[line] ?? 500;

    const rows = machines.map(mac => {
      const lineProducts = products.filter(p => p.product_line === mac.name);
      const speed = rate(mac.name);
      const availableHours = mac.monthly_capacity ? mac.monthly_capacity / speed : 600;
      const plannedHours = lineProducts.reduce((s, p) => {
        const q = prodPlans
          .filter(pl => pl.product_id === p.id && isInPeriod(pl.period_start, period))
          .reduce((a, pl) => a + pl.quantity, 0);
        return s + q / speed;
      }, 0);
      return {
        name: mac.name,
        utilisation: availableHours > 0 ? Math.round((plannedHours / availableHours) * 100) : 0,
      };
    });

    const loaded = rows.filter(r => r.utilisation > 0);
    return {
      rows,
      total: machines.length,
      loaded: loaded.length,
      avgUtilisation: loaded.length
        ? Math.round(loaded.reduce((s, r) => s + r.utilisation, 0) / loaded.length)
        : 0,
      overloaded: rows.filter(r => r.utilisation > 95).length,
    };
  }, [machines, products, prodPlans]);

  const byProductLine = useMemo(() => {
    const period = getPlanningPeriod();
    const acc = new Map<string, { line: string; produced: number; sold: number }>();
    const bump = (pid: string, field: 'produced' | 'sold', qty: number) => {
      const line = productById.get(pid)?.product_line || 'Unassigned';
      const row = acc.get(line) ?? { line, produced: 0, sold: 0 };
      row[field] += qty;
      acc.set(line, row);
    };
    prodActuals.filter(r => isInPeriod(r.period_start, period)).forEach(r => bump(r.product_id, 'produced', r.quantity));
    salesActuals.filter(r => isInPeriod(r.period_start, period)).forEach(r => bump(r.product_id, 'sold', r.quantity));
    return [...acc.values()].sort((a, b) => b.produced - a.produced);
  }, [prodActuals, salesActuals, productById]);

  if (loading && isFirstLoad) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-7 w-56 bg-slate-200 rounded-md"></div>
            <div className="h-3 w-80 bg-slate-200 rounded-md"></div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card-elevated p-4 h-28 flex flex-col justify-between">
              <div className="h-3 w-24 bg-slate-200 rounded"></div>
              <div className="h-7 w-16 bg-slate-200 rounded"></div>
              <div className="h-1.5 w-full bg-slate-100 rounded-full"></div>
            </div>
          ))}
        </div>

        <div className="card-elevated p-6 h-[400px] flex flex-col gap-4">
          <div className="h-5 w-64 bg-slate-200 rounded"></div>
          <div className="flex-1 bg-slate-50 rounded-lg"></div>
        </div>
      </div>
    );
  }

  if (presentationMode) {
    return (
      <div className="space-y-4">
        <div className="no-print flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[12px] text-slate-500">
            Presentation view — controls and navigation are hidden when printing.
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()} className="btn-base btn-primary gap-1.5">
              <Printer className="w-3.5 h-3.5" /> Print / Save as PDF
            </button>
            <button onClick={() => setPresentationMode(false)} className="btn-base btn-secondary gap-1.5">
              <Monitor className="w-3.5 h-3.5" /> Back to live board
            </button>
          </div>
        </div>
        <ManagementPack
          period={getPlanningPeriod()}
          executiveCharts={executiveChartData}
          materialCoverages={materialCoverages}
          productCoverages={productCoverages}
          fgPsi={fgPsi}
          salesAchievement={salesAchievement}
          hasSalesActuals={hasSalesActuals}
          shipments={shipments}
          containers={containers}
          exportOrders={exportOrders}
          products={products}
          prodActuals={prodActuals}
          salesActuals={salesActuals}
        />
      </div>
    );
  }

  // Individual Widget Renderer
  const renderWidget = (id: string, config?: WidgetConfig) => {
    const heightVal = config?.height || 'md';
    const chartHeight = heightVal === 'sm' ? 180 : heightVal === 'lg' ? 360 : 240;

    switch (id) {
      case 'kpi_cards':
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Total RM Stock Coverage"
              value={`${totalRmCoverageMonths.toFixed(1)}`}
              unit="mo"
              secondaryValue={`(${totalRmCoverageDays} Days)`}
              sub={`Stock: ${formatQtyCompact(totalRmStockQty)} · w/ transit: ${totalRmWithTransitMonths.toFixed(1)} mo`}
              icon={<Boxes className="w-4 h-4" />}
              intent={oosRiskCount > 0 ? 'danger' : 'success'}
              badge={{
                label: oosRiskCount > 0 ? `${oosRiskCount} OOS Risk` : 'Healthy Cover',
                intent: oosRiskCount > 0 ? 'danger' : 'success',
              }}
              progress={Math.min(100, (totalRmCoverageMonths / 3.0) * 100)}
              onClick={() => onNavigate?.('coverage')}
            />
            <KpiCard
              label="Monthly PO Count"
              value={monthlyPoCount}
              unit="POs"
              sub={`${pendingPoCount} pending · ${formatQtyCompact(pendingPoQty)} units remaining`}
              icon={<ShoppingBag className="w-4 h-4" />}
              intent={pendingPoCount > 5 ? 'warning' : 'info'}
              badge={{
                label: `${pendingPoCount} Pending`,
                intent: pendingPoCount > 0 ? 'warning' : 'info',
              }}
              progress={purchaseOrders.length > 0 ? (completedPoCount / purchaseOrders.length) * 100 : 0}
              onClick={() => onNavigate?.('mrp')}
            />
            <KpiCard
              label="Finished Goods Coverage"
              value={`${totalFgCoverageMonths.toFixed(1)}`}
              unit="mo"
              secondaryValue={`(${totalFgCoverageDays} Days)`}
              sub={`Stock: ${formatQtyCompact(totalFgStockQty)} PCS (${Math.round(totalFgCartons).toLocaleString()} CTN)`}
              icon={<LayersIcon className="w-4 h-4" />}
              intent={fgBelowSafetyCount > 0 ? 'warning' : 'success'}
              badge={{
                label: fgBelowSafetyCount > 0 ? `${fgBelowSafetyCount} Below Safety` : 'Safe Stock',
                intent: fgBelowSafetyCount > 0 ? 'warning' : 'success',
              }}
              progress={Math.min(100, (totalFgCoverageMonths / 3.0) * 100)}
              onClick={() => onNavigate?.('psi')}
            />
            <KpiCard
              label="Sales Achievement"
              value={achievement.value}
              icon={<Target className="w-4 h-4" />}
              intent={achievementState === 'on-target' ? 'success' : achievementState === 'behind' ? 'warning' : 'default'}
              badge={{ label: achievement.badge, intent: achievement.badgeIntent }}
              progress={
                achievementState === 'on-target' || achievementState === 'behind'
                  ? Math.min(100, salesAchievement ?? 0)
                  : undefined
              }
              onClick={() => onNavigate?.('plan_vs_actual')}
            />
          </div>
        );

      case 'operational_cards':
        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Pending Shipments"
              value={pendingShipments.length}
              sub={`${formatQtyCompact(pendingShipments.reduce((s, x) => s + x.qty, 0))} units in transit`}
              intent={pendingShipments.length > 0 ? 'info' : 'success'}
              icon={<Ship className="w-4 h-4" />}
              onClick={() => onNavigate?.('logistics')}
            />
            <KpiCard
              label="Containers in Clearance"
              value={containers.filter(c => c.status !== 'delivered').length}
              sub={demurrageDays > 0 ? `${demurrageDays} demurrage days accrued` : 'no demurrage accrued'}
              intent={demurrageDays > 10 ? 'danger' : demurrageDays > 0 ? 'warning' : 'success'}
              icon={<Container className="w-4 h-4" />}
              onClick={() => onNavigate?.('customs_clearance')}
            />
            <KpiCard
              label="Open Export Orders"
              value={openExportOrders.length}
              sub={`${exportOrders.length - openExportOrders.length} shipped or delivered`}
              icon={<Globe className="w-4 h-4" />}
              onClick={() => onNavigate?.('export_forecast')}
            />
            <KpiCard
              label="MTD Production"
              value={formatQtyCompact(mtd.production.pcs)}
              unit="PCS"
              sub={mtd.production.allConvertible
                ? `${Math.round(mtd.production.ctn).toLocaleString()} CTN · sold ${formatQtyCompact(mtd.sales.pcs)} PCS`
                : `sold ${formatQtyCompact(mtd.sales.pcs)} PCS`}
              intent="success"
              icon={<Factory className="w-4 h-4" />}
            />
          </div>
        );

      case 'sales_by_pcs':
        return (
          <ChartCard
            chartId="dash-sales-by-pcs"
            title="Sales by PCS"
            subtitle={`Base Case (BC) vs Forecast (FC) monthly sales volume · ${chartCaption(executiveChartData, 'Sales actuals')}`}
            periods={salesCube.periods}
            seriesNames={salesCube.seriesNames}
            plan={salesCube.plan}
            actual={salesCube.actual}
            unit="M pcs"
            precision={1}
            fixedAxis="period"
          />
        );

      case 'production_by_pcs':
        return (
          <ChartCard
            chartId="dash-production-by-pcs"
            title="Production by PCS"
            subtitle={`Base Case (BC) vs Forecast (FC) monthly production plan · ${chartCaption(executiveChartData, 'Production actuals')}`}
            periods={productionCube.periods}
            seriesNames={productionCube.seriesNames}
            plan={productionCube.plan}
            actual={productionCube.actual}
            unit="M pcs"
            precision={1}
            fixedAxis="period"
          />
        );

      case 'rm_coverage_months':
        return (
          <ChartCard
            chartId="dash-rm-coverage"
            title="Raw material coverage"
            subtitle={`Months of cover against consumption · ${chartCaption(executiveChartData, 'RM inventory')}`}
            periods={rmCoverage.cube.periods}
            seriesNames={rmCoverage.cube.seriesNames}
            plan={rmCoverage.cube.plan}
            actual={rmCoverage.cube.actual}
            unit="mo"
            precision={2}
            fixedAxis="period"
            defaultConfig={rmCoverage.targetDefault}
          />
        );

      case 'rm_stock_usage_po':
        return <RawMaterialStockChart data={executiveChartData.rmStockUsagePo} height={chartHeight} caption={chartCaption(executiveChartData, 'PO procurement')} />;

      case 'fg_stock_coverage':
        return (
          <ChartCard
            chartId="dash-fg-coverage"
            title="Finished goods coverage"
            subtitle={`Months of cover against sales · ${chartCaption(executiveChartData, 'FG inventory')}`}
            periods={fgCoverage.cube.periods}
            seriesNames={fgCoverage.cube.seriesNames}
            plan={fgCoverage.cube.plan}
            actual={fgCoverage.cube.actual}
            unit="mo"
            precision={2}
            fixedAxis="period"
            defaultConfig={fgCoverage.targetDefault}
          />
        );

      case 'fg_stk_vs_sales':
        return <FGStockVsSalesChart data={executiveChartData.fgStkVsSales} height={chartHeight} caption={chartCaption(executiveChartData, 'FG sales & warehouse')} />;

      case 'rm_cat_coverage':
        return (
          <div className="card-elevated p-5 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-[13px] font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                  <Boxes className="w-4 h-4 text-brand-600" />
                  {config?.title ?? DEFAULT_WIDGET_TITLES.rm_cat_coverage}
                </h3>
                <p className="text-[11.5px] text-slate-500">Stock-Only vs Total Cover (Months) with In-Transit & Pending POs.</p>
              </div>
              <span className="text-[10.5px] font-mono font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                Avg {totalRmCoverageMonths.toFixed(1)} mo ({totalRmCoverageDays} days)
              </span>
            </div>
            <ResponsiveContainer width="100%" height={chartHeight}>
              <BarChart data={rmCategoryCoverageGraph} margin={{ top: 8, right: 12, left: -10, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="category" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}m`} />
                <Tooltip
                  cursor={{ fill: '#f8fafc' }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="bg-slate-900 text-white rounded-lg px-3 py-2 text-[11.5px] shadow-xl space-y-1 font-sans">
                        <p className="font-semibold text-slate-200">{label}</p>
                        {payload.map((p: any) => (
                          <div key={p.dataKey} className="flex items-center justify-between gap-4">
                            <span style={{ color: p.color }}>{p.name}:</span>
                            <span className="font-mono font-bold">{p.value} mo ({Math.round(p.value * 30)} days)</span>
                          </div>
                        ))}
                      </div>
                    );
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
                <ReferenceLine y={1.0} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'OOS Risk (1.0m)', fill: '#ef4444', fontSize: 9, position: 'insideTopLeft' }} />
                <ReferenceLine y={3.0} stroke="#0ea5e9" strokeDasharray="3 3" label={{ value: 'Overstock (3.0m)', fill: '#0ea5e9', fontSize: 9, position: 'insideTopLeft' }} />
                <Bar dataKey="stockOnlyCover" name="Stock-Only Cover" fill={chartColors().actual} radius={[3, 3, 0, 0]} maxBarSize={28} />
                <Bar dataKey="totalCover" name="Total Cover (w/ Transit & POs)" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        );

      case 'po_status':
        return (
          <div className="card-elevated p-5 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-[13px] font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4 text-sky-600" />
                  {config?.title ?? DEFAULT_WIDGET_TITLES.po_status}
                </h3>
                <p className="text-[11.5px] text-slate-500">Monthly PO count, pending orders, and total procurement volume.</p>
              </div>
              <span className="text-[10.5px] font-mono font-bold bg-sky-50 text-sky-700 px-2 py-0.5 rounded border border-sky-100">
                {monthlyPoCount} POs active ({pendingPoCount} pending)
              </span>
            </div>
            <ResponsiveContainer width="100%" height={chartHeight}>
              <ComposedChart data={monthlyPoTrendGraph} margin={{ top: 8, right: 12, left: -10, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#64748b', fontFamily: 'JetBrains Mono, monospace' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={formatQtyCompact} />
                <Tooltip
                  cursor={{ fill: '#f8fafc' }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="bg-slate-900 text-white rounded-lg px-3 py-2 text-[11.5px] shadow-xl space-y-1 font-sans">
                        <p className="font-semibold text-slate-200">{label}</p>
                        {payload.map((p: any) => (
                          <div key={p.dataKey} className="flex items-center justify-between gap-4">
                            <span style={{ color: p.color }}>{p.name}:</span>
                            <span className="font-mono font-bold">{p.dataKey === 'totalQty' ? p.value.toLocaleString() : p.value}</span>
                          </div>
                        ))}
                      </div>
                    );
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
                <Bar yAxisId="left" dataKey="completed" name="Completed POs" fill="#10b981" stackId="po" radius={[0, 0, 0, 0]} maxBarSize={28} />
                <Bar yAxisId="left" dataKey="pending" name="Pending POs" fill="#f59e0b" stackId="po" radius={[3, 3, 0, 0]} maxBarSize={28} />
                <Line yAxisId="right" type="monotone" dataKey="totalQty" name="Procurement Volume (Units)" stroke="#0284c7" strokeWidth={2.5} dot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        );

      case 'fg_cat_matrix':
        return (
          <div className="card-elevated p-5 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-[13px] font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                  <LayersIcon className="w-4 h-4 text-emerald-600" />
                  {config?.title ?? DEFAULT_WIDGET_TITLES.fg_cat_matrix}
                </h3>
                <p className="text-[11.5px] text-slate-500">Current FG inventory stock (PCS) against sales forecast and coverage months.</p>
              </div>
              <span className="text-[10.5px] font-mono font-bold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded border border-emerald-100">
                FG Cover {totalFgCoverageMonths.toFixed(1)} mo ({totalFgCoverageDays} days)
              </span>
            </div>
            <ResponsiveContainer width="100%" height={chartHeight}>
              <ComposedChart data={fgCategoryCoverageGraph} margin={{ top: 8, right: 12, left: -10, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="category" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={formatQtyCompact} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}m`} />
                <Tooltip
                  cursor={{ fill: '#f8fafc' }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="bg-slate-900 text-white rounded-lg px-3 py-2 text-[11.5px] shadow-xl space-y-1 font-sans">
                        <p className="font-semibold text-slate-200">{label}</p>
                        {payload.map((p: any) => (
                          <div key={p.dataKey} className="flex items-center justify-between gap-4">
                            <span style={{ color: p.color }}>{p.name}:</span>
                            <span className="font-mono font-bold">
                              {p.dataKey === 'coverageMonths' ? `${p.value} mo (${Math.round(p.value * 30)} days)` : `${p.value.toLocaleString()} PCS`}
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
                <Bar yAxisId="left" dataKey="stock" name="Current Stock (PCS)" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={28} />
                <Bar yAxisId="left" dataKey="forecast" name="Sales Forecast (PCS)" fill={chartColors().actual} radius={[3, 3, 0, 0]} maxBarSize={28} />
                <Line yAxisId="right" type="monotone" dataKey="coverageMonths" name="Coverage (Months)" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        );

      case 'machine_capacity':
        return (
          <KpiCard
            label="Machines"
            value={machineLoad.total}
            sub={`${machineLoad.loaded} loaded · avg ${machineLoad.avgUtilisation}% utilisation`}
            intent={machineLoad.overloaded > 0 ? 'warning' : 'default'}
            icon={<Cpu className="w-4 h-4" />}
            progress={machineLoad.avgUtilisation}
            badge={machineLoad.overloaded > 0
              ? { label: `${machineLoad.overloaded} over 95%`, intent: 'warning' }
              : { label: 'within capacity', intent: 'success' }}
            onClick={() => onNavigate?.('production_plan')}
            footer={
              <div className="pt-1 space-y-1.5">
                {machineLoad.rows.map(m => (
                  <div key={m.name} className="flex items-center gap-2 text-[10.5px]">
                    <span className="w-12 shrink-0 text-slate-500 font-semibold">{m.name}</span>
                    <div className="flex-1 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                      <div
                        className={`h-1.5 rounded-full ${m.utilisation > 95 ? 'bg-red-500' : m.utilisation > 0 ? 'bg-brand-600' : 'bg-slate-200'}`}
                        style={{ width: `${Math.min(100, m.utilisation)}%` }}
                      />
                    </div>
                    <span className="w-9 text-right font-mono text-slate-600 font-bold">{m.utilisation}%</span>
                  </div>
                ))}
              </div>
            }
          />
        );

      case 'category_achievement':
        return (
          <div className="card-elevated p-5 space-y-3">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <div>
                <h3 className="text-[13px] font-extrabold text-slate-900 tracking-tight">Sales achievement by category</h3>
                <p className="text-[11.5px] text-slate-500">Sales plan against actual reported figures for the active period.</p>
              </div>
              {!hasSalesActuals && (
                <span className="text-[11px] text-amber-700 font-semibold bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                  Actuals not reported yet
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
              {byCategory.length === 0 && (
                <p className="text-[12px] text-slate-500 col-span-3">No categories planned for this period.</p>
              )}
              {byCategory.map(c => {
                const pct = c.achievement ?? 0;
                const tone =
                  c.achievement === null ? 'bg-slate-300'
                  : pct >= 95 ? 'bg-emerald-500'
                  : pct >= 80 ? 'bg-amber-500' : 'bg-red-500';
                return (
                  <div key={c.category} className="bg-slate-50/70 p-3 rounded-lg border border-slate-100 space-y-2">
                    <div className="flex items-baseline justify-between gap-2 text-[12px]">
                      <span className="font-bold text-slate-800">{c.category}</span>
                      <b className={`font-mono text-[11px] ${
                        c.achievement === null ? 'text-slate-400'
                        : pct >= 95 ? 'text-emerald-700'
                        : pct >= 80 ? 'text-amber-700' : 'text-red-700'
                      }`}>
                        {c.achievement === null ? 'no plan' : `${pct}% achievement`}
                      </b>
                    </div>
                    <div className="w-full bg-slate-200/80 h-2 rounded-full overflow-hidden">
                      <div
                        className={`h-2 rounded-full transition-all duration-500 ${tone}`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10.5px] font-mono text-slate-500">
                      <span>Actual: {c.actual.toLocaleString()}</span>
                      <span>Plan: {c.planned.toLocaleString()} PCS</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );

      case 'container_funnel':
        return (
          <div className="card-elevated p-5 space-y-3">
            <div>
              <h3 className="text-[13px] font-extrabold text-slate-900 tracking-tight">Container flow & customs funnel</h3>
              <p className="text-[11.5px] text-slate-500">Where every tracked import container currently sits in clearance.</p>
            </div>
            <ResponsiveContainer width="100%" height={chartHeight}>
              <BarChart data={containerFunnel} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="stage" width={78} tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: '#f8fafc' }} formatter={(v: number) => [`${v} containers`, '']} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={26}>
                  {containerFunnel.map((s, i) => (
                    <Cell key={s.stage} fill={['#94a3b8', '#f59e0b', '#0ea5e9', '#10b981'][i]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        );

      case 'line_mtd':
        return (
          <div className="card-elevated p-5 space-y-3">
            <div>
              <h3 className="text-[13px] font-extrabold text-slate-900 tracking-tight">Month to date by product line</h3>
              <p className="text-[11.5px] text-slate-500">Produced against sold volume, from recorded actuals.</p>
            </div>
            <ResponsiveContainer width="100%" height={chartHeight}>
              <BarChart data={byProductLine} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="line" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={formatQtyCompact} />
                <Tooltip
                  cursor={{ fill: '#f8fafc' }}
                  formatter={(v: number, n: string) => [`${Math.round(v).toLocaleString()} PCS`, n]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="produced" name="Produced" fill={chartColors().actual} radius={[3, 3, 0, 0]} maxBarSize={26} />
                <Bar dataKey="sold" name="Sold" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        );

      case 'lowest_materials':
        return (
          <div className="card-elevated p-5 sm:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 pb-4">
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl bg-brand-50 text-brand-600 border border-brand-100 shrink-0">
                  <BarChart2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-[13.5px] font-extrabold text-slate-900 tracking-tight">
                    Top 20 raw & packaging materials with lowest coverage
                  </h3>
                  <p className="text-[11.5px] text-slate-500 leading-relaxed mt-0.5">
                    Months of inventory coverage including scheduled receipts.{' '}
                    <span className="text-red-600 font-semibold">&lt; 1.0</span> is OOS risk,{' '}
                    <span className="text-amber-600 font-semibold">1.0–2.0</span> is watchlist,{' '}
                    <span className="text-sky-600 font-semibold">&gt; 3.0</span> is overstock.
                  </p>
                </div>
              </div>
              <SearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search materials…"
                className="w-full sm:w-72"
                hasActiveSearch={hasActiveSearch}
              />
            </div>

            <ResponsiveContainer width="100%" height={chartHeight + 60}>
              <BarChart
                data={lowestMaterials.map(m => ({
                  name: m.sku,
                  fullName: m.material_name,
                  coverage: m.coverage_months,
                  stock: m.opening_stock,
                  uom: m.uom,
                }))}
                margin={{ top: 8, right: 12, left: 0, bottom: 48 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10, fill: '#64748b', fontFamily: 'JetBrains Mono, monospace' }}
                  angle={-45}
                  textAnchor="end"
                  interval={0}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `${v}m`}
                  domain={[0, Math.ceil(maxCoverageVal)]}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-slate-900 text-white rounded-lg px-3 py-2 text-[11.5px] shadow-xl font-sans">
                        <p className="font-semibold mb-0.5 text-slate-100">{d.fullName}</p>
                        <p>Coverage: <b className="font-mono text-emerald-400">{d.coverage} mo ({Math.round(d.coverage * 30)} days)</b></p>
                        <p>Opening Stock: <span className="font-mono">{Number(d.stock).toLocaleString()} {d.uom}</span></p>
                      </div>
                    );
                  }}
                />
                <ReferenceLine y={1} stroke="#ef4444" strokeDasharray="4 2" strokeWidth={1.5} label={{ value: 'OOS risk', fill: '#ef4444', fontSize: 9, position: 'insideTopRight' }} />
                <ReferenceLine y={3} stroke="#0ea5e9" strokeDasharray="4 2" strokeWidth={1.5} label={{ value: 'Overstock', fill: '#0ea5e9', fontSize: 9, position: 'insideTopRight' }} />
                <Bar dataKey="coverage" radius={[4, 4, 0, 0]} maxBarSize={32}>
                  {lowestMaterials.map((mat) => {
                    const fill = mat.coverage_months < 1.0 ? '#ef4444'
                      : mat.coverage_months <= 2.0 ? '#f59e0b'
                      : mat.coverage_months > 3.0  ? '#0ea5e9'
                      : '#10b981';
                    return <Cell key={mat.material_id} fill={fill} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        );

      case 'psi_overview':
        return fgPsi.length > 0 ? (
          <div className="card-elevated p-5 sm:p-6 space-y-4">
            <div className="flex items-start gap-3 border-b border-slate-100 pb-4">
              <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 shrink-0">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-[13.5px] font-extrabold text-slate-900 tracking-tight">
                  PSI Overview — Forecast vs Actuals vs Master Production Plan
                </h3>
                <p className="text-[11.5px] text-slate-500 mt-0.5">
                  Sales forecast, actual sales, and planned production across finished good SKUs.
                </p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={chartHeight + 20}>
              <BarChart
                data={fgPsi.map(p => ({
                  name: p.product_name || p.row_id,
                  forecast: p.sales_forecast,
                  actual: p.actual_sales,
                  production: p.production_plan,
                }))}
                margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                  tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="bg-slate-900 text-white rounded-lg px-3 py-2 text-[11.5px] shadow-xl space-y-0.5 font-sans">
                        <p className="font-semibold mb-1 text-slate-200">{label}</p>
                        {payload.map((p: any) => (
                          <p key={p.dataKey}>
                            <span style={{ color: p.fill }}>{p.name}</span>: <span className="font-mono font-bold">{Number(p.value).toLocaleString()} PCS</span>
                          </p>
                        ))}
                      </div>
                    );
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Bar dataKey="forecast"   name="Forecast"   fill={chartColors().actual} radius={[3,3,0,0]} maxBarSize={28} />
                <Bar dataKey="actual"     name="Actuals"    fill="#10b981" radius={[3,3,0,0]} maxBarSize={28} />
                <Bar dataKey="production" name="Production" fill="#f59e0b" radius={[3,3,0,0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : null;

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <ContentHeader
        title="Supply chain dashboard"
        actions={
          <div className="flex items-center gap-2">
            {/* Dashboard Presets Dropdown */}
            <div className="relative">
              <button
                onClick={() => setPresetDropdownOpen(!presetDropdownOpen)}
                className="btn-base btn-purple gap-1.5 shadow-sm"
                title="Select or save dashboard layout presets"
              >
                <Bookmark className="w-3.5 h-3.5 text-white" />
                <span className="max-w-[120px] sm:max-w-none truncate">{activePreset.name}</span>
                <ChevronDown className="w-3 h-3 text-brand-200" />
              </button>

              {presetDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setPresetDropdownOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-slate-200 z-40 p-1 space-y-1 text-xs">
                    <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
                      <span className="font-extrabold text-slate-800">Dashboard Presets</span>
                      <button
                        onClick={() => { setPresetDropdownOpen(false); setSaveModalOpen(true); }}
                        className="text-[11px] font-semibold text-brand-600 hover:text-brand-800 flex items-center gap-1"
                      >
                        <Save className="w-3 h-3" />
                        Save current
                      </button>
                    </div>

                    <div className="max-h-60 overflow-y-auto space-y-0.5">
                      <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Built-in Presets
                      </div>
                      {BUILTIN_PRESETS.map(preset => {
                        const isSelected = activePresetId === preset.id;
                        return (
                          <button
                            key={preset.id}
                            onClick={() => handleSelectPreset(preset)}
                            className={`w-full text-left px-3 py-2 rounded-lg transition-colors flex items-start justify-between gap-2 ${
                              isSelected ? 'bg-brand-50 text-brand-900 font-semibold' : 'hover:bg-slate-50 text-slate-700'
                            }`}
                          >
                            <div>
                              <div className="flex items-center gap-1.5 font-medium">
                                {preset.name}
                                {isSelected && <Check className="w-3.5 h-3.5 text-brand-600 shrink-0" />}
                              </div>
                              <p className="text-[10.5px] text-slate-500 font-normal line-clamp-1">{preset.description}</p>
                            </div>
                          </button>
                        );
                      })}

                      {customPresets.length > 0 && (
                        <>
                          <div className="px-2 py-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-t border-slate-100 mt-1">
                            Custom Presets
                          </div>
                          {customPresets.map(preset => {
                            const isSelected = activePresetId === preset.id;
                            return (
                              <div
                                key={preset.id}
                                onClick={() => handleSelectPreset(preset)}
                                className={`group/p w-full text-left px-3 py-2 rounded-lg transition-colors flex items-start justify-between gap-2 cursor-pointer ${
                                  isSelected ? 'bg-brand-50 text-brand-900 font-semibold' : 'hover:bg-slate-50 text-slate-700'
                                }`}
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 font-medium truncate">
                                    {preset.name}
                                    {isSelected && <Check className="w-3.5 h-3.5 text-brand-600 shrink-0" />}
                                  </div>
                                  <p className="text-[10.5px] text-slate-500 font-normal line-clamp-1">{preset.description}</p>
                                </div>
                                <button
                                  onClick={(e) => handleDeleteCustomPreset(preset.id, e)}
                                  className="opacity-0 group-hover/p:opacity-100 p-1 text-slate-400 hover:text-red-600 rounded hover:bg-red-50 transition-all shrink-0"
                                  title="Delete custom preset"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            );
                          })}
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            <button
              onClick={() => setIsCustomizing(!isCustomizing)}
              className={`btn-base gap-1.5 shadow-sm transition-all ${
                isCustomizing
                  ? 'btn-emerald font-bold ring-2 ring-emerald-300'
                  : 'btn-amber'
              }`}
              title="Toggle live customization mode to resize, drag, reorder and manage dashboard components"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-white" />
              {isCustomizing ? 'Done Customizing' : 'Customize layout'}
            </button>
            <button
              onClick={() => setPresentationMode(true)}
              className="btn-base btn-sky gap-1.5 shadow-sm"
              title="Open the monthly management pack view"
            >
              <Presentation className="w-3.5 h-3.5 text-white" />
              Management pack
            </button>
          </div>
        }
      />

      <ErrorState error={error} onRetry={loadData} />

      {/* ── Active Customization Mode Banner ──────────────────────────────────── */}
      {isCustomizing && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="p-4 bg-gradient-to-r from-brand-900 via-brand-800 to-slate-900 text-white rounded-2xl shadow-xl border border-brand-700/60 flex flex-col sm:flex-row items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-brand-500/20 text-brand-200 border border-brand-400/30 rounded-xl shrink-0">
              <GripVertical className="w-5 h-5 text-brand-300 animate-bounce" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-extrabold tracking-tight text-white">
                  Dashboard Customization Mode Active
                </p>
                <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-brand-500/30 text-brand-200 border border-brand-400/30 rounded-full uppercase">
                  Live Editing
                </span>
              </div>
              <p className="text-xs text-brand-200/80 mt-0.5">
                Drag cards by top handle to reorder • Click edge/corner bars to resize width & height • Hide or add modules anytime.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setCustomizerOpen(true)}
              className="btn-base bg-brand-700 hover:bg-brand-600 text-white border border-brand-500/40 text-xs gap-1.5 shadow-sm"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Component Catalog ({widgetConfigs.filter(w => w.visible).length}/{widgetConfigs.length})
            </button>
            <button
              onClick={() => setSaveModalOpen(true)}
              className="btn-base bg-brand-800 hover:bg-brand-700 text-white border border-brand-600/40 text-xs gap-1.5 shadow-sm"
            >
              <Save className="w-3.5 h-3.5" />
              Save Preset
            </button>
            <button
              onClick={() => setIsCustomizing(false)}
              className="btn-base bg-white text-brand-950 font-bold hover:bg-brand-50 text-xs px-4 shadow-md"
            >
              Done Customizing
            </button>
          </div>
        </motion.div>
      )}

      {/* ── Customizable Layout Grid with Layout Animations ───────────────────── */}
      <motion.div layout className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnimatePresence mode="popLayout">
          {widgetConfigs
            .filter(w => w.visible)
            .map((w, index) => {
              const content = renderWidget(w.id, w);
              if (!content) return null;
              const spanClass = w.width === 'full' ? 'lg:col-span-2' : 'lg:col-span-1';
              const isDragging = draggedWidgetId === w.id;
              const isDragOver = dragOverWidgetId === w.id;
              const heightLabel = w.height === 'sm' ? 'Short' : w.height === 'lg' ? 'Tall' : 'Normal';

              return (
                <motion.div
                  key={w.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ type: 'spring', stiffness: 350, damping: 28 }}
                  draggable={isCustomizing}
                  onDragStart={(e) => isCustomizing && handleGridDragStart(e as unknown as React.DragEvent, w.id)}
                  onDragOver={(e) => isCustomizing && handleGridDragOver(e as unknown as React.DragEvent, w.id)}
                  onDragLeave={(e) => isCustomizing && handleGridDragLeave(e as unknown as React.DragEvent, w.id)}
                  onDrop={(e) => isCustomizing && handleGridDrop(e as unknown as React.DragEvent, w.id)}
                  onDragEnd={handleGridDragEnd}
                  className={`${spanClass} relative group transition-all duration-200 ${
                    isCustomizing
                      ? 'ring-2 ring-brand-400/60 border-2 border-dashed border-brand-300 rounded-2xl bg-brand-50/10'
                      : ''
                  } ${
                    isDragging ? 'opacity-40 scale-[0.99] border-2 border-dashed border-brand-500 rounded-2xl' : ''
                  } ${
                    isDragOver ? 'ring-2 ring-brand-600 shadow-2xl rounded-2xl scale-[1.01] bg-brand-100/30' : ''
                  }`}
                >
                  {/* Drag, Drop, & Resize Controls (ONLY active when Customization Mode is enabled via button) */}
                  {isCustomizing && (
                    <>
                      {/* Top Control Bar */}
                      <div className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-white/95 backdrop-blur border border-brand-200 shadow-lg rounded-xl p-1 text-[11px] ring-2 ring-brand-400">
                        <div
                          className="cursor-grab active:cursor-grabbing p-1.5 text-brand-600 hover:bg-brand-50 rounded-lg flex items-center gap-1 font-semibold text-[10px]"
                          title="Drag to rearrange widget position"
                        >
                          <GripVertical className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Drag</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleMoveWidget(w.id, 'prev')}
                          disabled={index === 0}
                          className="p-1 text-slate-500 hover:text-slate-800 disabled:opacity-30 rounded"
                          title="Move up / left"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveWidget(w.id, 'next')}
                          disabled={index === widgetConfigs.filter(wc => wc.visible).length - 1}
                          className="p-1 text-slate-500 hover:text-slate-800 disabled:opacity-30 rounded"
                          title="Move down / right"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                        <div className="w-px h-3 bg-slate-200 mx-0.5" />
                        <button
                          type="button"
                          onClick={() => handleToggleWidgetWidth(w.id)}
                          className="px-2 py-0.5 text-[10px] font-mono font-bold bg-brand-50 hover:bg-brand-100 text-brand-700 rounded-md transition-colors border border-brand-200"
                          title={w.width === 'full' ? 'Switch to Half Width' : 'Switch to Full Width'}
                        >
                          Width: {w.width === 'full' ? '100%' : '50%'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCycleWidgetHeight(w.id)}
                          className="px-2 py-0.5 text-[10px] font-mono font-bold bg-brand-50 hover:bg-brand-100 text-brand-700 rounded-md transition-colors border border-brand-200"
                          title="Cycle Height (Short -> Normal -> Tall)"
                        >
                          Height: {heightLabel}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveWidget(w.id)}
                          className="p-1 text-slate-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors"
                          title="Hide from Dashboard"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Right Edge Handle: Toggle Width */}
                      <div
                        onClick={(e) => { e.stopPropagation(); handleToggleWidgetWidth(w.id); }}
                        className="absolute top-1/2 -right-2 -translate-y-1/2 w-5 h-14 z-20 cursor-col-resize flex items-center justify-center group/h"
                        title={`Click edge to toggle width (${w.width === 'full' ? 'Switch to Half width' : 'Switch to Full width'})`}
                      >
                        <div className="w-2 h-10 bg-brand-500/90 rounded-full shadow-lg group-hover/h:scale-125 group-hover/h:bg-brand-600 transition-all border border-white" />
                      </div>

                      {/* Bottom Edge Handle: Cycle Height */}
                      <div
                        onClick={(e) => { e.stopPropagation(); handleCycleWidgetHeight(w.id); }}
                        className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 h-5 w-20 z-20 cursor-row-resize flex items-center justify-center group/v"
                        title={`Click edge to toggle height (${heightLabel} -> Next)`}
                      >
                        <div className="h-2 w-12 bg-brand-500/90 rounded-full shadow-lg group-hover/v:scale-125 group-hover/v:bg-brand-600 transition-all border border-white" />
                      </div>

                      {/* Bottom-Right Corner Handle: Cycle dimensions */}
                      <div
                        onClick={(e) => { e.stopPropagation(); handleCycleWidgetHeight(w.id); handleToggleWidgetWidth(w.id); }}
                        className="absolute -bottom-2 -right-2 w-6 h-6 z-20 cursor-nwse-resize flex items-center justify-center group/c"
                        title="Click corner to resize height & width"
                      >
                        <div className="w-3.5 h-3.5 bg-brand-600 rounded-md shadow-lg group-hover/c:scale-125 group-hover/c:bg-brand-700 transition-all border border-white" />
                      </div>
                    </>
                  )}

                  {content}
                </motion.div>
              );
            })}
        </AnimatePresence>
      </motion.div>

      {/* ── Component Module Catalog / Add Widgets Bar ──────────────────────── */}
      {widgetConfigs.some(w => !w.visible) && (
        <div className="card-elevated p-5 border-dashed border-2 border-brand-200/80 bg-brand-50/30 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-brand-100 text-brand-700 rounded-xl">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-800">
                {widgetConfigs.filter(w => !w.visible).length} Report Module Visualization Components Available
              </p>
              <p className="text-[11px] text-slate-500">
                You have hidden data visualization components. Click below to add them back or reorder the dashboard grid layout.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCustomizerOpen(true)}
            className="btn-base btn-primary gap-1.5 text-xs shrink-0"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Add / Manage Dashboard Components
          </button>
        </div>
      )}

      {/* ── Customizer Modal ──────────────────────────────────────────────── */}
      <DashboardCustomizerModal
        open={customizerOpen}
        onClose={() => setCustomizerOpen(false)}
        widgets={widgetConfigs}
        onSave={saveLayout}
        onReset={resetLayout}
      />

      {/* ── Save Custom Preset Modal ────────────────────────────────────────── */}
      <Modal
        open={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        title="Save Dashboard Layout Preset"
      >
        <form onSubmit={handleSaveNewPreset} className="space-y-4 pt-1">
          <p className="text-xs text-slate-600">
            Save your current widget layout, visibility, and heights as a custom preset for quick loading anytime.
          </p>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Preset Name</label>
            <input
              type="text"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              placeholder="e.g. Executive Summary, Daily Procurement View"
              required
              className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setSaveModalOpen(false)}
              className="btn-base btn-secondary text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-base btn-primary text-xs gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              Save Preset
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
