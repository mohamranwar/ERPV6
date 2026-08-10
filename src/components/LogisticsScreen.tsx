/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAsyncLoad, type LoadSignal } from '../hooks/useAsyncLoad';
import { fetchTableData, saveRecord, deleteRecord } from '../supabaseClient';
import { Shipment, PurchaseOrder, Material, Supplier } from '../types';
import { 
  Calendar, CheckSquare, AlertTriangle, Ship, Truck, Plane, Plus, Trash2, Edit2, 
  RefreshCw, PackageCheck, Globe, MapPin, Clock, ArrowRight, ShieldAlert, FileText, CheckCircle2, Download, BarChart2
} from 'lucide-react';
import { useToast } from '../context/ToastConfirmContext';
import { useAuth } from '../context/AuthContext';
import { useTableSort } from '../hooks/useTableSort';
import { useFocusTrap } from '../hooks/useFocusTrap';
import SortableHeader from './SortableHeader';
import EmptyState from './EmptyState';
import SearchBar from './SearchBar';
import ScrollableTable from './ScrollableTable';
import ContentHeader from './ContentHeader';
import DataStateWrapper from './DataStateWrapper';
import ErrorState from './ErrorState';
import { exportToCsv } from '../utils/csv';
import { KpiCard } from './ui';

const NEVER_CANCELLED: LoadSignal = { cancelled: false };


/**
 * A purchase order and a shipment presented as one follow-up row.
 *
 * Named rather than inline so generic helpers (useTableSort, exportToCsv) can
 * infer the element type; as an anonymous shape it degraded to `unknown` at
 * every call site.
 */
export interface CombinedOrder {
  id: string;
  order_no: string;
  type: 'po' | 'shipment';
  material_id: string;
  material_name: string;
  material_sku: string;
  supplier_name: string;
  origin_type: 'local' | 'foreign';
  qty: number;
  order_date: string;
  original_delivery_date: string;
  revised_delivery_date: string;
  status: string;
  /** revised minus original, in days. Positive = slipped. */
  delay_days: number;
  po_ref?: PurchaseOrder;
  shipment_ref?: Shipment;
}

interface LogisticsScreenProps {
  searchQuery?: string;
  setSearchQuery?: (val: string) => void;
  refreshKey?: number;
}

export default function LogisticsScreen({
  searchQuery = '',
  setSearchQuery = () => {},
  refreshKey = 0,
}: LogisticsScreenProps) {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter by Sourcing: 'all' | 'local' | 'foreign'
  const [filterSourcing, setFilterSourcing] = useState<string>('all');
  // Filter by Delay / Status
  const [filterDelay, setFilterDelay] = useState<string>('all');
  // Filter by Historical Month: 'all' | 'YYYY-MM'
  const [filterMonth, setFilterMonth] = useState<string>('all');
  // Toggle for Monthly Historical Database Analysis Table
  const [showMonthlyBreakdown, setShowMonthlyBreakdown] = useState<boolean>(true);

  // Form Modals
  const [showShipmentForm, setShowShipmentForm] = useState(false);
  const [editShipment, setEditShipment] = useState<Shipment | null>(null);

  const [showPoForm, setShowPoForm] = useState(false);
  const [editPo, setEditPo] = useState<PurchaseOrder | null>(null);

  const { showToast, confirm: askConfirm } = useToast();
  const { hasRole } = useAuth();

  // Both dialogs previously had no focus management: keyboard focus could Tab
  // straight out of the form into the page behind the backdrop, and Escape did
  // nothing. useFocusTrap confines Tab to the dialog and wires Escape to close.
  const poModalRef = useRef<HTMLDivElement>(null);
  const shipmentModalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(poModalRef, showPoForm, () => setShowPoForm(false));
  useFocusTrap(shipmentModalRef, showShipmentForm, () => setShowShipmentForm(false));

  async function loadData(signal: LoadSignal = NEVER_CANCELLED) {
    setLoading(true);
    setError(null);
    try {
      const [shps, pos, mats, sups] = await Promise.all([
        fetchTableData<Shipment>('shipments'),
        fetchTableData<PurchaseOrder>('purchase_orders'),
        fetchTableData<Material>('materials'),
        fetchTableData<Supplier>('suppliers')
      ]);
      if (signal.cancelled) return;
      setShipments(shps);
      setPurchaseOrders(pos);
      setMaterials(mats);
      setSuppliers(sups);
    } catch (e) {
      if (signal.cancelled) return;
      setError(e instanceof Error ? e.message : String(e));
      console.error("Logistics database fetch failed", e);
    } finally {
      if (!signal.cancelled) setLoading(false);
    }
  }

  useAsyncLoad(loadData, [refreshKey]);

  // Combined Order View Items (Merging POs and Shipments)
  const combinedOrders = useMemo(() => {
    const list: CombinedOrder[] = [];

    // Process POs
    purchaseOrders.forEach(po => {
      const mat = materials.find(m => m.id === po.material_id);
      const sup = suppliers.find(s => s.id === po.supplier_id);
      const origin: 'local' | 'foreign' = po.origin_type || mat?.origin_type || (sup?.default_transit_days && sup.default_transit_days <= 5 ? 'local' : 'foreign');
      
      const origDate = po.original_delivery_date || po.required_date || po.po_date;
      const revDate = po.revised_delivery_date || origDate;
      
      // Calculate delay in days
      let delay = 0;
      if (origDate && revDate) {
        const d1 = new Date(origDate).getTime();
        const d2 = new Date(revDate).getTime();
        delay = Math.round((d2 - d1) / (1000 * 3600 * 24));
      }

      list.push({
        id: po.id,
        order_no: po.order_no,
        type: 'po',
        material_id: po.material_id,
        material_name: mat?.name || 'Unknown Material',
        material_sku: mat?.sku || po.material_id,
        supplier_name: sup?.name || 'Unknown Supplier',
        origin_type: origin,
        qty: po.qty,
        order_date: po.po_date,
        original_delivery_date: origDate,
        revised_delivery_date: revDate,
        status: po.status,
        delay_days: delay,
        po_ref: po
      });
    });

    // Process Shipments not linked to PO or additional
    shipments.forEach(shp => {
      const mat = materials.find(m => m.id === shp.material_id);
      const sup = suppliers.find(s => s.id === shp.supplier_id);
      const origin: 'local' | 'foreign' = shp.origin_type || mat?.origin_type || (shp.ship_method === 'land' ? 'local' : 'foreign');

      const origDate = shp.original_delivery_date || shp.factory_arrival_date || shp.port_eta || '';
      const revDate = shp.revised_delivery_date || shp.factory_arrival_date || origDate;
      const delay = shp.delay || 0;

      list.push({
        id: shp.id,
        order_no: shp.invoice_no || `SHIP-${shp.id}`,
        type: 'shipment',
        material_id: shp.material_id,
        material_name: mat?.name || 'Unknown Material',
        material_sku: mat?.sku || shp.material_id,
        supplier_name: sup?.name || 'Unknown Supplier',
        origin_type: origin,
        qty: shp.qty,
        order_date: shp.etd || '',
        original_delivery_date: origDate,
        revised_delivery_date: revDate,
        status: shp.factory_arrival_date ? 'delivered' : 'in_transit',
        delay_days: delay,
        shipment_ref: shp
      });
    });

    return list;
  }, [purchaseOrders, shipments, materials, suppliers]);

  // Available Months in database records
  const availableMonths = useMemo(() => {
    const monthSet = new Set<string>();
    combinedOrders.forEach(o => {
      const raw = o.order_date || o.original_delivery_date || '';
      if (raw && raw.length >= 7) {
        monthSet.add(raw.slice(0, 7));
      }
    });
    return Array.from(monthSet).sort();
  }, [combinedOrders]);

  // Monthly Historical Aggregates from Database
  const monthlyHistoricalData = useMemo(() => {
    const map: Record<string, {
      monthKey: string;
      monthLabel: string;
      totalOrders: number;
      totalQty: number;
      localCount: number;
      foreignCount: number;
      delayedCount: number;
      onTimeCount: number;
      totalValue: number;
    }> = {};

    combinedOrders.forEach(o => {
      const rawDate = o.order_date || o.original_delivery_date || '';
      const monthKey = (rawDate && rawDate.length >= 7) ? rawDate.slice(0, 7) : 'Unknown';

      if (!map[monthKey]) {
        let monthLabel = monthKey;
        if (monthKey !== 'Unknown' && monthKey.includes('-')) {
          const [y, m] = monthKey.split('-');
          const dateObj = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
          if (!isNaN(dateObj.getTime())) {
            monthLabel = dateObj.toLocaleString('en-US', { month: 'short', year: 'numeric' });
          }
        }

        map[monthKey] = {
          monthKey,
          monthLabel,
          totalOrders: 0,
          totalQty: 0,
          localCount: 0,
          foreignCount: 0,
          delayedCount: 0,
          onTimeCount: 0,
          totalValue: 0
        };
      }

      const entry = map[monthKey];
      entry.totalOrders += 1;
      entry.totalQty += o.qty || 0;
      if (o.origin_type === 'local') entry.localCount += 1;
      else entry.foreignCount += 1;

      if (o.delay_days > 0) entry.delayedCount += 1;
      else entry.onTimeCount += 1;

      const unitPrice = o.po_ref?.unit_price || 0;
      entry.totalValue += (o.qty || 0) * unitPrice;
    });

    return Object.values(map).sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  }, [combinedOrders]);

  // Orders filtered by selected historical month
  const monthFilteredOrders = useMemo(() => {
    if (filterMonth === 'all') return combinedOrders;
    return combinedOrders.filter(o => {
      const raw = o.order_date || o.original_delivery_date || '';
      return raw.startsWith(filterMonth);
    });
  }, [combinedOrders, filterMonth]);

  // Search & Filter Logic (Rule: Search Query Overrides Categorical Dropdowns)
  const filteredCombinedOrders = useMemo(() => {
    let result = monthFilteredOrders;

    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      return combinedOrders.filter(item => 
        item.order_no.toLowerCase().includes(q) ||
        item.material_name.toLowerCase().includes(q) ||
        item.material_sku.toLowerCase().includes(q) ||
        item.supplier_name.toLowerCase().includes(q)
      );
    }

    // Apply categorical and month filters when search is empty
    if (filterSourcing !== 'all') {
      result = result.filter(item => item.origin_type === filterSourcing);
    }

    if (filterDelay === 'delayed') {
      result = result.filter(item => item.delay_days > 0);
    } else if (filterDelay === 'on_time') {
      result = result.filter(item => item.delay_days <= 0);
    }

    return result;
  }, [combinedOrders, monthFilteredOrders, searchQuery, filterSourcing, filterDelay]);

  // Table Sort
  const { sortedItems: sortedOrders, sortConfig, handleSort } =
    useTableSort<CombinedOrder>(filteredCombinedOrders, 'original_delivery_date', 'asc');

  // Handle PO Save
  const handleSavePo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editPo) return;
    if (!hasRole('planner')) {
      showToast('Planner or Admin access required to save POs.', 'error');
      return;
    }
    try {
      const saved = await saveRecord<PurchaseOrder>('purchase_orders', editPo);
      setPurchaseOrders(prev => editPo.id ? prev.map(p => p.id === saved.id ? saved : p) : [...prev, saved]);
      setShowPoForm(false);
      setEditPo(null);
      showToast("Purchase Order saved successfully!", "success");
    } catch (err) {
      showToast("Error saving Purchase Order.", "error");
    }
  };

  // Handle Shipment Save
  const handleSaveShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editShipment) return;
    if (!hasRole('planner')) {
      showToast('Planner or Admin access required to save shipments.', 'error');
      return;
    }
    try {
      const saved = await saveRecord<Shipment>('shipments', editShipment);
      setShipments(prev => editShipment.id ? prev.map(s => s.id === saved.id ? saved : s) : [...prev, saved]);
      setShowShipmentForm(false);
      setEditShipment(null);
      showToast("Shipment log saved successfully!", "success");
    } catch (err) {
      showToast("Error saving shipment.", "error");
    }
  };

  const handleDeletePo = async (id: string) => {
    if (!hasRole('planner')) {
      showToast('Planner or Admin access required to delete POs.', 'error');
      return;
    }
    const confirmed = await askConfirm('Are you sure you want to delete this purchase order?', 'Delete PO');
    if (!confirmed) return;
    try {
      await deleteRecord('purchase_orders', id);
      setPurchaseOrders(prev => prev.filter(p => p.id !== id));
      showToast('Purchase Order deleted successfully.', 'success');
    } catch (err: any) {
      showToast('Error deleting PO: ' + err.message, 'error');
    }
  };

  const handleDeleteShipment = async (id: string) => {
    if (!hasRole('planner')) {
      showToast('Planner or Admin access required to delete shipments.', 'error');
      return;
    }
    const confirmed = await askConfirm('Are you sure you want to delete this shipment log?', 'Delete Shipment');
    if (!confirmed) return;
    try {
      await deleteRecord('shipments', id);
      setShipments(prev => prev.filter(s => s.id !== id));
      showToast('Shipment log deleted successfully.', 'success');
    } catch (err: any) {
      showToast('Error deleting shipment: ' + err.message, 'error');
    }
  };

  const handleCreatePo = () => {
    if (!hasRole('planner')) {
      showToast('Planner or Admin access required to create POs.', 'error');
      return;
    }
    const mat = materials[0];
    const sup = suppliers.find(s => s.id === mat?.supplier_id) || suppliers[0];
    const today = new Date().toISOString().slice(0, 10);
    const targetDate = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

    setEditPo({
      id: '',
      material_id: mat?.id || '',
      supplier_id: sup?.id || '',
      order_no: `PO-2026-${Math.floor(100 + Math.random() * 900)}`,
      qty: 50000,
      remaining_qty: 50000,
      po_date: today,
      required_date: targetDate,
      original_delivery_date: targetDate,
      revised_delivery_date: targetDate,
      origin_type: mat?.origin_type || 'foreign',
      status: 'pending',
      timing: 'Normal',
      unit_price: mat?.standard_cost || 1.0
    });
    setShowPoForm(true);
  };

  const handleCreateShipment = () => {
    if (!hasRole('planner')) {
      showToast('Planner or Admin access required to create shipments.', 'error');
      return;
    }
    const mat = materials[0];
    const sup = suppliers.find(s => s.id === mat?.supplier_id) || suppliers[0];
    const today = new Date().toISOString().slice(0, 10);
    const targetDate = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);

    setEditShipment({
      id: '',
      material_id: mat?.id || '',
      supplier_id: sup?.id || '',
      qty: 25000,
      invoice_no: `INV-${Math.floor(1000 + Math.random() * 9000)}`,
      bl_no: mat?.origin_type === 'local' ? 'LOCAL-DELIVERY-NOTE' : `BL-${Math.floor(10000 + Math.random() * 90000)}`,
      container_count: 2,
      ship_method: mat?.origin_type === 'local' ? 'land' : 'sea',
      origin_type: mat?.origin_type || 'foreign',
      etd: today,
      port_eta: targetDate,
      port_name: mat?.origin_type === 'local' ? 'Factory Gate' : 'Alexandria',
      customs_clearance_days: mat?.origin_type === 'local' ? 0 : 5,
      original_delivery_date: targetDate,
      revised_delivery_date: targetDate,
      factory_arrival_date: null,
      delay: 0
    });
    setShowShipmentForm(true);
  };

  const handleExportCSV = () => {
    // Export what the planner is actually looking at. Exporting the unfiltered
    // set while the table showed a filtered view meant the file never matched
    // the screen it was exported from.
    const visible = sortedOrders;
    if (visible.length === 0) {
      showToast('Nothing to export — no orders match the current filters.', 'error');
      return;
    }

    const ok = exportToCsv<CombinedOrder>(visible, `logistics_report_${new Date().toISOString().slice(0, 10)}`, [
      { header: 'Order / Invoice No', key: o => o.order_no },
      { header: 'Type', key: o => (o.type === 'po' ? 'Purchase Order' : 'Shipment') },
      { header: 'Material', key: o => o.material_name },
      { header: 'Material SKU', key: o => o.material_sku },
      { header: 'Supplier', key: o => o.supplier_name },
      { header: 'Sourcing', key: o => o.origin_type },
      { header: 'Qty', key: o => o.qty },
      { header: 'Original Delivery', key: o => o.original_delivery_date || '' },
      { header: 'Revised Delivery', key: o => o.revised_delivery_date || '' },
      { header: 'Delay (Days)', key: o => o.delay_days },
      { header: 'Status', key: o => o.status },
    ]);

    if (ok) showToast(`Exported ${visible.length} row(s) to CSV.`, 'success');
  };

  return (
    <div className="space-y-6" id="logistics_screen">
      <ContentHeader
        title="Purchase Orders (PO)"
      />

      {/* Action Toolbar in separate div - compact button size reduced by 30% */}
      <div className="flex flex-wrap items-center gap-1.5 -mt-4 mb-2 p-1.5 bg-slate-50/80 rounded-md border border-slate-200/80">
        <button
          type="button"
          onClick={handleExportCSV}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8.5px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded transition-colors shadow-2xs cursor-pointer"
          title="Export shipments report as CSV"
        >
          <Download className="w-2.5 h-2.5 text-white" /> Export Report (CSV)
        </button>
        <button
          type="button"
          onClick={handleCreatePo}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8.5px] font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded transition-colors shadow-2xs cursor-pointer"
        >
          <Plus className="w-2.5 h-2.5 text-white" /> Create Purchase Order
        </button>
        <button
          type="button"
          onClick={handleCreateShipment}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8.5px] font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded transition-colors shadow-2xs cursor-pointer"
        >
          <Ship className="w-2.5 h-2.5 text-white" /> Log In-Transit Shipment
        </button>
      </div>

      <ErrorState error={error} onRetry={loadData} />

      {/* KPI Cards — calculated dynamically from historical database records (monthly filterable) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total Active Orders"
          value={monthFilteredOrders.length}
          sub={filterMonth === 'all' ? "All historical DB orders" : `DB Month: ${filterMonth}`}
          icon={<FileText className="w-4 h-4" />}
        />
        <KpiCard
          label="Local Deliveries"
          value={monthFilteredOrders.filter(o => o.origin_type === 'local').length}
          sub="Direct factory delivery, no customs"
          intent="success"
          icon={<MapPin className="w-4 h-4" />}
        />
        <KpiCard
          label="Foreign Imports"
          value={monthFilteredOrders.filter(o => o.origin_type === 'foreign').length}
          sub="Requires port & customs clearance"
          intent="info"
          icon={<Globe className="w-4 h-4" />}
        />
        <KpiCard
          label="Delayed Shipments"
          value={monthFilteredOrders.filter(o => o.delay_days > 0).length}
          sub="Revised date exceeds original"
          intent={monthFilteredOrders.some(o => o.delay_days > 0) ? 'warning' : 'success'}
          icon={<AlertTriangle className="w-4 h-4" />}
        />
      </div>

      {/* Monthly Historical Database Matrix Card */}
      {showMonthlyBreakdown && monthlyHistoricalData.length > 0 && (
        <div className="card-elevated p-4 space-y-3 bg-white border border-slate-200/90 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-sky-600" />
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Monthly Historical Database Breakdown
              </h3>
            </div>
            <span className="text-[11px] font-mono text-slate-500 font-medium">
              Source: Database purchase_orders & shipments
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs font-medium">
              <thead>
                <tr className="bg-slate-50/90 text-slate-600">
                  <th className="px-3 py-2 font-semibold">Month</th>
                  <th className="px-3 py-2 text-right font-semibold">Total Orders</th>
                  <th className="px-3 py-2 text-right font-semibold">Volume (Units)</th>
                  <th className="px-3 py-2 text-center font-semibold">Local / Foreign</th>
                  <th className="px-3 py-2 text-center font-semibold">On-Time / Delayed</th>
                  <th className="px-3 py-2 text-right font-semibold">Est. Order Value</th>
                  <th className="px-3 py-2 text-center font-semibold">Filter Mode</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800 font-mono text-[11px]">
                {monthlyHistoricalData.map(m => {
                  const onTimePct = m.totalOrders > 0 ? Math.round((m.onTimeCount / m.totalOrders) * 100) : 0;
                  const isSelected = filterMonth === m.monthKey;
                  return (
                    <tr key={m.monthKey} className={isSelected ? "bg-sky-50/80 font-bold" : "hover:bg-slate-50/80 transition-colors"}>
                      <td className="px-3 py-2 font-sans font-bold text-slate-900">{m.monthLabel}</td>
                      <td className="px-3 py-2 text-right font-bold text-slate-900">{m.totalOrders}</td>
                      <td className="px-3 py-2 text-right font-medium text-slate-700">{m.totalQty.toLocaleString()}</td>
                      <td className="px-3 py-2 text-center">
                        <span className="text-emerald-700 font-bold">{m.localCount} Local</span>
                        <span className="text-slate-400 mx-1">/</span>
                        <span className="text-sky-700 font-bold">{m.foreignCount} Import</span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className="text-emerald-700 font-bold">{m.onTimeCount} On-time ({onTimePct}%)</span>
                        {m.delayedCount > 0 && (
                          <span className="text-amber-600 font-bold ml-1.5">({m.delayedCount} Delayed)</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-slate-900">
                        ${m.totalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </td>
                      <td className="px-3 py-2 text-center font-sans">
                        <button
                          type="button"
                          onClick={() => setFilterMonth(isSelected ? 'all' : m.monthKey)}
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
                            isSelected
                              ? "bg-sky-700 text-white"
                              : "bg-slate-100 text-slate-700 hover:bg-sky-100 hover:text-sky-800 border border-slate-200"
                          }`}
                        >
                          {isSelected ? 'Active Month' : 'Select Month'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Control Filters Bar */}
      <div className="card-elevated p-4 space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search PO #, Invoice, Material Name or SKU..."
            className="w-full sm:w-80"
          />

          <div className="flex flex-wrap items-center gap-3 text-xs font-medium">
            {/* Monthly Database Historical Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-semibold flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-500" /> Historical Month:
              </span>
              <select
                aria-label="Filter by historical month"
                value={filterMonth}
                onChange={(e) => setFilterMonth(e.target.value)}
                disabled={searchQuery.trim() !== ''}
                className="bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
              >
                <option value="all">All Historical Months ({combinedOrders.length} orders)</option>
                {availableMonths.map(mKey => {
                  const [y, m] = mKey.split('-');
                  const d = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
                  const label = isNaN(d.getTime()) ? mKey : d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
                  const count = combinedOrders.filter(o => (o.order_date || o.original_delivery_date || '').startsWith(mKey)).length;
                  return (
                    <option key={mKey} value={mKey}>
                      {label} ({count} DB orders)
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Sourcing Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-semibold">Origin:</span>
              <select aria-label="Filter by sourcing"
                value={filterSourcing}
                onChange={(e) => setFilterSourcing(e.target.value)}
                disabled={searchQuery.trim() !== ''}
                className="bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
              >
                <option value="all">All Origins (Local & Foreign)</option>
                <option value="local">Local Materials Only</option>
                <option value="foreign">Foreign / Import Materials</option>
              </select>
            </div>

            {/* Delay Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-semibold">Delivery Status:</span>
              <select aria-label="Filter by delay"
                value={filterDelay}
                onChange={(e) => setFilterDelay(e.target.value)}
                disabled={searchQuery.trim() !== ''}
                className="bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
              >
                <option value="all">All Timelines</option>
                <option value="delayed">Delayed Orders Only</option>
                <option value="on_time">On Time / Early</option>
              </select>
            </div>

            {/* Toggle Monthly Historical Breakdown Table */}
            <button
              type="button"
              onClick={() => setShowMonthlyBreakdown(!showMonthlyBreakdown)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 transition-colors font-semibold cursor-pointer"
            >
              <BarChart2 className="w-3.5 h-3.5 text-sky-600" />
              {showMonthlyBreakdown ? 'Hide Monthly Table' : 'Show Monthly Table'}
            </button>
          </div>
        </div>

        {searchQuery.trim() !== '' && (
          <div className="text-xs text-sky-700 bg-sky-50 px-3 py-1.5 rounded-md border border-sky-200 font-medium">
            🔍 Search active: Categorical filters are bypassed to search globally across all orders and shipments.
          </div>
        )}
      </div>

      {/* Orders Follow-up Table */}
      <div className="card-elevated overflow-hidden">
        <ScrollableTable>
          <table className="min-w-full divide-y divide-slate-200 text-left">
            <thead>
              <tr>
                <SortableHeader label="Order / Invoice #" sortKey="order_no" sortConfig={sortConfig} onSort={handleSort} align="left" className="px-4 py-3" />
                <SortableHeader label="Material (Name & SKU)" sortKey="material_name" sortConfig={sortConfig} onSort={handleSort} align="left" className="px-4 py-3" />
                <SortableHeader label="Supplier" sortKey="supplier_name" sortConfig={sortConfig} onSort={handleSort} align="left" className="px-4 py-3" />
                <SortableHeader label="Sourcing" sortKey="origin_type" sortConfig={sortConfig} onSort={handleSort} align="center" className="px-4 py-3" />
                <SortableHeader label="Quantity" sortKey="qty" sortConfig={sortConfig} onSort={handleSort} align="right" className="px-4 py-3 font-mono" />
                <SortableHeader label="Original Delivery Date" sortKey="original_delivery_date" sortConfig={sortConfig} onSort={handleSort} align="center" className="px-4 py-3 font-mono" />
                <SortableHeader label="Revised Delivery Date" sortKey="revised_delivery_date" sortConfig={sortConfig} onSort={handleSort} align="center" className="px-4 py-3 font-mono" />
                <SortableHeader label="Delay (Days)" sortKey="delay_days" sortConfig={sortConfig} onSort={handleSort} align="center" className="px-4 py-3 font-mono" />
                <SortableHeader label="Status" sortKey="status" sortConfig={sortConfig} onSort={handleSort} align="center" className="px-4 py-3" />
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-800">
              {sortedOrders.map((item) => (
                <tr key={`${item.type}-${item.id}`} className="hover:bg-slate-50/80 transition-colors">
                  {/* Order / Invoice # */}
                  <td className="px-4 py-3">
                    <div className="font-bold font-mono text-slate-900">{item.order_no}</div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                      {item.type === 'po' ? 'Purchase Order' : 'Shipment / In-Transit'}
                    </div>
                  </td>

                  {/* MERGED: Material (Name & SKU in same column) */}
                  <td className="px-4 py-3">
                    <div className="font-bold text-slate-900">{item.material_name}</div>
                    <div className="text-[11px] font-mono text-slate-500 font-medium">{item.material_sku}</div>
                  </td>

                  {/* Supplier */}
                  <td className="px-4 py-3 font-medium text-slate-700">{item.supplier_name}</td>

                  {/* Local vs Foreign Sourcing Badge */}
                  <td className="px-4 py-3 text-center">
                    {item.origin_type === 'local' ? (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 inline-flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-emerald-600" /> Local
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-sky-100 text-sky-800 border border-sky-300 inline-flex items-center gap-1">
                        <Globe className="w-3 h-3 text-sky-600" /> Foreign
                      </span>
                    )}
                  </td>

                  {/* Quantity */}
                  <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">
                    {item.qty.toLocaleString()}
                  </td>

                  {/* Original Delivery Date */}
                  <td className="px-4 py-3 text-center font-mono text-slate-600">
                    {item.original_delivery_date || 'N/A'}
                  </td>

                  {/* Revised Delivery Date */}
                  <td className="px-4 py-3 text-center font-mono font-bold">
                    <span className={item.delay_days > 0 ? 'text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200' : 'text-slate-800'}>
                      {item.revised_delivery_date || item.original_delivery_date || 'N/A'}
                    </span>
                  </td>

                  {/* Delay Days */}
                  <td className="px-4 py-3 text-center font-mono font-bold">
                    {item.delay_days > 0 ? (
                      <span className="text-amber-700 font-bold">+{item.delay_days} days</span>
                    ) : item.delay_days < 0 ? (
                      <span className="text-emerald-700 font-semibold">{item.delay_days} days (Early)</span>
                    ) : (
                      <span className="text-slate-400">On Time</span>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3 text-center">
                    {item.status === 'completed' || item.status === 'delivered' ? (
                      <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 border border-emerald-200">
                        Delivered
                      </span>
                    ) : item.status === 'in_transit' ? (
                      <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase bg-sky-100 text-sky-800 border border-sky-200">
                        In-Transit
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase bg-amber-100 text-amber-800 border border-amber-200">
                        Pending PO
                      </span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      {item.type === 'po' && item.po_ref && (
                        <>
                          <button
                            onClick={() => {
                              if (!hasRole('planner')) {
                                showToast('Planner or Admin access required to edit POs.', 'error');
                                return;
                              }
                              setEditPo({ ...item.po_ref! });
                              setShowPoForm(true);
                            }}
                            className="p-1.5 text-slate-500 hover:text-sky-700 hover:bg-slate-100 rounded-md transition-all cursor-pointer"
                            title="Edit Purchase Order"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          {hasRole('planner') && (
                            <button
                              onClick={() => handleDeletePo(item.po_ref!.id)}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-all cursor-pointer"
                              title="Delete Purchase Order"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </>
                      )}
                      {item.type === 'shipment' && item.shipment_ref && (
                        <>
                          <button
                            onClick={() => {
                              if (!hasRole('planner')) {
                                showToast('Planner or Admin access required to edit shipments.', 'error');
                                return;
                              }
                              setEditShipment({ ...item.shipment_ref! });
                              setShowShipmentForm(true);
                            }}
                            className="p-1.5 text-slate-500 hover:text-sky-700 hover:bg-slate-100 rounded-md transition-all cursor-pointer"
                            title="Edit Shipment Details"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          {hasRole('planner') && (
                            <button
                              onClick={() => handleDeleteShipment(item.shipment_ref!.id)}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-all cursor-pointer"
                              title="Delete Shipment Log"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {sortedOrders.length === 0 && (
                <tr>
                  <td colSpan={10}>
                    <EmptyState
                      title="No Orders Found"
                      message="No purchase orders or shipments matched your search criteria."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </div>

      {/* PO Form Modal */}
      {showPoForm && editPo && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="po_form_title"
        >
          <div ref={poModalRef} className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h3 id="po_form_title" className="font-bold text-slate-900 text-sm">
                {editPo.id ? 'Edit Purchase Order' : 'Create Purchase Order'}
              </h3>
              <button
                onClick={() => setShowPoForm(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSavePo} className="p-6 space-y-4 text-xs font-medium text-slate-800">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-700 mb-1 font-semibold">PO Order Number</label>
                  <input aria-label="Order no"
                    type="text"
                    required
                    value={editPo.order_no}
                    onChange={(e) => setEditPo(p => ({ ...p!, order_no: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 mb-1 font-semibold">Sourcing Origin</label>
                  <select aria-label="Origin type"
                    value={editPo.origin_type || 'foreign'}
                    onChange={(e) => setEditPo(p => ({ ...p!, origin_type: e.target.value as any }))}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="local">Local Material (Direct Factory Delivery)</option>
                    <option value="foreign">Foreign Material (Import / Freight)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 mb-1 font-semibold">Material Item</label>
                <select aria-label="Material id"
                  value={editPo.material_id}
                  onChange={(e) => {
                    const matId = e.target.value;
                    const mat = materials.find(m => m.id === matId);
                    setEditPo(p => ({
                      ...p!,
                      material_id: matId,
                      origin_type: mat?.origin_type || p!.origin_type,
                      supplier_id: mat?.supplier_id || p!.supplier_id
                    }));
                  }}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
                >
                  {materials.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.sku}) [{m.origin_type === 'local' ? 'Local' : 'Foreign'}]
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-700 mb-1 font-semibold">Order Quantity</label>
                  <input aria-label="Qty"
                    type="number"
                    required
                    min={1}
                    value={editPo.qty}
                    onChange={(e) => setEditPo(p => ({ ...p!, qty: parseInt(e.target.value) || 0, remaining_qty: parseInt(e.target.value) || 0 }))}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 mb-1 font-semibold">PO Order Date</label>
                  <input aria-label="Po date"
                    type="date"
                    required
                    value={editPo.po_date}
                    onChange={(e) => setEditPo(p => ({ ...p!, po_date: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              {/* Delivery Dates: Original vs Revised */}
              <div className="p-3 bg-sky-50/50 rounded-lg border border-sky-100 space-y-3">
                <div className="font-bold text-sky-900 text-[11px] uppercase tracking-wider flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-sky-600" /> Delivery Target Commitment Dates
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-700 mb-1 font-semibold">Original Delivery Date</label>
                    <input aria-label="Original delivery date"
                      type="date"
                      required
                      value={editPo.original_delivery_date || editPo.required_date}
                      onChange={(e) => setEditPo(p => ({ ...p!, original_delivery_date: e.target.value, required_date: e.target.value }))}
                      className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-700 mb-1 font-semibold">Revised Delivery Date</label>
                    <input aria-label="Revised delivery date"
                      type="date"
                      value={editPo.revised_delivery_date || editPo.original_delivery_date || editPo.required_date}
                      onChange={(e) => setEditPo(p => ({ ...p!, revised_delivery_date: e.target.value }))}
                      className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowPoForm(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 font-medium text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-semibold text-xs shadow-sm"
                >
                  Save Purchase Order
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Shipment Form Modal */}
      {showShipmentForm && editShipment && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shipment_form_title"
        >
          <div ref={shipmentModalRef} className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h3 id="shipment_form_title" className="font-bold text-slate-900 text-sm">
                {editShipment.id ? 'Edit Shipment Tracking' : 'Log New Shipment'}
              </h3>
              <button
                onClick={() => setShowShipmentForm(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveShipment} className="p-6 space-y-4 text-xs font-medium text-slate-800">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-700 mb-1 font-semibold">Invoice # / Delivery Ref</label>
                  <input aria-label="Invoice no"
                    type="text"
                    required
                    value={editShipment.invoice_no}
                    onChange={(e) => setEditShipment(s => ({ ...s!, invoice_no: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 mb-1 font-semibold">Sourcing Type</label>
                  <select aria-label="Origin type"
                    value={editShipment.origin_type || 'foreign'}
                    onChange={(e) => {
                      const origin = e.target.value as 'local' | 'foreign';
                      setEditShipment(s => ({
                        ...s!,
                        origin_type: origin,
                        bl_no: origin === 'local' ? 'LOCAL-DELIVERY-NOTE' : s!.bl_no,
                        customs_clearance_days: origin === 'local' ? 0 : 5
                      }));
                    }}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="local">Local Material (Direct Delivery)</option>
                    <option value="foreign">Foreign Material (Sea/Air Logistics)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 mb-1 font-semibold">Material Item</label>
                <select aria-label="Material id"
                  value={editShipment.material_id}
                  onChange={(e) => setEditShipment(s => ({ ...s!, material_id: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
                >
                  {materials.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.sku})
                    </option>
                  ))}
                </select>
              </div>

              {editShipment.origin_type !== 'local' && (
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-slate-700 mb-1 font-semibold">Bill of Lading (BL #)</label>
                    <input aria-label="Bl no"
                      type="text"
                      value={editShipment.bl_no || ''}
                      onChange={(e) => setEditShipment(s => ({ ...s!, bl_no: e.target.value }))}
                      className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-700 mb-1 font-semibold">Port Name</label>
                    <input aria-label="Port name"
                      type="text"
                      value={editShipment.port_name || ''}
                      onChange={(e) => setEditShipment(s => ({ ...s!, port_name: e.target.value }))}
                      className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-700 mb-1 font-semibold">Customs Days</label>
                    <input aria-label="Customs clearance days"
                      type="number"
                      min={0}
                      value={editShipment.customs_clearance_days || 0}
                      onChange={(e) => setEditShipment(s => ({ ...s!, customs_clearance_days: parseInt(e.target.value) || 0 }))}
                      className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-mono"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-700 mb-1 font-semibold">Original Delivery Date</label>
                  <input aria-label="Original delivery date"
                    type="date"
                    value={editShipment.original_delivery_date || ''}
                    onChange={(e) => setEditShipment(s => ({ ...s!, original_delivery_date: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 mb-1 font-semibold">Revised Delivery Date</label>
                  <input aria-label="Revised delivery date"
                    type="date"
                    value={editShipment.revised_delivery_date || editShipment.original_delivery_date || ''}
                    onChange={(e) => setEditShipment(s => ({ ...s!, revised_delivery_date: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowShipmentForm(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 font-medium text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-semibold text-xs shadow-sm"
                >
                  Save Shipment Log
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
