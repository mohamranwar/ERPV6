/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import {
  fetchTableData,
  saveRecord,
  deleteRecord,
  syncExportForecastsToSalesPlan,
  getPlanningPeriod,
  formatPlanningPeriod
} from '../supabaseClient';
import {
  ExportForecast, ExportOrderLineItem, ExportLineStatus, Product,
  InventorySnapshot, ProductionPlan, SalesPlan, Channel,
} from '../types';
import {
  Globe,
  Plus,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertCircle,
  Ship,
  FileText,
  Edit,
  Trash2,
  ArrowRight,
  Send,
  Building,
  Anchor,
  X,
  Layers,
  Check,
  PackageCheck,
  Calendar,
  ChevronDown,
  ChevronRight,
  Box,
  AlertTriangle,
  SlidersHorizontal
} from 'lucide-react';
import { useToast } from '../context/ToastConfirmContext';
import { toQuantity } from '../utils/number';
import { useAuth } from '../context/AuthContext';
import SearchBar from './SearchBar';
import ScrollableTable from './ScrollableTable';
import ContentHeader from './ContentHeader';
import { KpiCard, StatusBadge } from './ui';
import { toCartons, formatQty, formatDual, pcsPerCarton } from '../utils/uom';
import { buildAllocations, availableForOrder, claimsByCountry } from '../utils/allocation';
import ErrorState from './ErrorState';
import DataStateWrapper from './DataStateWrapper';

/** Ordered by how far through fulfilment a SKU is. */
const LINE_STATUSES: ExportLineStatus[] = [
  'pending', 'in_production', 'produced', 'staged', 'shipped', 'on_hold',
];

const LINE_STATUS_STYLE: Record<ExportLineStatus, string> = {
  pending:       'bg-slate-100 text-slate-700 border-slate-300',
  in_production: 'bg-amber-50 text-amber-800 border-amber-300',
  produced:      'bg-sky-50 text-sky-800 border-sky-300',
  staged:        'bg-indigo-50 text-indigo-800 border-indigo-300',
  shipped:       'bg-emerald-50 text-emerald-800 border-emerald-300',
  on_hold:       'bg-red-50 text-red-800 border-red-300',
};

interface ExportForecastScreenProps {
  searchQuery?: string;
  setSearchQuery?: (val: string) => void;
  refreshKey?: number;
}

const COUNTRY_OPTIONS = [
  { code: 'KSA', name: 'Saudi Arabia', flag: '🇸🇦' },
  { code: 'UAE', name: 'United Arab Emirates', flag: '🇦🇪' },
  { code: 'IRQ', name: 'Iraq', flag: '🇮🇶' },
  { code: 'JOR', name: 'Jordan', flag: '🇯🇴' },
  { code: 'KNY', name: 'Kenya', flag: '🇰🇪' },
  { code: 'NGA', name: 'Nigeria', flag: '🇳🇬' },
  { code: 'DZA', name: 'Algeria', flag: '🇩🇿' },
  { code: 'LBY', name: 'Libya', flag: '🇱🇾' },
  { code: 'DEU', name: 'Germany', flag: '🇩🇪' }
];

export default function ExportForecastScreen({
  searchQuery = '',
  setSearchQuery = () => {},
  refreshKey = 0
}: ExportForecastScreenProps) {
  const [exportList, setExportList] = useState<ExportForecast[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<InventorySnapshot[]>([]);
  const [productionPlans, setProductionPlans] = useState<ProductionPlan[]>([]);
  const [salesPlans, setSalesPlans] = useState<SalesPlan[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<boolean>(false);

  // Expanded order rows state
  const [expandedOrderIds, setExpandedOrderIds] = useState<Record<string, boolean>>({});

  // Filter States
  const [filterCountry, setFilterCountry] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterMerged, setFilterMerged] = useState<string>('');
  const [filterReadiness, setFilterReadiness] = useState<string>('');

  // Selected records for batch merge
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Modal & Drawer states
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingRecord, setEditingRecord] = useState<ExportForecast | null>(null);
  const [activeDrawerRecord, setActiveDrawerRecord] = useState<ExportForecast | null>(null);

  // All three overlays on this screen previously let Tab escape behind the
  // backdrop and ignored Escape. The side drawer counts as a dialog too: it
  // renders over an inert page behind a scrim.
  const orderModalRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const stockModalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(orderModalRef, isModalOpen, () => setIsModalOpen(false));
  useFocusTrap(drawerRef, activeDrawerRecord !== null, () => setActiveDrawerRecord(null));

  // Stock Quick-Update Modal State
  const [stockModalItem, setStockModalItem] = useState<{
    orderId: string;
    orderLineItem: ExportOrderLineItem;
    customerName: string;
  } | null>(null);
  const [newProducedStockQty, setNewProducedStockQty] = useState<number>(0);
  useFocusTrap(stockModalRef, stockModalItem !== null, () => setStockModalItem(null));

  // Form State for Multi-SKU Order
  const [formData, setFormData] = useState<{
    order_number: string;
    country_code: string;
    country_name: string;
    customer_name: string;
    period_start: string;
    target_ship_date: string;
    order_status: ExportForecast['order_status'];
    shipping_port: string;
    container_count: number;
    payment_term: string;
    lc_reference: string;
    export_license_status: 'approved' | 'pending' | 'not_required';
    merged_to_sales_plan: boolean;
    notes: string;
    items: ExportOrderLineItem[];
  }>({
    order_number: '',
    country_code: 'KSA',
    country_name: 'Saudi Arabia',
    customer_name: '',
    period_start: '2026-07-01',
    target_ship_date: '2026-08-01',
    order_status: 'draft',
    shipping_port: 'Alexandria Port',
    container_count: 1,
    payment_term: 'LC 60 Days',
    lc_reference: '',
    export_license_status: 'pending',
    merged_to_sales_plan: false,
    notes: '',
    items: []
  });

  const { showToast, confirm: askConfirm } = useToast();
  const { hasRole } = useAuth();

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      // Inventory, production and the sales plan are loaded too: stock cannot
      // be allocated to an order without knowing what else already claims it.
      const [exportsData, prodsData, invData, prodPlanData, salesPlanData, channelData] = await Promise.all([
        fetchTableData<ExportForecast>('export_forecasts'),
        fetchTableData<Product>('products'),
        fetchTableData<InventorySnapshot>('inventory_snapshots'),
        fetchTableData<ProductionPlan>('production_plan'),
        fetchTableData<SalesPlan>('sales_plan'),
        fetchTableData<Channel>('channels'),
      ]);
      setExportList(exportsData);
      setProducts(prodsData);
      setInventory(invData);
      setProductionPlans(prodPlanData);
      setSalesPlans(salesPlanData);
      setChannels(channelData);
    } catch (err: any) {
      setError(err instanceof Error ? err.message : String(err));
      showToast('Failed to load export forecast records: ' + (err.message || err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [refreshKey]);

  // Map for fast product lookup
  const productMap = useMemo(() => {
    const map = new Map<string, Product>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  // Helper to calculate total order quantities and produced stock
  /**
   * The allocation position for every SKU: what supply exists, who has already
   * claimed it, and what is genuinely left to promise.
   */
  const allocations = useMemo(
    () => buildAllocations({
      products, exportOrders: exportList, inventory,
      productionPlans, salesPlans, channels, period: getPlanningPeriod(),
    }),
    [products, exportList, inventory, productionPlans, salesPlans, channels]
  );

  /** Product lookup, for pack configuration on each order line. */
  const productById = useMemo(() => {
    const m = new Map<string, Product>();
    products.forEach(p => m.set(p.id, p));
    return m;
  }, [products]);

  /**
   * Order readiness, computed per SKU line and then rolled up.
   *
   * This used to be sum(produced) / sum(target) across the whole order, which
   * lets a surplus on one SKU mask a shortfall on another: an order with 200%
   * of SKU A and 0% of SKU B reported 100% ready and could not be shipped.
   *
   * Each line is now credited only up to its own target, so the order total
   * cannot exceed what is genuinely shippable, and every line carries its own
   * percentage and shortfall.
   */
  const calculateOrderTotals = (items: ExportOrderLineItem[] = []) => {
    const lines = items.map(li => {
      const product = productById.get(li.product_id) ?? null;
      const forecast = toQuantity(li.forecast_qty);
      const confirmed = toQuantity(li.confirmed_order_qty);
      const produced = toQuantity(li.produced_stock_qty);
      const target = confirmed > 0 ? confirmed : forecast;
      return {
        ...li,
        product,
        forecast,
        confirmed,
        produced,
        target,
        pct: target > 0 ? Math.min(100, Math.round((produced / target) * 100)) : 0,
        status: (li.line_status ?? 'pending') as ExportLineStatus,
        shortfall: Math.max(0, target - produced),
        // Cartons for the customer-facing figures; null when the product has
        // no pack configuration.
        targetCartons: toCartons(target, product),
        producedCartons: toCartons(produced, product),
      };
    });

    const forecast = lines.reduce((s, l) => s + l.forecast, 0);
    const confirmed = lines.reduce((s, l) => s + l.confirmed, 0);
    const produced = lines.reduce((s, l) => s + l.produced, 0);
    const targetQty = lines.reduce((s, l) => s + l.target, 0);

    const shippable = lines.reduce((s, l) => s + Math.min(l.produced, l.target), 0);
    const readinessPct = targetQty > 0 ? Math.round((shippable / targetQty) * 100) : 0;

    return {
      lines,
      forecast,
      confirmed,
      produced,
      targetQty,
      readinessPct,
      linesReady: lines.filter(l => l.pct >= 100).length,
      linesShipped: lines.filter(l => l.status === 'shipped').length,
      linesOnHold: lines.filter(l => l.status === 'on_hold').length,
      lineCount: lines.length,
      shortfall: Math.max(0, targetQty - shippable),
    };
  };

  // Filtered Export Orders (Rule: Search Query Overrides Categorical Dropdowns)
  const filteredExports = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    if (q) {
      return exportList.filter((item) => {
        const itemSkus = (item.items || [])
          .map((li) => {
            const p = productMap.get(li.product_id);
            return `${li.product_id} ${p?.sku || ''} ${p?.name || ''}`;
          })
          .join(' ');

        return (
          item.order_number?.toLowerCase().includes(q) ||
          item.country_name.toLowerCase().includes(q) ||
          item.country_code.toLowerCase().includes(q) ||
          item.customer_name.toLowerCase().includes(q) ||
          item.order_status.toLowerCase().includes(q) ||
          (item.shipping_port && item.shipping_port.toLowerCase().includes(q)) ||
          (item.lc_reference && item.lc_reference.toLowerCase().includes(q)) ||
          itemSkus.toLowerCase().includes(q)
        );
      });
    }

    return exportList.filter((item) => {
      if (filterCountry && item.country_code !== filterCountry) return false;
      if (filterStatus && item.order_status !== filterStatus) return false;
      if (filterMerged) {
        if (filterMerged === 'merged' && !item.merged_to_sales_plan) return false;
        if (filterMerged === 'unmerged' && item.merged_to_sales_plan) return false;
      }
      if (filterReadiness) {
        const { readinessPct } = calculateOrderTotals(item.items);
        if (filterReadiness === 'completed' && readinessPct < 100) return false;
        if (filterReadiness === 'in_progress' && (readinessPct === 0 || readinessPct >= 100)) return false;
        if (filterReadiness === 'pending' && readinessPct > 0) return false;
      }
      return true;
    });
  }, [exportList, searchQuery, filterCountry, filterStatus, filterMerged, filterReadiness, productMap]);

  // Aggregate Metrics for Header Cards (No financial value!)
  const metrics = useMemo(() => {
    let totalOrders = exportList.length;
    let totalForecastPieces = 0;
    let totalConfirmedPieces = 0;
    let totalProducedStockPieces = 0;
    let mergedCount = 0;
    let readyToShipOrders = 0;

    const countryBreakdown: Record<string, { name: string; qty: number; orderCount: number }> = {};

    exportList.forEach((order) => {
      const { forecast, confirmed, produced, readinessPct } = calculateOrderTotals(order.items);
      totalForecastPieces += forecast;
      totalConfirmedPieces += confirmed;
      totalProducedStockPieces += produced;

      if (order.merged_to_sales_plan) mergedCount++;
      if (readinessPct >= 100 || order.order_status === 'ready_to_ship') readyToShipOrders++;

      if (!countryBreakdown[order.country_code]) {
        countryBreakdown[order.country_code] = { name: order.country_name, qty: 0, orderCount: 0 };
      }
      countryBreakdown[order.country_code].qty += confirmed > 0 ? confirmed : forecast;
      countryBreakdown[order.country_code].orderCount += 1;
    });

    const targetVolume = totalConfirmedPieces > 0 ? totalConfirmedPieces : totalForecastPieces;
    const overallReadinessPct = targetVolume > 0 ? Math.min(100, Math.round((totalProducedStockPieces / targetVolume) * 100)) : 0;

    return {
      totalOrders,
      totalForecastPieces,
      totalConfirmedPieces,
      totalProducedStockPieces,
      overallReadinessPct,
      readyToShipOrders,
      mergedCount,
      countryBreakdown
    };
  }, [exportList]);

  // Toggle order expansion
  const toggleOrderExpand = (id: string) => {
    setExpandedOrderIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Helper for Estimated Shipping Date (ETS) badge & status
  const getEtsStatus = (targetShipDate: string, orderStatus: string) => {
    if (orderStatus === 'shipped' || orderStatus === 'delivered') {
      return { label: `Shipped (${targetShipDate})`, badgeClass: 'bg-slate-100 text-slate-700 border-slate-300' };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const shipDate = new Date(targetShipDate);
    shipDate.setHours(0, 0, 0, 0);

    const diffDays = Math.ceil((shipDate.getTime() - today.getTime()) / (1000 * 3600 * 24));

    if (diffDays < 0) {
      return { label: `Overdue by ${Math.abs(diffDays)}d (${targetShipDate})`, badgeClass: 'bg-rose-50 text-rose-700 border-rose-200' };
    } else if (diffDays === 0) {
      return { label: `Shipment Due Today!`, badgeClass: 'bg-amber-50 text-amber-700 border-amber-300 animate-pulse' };
    } else if (diffDays <= 7) {
      return { label: `Ships in ${diffDays}d (${targetShipDate})`, badgeClass: 'bg-amber-50 text-amber-700 border-amber-200' };
    } else {
      return { label: `ETS: ${targetShipDate} (${diffDays}d left)`, badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    }
  };

  // Merge to Sales Plan
  async function handleMergeToSalesPlan(targetIds?: string[]) {
    if (!hasRole(['admin', 'planner'])) {
      showToast('Permission denied. Planner role required to update Sales Demand Plan.', 'error');
      return;
    }

    const idsToMerge = targetIds || (selectedIds.length > 0 ? selectedIds : undefined);
    const countToMerge = idsToMerge ? idsToMerge.length : exportList.filter((e) => !e.merged_to_sales_plan).length;

    if (countToMerge === 0) {
      showToast('All selected export orders are already merged with the Sales Demand Plan.', 'info');
      return;
    }

    const confirmed = await askConfirm(
      `Are you sure you want to merge ${idsToMerge ? `${idsToMerge.length} selected` : 'all unmerged'} export orders into the Sales Demand Plan (Channel: Export Global)?`,
      'Merge Export Orders to Sales Plan'
    );

    if (!confirmed) return;

    setSyncing(true);
    try {
      const result = await syncExportForecastsToSalesPlan(idsToMerge);
      showToast(
        `Successfully merged ${result.mergedCount} export order(s) [Total Volume: ${result.totalVolumeMerged.toLocaleString()} PCS] into the Sales Demand Plan!`,
        'success'
      );
      setSelectedIds([]);
      await loadData();
    } catch (err: any) {
      showToast('Failed to merge export orders: ' + (err.message || err), 'error');
    } finally {
      setSyncing(false);
    }
  }

  // Open Add/Edit Modal
  function handleOpenModal(record?: ExportForecast) {
    if (record) {
      setEditingRecord(record);
      setFormData({
        order_number: record.order_number || `EXP-${new Date().getFullYear()}-00${exportList.length + 1}`,
        country_code: record.country_code,
        country_name: record.country_name,
        customer_name: record.customer_name,
        period_start: record.period_start,
        target_ship_date: record.target_ship_date,
        order_status: record.order_status,
        shipping_port: record.shipping_port || 'Alexandria Port',
        container_count: record.container_count || 1,
        payment_term: record.payment_term || 'LC 60 Days',
        lc_reference: record.lc_reference || '',
        export_license_status: record.export_license_status || 'pending',
        merged_to_sales_plan: record.merged_to_sales_plan,
        notes: record.notes || '',
        items: record.items ? record.items.map((it) => ({ ...it })) : []
      });
    } else {
      setEditingRecord(null);
      const defaultProductId = products[0]?.id || 'P1';
      setFormData({
        order_number: `EXP-${new Date().getFullYear()}-00${exportList.length + 1}`,
        country_code: 'KSA',
        country_name: 'Saudi Arabia',
        customer_name: '',
        period_start: '2026-07-01',
        target_ship_date: '2026-08-01',
        order_status: 'draft',
        shipping_port: 'Alexandria Port',
        container_count: 2,
        payment_term: 'LC 60 Days',
        lc_reference: '',
        export_license_status: 'pending',
        merged_to_sales_plan: false,
        notes: '',
        items: [
          {
            id: `LI_${Date.now()}_1`,
            product_id: defaultProductId,
            forecast_qty: 25000,
            confirmed_order_qty: 25000,
            produced_stock_qty: 0,
          line_status: 'pending',
            notes: ''
          }
        ]
      });
    }
    setIsModalOpen(true);
  }

  // Add line item to form
  const handleAddFormItem = () => {
    const defaultProductId = products[0]?.id || 'P1';
    setFormData((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          id: `LI_${Date.now()}_${prev.items.length + 1}`,
          product_id: defaultProductId,
          forecast_qty: 10000,
          confirmed_order_qty: 0,
          produced_stock_qty: 0,
          line_status: 'pending',
          notes: ''
        }
      ]
    }));
  };

  // Remove line item from form
  const handleRemoveFormItem = (index: number) => {
    if (formData.items.length <= 1) {
      showToast('An export order must contain at least 1 SKU line item.', 'error');
      return;
    }
    setFormData((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }));
  };

  // Update line item in form
  const handleUpdateFormItem = (index: number, field: keyof ExportOrderLineItem, value: any) => {
    setFormData((prev) => {
      const updatedItems = [...prev.items];
      updatedItems[index] = {
        ...updatedItems[index],
        [field]: value
      };
      return { ...prev, items: updatedItems };
    });
  };

  // Save Order Record
  async function handleSaveRecord(e: React.FormEvent) {
    e.preventDefault();
    if (!hasRole(['admin', 'planner'])) {
      showToast('Permission denied. Planner or Admin role required.', 'error');
      return;
    }

    if (!formData.customer_name) {
      showToast('Please specify the Customer Name.', 'error');
      return;
    }

    if (!formData.items || formData.items.length === 0) {
      showToast('Please add at least one SKU to this export order.', 'error');
      return;
    }

    const countryObj = COUNTRY_OPTIONS.find((c) => c.code === formData.country_code);

    const recordToSave: ExportForecast = {
      id: editingRecord ? editingRecord.id : `EF_${Date.now()}`,
      order_number: formData.order_number || `EXP-${Date.now().toString().slice(-4)}`,
      country_code: formData.country_code || 'KSA',
      country_name: countryObj ? countryObj.name : formData.country_name || 'Saudi Arabia',
      customer_name: formData.customer_name,
      period_start: formData.period_start || '2026-07-01',
      target_ship_date: formData.target_ship_date || '2026-08-01',
      order_status: formData.order_status,
      shipping_port: formData.shipping_port || 'Alexandria Port',
      container_count: Number(formData.container_count) || 1,
      payment_term: formData.payment_term || 'LC 60 Days',
      lc_reference: formData.lc_reference || '',
      export_license_status: formData.export_license_status,
      merged_to_sales_plan: formData.merged_to_sales_plan || false,
      notes: formData.notes || '',
      items: formData.items.map((it) => ({
        id: it.id || `LI_${Math.random().toString(36).slice(2, 7)}`,
        product_id: it.product_id,
        forecast_qty: Number(it.forecast_qty) || 0,
        confirmed_order_qty: Number(it.confirmed_order_qty) || 0,
        produced_stock_qty: Number(it.produced_stock_qty) || 0,
        notes: it.notes || ''
      }))
    };

    try {
      await saveRecord<ExportForecast>('export_forecasts', recordToSave);
      showToast(`Export Order ${recordToSave.order_number} (${recordToSave.items.length} SKUs) saved successfully!`, 'success');
      setIsModalOpen(false);
      setEditingRecord(null);
      await loadData();
    } catch (err: any) {
      showToast('Failed to save order: ' + (err.message || err), 'error');
    }
  }

  // Delete Record
  async function handleDeleteRecord(id: string, name: string) {
    if (!hasRole(['admin'])) {
      showToast('Permission denied. Admin role required to delete records.', 'error');
      return;
    }

    const confirmed = await askConfirm(`Are you sure you want to delete export order "${name}"?`, 'Delete Export Order');
    if (!confirmed) return;

    try {
      await deleteRecord('export_forecasts', id);
      showToast('Export order deleted.', 'success');
      if (activeDrawerRecord?.id === id) setActiveDrawerRecord(null);
      await loadData();
    } catch (err: any) {
      showToast('Failed to delete order: ' + (err.message || err), 'error');
    }
  }

  // Quick produced stock updater for an individual SKU item in an order
  const handleOpenStockModal = (order: ExportForecast, lineItem: ExportOrderLineItem) => {
    setStockModalItem({
      orderId: order.id,
      orderLineItem: lineItem,
      customerName: order.customer_name
    });
    setNewProducedStockQty(lineItem.produced_stock_qty || 0);
  };

  const handleSaveStockUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockModalItem) return;
    if (!hasRole('planner')) {
      showToast('Planner or Admin access is required to update produced stock.', 'error');
      return;
    }

    const targetOrder = exportList.find((o) => o.id === stockModalItem.orderId);
    if (!targetOrder) return;

    const updatedItems = (targetOrder.items || []).map((li) => {
      if (li.id === stockModalItem.orderLineItem.id) {
        return { ...li, produced_stock_qty: Number(newProducedStockQty) || 0 };
      }
      return li;
    });

    const updatedOrder = { ...targetOrder, items: updatedItems };

    try {
      await saveRecord<ExportForecast>('export_forecasts', updatedOrder);
      showToast(`Stock link updated to ${newProducedStockQty.toLocaleString()} PCS for order SKU.`, 'success');
      setStockModalItem(null);
      if (activeDrawerRecord?.id === updatedOrder.id) {
        setActiveDrawerRecord(updatedOrder);
      }
      await loadData();
    } catch (err: any) {
      showToast('Failed to update stock qty: ' + (err.message || err), 'error');
    }
  };

  // Status updates from drawer
  /**
   * Update the fulfilment status of one SKU line.
   *
   * SKUs on a single order do not move together — one can be produced and
   * staged while another has not started — so each line carries its own
   * status rather than inheriting the order's.
   */
  async function handleUpdateLineStatus(lineId: string, status: ExportLineStatus) {
    if (!activeDrawerRecord) return;
    if (!hasRole('planner')) {
      showToast('Planner or Admin access is required to change SKU status.', 'error');
      return;
    }
    const updated: ExportForecast = {
      ...activeDrawerRecord,
      items: (activeDrawerRecord.items || []).map(li =>
        li.id === lineId ? { ...li, line_status: status } : li
      ),
    };
    try {
      await saveRecord<ExportForecast>('export_forecasts', updated);
      setActiveDrawerRecord(updated);
      showToast(`SKU status set to "${status.replace(/_/g, ' ')}".`, 'success');
      await loadData();
    } catch (err: any) {
      showToast('Failed to update SKU status: ' + err.message, 'error');
    }
  }

  async function handleUpdateOrderStatus(status: ExportForecast['order_status']) {
    if (!activeDrawerRecord) return;
    if (!hasRole('planner')) {
      showToast('Planner or Admin access is required to change order status.', 'error');
      return;
    }
    const updated = { ...activeDrawerRecord, order_status: status };
    try {
      await saveRecord<ExportForecast>('export_forecasts', updated);
      setActiveDrawerRecord(updated);
      showToast(`Order status updated to "${status.replace('_', ' ').toUpperCase()}"`, 'success');
      await loadData();
    } catch (err: any) {
      showToast('Failed to update status: ' + err.message, 'error');
    }
  }

  // Select all checkboxes
  function toggleSelectRow(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  }

  function toggleSelectAll() {
    if (selectedIds.length === filteredExports.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredExports.map((item) => item.id));
    }
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Content Header */}
      <ContentHeader
        title="Export Order"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <button
              id="btn_refresh_export_orders"
              onClick={loadData}
              disabled={loading}
              className="btn-base btn-sky gap-1.5 shadow-sm"
              title="Refresh Data"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-white ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>

            <button
              id="btn_merge_sales_plan"
              onClick={() => handleMergeToSalesPlan()}
              disabled={syncing || exportList.length === 0}
              className="btn-base btn-emerald gap-1.5 shadow-sm"
            >
              <Send className={`w-3.5 h-3.5 text-white ${syncing ? 'animate-bounce' : ''}`} />
              {selectedIds.length > 0 ? `Merge ${selectedIds.length} Selected` : 'Merge All to Sales Plan'}
            </button>

            {hasRole(['admin', 'planner']) && (
              <button
                id="btn_create_export_order"
                onClick={() => handleOpenModal()}
                className="btn-base btn-purple gap-1.5 shadow-sm"
              >
                <Plus className="w-4 h-4 text-white" />
                New Multi-SKU Export Order
              </button>
            )}
          </div>
        }
      />

      <ErrorState error={error} onRetry={loadData} />

      {/* KPI Cards Banner (strictly quantities & production readiness - NO monetary values) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total Export Orders"
          value={metrics.totalOrders}
          sub={`${metrics.mergedCount} merged with sales plan`}
          icon={<Globe className="w-4 h-4" />}
        />
        <KpiCard
          label="Total Order Volume"
          value={metrics.totalConfirmedPieces.toLocaleString()}
          unit="PCS"
          sub={`Forecast total: ${metrics.totalForecastPieces.toLocaleString()} PCS`}
          intent="info"
          icon={<Box className="w-4 h-4" />}
        />
        <KpiCard
          label="Produced Stock Linked"
          value={metrics.totalProducedStockPieces.toLocaleString()}
          unit="PCS"
          intent="success"
          progress={metrics.overallReadinessPct}
          icon={<PackageCheck className="w-4 h-4" />}
        />
        <KpiCard
          label="Ready to Ship"
          value={metrics.readyToShipOrders}
          sub="Orders ready"
          intent="warning"
          icon={<Ship className="w-4 h-4" />}
          footer={
            <div className="flex items-center gap-1.5 flex-wrap">
              {(Object.entries(metrics.countryBreakdown) as [string, { name: string; qty: number; orderCount: number }][])
                .sort((a, b) => b[1].qty - a[1].qty)
                .slice(0, 3)
                .map(([code, item]) => {
                  const country = COUNTRY_OPTIONS.find((c) => c.code === code);
                  return (
                    <span
                      key={code}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200"
                      title={`${item.name}: ${item.qty.toLocaleString()} PCS`}
                    >
                      <span>{country?.flag || '🌐'}</span>
                      <span>{code}</span>
                    </span>
                  );
                })}
            </div>
          }
        />
      </div>

      {/* Stock allocation by SKU and destination.
          An export SKU is not reserved for export — domestic channels and
          every other country draw on the same pool — so this is the only place
          that says whether the promises across all orders can actually be kept. */}
      {(() => {
        const rows = [...allocations.values()]
          .filter(a => a.exportAllocated > 0 || a.overAllocated)
          .sort((a, b) => a.free - b.free);
        if (rows.length === 0) return null;
        const short = rows.filter(a => a.overAllocated);

        return (
          <div className="card-elevated overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-[13px] font-extrabold text-slate-900 tracking-tight">
                  Stock allocation by SKU and destination
                </h3>
                <p className="text-[11.5px] text-slate-500">
                  Supply is stock on hand plus production planned for {formatPlanningPeriod(getPlanningPeriod())}.
                  Domestic channel demand is deducted before anything is promised to export.
                </p>
              </div>
              {short.length > 0 && (
                <StatusBadge intent="oos" dot>
                  {short.length} SKU{short.length > 1 ? 's' : ''} over-committed
                </StatusBadge>
              )}
            </div>

            <ScrollableTable>
              <table className="min-w-full text-[12px]">
                <thead>
                  <tr>
                    <th className="text-left px-3 py-2">SKU</th>
                    <th className="text-right px-3 py-2">On hand</th>
                    <th className="text-right px-3 py-2">Planned prod.</th>
                    <th className="text-right px-3 py-2">Supply</th>
                    <th className="text-right px-3 py-2">Other channels</th>
                    <th className="text-right px-3 py-2">Export promised</th>
                    <th className="text-left px-3 py-2">By destination</th>
                    <th className="text-right px-3 py-2">Free</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(a => {
                    const prod = productMap.get(a.productId);
                    return (
                      <tr key={a.productId} className={a.overAllocated ? 'bg-red-50/40' : ''}>
                        <td className="px-3 py-2">
                          <span className="font-mono font-bold text-indigo-700">{prod?.sku ?? a.productId}</span>
                          <span className="block text-[10.5px] text-slate-500 truncate max-w-[190px]">{prod?.name}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{a.onHand.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-500">
                          {a.plannedProduction > 0 ? `+${a.plannedProduction.toLocaleString()}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold">{a.supply.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-500">
                          {a.otherChannelDemand > 0 ? `−${a.otherChannelDemand.toLocaleString()}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-700">
                          −{a.exportAllocated.toLocaleString()}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {claimsByCountry(a).map(c => (
                              <span
                                key={c.countryCode}
                                className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200"
                                title={`${c.countryName}: ${c.qty.toLocaleString()} PCS across ${c.orders} order(s)`}
                              >
                                {COUNTRY_OPTIONS.find(o => o.code === c.countryCode)?.flag || '🌐'}
                                {c.countryCode} {c.qty.toLocaleString()}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className={`px-3 py-2 text-right font-mono font-extrabold ${
                          a.overAllocated ? 'text-red-700' : 'text-emerald-700'
                        }`}>
                          {a.free.toLocaleString()}
                          {prod && pcsPerCarton(prod) !== null && (
                            <span className="block text-[10px] font-normal text-slate-400">
                              {formatQty(a.free, prod, 'cartons')} CTN
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollableTable>

            {short.length > 0 && (
              <p className="px-4 py-2.5 bg-red-50 border-t border-red-200 text-[11.5px] text-red-900">
                <b>{short.map(a => productMap.get(a.productId)?.sku ?? a.productId).join(', ')}</b>{' '}
                {short.length > 1 ? 'are' : 'is'} promised to customers beyond available supply. Either raise
                production, or reduce an allocation — the shortfall will otherwise surface as a missed shipment.
              </p>
            )}
          </div>
        );
      })()}

      {/* Toolbar & Filters (Search Query Overrides Categorical Filters) */}
      <div className="card-elevated p-4 space-y-4">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
          <div className="w-full md:w-80">
            <SearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search order #, customer, country, SKU..."
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Country Dropdown Filter */}
            <select aria-label="Filter by country"
              id="filter_export_country"
              value={filterCountry}
              onChange={(e) => setFilterCountry(e.target.value)}
              className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All Countries</option>
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.name} ({c.code})
                </option>
              ))}
            </select>

            {/* Status Dropdown Filter */}
            <select aria-label="Filter by status"
              id="filter_export_status"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="confirmed">Confirmed</option>
              <option value="in_production">In Production</option>
              <option value="ready_to_ship">Ready to Ship</option>
              <option value="shipped">Shipped</option>
              <option value="delivered">Delivered</option>
              <option value="on_hold">On Hold</option>
            </select>

            {/* Production Readiness Filter */}
            <select aria-label="Filter by readiness"
              id="filter_export_readiness"
              value={filterReadiness}
              onChange={(e) => setFilterReadiness(e.target.value)}
              className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All Stock Readiness</option>
              <option value="completed">100% Stock Ready</option>
              <option value="in_progress">In Production / Partial</option>
              <option value="pending">0% Produced</option>
            </select>

            {/* Merged to Sales Plan Filter */}
            <select aria-label="Filter by merged"
              id="filter_export_merged"
              value={filterMerged}
              onChange={(e) => setFilterMerged(e.target.value)}
              className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All Sales Plan Statuses</option>
              <option value="merged">Merged to Sales Plan</option>
              <option value="unmerged">Unmerged</option>
            </select>

            {(filterCountry || filterStatus || filterMerged || filterReadiness) && (
              <button
                onClick={() => {
                  setFilterCountry('');
                  setFilterStatus('');
                  setFilterMerged('');
                  setFilterReadiness('');
                }}
                className="text-xs text-rose-600 hover:text-rose-800 font-semibold px-2 py-1"
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>

        {searchQuery && (
          <div className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-lg flex items-center justify-between">
            <span>
              <strong>Global Search Active:</strong> Categorical dropdown filters are bypassed while searching for "
              {searchQuery}".
            </span>
            <button
              onClick={() => setSearchQuery('')}
              className="font-bold underline hover:text-indigo-900 text-[11px]"
            >
              Clear Search
            </button>
          </div>
        )}
      </div>

      {/* Export Orders List Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {filteredExports.length === 0 ? (
          <div className="p-12 text-center">
            <Globe className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-700">No export orders found</p>
            <p className="text-xs text-slate-600 mt-1">
              Try adjusting your search query or filter options, or click "New Multi-SKU Export Order".
            </p>
          </div>
        ) : (
          <ScrollableTable className="max-h-[700px] overflow-y-auto">
            <table className="w-full text-left border-collapse" id="export_orders_table">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase tracking-wider sticky top-0 z-10">
                  <th className="py-3 px-3 w-8 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.length === filteredExports.length && filteredExports.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </th>
                  <th className="py-3 px-3 w-8 text-center"></th>
                  <th className="py-3 px-3">Order Number</th>
                  <th className="py-3 px-3">Destination / Customer</th>
                  <th className="py-3 px-3 text-center">SKU Lines</th>
                  <th className="py-3 px-3">Est. Shipping Date (ETS)</th>
                  <th className="py-3 px-3 text-right">Order Vol. (PCS)</th>
                  <th className="py-3 px-3 text-right">Stock Produced</th>
                  <th className="py-3 px-3">Stock Readiness</th>
                  <th className="py-3 px-3 text-center">Status</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs text-slate-800">
                {filteredExports.map((order) => {
                  const country = COUNTRY_OPTIONS.find((c) => c.code === order.country_code);
                  const isExpanded = !!expandedOrderIds[order.id];
                  const { forecast, confirmed, produced, targetQty, readinessPct } = calculateOrderTotals(order.items);
                  const etsInfo = getEtsStatus(order.target_ship_date, order.order_status);
                  const isSelected = selectedIds.includes(order.id);

                  return (
                    <React.Fragment key={order.id}>
                      {/* Parent Order Row */}
                      <tr className={`hover:bg-slate-50/80 transition-colors ${isSelected ? 'bg-indigo-50/40' : ''}`}>
                        <td className="py-3 px-3 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectRow(order.id)}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="py-3 px-3 text-center">
                          <button
                            onClick={() => toggleOrderExpand(order.id)}
                            className="p-1 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200 transition-colors"
                            title={isExpanded ? 'Collapse SKUs' : 'Expand SKU Details'}
                          >
                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                        </td>
                        <td className="py-3 px-3 font-semibold text-slate-900">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs text-indigo-700 font-bold">{order.order_number}</span>
                            {order.merged_to_sales_plan && (
                              <span
                                className="inline-flex items-center gap-0.5 text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1 py-0.5 rounded border border-emerald-200"
                                title="Merged with Sales Demand Plan"
                              >
                                <Check className="w-2.5 h-2.5" /> MPS
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-500 block font-mono">Period: {order.period_start}</span>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <span className="text-base">{country?.flag || '🌐'}</span>
                            <div>
                              <div className="font-semibold text-slate-900">{order.customer_name}</div>
                              <div className="text-[10px] text-slate-500">
                                {order.country_name} ({order.country_code}) • {order.shipping_port || 'Port N/A'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-center font-semibold">
                          <span
                            onClick={() => toggleOrderExpand(order.id)}
                            className="cursor-pointer inline-flex items-center gap-1 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded-full text-slate-700 text-xs font-mono border border-slate-300"
                          >
                            <Layers className="w-3 h-3 text-indigo-600" />
                            {order.items ? order.items.length : 0} SKU{(order.items?.length || 0) > 1 ? 's' : ''}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${etsInfo.badgeClass}`}>
                            <Clock className="w-3 h-3" />
                            {etsInfo.label}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                          {targetQty.toLocaleString()}
                          <span className="text-[10px] text-slate-600 font-sans block">
                            {confirmed > 0 ? 'Confirmed' : 'Forecast'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-semibold text-emerald-800">
                          {produced.toLocaleString()}
                          <span className="text-[10px] text-slate-600 font-sans block">PCS Linked</span>
                        </td>
                        <td className="py-3 px-3">
                          <div className="w-28 space-y-1">
                            <div className="flex items-center justify-between text-[10px] font-semibold text-slate-700 font-mono">
                              <span>{readinessPct}%</span>
                              <span>
                                {readinessPct >= 100 ? (
                                  <span className="text-emerald-700 font-bold">Stock Ready</span>
                                ) : (
                                  <span className="text-slate-600">{readinessPct === 0 ? 'Not Started' : 'In Prod.'}</span>
                                )}
                              </span>
                            </div>
                            <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                              <div
                                className={`h-1.5 rounded-full transition-all duration-300 ${
                                  readinessPct >= 100
                                    ? 'bg-emerald-500'
                                    : readinessPct > 50
                                    ? 'bg-blue-500'
                                    : readinessPct > 0
                                    ? 'bg-amber-500'
                                    : 'bg-slate-300'
                                }`}
                                style={{ width: `${readinessPct}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                              order.order_status === 'confirmed'
                                ? 'bg-blue-50 text-blue-700 border-blue-200'
                                : order.order_status === 'in_production'
                                ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                : order.order_status === 'ready_to_ship'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                : order.order_status === 'shipped' || order.order_status === 'delivered'
                                ? 'bg-slate-100 text-slate-700 border-slate-300'
                                : order.order_status === 'on_hold'
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : 'bg-amber-50 text-amber-700 border-amber-200'
                            }`}
                          >
                            {order.order_status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setActiveDrawerRecord(order)}
                              className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-colors"
                              title="Inspect Order Details"
                            >
                              <FileText className="w-3.5 h-3.5" />
                            </button>
                            {hasRole(['admin', 'planner']) && (
                              <button
                                onClick={() => handleOpenModal(order)}
                                className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-colors"
                                title="Edit Multi-SKU Order"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {hasRole(['admin']) && (
                              <button
                                onClick={() => handleDeleteRecord(order.id, `${order.order_number} - ${order.customer_name}`)}
                                className="p-1.5 text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                title="Delete Order"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Nested Multi-SKU Rows View */}
                      {isExpanded && (
                        <tr className="bg-slate-50/70">
                          <td colSpan={11} className="py-3 px-4 pl-12 border-y border-slate-200">
                            <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-inner space-y-3">
                              <div className="flex items-center justify-between text-xs border-b border-slate-100 pb-2">
                                <div className="flex items-center gap-2 font-semibold text-slate-800">
                                  <Layers className="w-4 h-4 text-indigo-600" />
                                  <span>SKU Breakdown for {order.order_number} ({order.items?.length || 0} SKUs)</span>
                                </div>
                                <div className="text-[11px] text-slate-600 font-mono">
                                  Containers: {order.container_count || 1} • Payment: {order.payment_term} • LC: {order.lc_reference || 'N/A'}
                                </div>
                              </div>

                              <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs border-collapse">
                                  <thead>
                                    <tr className="text-[10px] uppercase font-bold text-slate-600 border-b border-slate-200 bg-slate-50">
                                      <th className="py-1.5 px-2">SKU Code</th>
                                      <th className="py-1.5 px-2">Product Description</th>
                                      <th className="py-1.5 px-2 text-right">Forecast Qty</th>
                                      <th className="py-1.5 px-2 text-right">Confirmed Qty</th>
                                      <th className="py-1.5 px-2 text-right">Linked Produced Stock</th>
                                      <th className="py-1.5 px-2 text-center">Readiness Status</th>
                                      <th className="py-1.5 px-2">SKU Notes</th>
                                      <th className="py-1.5 px-2 text-right font-mono">Stock Update</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 font-sans">
                                    {(order.items || []).map((li, idx) => {
                                      const prod = productMap.get(li.product_id);
                                      const skuTarget = li.confirmed_order_qty > 0 ? li.confirmed_order_qty : li.forecast_qty;
                                      const itemPct = skuTarget > 0 ? Math.min(100, Math.round((li.produced_stock_qty / skuTarget) * 100)) : 0;

                                      return (
                                        <tr key={li.id || idx} className="hover:bg-slate-50/90">
                                          <td className="py-2 px-2 font-mono font-bold text-indigo-700">{prod?.sku || li.product_id}</td>
                                          <td className="py-2 px-2 font-medium text-slate-900">{prod?.name || 'Hygiene Product'}</td>
                                          <td className="py-2 px-2 text-right font-mono text-slate-600">{li.forecast_qty?.toLocaleString()} PCS</td>
                                          <td className="py-2 px-2 text-right font-mono font-semibold text-slate-900">{li.confirmed_order_qty?.toLocaleString()} PCS</td>
                                          <td className="py-2 px-2 text-right font-mono font-bold text-emerald-700">
                                            {li.produced_stock_qty?.toLocaleString()} PCS
                                          </td>
                                          <td className="py-2 px-2 text-center">
                                            <span
                                              className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                                itemPct >= 100
                                                  ? 'bg-emerald-100 text-emerald-800'
                                                  : itemPct > 0
                                                  ? 'bg-amber-100 text-amber-800'
                                                  : 'bg-slate-100 text-slate-600'
                                              }`}
                                            >
                                              {itemPct >= 100 ? '100% Ready' : `${itemPct}% Stocked`}
                                            </span>
                                          </td>
                                          <td className="py-2 px-2 text-slate-500 text-[11px] italic">{li.notes || '—'}</td>
                                          <td className="py-2 px-2 text-right">
                                            {hasRole(['admin', 'planner']) && (
                                              <button
                                                onClick={() => handleOpenStockModal(order, li)}
                                                className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded border border-emerald-200 transition-colors"
                                              >
                                                <PackageCheck className="w-3 h-3" />
                                                Update Stock
                                              </button>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </ScrollableTable>
        )}
      </div>

      {/* Quick Produced Stock Link Modal */}
      {stockModalItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Link produced stock">
          <div ref={stockModalRef} className="bg-white rounded-xl border border-slate-200 shadow-2xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <PackageCheck className="w-5 h-5 text-emerald-600" />
                <h3 className="text-base font-bold text-slate-900">Link Produced Stock to Order SKU</h3>
              </div>
              <button
                onClick={() => setStockModalItem(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-600 space-y-1 bg-slate-50 p-3 rounded-lg border border-slate-200">
              <div><strong>Customer:</strong> {stockModalItem.customerName}</div>
              <div>
                <strong>SKU:</strong>{' '}
                {productMap.get(stockModalItem.orderLineItem.product_id)?.sku} -{' '}
                {productMap.get(stockModalItem.orderLineItem.product_id)?.name}
              </div>
              <div>
                <strong>Target Order Quantity:</strong>{' '}
                {(stockModalItem.orderLineItem.confirmed_order_qty > 0
                  ? stockModalItem.orderLineItem.confirmed_order_qty
                  : stockModalItem.orderLineItem.forecast_qty
                ).toLocaleString()}{' '}
                PCS
              </div>
            </div>

            {/* The allocation position for this SKU. Without it the number
                below is typed against nothing: the same finished good is sold
                domestically and to other countries, and all of them draw on
                one physical pool. */}
            {(() => {
              const pid = stockModalItem.orderLineItem.product_id;
              const alloc = allocations.get(pid);
              const prod = productMap.get(pid);
              if (!alloc) return null;
              const ceiling = availableForOrder(alloc, stockModalItem.orderId);
              const others = claimsByCountry(alloc)
                .map(c => ({ ...c, qty: c.qty - alloc.claims
                  .filter(x => x.orderId === stockModalItem.orderId && x.countryCode === c.countryCode)
                  .reduce((s, x) => s + x.qty, 0) }))
                .filter(c => c.qty > 0);

              return (
                <div className="text-[11.5px] rounded-lg border border-slate-200 overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 font-bold uppercase tracking-wider text-[10px] text-slate-600">
                    Stock position for this SKU
                  </div>
                  <div className="p-3 space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-slate-600">On hand + planned production</span>
                      <span className="font-mono font-bold text-slate-800">
                        {alloc.supply.toLocaleString()} PCS
                      </span>
                    </div>
                    {alloc.otherChannelDemand > 0 && (
                      <div className="flex justify-between">
                        <span className="text-slate-600">Committed to other channels</span>
                        <span className="font-mono text-slate-700">
                          −{alloc.otherChannelDemand.toLocaleString()} PCS
                        </span>
                      </div>
                    )}
                    {others.length > 0 && (
                      <div className="flex justify-between items-start gap-2">
                        <span className="text-slate-600">Promised to other export orders</span>
                        <span className="font-mono text-slate-700 text-right">
                          −{others.reduce((s, c) => s + c.qty, 0).toLocaleString()} PCS
                          <span className="block text-[10px] text-slate-400">
                            {others.map(c => `${c.countryCode} ${c.qty.toLocaleString()}`).join(' · ')}
                          </span>
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between pt-1.5 border-t border-slate-200">
                      <span className="font-bold text-slate-700">Available to this order</span>
                      <span className={`font-mono font-extrabold ${ceiling < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                        {ceiling.toLocaleString()} PCS
                        {prod && toCartons(Math.max(0, ceiling), prod) !== null && (
                          <span className="block text-[10px] font-normal text-slate-400">
                            {formatQty(Math.max(0, ceiling), prod, 'cartons')} CTN
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                  {newProducedStockQty > ceiling && (
                    // A warning, not a block: a planner may knowingly promise
                    // against production that is not yet in the plan. It must
                    // be a deliberate act rather than an invisible one.
                    <p className="px-3 py-2 bg-amber-50 border-t border-amber-200 text-[11px] text-amber-900 font-semibold">
                      This allocates {(newProducedStockQty - ceiling).toLocaleString()} PCS more than is
                      available. Saving will leave this SKU over-committed across orders.
                    </p>
                  )}
                </div>
              );
            })()}

            <form onSubmit={handleSaveStockUpdate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Produced Stock Linked for this SKU (PCS)
                </label>
                <input aria-label="Produced stock qty"
                  type="number"
                  min="0"
                  step="100"
                  value={newProducedStockQty}
                  onChange={(e) => setNewProducedStockQty(toQuantity(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono font-bold border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setStockModalItem(null)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm"
                >
                  Save Stock Allocation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Multi-SKU Export Order Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Export order">
          <div ref={orderModalRef} className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Globe className="w-5 h-5 text-indigo-600" />
                <h3 className="text-base font-bold text-slate-900">
                  {editingRecord ? `Edit Export Order ${formData.order_number}` : 'Create Multi-SKU Export Order'}
                </h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Form Body */}
            <form onSubmit={handleSaveRecord} className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Section 1: Order Header Specs */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-1">
                  1. Order Header Information
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Order Number *</label>
                    <input aria-label="Order number"
                      type="text"
                      value={formData.order_number}
                      onChange={(e) => setFormData({ ...formData, order_number: e.target.value })}
                      className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      placeholder="EXP-2026-001"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Destination Country *</label>
                    <select aria-label="Country code"
                      value={formData.country_code}
                      onChange={(e) => {
                        const code = e.target.value;
                        const c = COUNTRY_OPTIONS.find((item) => item.code === code);
                        setFormData({
                          ...formData,
                          country_code: code,
                          country_name: c ? c.name : code
                        });
                      }}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white"
                      required
                    >
                      {COUNTRY_OPTIONS.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.flag} {c.name} ({c.code})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Customer / Client Name *</label>
                    <input aria-label="Customer name"
                      type="text"
                      value={formData.customer_name}
                      onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      placeholder="e.g. Panda Retail Group"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Planning Month (Period)</label>
                    <input aria-label="Period start"
                      type="date"
                      value={formData.period_start}
                      onChange={(e) => setFormData({ ...formData, period_start: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Est. Shipping Date (ETS) *</label>
                    <input aria-label="Target ship date"
                      type="date"
                      value={formData.target_ship_date}
                      onChange={(e) => setFormData({ ...formData, target_ship_date: e.target.value })}
                      className="w-full px-3 py-2 text-xs font-semibold text-indigo-900 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Order Status</label>
                    <select aria-label="Order status"
                      value={formData.order_status}
                      onChange={(e) => setFormData({ ...formData, order_status: e.target.value as any })}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white"
                    >
                      <option value="draft">Draft</option>
                      <option value="confirmed">Confirmed</option>
                      <option value="in_production">In Production</option>
                      <option value="ready_to_ship">Ready to Ship</option>
                      <option value="shipped">Shipped</option>
                      <option value="delivered">Delivered</option>
                      <option value="on_hold">On Hold</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Export License Status</label>
                    <select aria-label="Export license status"
                      value={formData.export_license_status}
                      onChange={(e) => setFormData({ ...formData, export_license_status: e.target.value as any })}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white"
                    >
                      <option value="approved">Approved</option>
                      <option value="pending">Pending</option>
                      <option value="not_required">Not Required</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Shipping Port</label>
                    <input aria-label="Shipping port"
                      type="text"
                      value={formData.shipping_port}
                      onChange={(e) => setFormData({ ...formData, shipping_port: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      placeholder="e.g. Damietta Port"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Container Count (TEU)</label>
                    <input aria-label="Container count"
                      type="number"
                      min="1"
                      value={formData.container_count}
                      onChange={(e) => setFormData({ ...formData, container_count: toQuantity(e.target.value) })}
                      className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Payment Term / LC Ref</label>
                    <input aria-label="Lc reference"
                      type="text"
                      value={formData.lc_reference}
                      onChange={(e) => setFormData({ ...formData, lc_reference: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      placeholder="e.g. LC-KSA-99012"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Multi-SKU Line Items (Up to 10+ SKUs per order) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-1">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-indigo-600" />
                    2. Order SKU Line Items ({formData.items.length} SKUs added)
                  </h4>
                  <button
                    type="button"
                    onClick={handleAddFormItem}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add SKU Line Item
                  </button>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-inner bg-slate-50 p-2 space-y-2 max-h-72 overflow-y-auto">
                  {formData.items.map((item, idx) => (
                    <div key={item.id || idx} className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-700 font-mono">SKU #{idx + 1}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveFormItem(idx)}
                          className="text-slate-400 hover:text-rose-600 p-1"
                          title="Remove SKU line"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] font-bold text-slate-600 uppercase mb-0.5">Product SKU</label>
                          <select aria-label="Product id"
                            value={item.product_id}
                            onChange={(e) => handleUpdateFormItem(idx, 'product_id', e.target.value)}
                            className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white font-medium"
                          >
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.sku} - {p.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-slate-600 uppercase mb-0.5">Forecast Qty (PCS)</label>
                          <input aria-label="Forecast qty"
                            type="number"
                            min="0"
                            step="500"
                            value={item.forecast_qty}
                            onChange={(e) => handleUpdateFormItem(idx, 'forecast_qty', toQuantity(e.target.value))}
                            className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-slate-600 uppercase mb-0.5">Confirmed Qty (PCS)</label>
                          <input aria-label="Confirmed order qty"
                            type="number"
                            min="0"
                            step="500"
                            value={item.confirmed_order_qty}
                            onChange={(e) => handleUpdateFormItem(idx, 'confirmed_order_qty', toQuantity(e.target.value))}
                            className="w-full px-2.5 py-1.5 text-xs font-mono font-bold border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-slate-900"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                        <div>
                          <label className="block text-[10px] font-bold text-emerald-700 uppercase mb-0.5">
                            Linked Produced Stock (PCS)
                          </label>
                          <input aria-label="Produced stock qty"
                            type="number"
                            min="0"
                            step="500"
                            value={item.produced_stock_qty}
                            onChange={(e) => handleUpdateFormItem(idx, 'produced_stock_qty', toQuantity(e.target.value))}
                            className="w-full px-2.5 py-1.5 text-xs font-mono font-bold text-emerald-800 border border-emerald-300 bg-emerald-50/50 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-600 uppercase mb-0.5">Line Notes</label>
                          <input aria-label="Notes"
                            type="text"
                            value={item.notes || ''}
                            onChange={(e) => handleUpdateFormItem(idx, 'notes', e.target.value)}
                            className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            placeholder="Packaging specs / promo tags..."
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Section 3: Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Order Level Notes</label>
                <textarea aria-label="Notes"
                  rows={2}
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  placeholder="Shipping instructions, custom clearance documents required, etc."
                />
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors"
                >
                  Save Export Order
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Side Drawer for Inspection */}
      {activeDrawerRecord && (
        <div className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-xs flex justify-end" role="dialog" aria-modal="true" aria-label="Export order details">
          <div ref={drawerRef} className="bg-white w-full max-w-xl h-full shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold text-slate-900 font-mono">{activeDrawerRecord.order_number}</span>
                  <span className="text-sm">
                    {COUNTRY_OPTIONS.find((c) => c.code === activeDrawerRecord.country_code)?.flag}
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-0.5">
                  {activeDrawerRecord.customer_name} • {activeDrawerRecord.country_name}
                </p>
              </div>
              <button
                onClick={() => setActiveDrawerRecord(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Shipping ETS Countdown */}
              <div className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white rounded-xl p-4 shadow-md space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-indigo-200 font-semibold uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-amber-400" />
                    Estimated Time of Shipping (ETS)
                  </span>
                  <span className="text-xs font-mono bg-white/10 px-2 py-0.5 rounded text-white">
                    Target: {activeDrawerRecord.target_ship_date}
                  </span>
                </div>
                <div className="text-lg font-bold">
                  {getEtsStatus(activeDrawerRecord.target_ship_date, activeDrawerRecord.order_status).label}
                </div>
              </div>

              {/* Status Updater Buttons */}
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block mb-2">Advance Order Lifecycle</span>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => handleUpdateOrderStatus('confirmed')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                      activeDrawerRecord.order_status === 'confirmed'
                        ? 'bg-blue-600 text-white border-blue-700'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    Confirmed
                  </button>
                  <button
                    onClick={() => handleUpdateOrderStatus('in_production')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                      activeDrawerRecord.order_status === 'in_production'
                        ? 'bg-indigo-600 text-white border-indigo-700'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    In Production
                  </button>
                  <button
                    onClick={() => handleUpdateOrderStatus('ready_to_ship')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                      activeDrawerRecord.order_status === 'ready_to_ship'
                        ? 'bg-emerald-600 text-white border-emerald-700'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    Ready to Ship
                  </button>
                </div>
              </div>

              {/* SKU list — progress is per line, and the order total below is
                  the roll-up of these, so it is always clear which SKU is
                  holding the order back. */}
              {(() => {
                const t = calculateOrderTotals(activeDrawerRecord.items);
                return (
                  <div className="space-y-3">
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        Order SKUs &amp; linked stock
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500">
                        {t.linesReady} of {t.lineCount} SKUs ready
                        {t.linesShipped > 0 && ` · ${t.linesShipped} shipped`}
                        {t.linesOnHold > 0 && (
                          <span className="text-red-600"> · {t.linesOnHold} on hold</span>
                        )}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {t.lines.map((li, idx) => (
                        <div key={li.id || idx} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                          <div className="flex items-center justify-between text-xs gap-2">
                            <span className="font-mono font-bold text-indigo-700">
                              {li.product?.sku || li.product_id}
                            </span>
                            <span className="font-semibold text-slate-900 truncate">{li.product?.name}</span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                            <div>
                              <span className="block text-slate-500">Ordered</span>
                              <span className="font-bold text-slate-800">{formatDual(li.target, li.product)}</span>
                            </div>
                            <div className="text-right">
                              <span className="block text-slate-500">Produced</span>
                              <span className="font-bold text-emerald-700">{formatDual(li.produced, li.product)}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-slate-200 h-1.5 rounded-full overflow-hidden">
                              <div
                                className={`h-1.5 rounded-full ${li.pct >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                                style={{ width: `${li.pct}%` }}
                              />
                            </div>
                            <span className={`text-[11px] font-bold tabular-nums ${li.pct >= 100 ? 'text-emerald-700' : 'text-slate-600'}`}>
                              {li.pct}%
                            </span>
                          </div>

                          {li.shortfall > 0 && (
                            <p className="text-[10.5px] text-amber-700 font-semibold">
                              Short {formatDual(li.shortfall, li.product)} to complete this line
                            </p>
                          )}

                          {/* Per-SKU status. Editable here because a planner
                              knows where an individual SKU is long before the
                              whole order moves. */}
                          <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-200">
                            <label
                              htmlFor={`line-status-${li.id}`}
                              className="text-[10px] font-bold uppercase tracking-wider text-slate-500"
                            >
                              SKU status
                            </label>
                            <select
                              id={`line-status-${li.id}`}
                              value={li.line_status ?? 'pending'}
                              disabled={!hasRole('planner')}
                              onChange={e => handleUpdateLineStatus(li.id, e.target.value as ExportLineStatus)}
                              className={`text-[10.5px] font-bold rounded-md border px-1.5 py-1 cursor-pointer focus:outline-none ${
                                LINE_STATUS_STYLE[li.line_status ?? 'pending']
                              } ${!hasRole('planner') ? 'opacity-60 cursor-not-allowed' : ''}`}
                            >
                              {LINE_STATUSES.map(s => (
                                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* The roll-up. Each line counts only up to its own target,
                        so a surplus on one SKU cannot present the order as
                        shippable while another SKU is short. */}
                    <div className="border border-slate-300 rounded-xl p-3 bg-white space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold uppercase tracking-wider text-slate-600">Order total</span>
                        <span className={`font-bold tabular-nums ${t.readinessPct >= 100 ? 'text-emerald-700' : 'text-slate-700'}`}>
                          {t.readinessPct}% ready
                        </span>
                      </div>
                      <div className="flex-1 bg-slate-200 h-2 rounded-full overflow-hidden">
                        <div
                          className={`h-2 rounded-full ${t.readinessPct >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                          style={{ width: `${t.readinessPct}%` }}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                        <span className="text-slate-600">
                          Ordered <b className="text-slate-900">{t.targetQty.toLocaleString()} PCS</b>
                        </span>
                        <span className="text-right text-slate-600">
                          Produced <b className="text-emerald-700">{t.produced.toLocaleString()} PCS</b>
                        </span>
                      </div>
                      {t.shortfall > 0 && (
                        <p className="text-[11px] text-amber-700 font-semibold">
                          {t.shortfall.toLocaleString()} PCS still to produce before this order can ship complete.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Order Metadata Grid */}
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 text-xs space-y-2">
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span className="text-slate-600">Shipping Port:</span>
                  <span className="font-semibold text-slate-900">{activeDrawerRecord.shipping_port || 'N/A'}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span className="text-slate-600">Containers:</span>
                  <span className="font-semibold text-slate-900">{activeDrawerRecord.container_count || 1} TEU</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span className="text-slate-600">Payment Term:</span>
                  <span className="font-semibold text-slate-900">{activeDrawerRecord.payment_term || 'N/A'}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span className="text-slate-600">LC Reference:</span>
                  <span className="font-mono font-bold text-indigo-700">{activeDrawerRecord.lc_reference || 'N/A'}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-600">License Status:</span>
                  <span className="font-semibold uppercase text-slate-800">{activeDrawerRecord.export_license_status}</span>
                </div>
              </div>

              {activeDrawerRecord.notes && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900">
                  <strong>Notes:</strong> {activeDrawerRecord.notes}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
