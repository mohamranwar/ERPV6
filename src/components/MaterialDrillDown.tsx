/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  fetchTableData,
  getVMaterialMonthlyProjection,
  getSafetyStockQty,
  getSafetyStockMonths,
  hasSafetyStockOverride,
  SAFETY_SERVICE_FACTOR
} from '../supabaseClient';
import {
  Material, VMaterialMonthlyProjection, Supplier, MaterialCategory,
  MaterialAlternative, BOMOption, BOMSlot, BOMHeader, Product
} from '../types';
import {
  Layers, ShieldAlert, Sparkles, TrendingUp, Info, RefreshCw, Calendar,
  Package, Truck, CheckCircle2, AlertTriangle, Filter, ChevronRight,
  Send, ExternalLink, ArrowUpDown, ArrowLeft, ShoppingBag, DollarSign, Search,
  ChevronDown, ChevronUp, LineChart
} from 'lucide-react';
import DataStateWrapper from './DataStateWrapper';
import { useTableFilters } from '../hooks/useTableFilters';
import SearchBar from './SearchBar';
import ScrollableTable from './ScrollableTable';
import ContentHeader from './ContentHeader';
import { useToast } from '../context/ToastConfirmContext';

const formatPeriodLabel = (periodStart: string, grain: 'day' | 'week' | 'month' = 'month') => {
  if (!periodStart) return '';
  if (grain === 'day') {
    const d = new Date(periodStart);
    return isNaN(d.getTime()) ? periodStart : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  }
  if (grain === 'week') {
    const d = new Date(periodStart);
    if (isNaN(d.getTime())) return periodStart;
    const end = new Date(d.getTime() + 6 * 24 * 60 * 60 * 1000);
    const fmt = (dt: Date) => dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    return `${fmt(d)} - ${fmt(end)}`;
  }
  const parts = periodStart.split('-');
  if (parts.length < 2) return periodStart;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthIdx = parseInt(parts[1], 10) - 1;
  const yearShort = parts[0] ? `'${parts[0].slice(-2)}` : '';
  return `${months[monthIdx] || ''} ${yearShort}`.trim();
};

interface SparklineDataPoint {
  label: string;
  value: number;
}

interface InventorySparklineProps {
  data: SparklineDataPoint[];
  safetyStock: number;
  width?: number;
  height?: number;
  showLabels?: boolean;
}

export function InventorySparkline({
  data,
  safetyStock,
  width = 240,
  height = 55,
  showLabels = true
}: InventorySparklineProps) {
  if (!data || data.length === 0) {
    return <span className="text-[10px] text-slate-400 font-mono">No trend data available</span>;
  }

  const allValues = [...data.map(d => d.value), safetyStock, 0];
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues) * 1.15 || 100;
  const valueRange = maxValue - minValue || 1;

  const paddingX = 18;
  const paddingY = 10;
  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingY * 2;

  const getX = (index: number) => {
    if (data.length <= 1) return width / 2;
    return paddingX + (index / (data.length - 1)) * chartWidth;
  };

  const getY = (val: number) => {
    return height - paddingY - ((val - minValue) / valueRange) * chartHeight;
  };

  const points = data.map((d, i) => `${getX(i)},${getY(d.value)}`).join(' ');
  const safetyY = getY(safetyStock);

  const isHealthy = data.every(d => d.value >= safetyStock);
  const isNegative = data.some(d => d.value < 0);

  const strokeColor = isNegative ? '#dc2626' : isHealthy ? '#059669' : '#d97706';
  const fillColor = isNegative ? 'rgba(239, 68, 68, 0.12)' : isHealthy ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)';

  const firstX = getX(0);
  const lastX = getX(data.length - 1);
  const bottomY = height - paddingY;
  const areaPath = `M ${firstX},${bottomY} L ${points} L ${lastX},${bottomY} Z`;

  return (
    <div className="inline-flex flex-col items-center select-none">
      <svg width={width} height={height} className="overflow-visible">
        {/* Safety Stock Threshold Line */}
        {safetyStock > 0 && safetyY >= paddingY && safetyY <= height - paddingY && (
          <line
            x1={paddingX - 4}
            y1={safetyY}
            x2={width - paddingX + 4}
            y2={safetyY}
            stroke="#b45309"
            strokeWidth="1.2"
            strokeDasharray="3 3"
            opacity={0.65}
          />
        )}

        {/* Area Fill */}
        <path d={areaPath} fill={fillColor} />

        {/* Trend Line */}
        <polyline
          fill="none"
          stroke={strokeColor}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />

        {/* Data Dots */}
        {data.map((d, i) => {
          const cx = getX(i);
          const cy = getY(d.value);
          const isPointNegative = d.value < 0;
          const isPointBelowSafety = d.value < safetyStock;

          return (
            <g key={i} className="group/dot cursor-pointer">
              <circle
                cx={cx}
                cy={cy}
                r={4}
                fill={isPointNegative ? '#dc2626' : isPointBelowSafety ? '#d97706' : '#059669'}
                stroke="#ffffff"
                strokeWidth={1.5}
                className="transition-transform duration-150 group-hover/dot:scale-150"
              />
              <title>{`${d.label}: ${Math.round(d.value).toLocaleString()} units`}</title>
            </g>
          );
        })}
      </svg>

      {showLabels && (
        <div className="flex justify-between w-full px-1 mt-1 text-[9px] font-mono text-slate-500 font-bold">
          {data.map((d, i) => (
            <span key={i} title={`${d.label}: ${Math.round(d.value).toLocaleString()} units`}>
              {d.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface MaterialDrillDownProps {
  searchQuery?: string;
  setSearchQuery?: (val: string) => void;
  refreshKey?: number;
  onNavigate?: (screen: string) => void;
  initialMode?: 'selector' | 'detail';
}

export default function MaterialDrillDown({
  searchQuery = '',
  setSearchQuery = () => {},
  refreshKey = 0,
  onNavigate = () => {},
  initialMode = 'selector',
}: MaterialDrillDownProps) {
  const { showToast } = useToast();

  const [materials, setMaterials] = useState<Material[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<MaterialCategory[]>([]);
  const [alternatives, setAlternatives] = useState<MaterialAlternative[]>([]);
  const [bomOptions, setBomOptions] = useState<BOMOption[]>([]);
  const [bomSlots, setBomSlots] = useState<BOMSlot[]>([]);
  const [bomHeaders, setBomHeaders] = useState<BOMHeader[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const [selectedMaterialId, setSelectedMaterialId] = useState<string>('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('ALL');
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('ALL');
  const [selectedControllerId, setSelectedControllerId] = useState<string>('ALL');
  const [selectedStatusId, setSelectedStatusId] = useState<string>('ALL'); // 'ALL' | 'CRITICAL' | 'COVERED'
  const [materialSummaries, setMaterialSummaries] = useState<Record<string, {
    openingStock: number;
    openSupply: number;
    inTransit: number;
    openPOs: number;
    grossReq: number;
    safetyStock: number;
    isDeficit: boolean;
    endingStock: number;
    coverageMonths: number;
    monthlyTrend: Array<{ period: string; endingStock: number; openingStock: number; consumption: number }>;
  }>>({});
  const [viewMode, setViewMode] = useState<'selector' | 'detail'>(initialMode);
  const [inspectionSearchQuery, setInspectionSearchQuery] = useState<string>('');
  const [expandedMaterialIds, setExpandedMaterialIds] = useState<Record<string, boolean>>({});

  const toggleExpandRow = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedMaterialIds(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  useEffect(() => {
    setViewMode(initialMode);
  }, [initialMode]);

  // Grain State (day, week, month)
  const [inspectionGrain, setInspectionGrain] = useState<'day' | 'week' | 'month'>('month');

  // Projections
  const [projections, setProjections] = useState<VMaterialMonthlyProjection[]>([]);
  const [shipments, setShipments] = useState<any[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadProjectionsForMaterials(mats: Material[], grainMode: 'day' | 'week' | 'month' = inspectionGrain) {
    const summaryMap: Record<string, {
      openingStock: number;
      openSupply: number;
      inTransit: number;
      openPOs: number;
      grossReq: number;
      safetyStock: number;
      isDeficit: boolean;
      endingStock: number;
      coverageMonths: number;
      monthlyTrend: Array<{ period: string; endingStock: number; openingStock: number; consumption: number }>;
    }> = {};

    await Promise.all(
      mats.map(async (m) => {
        try {
          const proj = await getVMaterialMonthlyProjection(m.id, grainMode);
          const openingStock = proj.length > 0 ? (proj[0].opening_stock ?? 0) : 0;
          const grossReq = proj.reduce((sum, p) => sum + (p.plan_consumption || 0), 0);
          const inTransit = proj.reduce((sum, p) => sum + (p.in_transit_qty || 0), 0);
          const openPOs = proj.reduce((sum, p) => sum + (p.pending_po_qty || 0), 0);
          const openSupply = inTransit + openPOs;
          const plannedCons = proj.map(p => p.plan_consumption ?? 0).filter(q => q > 0);
          const avgMonthly = plannedCons.length > 0 ? plannedCons.reduce((sum, q) => sum + q, 0) / plannedCons.length : 0;
          const safetyStock = getSafetyStockQty(m, avgMonthly);
          const isDeficit = proj.some(p => (p.ending_stock ?? 0) < 0);
          const endingStock = proj.length > 0 ? (proj[proj.length - 1].ending_stock ?? 0) : 0;
          const coverageMonths = proj.length > 0 ? ((proj[proj.length - 1].ending_coverage_days ?? 0) / 30) : 0;

          const monthlyTrend = proj.slice(0, 3).map(p => ({
            period: formatPeriodLabel(p.period_start, grainMode),
            endingStock: p.ending_stock ?? 0,
            openingStock: p.opening_stock ?? 0,
            consumption: p.plan_consumption ?? 0
          }));

          summaryMap[m.id] = {
            openingStock,
            openSupply,
            inTransit,
            openPOs,
            grossReq,
            safetyStock,
            isDeficit,
            endingStock,
            coverageMonths,
            monthlyTrend
          };
        } catch (err) {
          console.error(`Projection computation error for ${m.sku}`, err);
        }
      })
    );
    setMaterialSummaries(summaryMap);
  }

  async function loadInitial() {
    setLoading(true);
    setError(null);
    try {
      const [mats, sups, cats, alts, shps, pos, opts, slots, hdrs, prods] = await Promise.all([
        fetchTableData<Material>('materials'),
        fetchTableData<Supplier>('suppliers'),
        fetchTableData<MaterialCategory>('material_categories'),
        fetchTableData<MaterialAlternative>('material_alternatives'),
        fetchTableData<any>('shipments'),
        fetchTableData<any>('purchase_orders'),
        fetchTableData<BOMOption>('bom_options'),
        fetchTableData<BOMSlot>('bom_slots'),
        fetchTableData<BOMHeader>('bom_headers'),
        fetchTableData<Product>('products'),
      ]);

      setMaterials(mats);
      setSuppliers(sups);
      setCategories(cats);
      setAlternatives(alts);
      setShipments(shps);
      setPurchaseOrders(pos);
      setBomOptions(opts);
      setBomSlots(slots);
      setBomHeaders(hdrs);
      setProducts(prods);

      if (mats.length > 0) {
        setSelectedMaterialId(prev => (prev && mats.some(m => m.id === prev)) ? prev : mats[0].id);
        await loadProjectionsForMaterials(mats);
      }
      setLoading(false);
    } catch (e: any) {
      console.error("Failed to load Material Check initial data", e);
      setError(e.message || "Failed to load master data.");
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInitial();
  }, [refreshKey]);

  useEffect(() => {
    if (!selectedMaterialId) {
      setProjections([]);
      return;
    }
    async function fetchProjections() {
      setLoading(true);
      setError(null);
      try {
        const data = await getVMaterialMonthlyProjection(selectedMaterialId, inspectionGrain);
        setProjections(data);
      } catch (err: any) {
        console.error("Projection fetch failed", err);
        setError(err.message || "Failed to fetch projections.");
      } finally {
        setLoading(false);
      }
    }
    fetchProjections();
  }, [selectedMaterialId, inspectionGrain]);

  // Derived list of unique controllers
  const controllersList = useMemo(() => {
    const set = new Set<string>();
    materials.forEach(m => {
      if (m.controller) set.add(m.controller);
    });
    return Array.from(set).sort();
  }, [materials]);

  // Filters setup: Enforce "Search Field Overrides Dropdowns" rule
  const categoryFilterActive = selectedCategoryId !== 'ALL' && !searchQuery;
  const supplierFilterActive = selectedSupplierId !== 'ALL' && !searchQuery;
  const controllerFilterActive = selectedControllerId !== 'ALL' && !searchQuery;
  const statusFilterActive = selectedStatusId !== 'ALL' && !searchQuery;

  const categorySupplierFilteredMaterials = useMemo(() => {
    return materials.filter(m => {
      if (categoryFilterActive && m.category_id !== selectedCategoryId) return false;
      if (supplierFilterActive && m.supplier_id !== selectedSupplierId) return false;
      if (controllerFilterActive && (m.controller || 'Unassigned') !== selectedControllerId) return false;
      if (statusFilterActive) {
        const isDeficit = materialSummaries[m.id]?.isDeficit ?? false;
        if (selectedStatusId === 'CRITICAL' && !isDeficit) return false;
        if (selectedStatusId === 'COVERED' && isDeficit) return false;
      }
      return true;
    });
  }, [
    materials,
    selectedCategoryId,
    selectedSupplierId,
    selectedControllerId,
    selectedStatusId,
    materialSummaries,
    categoryFilterActive,
    supplierFilterActive,
    controllerFilterActive,
    statusFilterActive
  ]);

  // Search filtering
  const { filtered: filteredMaterials, hasActiveSearch } = useTableFilters<Material>(
    categorySupplierFilteredMaterials,
    ['name', 'sku', 'controller'],
    {},
    searchQuery,
    setSearchQuery
  );

  // Keep selection synchronized
  useEffect(() => {
    if (filteredMaterials.length > 0 && !filteredMaterials.some(m => m.id === selectedMaterialId)) {
      setSelectedMaterialId(filteredMaterials[0].id);
    }
  }, [filteredMaterials, selectedMaterialId]);

  // Dedicated filter for Inspection mode search
  const inspectionFilteredMaterials = useMemo(() => {
    if (!inspectionSearchQuery.trim()) return materials;
    const q = inspectionSearchQuery.toLowerCase().trim();
    return materials.filter(m =>
      m.sku.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      (m.controller && m.controller.toLowerCase().includes(q))
    );
  }, [materials, inspectionSearchQuery]);

  // Keep selection synchronized in Inspection mode when searching
  useEffect(() => {
    if (viewMode === 'detail' && inspectionFilteredMaterials.length > 0 && !inspectionFilteredMaterials.some(m => m.id === selectedMaterialId)) {
      setSelectedMaterialId(inspectionFilteredMaterials[0].id);
    }
  }, [inspectionFilteredMaterials, selectedMaterialId, viewMode]);

  const activeMaterial = useMemo(() => materials.find(m => m.id === selectedMaterialId), [materials, selectedMaterialId]);
  const activeSupplier = useMemo(() => suppliers.find(s => s.id === activeMaterial?.supplier_id), [suppliers, activeMaterial]);
  const activeCat = useMemo(() => categories.find(c => c.id === activeMaterial?.category_id), [categories, activeMaterial]);

  // Safety stock calculation matching MRP / DrillDown rules
  const safetyStockUnits = useMemo(() => {
    if (!activeMaterial) return 0;
    const planned = projections.map(p => p.plan_consumption ?? 0).filter(q => q > 0);
    const avgMonthly = planned.length > 0
      ? planned.reduce((sum, q) => sum + q, 0) / planned.length
      : 0;
    return getSafetyStockQty(activeMaterial, avgMonthly);
  }, [activeMaterial, projections]);

  // Find approved alternative materials
  const activeAlts = useMemo(() => {
    return alternatives
      .filter(a => a.material_id === selectedMaterialId)
      .map(a => materials.find(m => m.id === a.alternative_material_id))
      .filter((m): m is Material => !!m);
  }, [alternatives, selectedMaterialId, materials]);

  // Identify the first month ending stock goes negative
  const firstNegativeMonth = useMemo(() => projections.find(p => p.ending_stock < 0), [projections]);

  // Where Used - Find finished goods consuming this raw material
  const whereUsedList = useMemo(() => {
    if (!selectedMaterialId) return [];
    const matchingOpts = bomOptions.filter(o => o.material_id === selectedMaterialId);

    const list: Array<{
      product: Product;
      slotName: string;
      qtyPerUnit: number;
      scrapPercent: number;
      priority: number;
    }> = [];

    matchingOpts.forEach(opt => {
      const slot = bomSlots.find(s => s.id === opt.slot_id);
      if (!slot) return;
      const header = bomHeaders.find(h => h.id === slot.bom_id);
      if (!header || !header.is_active) return;
      const prod = products.find(p => p.id === header.product_id);
      if (!prod) return;

      list.push({
        product: prod,
        slotName: slot.slot_name,
        qtyPerUnit: opt.qty_per_unit,
        scrapPercent: opt.scrap_percent,
        priority: opt.priority,
      });
    });

    return list;
  }, [selectedMaterialId, bomOptions, bomSlots, bomHeaders, products]);

  // Executive KPI summary stats
  const totalMaterialsCount = materials.length;
  const atRiskCount = useMemo(() => {
    return materials.filter(m => materialSummaries[m.id]?.isDeficit).length;
  }, [materials, materialSummaries]);

  const formatMonth = (periodStart: string) => formatPeriodLabel(periodStart, inspectionGrain);

  const formatDateFriendly = (dateStr: string | null | undefined) => {
    if (!dateStr) return 'N/A';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}-${month}-${year}`;
    } catch {
      return dateStr;
    }
  };

  // Build incoming freight & PO receipts timeline events
  const timelineEvents = useMemo(() => {
    const materialShipments = shipments.filter(s => s.material_id === selectedMaterialId);
    const materialPOs = purchaseOrders.filter(po => po.material_id === selectedMaterialId && po.status === 'pending');

    const events = [
      ...materialShipments.map(s => ({
        type: 'shipment',
        id: s.id,
        date: s.factory_arrival_date || s.port_eta,
        qty: s.qty,
        reference: s.invoice_no,
        details: `BL: ${s.bl_no || 'Pending'} | Freight: ${s.ship_method?.toUpperCase() || 'SEA'}`,
        status: 'In-Transit'
      })),
      ...materialPOs.map(po => ({
        type: 'purchase_order',
        id: po.id,
        date: po.required_date,
        qty: po.remaining_qty,
        reference: po.order_no,
        details: `Supplier PO: ${po.status?.toUpperCase() || 'PENDING'}`,
        status: 'Planned PO'
      }))
    ];

    events.sort((a, b) => {
      const dA = a.date ? new Date(a.date).getTime() : 0;
      const dB = b.date ? new Date(b.date).getTime() : 0;
      return dA - dB;
    });

    return events;
  }, [shipments, purchaseOrders, selectedMaterialId]);

  // Summary calculations for selected material
  const summaryMetrics = useMemo(() => {
    if (!projections || projections.length === 0) {
      return {
        grossReq: 0,
        inTransit: 0,
        openPOs: 0,
        totalSupply: 0,
        openingStock: 0,
        endingStock: 0,
        coverageMonths: 0,
      };
    }
    const grossReq = projections.reduce((sum, p) => sum + (p.plan_consumption || 0), 0);
    const inTransit = projections.reduce((sum, p) => sum + (p.in_transit_qty || 0), 0);
    const openPOs = projections.reduce((sum, p) => sum + (p.pending_po_qty || 0), 0);
    const totalSupply = inTransit + openPOs;
    const openingStock = projections[0]?.opening_stock || 0;
    const endingStock = projections[projections.length - 1]?.ending_stock || 0;
    const coverageMonths = (projections[projections.length - 1]?.ending_coverage_days || 0) / 30;

    return {
      grossReq,
      inTransit,
      openPOs,
      totalSupply,
      openingStock,
      endingStock,
      coverageMonths,
    };
  }, [projections]);

  const handleSelectMaterial = (materialId: string) => {
    setSelectedMaterialId(materialId);
    setViewMode('detail');
  };

  return (
    <div className="space-y-6" id="material_drilldown_screen">
      {/* ----------------- PAGE VIEW 1: COMPONENT SELECTOR PAGE ----------------- */}
      {viewMode === 'selector' ? (
        <div className="space-y-6">
          <ContentHeader
            title="Material Check — Interactive Component Selector"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={loadInitial}
                  className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-700 font-semibold hover:bg-slate-50 flex items-center gap-1 shadow-2xs cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-slate-500" /> Refresh Data
                </button>
              </div>
            }
          />

          {/* KPI Stats Overview Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="card-elevated p-3.5 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Components</span>
                <span className="text-xl font-bold font-mono text-slate-900">{totalMaterialsCount}</span>
                <span className="text-[10px] text-slate-500 block mt-0.5 font-medium">Raw Materials & Packaging</span>
              </div>
              <div className="p-2.5 bg-slate-100 text-slate-600 rounded-lg">
                <Package className="w-5 h-5" />
              </div>
            </div>

            <div className="card-elevated p-3.5 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">Healthy Inventory</span>
                <span className="text-xl font-bold font-mono text-emerald-700">{totalMaterialsCount - atRiskCount}</span>
                <span className="text-[10px] text-emerald-600/80 block mt-0.5 font-medium">Sufficient Stock Cover</span>
              </div>
              <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-lg">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            </div>

            <div className="card-elevated p-3.5 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-red-600 uppercase tracking-wider block">Shortage Risk</span>
                <span className="text-xl font-bold font-mono text-red-600">{atRiskCount}</span>
                <span className="text-[10px] text-red-600/80 block mt-0.5 font-medium">Deficit Projected</span>
              </div>
              <div className="p-2.5 bg-red-50 text-red-600 rounded-lg">
                <ShieldAlert className="w-5 h-5" />
              </div>
            </div>

            <div className="card-elevated p-3.5 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block">Primary Suppliers</span>
                <span className="text-xl font-bold font-mono text-indigo-700">{suppliers.length}</span>
                <span className="text-[10px] text-slate-500 block mt-0.5 font-medium">Active Vendors</span>
              </div>
              <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-lg">
                <Truck className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Control Filter Bar */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <SearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search component SKU, name, or controller..."
                className="w-64"
                hasActiveSearch={hasActiveSearch}
              />

              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Category:</span>
                <select aria-label="Select category id"
                  value={selectedCategoryId}
                  onChange={e => setSelectedCategoryId(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-700 font-bold cursor-pointer"
                >
                  <option value="ALL">All Categories ({categories.length})</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Supplier:</span>
                <select aria-label="Select supplier id"
                  value={selectedSupplierId}
                  onChange={e => setSelectedSupplierId(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-700 font-bold cursor-pointer"
                >
                  <option value="ALL">All Suppliers ({suppliers.length})</option>
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Controller:</span>
                <select aria-label="Select controller id"
                  value={selectedControllerId}
                  onChange={e => setSelectedControllerId(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-700 font-bold cursor-pointer"
                >
                  <option value="ALL">All Controllers ({controllersList.length})</option>
                  {controllersList.map(ctrl => (
                    <option key={ctrl} value={ctrl}>{ctrl}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Stock Status:</span>
                <select aria-label="Select status id"
                  value={selectedStatusId}
                  onChange={e => setSelectedStatusId(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-700 font-bold cursor-pointer"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="CRITICAL">Critical / Deficit Only ⚠️</option>
                  <option value="COVERED">Covered / Healthy Only ✅</option>
                </select>
              </div>

              {/* Time Horizon / Grain Switcher */}
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-1">Grain:</span>
                <button
                  type="button"
                  onClick={() => {
                    setInspectionGrain('day');
                    if (materials.length > 0) loadProjectionsForMaterials(materials, 'day');
                  }}
                  className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                    inspectionGrain === 'day' 
                      ? 'bg-white text-blue-600 shadow-2xs' 
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Daily
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInspectionGrain('week');
                    if (materials.length > 0) loadProjectionsForMaterials(materials, 'week');
                  }}
                  className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                    inspectionGrain === 'week' 
                      ? 'bg-white text-blue-600 shadow-2xs' 
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Weekly
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInspectionGrain('month');
                    if (materials.length > 0) loadProjectionsForMaterials(materials, 'month');
                  }}
                  className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                    inspectionGrain === 'month' 
                      ? 'bg-white text-blue-600 shadow-2xs' 
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Monthly
                </button>
              </div>
            </div>

            <div className="text-[11px] font-mono text-slate-500 font-semibold">
              Showing {filteredMaterials.length} of {materials.length} components
            </div>
          </div>

          {/* Master Component Directory Table */}
          <div className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-6 py-4 bg-slate-900 text-white flex flex-wrap justify-between items-center gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-blue-500/20 text-blue-400 rounded-lg border border-blue-500/30">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold tracking-tight text-slate-100 flex items-center gap-2">
                    Component Directory & Balance Matrix
                  </h3>
                  <p className="text-[11px] text-slate-400 font-medium">
                    Monitor inventory balances, inbound freight, open purchase orders, and production demand for all components
                  </p>
                </div>
              </div>
              <span className="text-xs text-blue-300 bg-blue-900/50 border border-blue-700/50 px-3 py-1 rounded-full font-medium">
                Click any component row to view detailed coverage analysis 🔍
              </span>
            </div>

            <ScrollableTable>
              <table className="min-w-full divide-y divide-slate-200/80 text-left text-xs font-sans">
                <thead className="bg-slate-50/90 text-[11px] font-bold text-slate-500 uppercase tracking-wider sticky top-0 z-10 border-b border-slate-200">
                  <tr>
                    <th className="px-3 sm:px-5 py-3.5">Component & SKU</th>
                    <th className="px-4 py-3.5 hidden md:table-cell">Category & Vendor</th>
                    <th className="px-3 py-3.5 hidden lg:table-cell">Controller</th>
                    <th className="px-3 sm:px-4 py-3.5 text-right bg-emerald-50/60 text-emerald-950 font-bold">On-Hand Stock 📦</th>
                    <th className="px-4 py-3.5 text-right bg-indigo-50/60 text-indigo-950 font-bold hidden sm:table-cell">Open POs & Transit 🚢</th>
                    <th className="px-4 py-3.5 text-right hidden md:table-cell">Gross Demand ⚙️</th>
                    <th className="px-4 py-3.5 text-right hidden lg:table-cell">Safety Target 🛡️</th>
                    <th className="px-3 sm:px-4 py-3.5 text-center">Stock Coverage Status</th>
                    <th className="px-3 sm:px-4 py-3.5 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs bg-white">
                  {filteredMaterials.map(m => {
                    const cat = categories.find(c => c.id === m.category_id);
                    const sup = suppliers.find(s => s.id === m.supplier_id);
                    const summary = materialSummaries[m.id];
                    const isDeficit = summary?.isDeficit ?? false;

                    return (
                      <React.Fragment key={m.id}>
                        <tr
                          onClick={() => handleSelectMaterial(m.id)}
                          className={`group cursor-pointer transition-all duration-200 hover:bg-slate-100/80 hover:shadow-2xs ${
                            isDeficit ? 'bg-red-50/30 hover:bg-red-50/60' : ''
                          } ${
                            expandedMaterialIds[m.id]
                              ? 'bg-blue-50/70 font-medium border-l-4 border-l-blue-600'
                              : 'hover:border-l-4 hover:border-l-blue-400'
                          }`}
                        >
                        {/* Component Name & SKU */}
                        <td className="px-3 sm:px-5 py-3.5">
                          <div className="font-bold text-slate-900 text-sm group-hover:text-blue-700 transition-colors break-words">
                            {m.name}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mt-1">
                            <span className="font-mono text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded">
                              {m.sku}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              LT: {m.total_lead_time_days} days
                            </span>
                          </div>
                        </td>

                        {/* Category & Supplier */}
                        <td className="px-4 py-3.5 hidden md:table-cell">
                          <div className="inline-block px-2 py-0.5 bg-slate-100 text-slate-700 font-bold text-[10px] rounded mb-0.5 border border-slate-200">
                            {cat?.name || 'Raw Material'}
                          </div>
                          <div className="text-[11px] text-slate-600 font-medium truncate max-w-[140px]">
                            {sup?.name || 'Standard Vendor'}
                          </div>
                        </td>

                        {/* Controller */}
                        <td className="px-3 py-3.5 hidden lg:table-cell">
                          <span className="inline-block px-2.5 py-1 bg-slate-100 text-slate-700 rounded-md text-[11px] font-mono font-bold border border-slate-200">
                            {m.controller || 'Unassigned'}
                          </span>
                        </td>

                        {/* On-Hand Stock */}
                        <td className="px-3 sm:px-4 py-3.5 text-right bg-emerald-50/20 group-hover:bg-emerald-50/40 transition-colors">
                          <div className="font-mono font-bold text-sm text-emerald-900">
                            {summary ? summary.openingStock.toLocaleString() : '—'}
                          </div>
                          <div className="text-[10px] font-sans font-medium text-emerald-700">
                            {m.uom || 'units'}
                          </div>
                        </td>

                        {/* Open Orders & Freight */}
                        <td className="px-4 py-3.5 text-right bg-indigo-50/20 group-hover:bg-indigo-50/40 transition-colors hidden sm:table-cell">
                          <div className="font-mono font-bold text-sm text-indigo-900">
                            +{summary ? summary.openSupply.toLocaleString() : '—'}
                          </div>
                          {summary && summary.openSupply > 0 ? (
                            <div className="text-[10px] font-mono text-indigo-600 font-semibold">
                              PO: +{summary.openPOs.toLocaleString()} | Transit: +{summary.inTransit.toLocaleString()}
                            </div>
                          ) : (
                            <div className="text-[10px] font-sans text-slate-400">No Open Orders</div>
                          )}
                        </td>

                        {/* Gross Demand */}
                        <td className="px-4 py-3.5 text-right hidden md:table-cell">
                          <div className="font-mono font-bold text-sm text-slate-800">
                            {summary ? summary.grossReq.toLocaleString() : '—'}
                          </div>
                          <div className="text-[10px] text-slate-400">{m.uom || 'units'}</div>
                        </td>

                        {/* Safety Stock Target */}
                        <td className="px-4 py-3.5 text-right hidden lg:table-cell">
                          <div className="font-mono font-bold text-sm text-amber-800">
                            {summary ? Math.round(summary.safetyStock).toLocaleString() : '—'}
                          </div>
                          <div className="text-[10px] text-amber-600/80 font-medium">Safety Target</div>
                        </td>

                        {/* Stock Coverage Status */}
                        <td className="px-3 sm:px-4 py-3.5 text-center">
                          {isDeficit ? (
                            <div className="inline-flex flex-col items-center">
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-100 border border-red-300 text-red-800 rounded-lg font-bold text-[11px] shadow-2xs">
                                <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0 animate-pulse" />
                                <span>Shortage Risk</span>
                              </span>
                              {summary && (
                                <span className="text-sm font-mono text-red-600 font-bold mt-1">
                                  Cover: {summary.coverageMonths.toFixed(1)} mos
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="inline-flex flex-col items-center">
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-100 border border-emerald-300 text-emerald-800 rounded-lg font-bold text-[11px] shadow-2xs">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                <span>Covered</span>
                              </span>
                              {summary && (
                                <span className="text-sm font-mono text-emerald-700 font-bold mt-1">
                                  Cover: {summary.coverageMonths.toFixed(1)} mos
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Action Button */}
                        <td className="px-3 sm:px-4 py-3.5 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={(e) => toggleExpandRow(m.id, e)}
                              className={`p-1.5 rounded-xl border text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                                expandedMaterialIds[m.id]
                                  ? 'bg-blue-100 text-blue-800 border-blue-300 shadow-2xs'
                                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                              }`}
                              title="Toggle 3-Month Trend Sparkline"
                            >
                              <LineChart className="w-3.5 h-3.5 text-blue-600" />
                              {expandedMaterialIds[m.id] ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectMaterial(m.id);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl transition-all shadow-xs hover:shadow-md cursor-pointer active:scale-95"
                            >
                              <span>Inspect Status</span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedMaterialIds[m.id] && (
                        <tr key={`${m.id}-expanded`} className="bg-slate-50/90 border-b border-slate-200">
                          <td colSpan={9} className="p-4 sm:p-5">
                            <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-xs flex flex-wrap lg:flex-nowrap items-center justify-between gap-6">
                              <div className="space-y-1.5 max-w-sm">
                                <div className="flex items-center gap-2">
                                  <div className="p-1.5 bg-blue-100 text-blue-700 rounded-lg">
                                    <LineChart className="w-4 h-4" />
                                  </div>
                                  <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">3-Month Inventory Projection Trend</span>
                                </div>
                                <p className="text-[11px] text-slate-500 leading-relaxed">
                                  Projected stock trajectory for <b className="text-slate-800">{m.name}</b> ({m.sku}) over the next 3 planning periods against Safety Stock threshold.
                                </p>
                                {summary && (
                                  <div className="flex items-center gap-2 text-[11px] font-mono font-bold pt-1">
                                    <span className="text-slate-500 font-sans font-medium">Safety Stock Target:</span>
                                    <span className="text-amber-800 bg-amber-50 border border-amber-200/80 px-2.5 py-0.5 rounded-md">
                                      {Math.round(summary.safetyStock).toLocaleString()} {m.uom || 'units'}
                                    </span>
                                  </div>
                                )}
                              </div>

                              {/* Sparkline Graphic */}
                              <div className="flex flex-wrap items-center gap-6 bg-slate-50/80 border border-slate-200/80 p-3.5 rounded-xl">
                                <InventorySparkline
                                  data={summary?.monthlyTrend.map(t => ({
                                    label: t.period,
                                    value: t.endingStock
                                  })) || []}
                                  safetyStock={summary?.safetyStock || 0}
                                  width={280}
                                  height={60}
                                />

                                <div className="space-y-1 border-l border-slate-200 pl-4 py-0.5 min-w-[170px]">
                                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Monthly Ending Balances</span>
                                  {summary?.monthlyTrend.map((t, idx) => {
                                    const isNegative = t.endingStock < 0;
                                    const isBelowSafety = t.endingStock < (summary.safetyStock || 0);
                                    return (
                                      <div key={idx} className="flex items-center justify-between gap-3 text-[11px] font-mono">
                                        <span className="text-slate-500 font-sans font-semibold">{t.period}:</span>
                                        <span className={`font-bold ${
                                          isNegative ? 'text-red-600 font-black' : isBelowSafety ? 'text-amber-700' : 'text-emerald-700'
                                        }`}>
                                          {Math.round(t.endingStock).toLocaleString()} {m.uom || 'units'}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Quick Action Button */}
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSelectMaterial(m.id);
                                  }}
                                  className="px-4 py-2 bg-slate-900 hover:bg-blue-600 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                                >
                                  <span>Full Material Inspection</span>
                                  <ChevronRight className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                  })}
                  {filteredMaterials.length === 0 && (
                    <tr>
                      <td colSpan={9} className="p-12 text-center text-slate-400 bg-slate-50/50">
                        <div className="max-w-md mx-auto space-y-2">
                          <p className="text-slate-600 font-bold text-sm">No matching components found for the selected filters</p>
                          <p className="text-xs text-slate-400">Try adjusting your search query or dropdown filter selections</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </ScrollableTable>
          </div>
        </div>
      ) : (
        /* ----------------- PAGE VIEW 2: COMPONENT STATUS & DETAIL VIEW PAGE ----------------- */
        <div className="space-y-6">
          {/* Top Detail Navigation Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setViewMode('selector')}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4 text-slate-600" />
                <span>Back to Component Selector</span>
              </button>
              <div className="h-5 w-px bg-slate-200 hidden sm:block" />
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider hidden sm:block">
                Material Inspection Mode
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Inspection Grain Selector Switcher (Day / Week / Month) */}
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-1">Grain:</span>
                <button
                  type="button"
                  onClick={() => setInspectionGrain('day')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                    inspectionGrain === 'day' 
                      ? 'bg-blue-600 text-white shadow-xs' 
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                  }`}
                >
                  Daily
                </button>
                <button
                  type="button"
                  onClick={() => setInspectionGrain('week')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                    inspectionGrain === 'week' 
                      ? 'bg-blue-600 text-white shadow-xs' 
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                  }`}
                >
                  Weekly
                </button>
                <button
                  type="button"
                  onClick={() => setInspectionGrain('month')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                    inspectionGrain === 'month' 
                      ? 'bg-blue-600 text-white shadow-xs' 
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                  }`}
                >
                  Monthly
                </button>
              </div>

              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 absolute left-2.5 text-slate-400 pointer-events-none" />
                <input aria-label="Inspection search query"
                  type="text"
                  placeholder="Filter materials by SKU or Name..."
                  value={inspectionSearchQuery}
                  onChange={e => setInspectionSearchQuery(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white w-48 sm:w-64"
                />
              </div>

              <select aria-label="Select material id"
                value={selectedMaterialId}
                onChange={e => setSelectedMaterialId(e.target.value)}
                className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-bold cursor-pointer max-w-xs truncate"
              >
                {inspectionFilteredMaterials.length > 0 ? (
                  inspectionFilteredMaterials.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.sku} — {m.name}
                    </option>
                  ))
                ) : (
                  <option value="" disabled>No matching materials</option>
                )}
              </select>

              <button
                onClick={loadInitial} aria-label="Refresh data"
                className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg cursor-pointer"
                title="Refresh Data"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          <DataStateWrapper
            loading={loading && materials.length === 0}
            error={error}
            isEmpty={!activeMaterial}
            onRetry={loadInitial}
            emptyMessage="No component selected or record missing."
          >
            {activeMaterial ? (
              <div className="space-y-6">
                {/* Header Banner for Active Component */}
                <div className="bg-slate-900 text-white p-5 rounded-xl flex flex-wrap items-center justify-between gap-4 shadow-md">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 bg-blue-600 text-white font-mono text-[10px] font-bold rounded uppercase tracking-wider">
                        {activeCat?.name || 'Raw Material'}
                      </span>
                      <span className="text-xs font-mono text-blue-300 font-bold">{activeMaterial.sku}</span>
                    </div>
                    <h2 className="text-xl font-black tracking-tight text-white">{activeMaterial.name}</h2>
                    <p className="text-xs text-slate-300 font-sans">
                      Controller: <b className="text-white">{activeMaterial.controller || 'Unassigned'}</b> • UOM: <b className="text-white">{activeMaterial.uom || 'Units'}</b> • Standard Cost: <b className="text-white">EGP {activeMaterial.standard_cost}</b>
                    </p>
                  </div>
                </div>

                {/* EXECUTIVE SUMMARY METRIC CARDS */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="card-elevated p-4 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Gross Requirements</span>
                    <h3 className="text-2xl font-black font-mono text-slate-900">
                      {summaryMetrics.grossReq.toLocaleString()} <span className="text-xs font-normal text-slate-500">{activeMaterial.uom || 'units'}</span>
                    </h3>
                    <p className="text-[10px] text-slate-500 font-medium">Total plan consumption across periods</p>
                  </div>

                  <div className="card-elevated p-4 space-y-1">
                    <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block">Open POs & Freight</span>
                    <h3 className="text-2xl font-black font-mono text-indigo-700">
                      +{summaryMetrics.totalSupply.toLocaleString()} <span className="text-xs font-normal text-slate-500">{activeMaterial.uom || 'units'}</span>
                    </h3>
                    <p className="text-[10px] text-slate-500 font-medium">
                      In-Transit: <b className="text-emerald-600">+{summaryMetrics.inTransit.toLocaleString()}</b> | Open POs: <b className="text-indigo-600">+{summaryMetrics.openPOs.toLocaleString()}</b>
                    </p>
                  </div>

                  <div className="card-elevated p-4 space-y-1">
                    <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">Safety Stock Target</span>
                    <h3 className="text-2xl font-black font-mono text-amber-800">
                      {Math.round(safetyStockUnits).toLocaleString()} <span className="text-xs font-normal text-slate-500">{activeMaterial.uom || 'units'}</span>
                    </h3>
                    <p className="text-[10px] text-amber-600 font-medium">
                      Target Cover: {getSafetyStockMonths(activeMaterial).toFixed(1)} months
                    </p>
                  </div>

                  <div className="card-elevated p-4 space-y-1">
                    <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider block">Lead Time & Coverage</span>
                    <h3 className="text-2xl font-black font-mono text-blue-700">
                      {activeMaterial.total_lead_time_days} <span className="text-xs font-normal text-slate-500">days lead</span>
                    </h3>
                    <p className="text-[10px] text-slate-500 font-medium">
                      Projected Ending Cover: <b className="text-slate-900">{summaryMetrics.coverageMonths.toFixed(1)} months</b>
                    </p>
                  </div>
                </div>

                {/* First Stock negative warning */}
                {firstNegativeMonth && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-800 text-xs">
                    <ShieldAlert className="w-5 h-5 shrink-0 text-red-600 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-sm">Stock Shortage Risk Detected!</h4>
                      <p className="leading-relaxed mt-0.5">Projected stock falls negative in <b>{formatMonth(firstNegativeMonth.period_start)}</b> (Ending Stock: <b className="font-mono">{firstNegativeMonth.ending_stock.toLocaleString()}</b>). Purchase orders or freight expedites must be released immediately to cover the {activeMaterial.total_lead_time_days}-day lead-time horizon.</p>
                    </div>
                  </div>
                )}

                {/* Projection Table */}
                <div className="card-elevated overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex flex-wrap justify-between items-center gap-3">
                    <div className="flex items-center gap-3">
                      <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                        {inspectionGrain === 'day' ? 'Daily (14 Days)' : inspectionGrain === 'week' ? 'Weekly (8 Weeks)' : 'Monthly (4 Months)'} Stock & Coverage Projections
                      </h3>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200 shadow-2xs">
                        <button
                          type="button"
                          onClick={() => setInspectionGrain('day')}
                          className={`px-2.5 py-0.5 text-[11px] font-bold rounded transition-all cursor-pointer ${
                            inspectionGrain === 'day' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          Daily
                        </button>
                        <button
                          type="button"
                          onClick={() => setInspectionGrain('week')}
                          className={`px-2.5 py-0.5 text-[11px] font-bold rounded transition-all cursor-pointer ${
                            inspectionGrain === 'week' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          Weekly
                        </button>
                        <button
                          type="button"
                          onClick={() => setInspectionGrain('month')}
                          className={`px-2.5 py-0.5 text-[11px] font-bold rounded transition-all cursor-pointer ${
                            inspectionGrain === 'month' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          Monthly
                        </button>
                      </div>
                      <span className="text-[10px] font-mono text-slate-500 font-bold hidden sm:inline">Basis: Production Plan & Confirmed Inbound Freight</span>
                    </div>
                  </div>

                  <ScrollableTable>
                    <table className="min-w-full divide-y divide-slate-200 text-left text-xs font-sans">
                      <thead className="bg-slate-50/50 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        <tr>
                          <th className="px-5 py-3">Planning Period</th>
                          <th className="px-5 py-3 text-right">Opening Inventory</th>
                          <th className="px-5 py-3 text-right">Gross Requirements</th>
                          <th className="px-5 py-3 text-right">In Transit Cargo</th>
                          <th className="px-5 py-3 text-right">Open POs</th>
                          <th className="px-5 py-3 text-right text-amber-700">Safety Stock Target</th>
                          <th className="px-5 py-3 text-right">Projected Ending Stock</th>
                          <th className="px-5 py-3 text-right">Months of Coverage</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-xs text-slate-700">
                        {projections.map((p, idx) => {
                          const isNegative = (p.ending_stock ?? 0) < 0;
                          const isBelowSafety = (p.ending_stock ?? 0) < safetyStockUnits;
                          const consumption = p.plan_consumption ?? 0;
                          const inTransit = p.in_transit_qty ?? 0;
                          const pendingPO = p.pending_po_qty ?? 0;
                          const coverageMonths = (p.ending_coverage_days ?? 0) / 30;

                          return (
                            <tr key={idx} className="hover:bg-slate-50/30 transition-colors">
                              <td className="px-5 py-3.5 font-bold text-slate-800">{formatMonth(p.period_start)}</td>
                              <td className="px-5 py-3.5 text-right font-mono text-slate-500">{(p.opening_stock ?? 0).toLocaleString()}</td>
                              <td className="px-5 py-3.5 text-right font-mono text-slate-600">{consumption.toLocaleString()}</td>
                              <td className="px-5 py-3.5 text-right font-mono text-emerald-600 font-semibold">
                                {inTransit > 0 ? `+${inTransit.toLocaleString()}` : '0'}
                              </td>
                              <td className="px-5 py-3.5 text-right font-mono text-indigo-600 font-semibold">
                                {pendingPO > 0 ? `+${pendingPO.toLocaleString()}` : '0'}
                              </td>
                              <td className="px-5 py-3.5 text-right font-mono text-amber-700 font-bold bg-amber-50/20">
                                {Math.round(safetyStockUnits).toLocaleString()}
                              </td>
                              <td className={`px-5 py-3.5 text-right font-mono font-bold ${
                                isNegative 
                                  ? 'text-red-600 bg-red-50/30 font-black' 
                                  : isBelowSafety 
                                    ? 'text-amber-700 bg-amber-50/40' 
                                    : 'text-slate-900'
                              }`}>
                                {(p.ending_stock ?? 0).toLocaleString()}
                              </td>
                              <td className="px-5 py-3.5 text-right">
                                <span className={`px-2 py-0.5 rounded-md font-mono text-sm font-bold ${
                                  coverageMonths < 1.0 
                                    ? 'bg-red-100 text-red-700' 
                                    : coverageMonths < 2.0 
                                      ? 'bg-amber-100 text-amber-700' 
                                      : 'bg-emerald-100 text-emerald-700'
                                }`}>
                                  {coverageMonths.toFixed(1)} mos
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </ScrollableTable>
                </div>

                {/* 3-Month Inventory Trend Sparkline Banner */}
                <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs flex flex-wrap lg:flex-nowrap items-center justify-between gap-6">
                  <div className="space-y-1.5 max-w-sm">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-blue-100 text-blue-700 rounded-lg">
                        <LineChart className="w-4 h-4" />
                      </div>
                      <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">3-Month Inventory Projection Sparkline</h3>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Visualizing ending stock trajectory over the next 3 planning periods against Safety Stock target (<b className="text-amber-800 font-mono">{Math.round(safetyStockUnits).toLocaleString()} {activeMaterial.uom || 'units'}</b>).
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-6 bg-slate-50/90 border border-slate-200/80 p-3.5 rounded-xl">
                    <InventorySparkline
                      data={projections.slice(0, 3).map(p => ({
                        label: formatMonth(p.period_start),
                        value: p.ending_stock ?? 0
                      }))}
                      safetyStock={safetyStockUnits}
                      width={280}
                      height={60}
                    />

                    <div className="space-y-1.5 border-l border-slate-200 pl-4 py-0.5 min-w-[170px]">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">3-Month Ending Balances</span>
                      {projections.slice(0, 3).map((p, idx) => {
                        const isNeg = (p.ending_stock ?? 0) < 0;
                        const isLow = (p.ending_stock ?? 0) < safetyStockUnits;
                        return (
                          <div key={idx} className="flex items-center justify-between gap-3 text-[11px] font-mono font-bold">
                            <span className="text-slate-500 font-sans font-semibold">{formatMonth(p.period_start)}:</span>
                            <span className={`font-bold ${
                              isNeg ? 'text-red-600 font-black' : isLow ? 'text-amber-700' : 'text-emerald-700'
                            }`}>
                              {Math.round(p.ending_stock ?? 0).toLocaleString()} {activeMaterial.uom || 'units'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Split Details Section */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Receipts Timeline */}
                  <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-3 flex items-center gap-1.5">
                      <Calendar className="w-4 h-4 text-blue-600" /> Procurement & Shipment Inbound Timeline
                    </h3>

                    {timelineEvents.length === 0 ? (
                      <p className="text-xs text-slate-400 py-6 text-center">No pending shipments or purchase approval requests recorded for this component.</p>
                    ) : (
                      <div className="relative border-l border-slate-200 ml-2.5 pl-4 space-y-5">
                        {timelineEvents.map((evt) => {
                          const isPO = evt.type === 'purchase_order';
                          return (
                            <div key={evt.id} className="relative">
                              <div className={`absolute -left-[22.5px] top-1.5 w-3 h-3 rounded-full border-2 border-white ${
                                isPO ? 'bg-indigo-600 shadow-xs' : 'bg-emerald-500 shadow-xs'
                              }`} />
                              <div className="flex justify-between items-start gap-4">
                                <div className="space-y-0.5">
                                  <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                                    {isPO ? 'Planned Procurement Release' : 'In-Transit Freight Shipment'}
                                    <span className={`text-[9px] font-mono px-1 py-0.5 rounded ${
                                      isPO ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                    }`}>
                                      Ref: {evt.reference}
                                    </span>
                                  </h4>
                                  <p className="text-[10px] text-slate-400 font-medium">{evt.details}</p>
                                </div>
                                <div className="text-right space-y-0.5 shrink-0">
                                  <span className="block text-xs font-bold font-mono text-slate-900">+{evt.qty.toLocaleString()} units</span>
                                  <span className="block text-[9px] font-mono text-slate-400 font-bold">ETA: {formatDateFriendly(evt.date)}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Where Used & Alternatives */}
                  <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-5">
                    {/* BOM Where Used Section */}
                    <div className="space-y-3">
                      <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-3 flex items-center gap-1.5">
                        <Package className="w-4 h-4 text-emerald-600" /> BOM "Where-Used" Products
                      </h3>

                      {whereUsedList.length === 0 ? (
                        <p className="text-[10px] text-slate-400">No active product BOMs are currently configured to consume this component.</p>
                      ) : (
                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                          {whereUsedList.map((item, i) => (
                            <div key={i} className="flex items-center justify-between bg-slate-50 border border-slate-200 p-2 rounded-lg text-xs">
                              <div>
                                <div className="font-bold text-slate-900">{item.product.name}</div>
                                <div className="text-[10px] font-mono text-slate-500">
                                  Slot: <b className="text-slate-700">{item.slotName}</b> ({item.product.product_line})
                                </div>
                              </div>
                              <div className="text-right font-mono">
                                <span className="text-xs font-bold text-indigo-700 block">{item.qtyPerUnit} {activeMaterial.uom || 'qty'}/unit</span>
                                <span className="text-[9px] text-slate-400 block">Scrap: {item.scrapPercent}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Alternatives Section */}
                    <div className="space-y-3 pt-3 border-t border-slate-100">
                      <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4 text-indigo-600" /> Approved Alternative Materials
                      </h3>

                      {activeAlts.length === 0 ? (
                        <p className="text-[10px] text-slate-400">No alternate components assigned. Production relies solely on primary supplier releases.</p>
                      ) : (
                        <div className="space-y-2">
                          {activeAlts.map(alt => (
                            <div key={alt.id} className="flex justify-between items-center bg-slate-50/50 border border-slate-200 p-2 rounded-lg text-xs">
                              <div>
                                <span className="font-mono text-[10px] font-bold text-slate-400">{alt.sku}</span>
                                <h4 className="font-semibold text-slate-700">{alt.name}</h4>
                              </div>
                              <span className="font-mono font-bold text-slate-500">EGP {alt.standard_cost}/unit</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </DataStateWrapper>
        </div>
      )}
    </div>
  );
}
