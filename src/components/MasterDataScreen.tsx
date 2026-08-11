/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAsyncLoad, type LoadSignal } from '../hooks/useAsyncLoad';
import { 
  fetchTableData, saveRecord, deleteRecord 
} from '../supabaseClient';
import { Product, Material, Supplier, Machine, Channel, MaterialCategory, ProductCategory, ProductGroup, UOMConversion } from '../types';
import { Plus, Edit2, Trash2, RefreshCw, Layers, CheckSquare, Square, CheckCircle2, XCircle, X, Scale, Sparkles } from 'lucide-react';
import CsvImportHelper from './CsvImportHelper';
import { useToast } from '../context/ToastConfirmContext';
import { useAuth } from '../context/AuthContext';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useTableFilters } from '../hooks/useTableFilters';
import { useTableSort } from '../hooks/useTableSort';
import SortableHeader from './SortableHeader';
import SearchBar from './SearchBar';
import ScrollableTable from './ScrollableTable';
import ContentHeader from './ContentHeader';
import ErrorState from './ErrorState';
import DataStateWrapper from './DataStateWrapper';
import EmptyState from './EmptyState';

const NEVER_CANCELLED: LoadSignal = { cancelled: false };


type TabType = 'products' | 'materials' | 'suppliers' | 'machines' | 'channels' | 'uom_conversions';

const UOMBadgeWithTooltip: React.FC<{
  uom: string;
  itemIdOrSku?: string;
  conversions: UOMConversion[];
}> = ({ uom, itemIdOrSku, conversions }) => {
  const matching = conversions.filter(c => {
    const isUomMatch = c.from_uom.toLowerCase() === uom.toLowerCase() || c.to_uom.toLowerCase() === uom.toLowerCase();
    if (!isUomMatch) return false;
    if (c.item_type === 'global') return true;
    if (itemIdOrSku && c.item_id === itemIdOrSku) return true;
    return false;
  });

  return (
    <div className="relative group inline-block">
      <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-slate-100 text-slate-800 border border-slate-200 cursor-help transition-colors hover:bg-brand-50 hover:border-brand-300 hover:text-brand-700">
        {uom || 'PCS'}
      </span>
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex flex-col z-50 w-60 p-2.5 bg-slate-900 text-white text-[11px] rounded-lg shadow-xl pointer-events-none">
        <div className="font-bold text-slate-200 border-b border-slate-700 pb-1 mb-1 flex items-center justify-between">
          <span>Unit of Measure: {uom || 'PCS'}</span>
          <span className="text-[9px] font-mono text-brand-400">Master Rule</span>
        </div>
        {matching.length > 0 ? (
          <div className="space-y-1.5 font-mono">
            {matching.map(c => (
              <div key={c.id} className="text-emerald-400 font-medium text-[10px] bg-slate-800/80 p-1.5 rounded border border-slate-700">
                1 {c.from_uom} = {c.conversion_factor.toLocaleString()} {c.to_uom}
                {c.description && <span className="text-slate-300 text-[9px] block font-sans italic mt-0.5">{c.description}</span>}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-slate-400 italic text-[10px]">
            Base unit. No specific conversion rule defined in Master Data.
          </div>
        )}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
      </div>
    </div>
  );
};

interface MasterDataScreenProps {
  searchQuery?: string;
  setSearchQuery?: (val: string) => void;
  refreshKey?: number;
}

export default function MasterDataScreen({
  searchQuery = '',
  setSearchQuery = () => {},
  refreshKey = 0,
}: MasterDataScreenProps) {
  const { showToast, confirm: askConfirm } = useToast();
  const { hasRole } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('materials');
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data states
  const [products, setProducts] = useState<Product[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [matCats, setMatCats] = useState<MaterialCategory[]>([]);
  const [prodCats, setProdCats] = useState<ProductCategory[]>([]);
  const [prodGroups, setProdGroups] = useState<ProductGroup[]>([]);
  const [uomConversions, setUomConversions] = useState<UOMConversion[]>([]);

  // Categorical Filters (these are bypassed if active search is present)
  const [filterCategory, setFilterCategory] = useState('');
  const [filterGroup, setFilterGroup] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Row selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Editing forms state
  const [editItem, setEditItem] = useState<any | null>(null);
  const [showForm, setShowForm] = useState(false);

  // The master-data editor is the most consequential form in the app (it edits
  // uom_conversions, which drive every calculation) and had no focus
  // management at all: Tab escaped into the page behind it and Escape did
  // nothing.
  const editModalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(editModalRef, showForm, () => { setShowForm(false); setEditItem(null); });

  async function loadData(signal: LoadSignal = NEVER_CANCELLED) {
    setLoading(true);
    // Cleared on every attempt, otherwise a single failure leaves the banner
    // pinned to the screen even after a successful retry.
    setError(null);
    setSelectedIds(new Set());
    try {
      const [prods, mats, sups, macs, chans, mcats, pcats, pgrps, uoms] = await Promise.all([
        fetchTableData<Product>('products'),
        fetchTableData<Material>('materials'),
        fetchTableData<Supplier>('suppliers'),
        fetchTableData<Machine>('machines'),
        fetchTableData<Channel>('channels'),
        fetchTableData<MaterialCategory>('material_categories'),
        fetchTableData<ProductCategory>('product_categories'),
        fetchTableData<ProductGroup>('product_groups'),
        fetchTableData<UOMConversion>('uom_conversions')
      ]);
      if (signal.cancelled) return;
      setProducts(prods);
      setMaterials(mats);
      setSuppliers(sups);
      setMachines(macs);
      setChannels(chans);
      setMatCats(mcats);
      setProdCats(pcats);
      setProdGroups(pgrps);
      setUomConversions(uoms);
    } catch (e) {
      if (signal.cancelled) return;
      setError(e instanceof Error ? e.message : String(e));
      console.error("Failed to load master data tables", e);
    } finally {
      if (!signal.cancelled) { setLoading(false); setHasLoadedOnce(true); }
    }
  }

  useAsyncLoad(loadData, [refreshKey]);

  // Reset category filters and selection when switching tab
  useEffect(() => {
    setFilterCategory('');
    setFilterGroup('');
    setFilterStatus('');
    setSelectedIds(new Set());
  }, [activeTab]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = (items: { id: string }[]) => {
    if (selectedIds.size === items.length && items.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map(i => i.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (!hasRole('planner')) {
      showToast('Your account is read-only - Planner or Admin access is required.', 'error');
      return;
    }
    const count = selectedIds.size;
    if (count === 0) return;

    const confirmed = await askConfirm(`Are you sure you want to delete ${count} selected record(s)?`, `Delete ${count} Items`);
    if (!confirmed) return;

    try {
      const idsToDelete: string[] = Array.from(selectedIds);
      for (const id of idsToDelete) {
        await deleteRecord(activeTab as string, id);
      }
      showToast(`Successfully deleted ${count} record(s)`, 'success');
      setSelectedIds(new Set());
      await loadData();
    } catch (err: any) {
      showToast('Bulk delete failed: ' + err.message, 'error');
    }
  };

  const handleBulkStatusChange = async (newStatus: string) => {
    if (!hasRole('planner')) {
      showToast('Your account is read-only - Planner or Admin access is required.', 'error');
      return;
    }
    const count = selectedIds.size;
    if (count === 0) return;

    try {
      const idsToUpdate = Array.from(selectedIds);
      if (activeTab === 'materials') {
        for (const id of idsToUpdate) {
          const item = materials.find(m => m.id === id);
          if (item) await saveRecord('materials', { ...item, status: newStatus });
        }
      } else if (activeTab === 'products') {
        for (const id of idsToUpdate) {
          const item = products.find(p => p.id === id);
          if (item) await saveRecord('products', { ...item, status: newStatus });
        }
      } else if (activeTab === 'suppliers') {
        for (const id of idsToUpdate) {
          const item = suppliers.find(s => s.id === id);
          if (item) await saveRecord('suppliers', { ...item, status: newStatus });
        }
      } else if (activeTab === 'channels') {
        for (const id of idsToUpdate) {
          const item = channels.find(c => c.id === id);
          if (item) await saveRecord('channels', { ...item, status: newStatus });
        }
      }
      showToast(`Updated ${count} record(s) status to ${newStatus}`, 'success');
      setSelectedIds(new Set());
      await loadData();
    } catch (err: any) {
      showToast('Bulk status update failed: ' + err.message, 'error');
    }
  };

  const handleEdit = (item: any) => {
    if (!hasRole('planner')) {
      showToast('Your account is read-only - Planner or Admin access is required to edit records.', 'error');
      return;
    }
    setEditItem({ ...item });
    setShowForm(true);
  };

  const handleCreateNew = () => {
    if (!hasRole('planner')) {
      showToast('Your account is read-only - Planner or Admin access is required to add records.', 'error');
      return;
    }
    if (activeTab === 'products') {
      setEditItem({
        id: '', name: '', sku: '', description: '', group_id: prodGroups[0]?.id || '',
        category_id: prodCats[0]?.id || '', brand: '', variant: '', product_line: machines[0]?.name || 'Pants',
        pack_type: '', size: '', status: 'running', pcs_per_bag: 40, bags_per_carton: 4,
        selling_price: 15.0, standard_cost: 10.0, uom: 'PCS'
      });
    } else if (activeTab === 'materials') {
      const defaultSup = suppliers[0];
      setEditItem({
        id: '', name: '', sku: '', description: '', category_id: matCats[0]?.id || '',
        supplier_id: defaultSup?.id || '',
        supplier_lead_time_days: defaultSup?.default_lead_time_days || 15,
        transit_days: defaultSup?.default_transit_days || 10,
        customs_clearance_days: defaultSup?.default_customs_clearance_days || 5,
        safety_stock_months: 0, moq: 10000, max_usage: 1000, controller: 'Mohamed Amr',
        status: 'running', standard_cost: 1.0, cost_basis: 'standard', uom: 'KG'
      });
    } else if (activeTab === 'suppliers') {
      setEditItem({ id: '', name: '', default_lead_time_days: 15, default_transit_days: 10, default_customs_clearance_days: 5, status: 'active' });
    } else if (activeTab === 'machines') {
      setEditItem({ id: '', name: '', description: '' });
    } else if (activeTab === 'channels') {
      setEditItem({ id: '', name: '', status: 'active' });
    } else if (activeTab === 'uom_conversions') {
      setEditItem({ id: '', item_type: 'global', item_id: '', from_uom: 'KG', to_uom: 'Grams', conversion_factor: 1000, description: '' });
    }
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editItem) return;

    // Master data drives every downstream calculation - a viewer must not be
    // able to edit it. handleDelete already gated on 'admin'; this path was
    // left open, so a read-only account could still create or edit materials,
    // suppliers and (most damaging) uom_conversions, whose conversion_factor
    // feeds the BOM explosion and every cost and coverage figure.
    if (!hasRole('planner')) {
      showToast('Planner or Admin access is required to edit master data.', 'error');
      return;
    }

    if (activeTab === 'products' || activeTab === 'materials') {
      if (!editItem.uom || !String(editItem.uom).trim()) {
        showToast("Unit of Measure (UOM) is required. Please specify a unit.", "error");
        return;
      }
    } else if (activeTab === 'uom_conversions') {
      if (!editItem.from_uom || !String(editItem.from_uom).trim() || !editItem.to_uom || !String(editItem.to_uom).trim()) {
        showToast("Both 'From UOM' and 'To UOM' are required for conversion rules.", "error");
        return;
      }
      if (!editItem.conversion_factor || Number(editItem.conversion_factor) <= 0) {
        showToast("Conversion Factor must be greater than zero.", "error");
        return;
      }
    }

    if (activeTab === 'materials') {
      const tot = Number(editItem.supplier_lead_time_days || 0) + 
                  Number(editItem.transit_days || 0) + 
                  Number(editItem.customs_clearance_days || 0);
      editItem.total_lead_time_days = tot;
      editItem.reorder_point_days = Math.round(tot * 1.25);
    }

    try {
      const saved = await saveRecord<any>(activeTab, editItem);
      if (activeTab === 'products') {
        setProducts(prev => editItem.id ? prev.map(p => p.id === saved.id ? saved : p) : [...prev, saved]);
      } else if (activeTab === 'materials') {
        setMaterials(prev => editItem.id ? prev.map(m => m.id === saved.id ? saved : m) : [...prev, saved]);
      } else if (activeTab === 'suppliers') {
        setSuppliers(prev => editItem.id ? prev.map(s => s.id === saved.id ? saved : s) : [...prev, saved]);
      } else if (activeTab === 'machines') {
        setMachines(prev => editItem.id ? prev.map(m => m.id === saved.id ? saved : m) : [...prev, saved]);
      } else if (activeTab === 'channels') {
        setChannels(prev => editItem.id ? prev.map(c => c.id === saved.id ? saved : c) : [...prev, saved]);
      } else if (activeTab === 'uom_conversions') {
        setUomConversions(prev => editItem.id ? prev.map(u => u.id === saved.id ? saved : u) : [...prev, saved]);
      }
      setShowForm(false);
      setEditItem(null);
      showToast("Record saved successfully!", "success");
    } catch (err) {
      showToast("Error saving record. Check database setup.", "error");
    }
  };

  const handleDelete = async (id: string) => {
    if (!hasRole('admin')) {
      showToast('Only Admin accounts can delete master data records.', 'error');
      return;
    }
    const isConfirmed = await askConfirm("Are you sure you want to delete this master data item? This can affect related configurations.", "Delete Item");
    if (!isConfirmed) return;
    try {
      await deleteRecord(activeTab, id);
      if (activeTab === 'products') setProducts(prev => prev.filter(p => p.id !== id));
      else if (activeTab === 'materials') setMaterials(prev => prev.filter(m => m.id !== id));
      else if (activeTab === 'suppliers') setSuppliers(prev => prev.filter(s => s.id !== id));
      else if (activeTab === 'machines') setMachines(prev => prev.filter(m => m.id !== id));
      else if (activeTab === 'channels') setChannels(prev => prev.filter(c => c.id !== id));
      else if (activeTab === 'uom_conversions') setUomConversions(prev => prev.filter(u => u.id !== id));
      showToast("Record deleted.", "success");
    } catch (err) {
      showToast("Delete failed.", "error");
    }
  };

  const handleSupplierChangeInMaterialForm = (supId: string) => {
    const sup = suppliers.find(s => s.id === supId);
    if (sup) {
      setEditItem((prev: any) => ({
        ...prev,
        supplier_id: supId,
        supplier_lead_time_days: sup.default_lead_time_days,
        transit_days: sup.default_transit_days,
        customs_clearance_days: sup.default_customs_clearance_days
      }));
    }
  };

  const handleCsvImport = async (data: any[]) => {
    if (!hasRole('planner')) {
      showToast('Your account is read-only - Planner or Admin access is required to import records.', 'error');
      return;
    }
    try {
      setLoading(true);
      for (const row of data) {
        if (activeTab === 'materials') {
          const lead = Number(row.supplier_lead_time_days || 15);
          const transit = Number(row.transit_days || 10);
          const customs = Number(row.customs_clearance_days || 5);
          row.total_lead_time_days = lead + transit + customs;
          // Must match the manual "Save Material" path's multiplier (1.25) below -
          // these previously drifted (1.3 here vs 1.25 there), giving the same
          // material a different reorder point depending on how it was created.
          row.reorder_point_days = Math.round(row.total_lead_time_days * 1.25);
        }
        await saveRecord(activeTab, row);
      }
      await loadData();
      showToast(`Imported ${data.length} records successfully!`, "success");
    } catch (err: any) {
      showToast("Import error: " + err.message, "error");
    } finally {
      setLoading(false);
      setHasLoadedOnce(true);
    }
  };

  // Filtration logic utilizing useTableFilters hook
  const { filtered: filteredMaterials, hasActiveSearch: matActiveSearch } = useTableFilters<Material>(
    materials,
    ['name', 'sku', 'controller'],
    {},
    searchQuery,
    setSearchQuery,
    (m) => {
      // By-passed if search active
      if (searchQuery.trim() !== '') return true;
      const cMatch = filterCategory ? m.category_id === filterCategory : true;
      const stMatch = filterStatus ? m.status === filterStatus : true;
      return cMatch && stMatch;
    }
  );

  const { filtered: filteredProducts, hasActiveSearch: prodActiveSearch } = useTableFilters<Product>(
    products,
    ['name', 'sku'],
    {},
    searchQuery,
    setSearchQuery,
    (p) => {
      // By-passed if search active
      if (searchQuery.trim() !== '') return true;
      const cMatch = filterCategory ? p.category_id === filterCategory : true;
      const gMatch = filterGroup ? p.group_id === filterGroup : true;
      const stMatch = filterStatus ? p.status === filterStatus : true;
      return cMatch && gMatch && stMatch;
    }
  );

  const { filtered: filteredSuppliers } = useTableFilters<Supplier>(
    suppliers,
    ['name'],
    {},
    searchQuery,
    setSearchQuery
  );

  const { filtered: filteredMachines } = useTableFilters<Machine>(
    machines,
    ['name'],
    {},
    searchQuery,
    setSearchQuery
  );

  const { filtered: filteredChannels } = useTableFilters<Channel>(
    channels,
    ['name'],
    {},
    searchQuery,
    setSearchQuery
  );

  const { filtered: filteredUomConversions } = useTableFilters<UOMConversion>(
    uomConversions,
    ['from_uom', 'to_uom', 'description', 'item_id'],
    {},
    searchQuery,
    setSearchQuery
  );

  const { sortedItems: sortedMaterials, sortConfig: matSortConfig, handleSort: handleMatSort } = useTableSort(filteredMaterials, 'sku');
  const { sortedItems: sortedProducts, sortConfig: prodSortConfig, handleSort: handleProdSort } = useTableSort(filteredProducts, 'sku');
  const { sortedItems: sortedSuppliers, sortConfig: supSortConfig, handleSort: handleSupSort } = useTableSort(filteredSuppliers, 'name');
  const { sortedItems: sortedMachines, sortConfig: macSortConfig, handleSort: handleMacSort } = useTableSort(filteredMachines, 'name');
  const { sortedItems: sortedChannels, sortConfig: chanSortConfig, handleSort: handleChanSort } = useTableSort(filteredChannels, 'name');
  const { sortedItems: sortedUomConversions, sortConfig: uomSortConfig, handleSort: handleUomSort } = useTableSort(filteredUomConversions, 'from_uom');

  const hasAnyActiveSearch = matActiveSearch || prodActiveSearch;

  // Define CSV Import fields based on tab
  const getCsvImportFields = () => {
    if (activeTab === 'products') {
      return [
        { key: 'sku', label: 'SKU *', required: true },
        { key: 'name', label: 'Description/Name *', required: true },
        { key: 'brand', label: 'Brand/Group (e.g. BabyJoy)' },
        { key: 'variant', label: 'Variant' },
        { key: 'product_line', label: 'Machine/Line (e.g. Pants)', defaultValue: 'Pants' },
        { key: 'pack_type', label: 'Pack Type (e.g. Jumbo)' },
        { key: 'size', label: 'Size (e.g. Size 4)' },
        { key: 'uom', label: 'Base UOM (e.g. PCS, Carton)', defaultValue: 'PCS' },
        { key: 'pcs_per_bag', label: 'PCs per Bag', defaultValue: 40 },
        { key: 'bags_per_carton', label: 'Bags per Carton', defaultValue: 4 },
        { key: 'selling_price', label: 'Selling Price', defaultValue: 15.0 },
        { key: 'standard_cost', label: 'Standard Cost', defaultValue: 10.0 }
      ];
    } else if (activeTab === 'materials') {
      return [
        { key: 'sku', label: 'SKU *', required: true },
        { key: 'name', label: 'Material Name *', required: true },
        { key: 'uom', label: 'Base UOM (e.g. KG, SQM)', defaultValue: 'KG' },
        { key: 'supplier_lead_time_days', label: 'Supplier Lead Time Days', defaultValue: 15 },
        { key: 'transit_days', label: 'Transit Days', defaultValue: 10 },
        { key: 'customs_clearance_days', label: 'Customs Clearance Days', defaultValue: 5 },
        { key: 'safety_stock_months', label: 'Safety Stock Override (Months, 0 = auto)', defaultValue: 0 },
        { key: 'moq', label: 'MOQ Qty', defaultValue: 5000 },
        { key: 'max_usage', label: 'Max Daily Usage', defaultValue: 500 },
        { key: 'controller', label: 'Controller', defaultValue: 'Mohamed Amr' },
        { key: 'standard_cost', label: 'Standard Unit Cost', defaultValue: 1.0 }
      ];
    } else if (activeTab === 'uom_conversions') {
      return [
        { key: 'from_uom', label: 'From UOM *', required: true },
        { key: 'to_uom', label: 'To UOM *', required: true },
        { key: 'conversion_factor', label: 'Conversion Factor *', required: true, defaultValue: 1000 },
        { key: 'item_type', label: 'Scope (global, material, product)', defaultValue: 'global' },
        { key: 'description', label: 'Description' }
      ];
    }
    return [];
  };

  return (
    <div className="space-y-6" id="master_data_screen">
      <ContentHeader
        title="Master Data Management"
        actions={
          <div className="flex items-center gap-2">
            {!hasRole('planner') && (
              <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 border border-slate-200 rounded-full">
                Read-only
              </span>
            )}
            {hasRole('planner') && ['products', 'materials', 'suppliers', 'machines', 'channels', 'uom_conversions'].includes(activeTab) && getCsvImportFields().length > 0 && (
              <CsvImportHelper
                fields={getCsvImportFields()}
                onImport={handleCsvImport}
                title={`Import ${activeTab.toUpperCase()} from CSV`}
              />
            )}
            {hasRole('planner') && (
              <button
                id="btn_create_master_item"
                onClick={handleCreateNew}
                className="btn-base btn-emerald gap-1.5 shadow-sm"
              >
                <Plus className="w-4 h-4 text-white" />
                Add New Record
              </button>
            )}
          </div>
        }
      />

      <ErrorState error={error} onRetry={loadData} />

      {/* Tabs */}
      <div className="flex border-b border-slate-200 overflow-x-auto gap-2 scrollbar-none font-sans" id="master_data_tabs_container">
        {(['materials', 'products', 'uom_conversions', 'suppliers', 'machines', 'channels'] as TabType[]).map(tab => (
          <button
            key={tab}
            id={`tab_${tab}`}
            onClick={() => { setActiveTab(tab); setSearchQuery(''); }}
            className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider border-b-2 whitespace-nowrap transition-all focus:outline-hidden cursor-pointer ${
              activeTab === tab 
                ? 'border-brand-600 text-brand-600 font-bold bg-brand-50/20' 
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab === 'uom_conversions' ? 'UOM Conversions' : tab}
          </button>
        ))}
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200 font-sans">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={`Search ${activeTab} by name or SKU...`}
          className="flex-1 min-w-[240px]"
          hasActiveSearch={hasAnyActiveSearch}
        />

        {activeTab === 'products' && (
          <>
            <select aria-label="Filter by category"
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-hidden font-semibold text-slate-600 cursor-pointer"
            >
              <option value="">All Categories</option>
              {prodCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select aria-label="Filter by group"
              value={filterGroup}
              onChange={(e) => setFilterGroup(e.target.value)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-hidden font-semibold text-slate-600 cursor-pointer"
            >
              <option value="">All Brands/Groups</option>
              {prodGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </>
        )}

        {activeTab === 'materials' && (
          <select aria-label="Filter by category"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-hidden font-semibold text-slate-600 cursor-pointer"
          >
            <option value="">All Material Categories</option>
            {matCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}

        {['products', 'materials'].includes(activeTab) && (
          <select aria-label="Filter by status"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-hidden font-semibold text-slate-600 cursor-pointer"
          >
            <option value="">All Statuses</option>
            <option value="running">Running</option>
            <option value="obsolete">Obsolete</option>
          </select>
        )}

        <button 
          onClick={loadData} aria-label="Reload master tables"
          className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors cursor-pointer"
          title="Reload Master Tables"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Bulk Action Multi-Selection Toolbar */}
      {selectedIds.size > 0 && (
        <div className="bg-slate-900 text-white px-4 py-2.5 rounded-md flex flex-wrap items-center justify-between gap-3 shadow-md border border-slate-800 font-sans">
          <div className="flex items-center gap-2 text-xs font-bold">
            <span className="px-2 py-0.5 bg-brand-600 rounded text-[11px]">{selectedIds.size} Selected</span>
            <span className="text-slate-300">items ready for bulk modification</span>
          </div>

          <div className="flex items-center gap-2">
            {['products', 'materials', 'suppliers', 'channels'].includes(activeTab) && (
              <>
                <button
                  type="button"
                  onClick={() => handleBulkStatusChange('running')}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-emerald-400 bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-800 rounded transition-all cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Set Running / Active</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkStatusChange('obsolete')}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-amber-400 bg-amber-950/80 hover:bg-amber-900 border border-amber-800 rounded transition-all cursor-pointer"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Set Obsolete</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={handleBulkDelete}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-rose-400 bg-rose-950/80 hover:bg-rose-900 border border-rose-800 rounded transition-all cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete ({selectedIds.size})</span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 cursor-pointer"
              title="Clear selection"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {(loading && !hasLoadedOnce) ? (
        <div className="flex justify-center items-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600"></div>
        </div>
      ) : (
        <div className="bg-white border border-slate-300 rounded-md overflow-hidden shadow-2xs font-sans">
          {/* Dense, Professional Tables */}
          {activeTab === 'materials' && (
            <div className="overflow-x-auto">
              <ScrollableTable>
                <table className="min-w-full divide-y divide-slate-200 text-left">
                  <thead className="bg-slate-100 text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-2.5 text-center w-10">
                        <input
                          type="checkbox"
                          checked={selectedIds.size > 0 && selectedIds.size === sortedMaterials.length}
                          onChange={() => toggleSelectAll(sortedMaterials)}
                          className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                        />
                      </th>
                      <SortableHeader label="Material (Name & SKU)" sortKey="name" sortConfig={matSortConfig} onSort={handleMatSort} className="sticky-col-2 px-4 py-2.5" />
                      <SortableHeader label="Category" sortKey="category_id" sortConfig={matSortConfig} onSort={handleMatSort} className="px-4 py-2.5" />
                      <SortableHeader label="Base UOM" sortKey="uom" sortConfig={matSortConfig} onSort={handleMatSort} align="center" className="px-4 py-2.5" />
                      <th className="px-4 py-2.5">Lead Time (Legs)</th>
                      <SortableHeader label="Total LT" sortKey="total_lead_time_days" sortConfig={matSortConfig} onSort={handleMatSort} align="right" className="px-4 py-2.5" />
                      <SortableHeader label="SS (mo)" sortKey="safety_stock_months" sortConfig={matSortConfig} onSort={handleMatSort} align="right" className="px-4 py-2.5" />
                      <SortableHeader label="MOQ" sortKey="moq" sortConfig={matSortConfig} onSort={handleMatSort} align="right" className="px-4 py-2.5" />
                      <SortableHeader label="Std Cost" sortKey="standard_cost" sortConfig={matSortConfig} onSort={handleMatSort} align="right" className="px-4 py-2.5" />
                      <SortableHeader label="Basis" sortKey="cost_basis" sortConfig={matSortConfig} onSort={handleMatSort} className="px-4 py-2.5" />
                      <SortableHeader label="Status" sortKey="status" sortConfig={matSortConfig} onSort={handleMatSort} align="center" className="px-4 py-2.5" />
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs text-slate-900">
                    {sortedMaterials.map(m => {
                      const catName = matCats.find(c => c.id === m.category_id)?.name || 'Unknown';
                      const isSelected = selectedIds.has(m.id);
                      return (
                        <tr key={m.id} className={`transition-colors ${isSelected ? 'bg-brand-50/80' : 'hover:bg-slate-50'}`}>
                          <td className="px-3 py-2 text-center w-10">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(m.id)}
                              className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                            />
                          </td>
                          <td className="sticky-col-2 px-4 py-2.5">
                            <div className="font-bold text-slate-900">{m.name}</div>
                            <div className="text-[11px] font-mono text-slate-500 font-medium">{m.sku}</div>
                          </td>
                          <td className="px-4 py-2.5 text-slate-500 truncate max-w-[120px]">{catName}</td>
                          <td className="px-4 py-2.5 text-center">
                            <UOMBadgeWithTooltip uom={m.uom || 'KG'} itemIdOrSku={m.sku} conversions={uomConversions} />
                          </td>
                          <td className="px-4 py-2.5 font-mono text-slate-400">
                            {m.supplier_lead_time_days}d + {m.transit_days}d + {m.customs_clearance_days}d
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold font-mono">{m.total_lead_time_days}d</td>
                          <td className="px-4 py-2.5 text-right font-mono">
                            {m.safety_stock_months > 0
                              ? m.safety_stock_months
                              : <span className="text-slate-400 text-[10px] font-sans">auto</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono">{m.moq.toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-right font-mono font-semibold">EGP {m.standard_cost.toFixed(3)}</td>
                          <td className="px-4 py-2.5">
                            <span className={`px-1.5 py-0.5 rounded-[4px] text-[10px] font-semibold ${m.cost_basis === 'weighted_avg' ? 'bg-brand-50 text-brand-600' : 'bg-slate-50 text-slate-600'}`}>
                              {m.cost_basis}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${m.status === 'running' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                              {m.status}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right flex justify-end gap-1.5">
                            <button onClick={() => handleEdit(m)} className="p-1 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-sm cursor-pointer">
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleDelete(m.id)} className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-sm cursor-pointer">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {sortedMaterials.length === 0 && (
                      <tr>
                        <td colSpan={12} className="px-4 py-8">
                          <EmptyState
                            title="No Materials Found"
                            message="No raw materials match your search or filter criteria."
                            onAction={handleCreateNew}
                            actionLabel="Add Material"
                          />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </ScrollableTable>
            </div>
          )}

          {activeTab === 'products' && (
            <div className="overflow-x-auto">
              <ScrollableTable>
                <table className="min-w-full divide-y divide-slate-200 text-left">
                  <thead className="bg-slate-100 text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-2.5 text-center w-10">
                        <input
                          type="checkbox"
                          checked={selectedIds.size > 0 && selectedIds.size === sortedProducts.length}
                          onChange={() => toggleSelectAll(sortedProducts)}
                          className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                        />
                      </th>
                      <SortableHeader label="Product (Name & SKU)" sortKey="name" sortConfig={prodSortConfig} onSort={handleProdSort} className="sticky-col-2 px-4 py-2.5" />
                      <SortableHeader label="Brand/Group" sortKey="group_id" sortConfig={prodSortConfig} onSort={handleProdSort} className="px-4 py-2.5" />
                      <SortableHeader label="Machine/Line" sortKey="product_line" sortConfig={prodSortConfig} onSort={handleProdSort} className="px-4 py-2.5" />
                      <SortableHeader label="Base UOM" sortKey="uom" sortConfig={prodSortConfig} onSort={handleProdSort} align="center" className="px-4 py-2.5" />
                      <th className="px-4 py-2.5">Pack/Size</th>
                      <SortableHeader label="Selling Price" sortKey="selling_price" sortConfig={prodSortConfig} onSort={handleProdSort} align="right" className="px-4 py-2.5" />
                      <SortableHeader label="Standard Cost" sortKey="standard_cost" sortConfig={prodSortConfig} onSort={handleProdSort} align="right" className="px-4 py-2.5" />
                      <SortableHeader label="Pcs/Bag" sortKey="pcs_per_bag" sortConfig={prodSortConfig} onSort={handleProdSort} align="right" className="px-4 py-2.5" />
                      <SortableHeader label="Status" sortKey="status" sortConfig={prodSortConfig} onSort={handleProdSort} align="center" className="px-4 py-2.5" />
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs text-slate-900">
                    {sortedProducts.map(p => {
                      const grpName = prodGroups.find(g => g.id === p.group_id)?.name || 'Unknown';
                      const isSelected = selectedIds.has(p.id);
                      return (
                        <tr key={p.id} className={`transition-colors ${isSelected ? 'bg-brand-50/80' : 'hover:bg-slate-50'}`}>
                          <td className="px-3 py-2 text-center w-10">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(p.id)}
                              className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                            />
                          </td>
                          <td className="sticky-col-2 px-4 py-2.5">
                            <div className="font-bold text-slate-900">{p.name}</div>
                            <div className="text-[11px] font-mono text-slate-500 font-medium">{p.sku}</div>
                          </td>
                          <td className="px-4 py-2.5 text-slate-500">{grpName}</td>
                          <td className="px-4 py-2.5">
                            <span className="px-2 py-0.5 bg-slate-100 rounded-sm text-[10px] font-mono font-medium text-slate-700">
                              {p.product_line}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <UOMBadgeWithTooltip uom={p.uom || 'PCS'} itemIdOrSku={p.sku} conversions={uomConversions} />
                          </td>
                          <td className="px-4 py-2.5 text-slate-500">{p.pack_type} / {p.size}</td>
                          <td className="px-4 py-2.5 text-right font-mono font-semibold text-emerald-600">EGP {p.selling_price.toFixed(2)}</td>
                          <td className="px-4 py-2.5 text-right font-mono">EGP {p.standard_cost.toFixed(2)}</td>
                          <td className="px-4 py-2.5 text-right font-mono">{p.pcs_per_bag} pcs ({p.bags_per_carton} bags)</td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${p.status === 'running' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                              {p.status}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right flex justify-end gap-1.5">
                            <button onClick={() => handleEdit(p)} className="p-1 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-sm cursor-pointer">
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleDelete(p.id)} className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-sm cursor-pointer">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {sortedProducts.length === 0 && (
                      <tr>
                        <td colSpan={11} className="px-4 py-8">
                          <EmptyState
                            title="No Products Found"
                            message="No finished goods match your search or category filter criteria."
                            onAction={handleCreateNew}
                            actionLabel="Add Product"
                          />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </ScrollableTable>
            </div>
          )}

          {activeTab === 'uom_conversions' && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-brand-600" /> UOM Conversion Rules Engine
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Define mathematical ratios for converting consumption units to inventory base units across BOMs and MRP runs.
                  </p>
                </div>
                <button
                  onClick={handleCreateNew}
                  className="flex items-center gap-2 px-3.5 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-semibold text-xs shadow-xs transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> New Rule
                </button>
              </div>

              {sortedUomConversions.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-8">
                  <EmptyState
                    title="No UOM Conversions Found"
                    message="No UOM conversion rules match your search input."
                    onAction={handleCreateNew}
                    actionLabel="Add UOM Conversion"
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sortedUomConversions.map(u => {
                    const isSelected = selectedIds.has(u.id);
                    let scopeLabel = 'Global Default';
                    if (u.item_type === 'material') {
                      const mat = materials.find(m => m.id === u.item_id || m.sku === u.item_id);
                      scopeLabel = mat ? `Material: ${mat.sku} (${mat.name})` : `Material: ${u.item_id}`;
                    } else if (u.item_type === 'product') {
                      const prod = products.find(p => p.id === u.item_id || p.sku === u.item_id);
                      scopeLabel = prod ? `Product: ${prod.sku} (${prod.name})` : `Product: ${u.item_id}`;
                    }

                    return (
                      <div
                        key={u.id}
                        className={`bg-white border rounded-xl p-4 shadow-xs hover:shadow-md transition-all flex flex-col justify-between space-y-3 ${
                          isSelected ? 'border-brand-500 bg-brand-50/20' : 'border-slate-200'
                        }`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                                u.item_type === 'global'
                                  ? 'bg-brand-50 text-brand-700 border border-brand-200'
                                  : u.item_type === 'material'
                                  ? 'bg-purple-50 text-purple-700 border border-purple-200'
                                  : 'bg-amber-50 text-amber-700 border border-amber-200'
                              }`}
                            >
                              {scopeLabel}
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleEdit(u)}
                                className="p-1 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded cursor-pointer"
                                title="Edit Conversion Rule"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDelete(u.id)}
                                className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded cursor-pointer"
                                title="Delete Rule"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-center justify-between">
                            <div className="text-center flex-1">
                              <span className="block text-[10px] uppercase font-bold text-slate-400">From Unit</span>
                              <span className="font-mono font-bold text-sm text-slate-900">{u.from_uom}</span>
                            </div>
                            <div className="px-2 text-slate-400 text-xs font-mono font-bold">➔</div>
                            <div className="text-center flex-1">
                              <span className="block text-[10px] uppercase font-bold text-slate-400">To Unit</span>
                              <span className="font-mono font-bold text-sm text-slate-900">{u.to_uom}</span>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <span className="text-[10px] uppercase font-semibold text-slate-400">Conversion Formula</span>
                            <div className="font-mono text-xs font-bold text-brand-700 bg-brand-50/70 border border-brand-100 rounded-md px-2.5 py-1.5">
                              1 {u.from_uom} = {u.conversion_factor.toLocaleString()} {u.to_uom}
                            </div>
                          </div>

                          {u.description && (
                            <p className="text-[11px] text-slate-500 italic line-clamp-2">{u.description}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Fallback Tables for Suppliers, Machines, Channels */}
          {['suppliers', 'machines', 'channels'].includes(activeTab) && (
            <div className="overflow-x-auto">
              <ScrollableTable>
                <table className="min-w-full divide-y divide-slate-200 text-left">
                  <thead className="bg-slate-100 text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-2.5 text-center w-10">
                        <input
                          type="checkbox"
                          checked={selectedIds.size > 0 && selectedIds.size === (activeTab === 'suppliers' ? sortedSuppliers : activeTab === 'machines' ? sortedMachines : sortedChannels).length}
                          onChange={() => toggleSelectAll(activeTab === 'suppliers' ? sortedSuppliers : activeTab === 'machines' ? sortedMachines : sortedChannels)}
                          className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                        />
                      </th>
                      <SortableHeader label="ID" sortKey="id" sortConfig={activeTab === 'suppliers' ? supSortConfig : activeTab === 'machines' ? macSortConfig : chanSortConfig} onSort={activeTab === 'suppliers' ? handleSupSort : activeTab === 'machines' ? handleMacSort : handleChanSort} className="sticky-col-2 px-4 py-2.5" />
                      <SortableHeader label="Name / Description" sortKey="name" sortConfig={activeTab === 'suppliers' ? supSortConfig : activeTab === 'machines' ? macSortConfig : chanSortConfig} onSort={activeTab === 'suppliers' ? handleSupSort : activeTab === 'machines' ? handleMacSort : handleChanSort} className="px-4 py-2.5" />
                      {activeTab === 'suppliers' && (
                        <>
                          <SortableHeader label="Def. LT" sortKey="default_lead_time_days" sortConfig={supSortConfig} onSort={handleSupSort} align="right" className="px-4 py-2.5" />
                          <SortableHeader label="Def. Transit" sortKey="default_transit_days" sortConfig={supSortConfig} onSort={handleSupSort} align="right" className="px-4 py-2.5" />
                          <SortableHeader label="Def. Customs" sortKey="default_customs_clearance_days" sortConfig={supSortConfig} onSort={handleSupSort} align="right" className="px-4 py-2.5" />
                        </>
                      )}
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs text-slate-900">
                    {(activeTab === 'suppliers' ? sortedSuppliers : activeTab === 'machines' ? sortedMachines : sortedChannels).map((item: any) => {
                      const isSelected = selectedIds.has(item.id);
                      return (
                        <tr key={item.id} className={`transition-colors ${isSelected ? 'bg-brand-50/80' : 'hover:bg-slate-50'}`}>
                          <td className="px-3 py-2 text-center w-10">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(item.id)}
                              className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                            />
                          </td>
                          <td className="sticky-col-2 px-4 py-3 font-mono text-slate-500">{item.id}</td>
                          <td className="px-4 py-3">
                            <p className="font-semibold">{item.name}</p>
                            {item.description && <p className="text-[11px] text-slate-400 font-sans">{item.description}</p>}
                          </td>
                          {activeTab === 'suppliers' && (
                            <>
                              <td className="px-4 py-3 text-right font-mono">{item.default_lead_time_days} days</td>
                              <td className="px-4 py-3 text-right font-mono">{item.default_transit_days} days</td>
                              <td className="px-4 py-3 text-right font-mono">{item.default_customs_clearance_days} days</td>
                            </>
                          )}
                          <td className="px-4 py-3 text-right flex justify-end gap-1.5">
                            <button onClick={() => handleEdit(item)} className="p-1 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-sm cursor-pointer">
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleDelete(item.id)} className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-sm cursor-pointer">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {(activeTab === 'suppliers' ? sortedSuppliers : activeTab === 'machines' ? sortedMachines : sortedChannels).length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8">
                          <EmptyState
                            title={`No ${activeTab.toUpperCase()} Records`}
                            message={`No ${activeTab} match your filter or search input.`}
                            onAction={handleCreateNew}
                            actionLabel={`Add ${activeTab.slice(0, -1)}`}
                          />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </ScrollableTable>
            </div>
          )}
        </div>
      )}

      {/* Slide-over or modal editor for fields */}
      {showForm && editItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs font-sans" role="dialog" aria-modal="true" aria-label="Edit master data record">
          <div ref={editModalRef} className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col border border-slate-100">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="text-sm font-semibold text-slate-900">{editItem.id ? 'Edit' : 'Create New'} {activeTab.slice(0, -1).toUpperCase()}</h3>
              <button onClick={() => { setShowForm(false); setEditItem(null); }} className="text-slate-400 hover:text-slate-600 text-lg font-medium cursor-pointer">&times;</button>
            </div>

            <form onSubmit={handleSave} className="p-6 overflow-y-auto space-y-4 max-h-[75vh] text-xs">
              {activeTab === 'materials' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700">SKU Code</label>
                    <input aria-label="Sku" type="text" value={editItem.sku} onChange={e => setEditItem({ ...editItem, sku: e.target.value })} required className="w-full p-2 border border-slate-300 rounded-lg" />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700">Material Name</label>
                    <input aria-label="Name" type="text" value={editItem.name} onChange={e => setEditItem({ ...editItem, name: e.target.value })} required className="w-full p-2 border border-slate-300 rounded-lg" />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700">Category</label>
                    <select aria-label="Category id" value={editItem.category_id} onChange={e => setEditItem({ ...editItem, category_id: e.target.value })} required className="w-full p-2 border border-slate-300 rounded-lg bg-white">
                      {matCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700">Base Unit of Measure (UOM)</label>
                    <input aria-label="Uom" type="text" value={editItem.uom || 'KG'} onChange={e => setEditItem({ ...editItem, uom: e.target.value })} placeholder="e.g. KG, SQM, Meters, Roll, PCS" required className="w-full p-2 border border-slate-300 rounded-lg font-mono" />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700">Primary Supplier</label>
                    <select aria-label="Supplier id" value={editItem.supplier_id} onChange={e => handleSupplierChangeInMaterialForm(e.target.value)} required className="w-full p-2 border border-slate-300 rounded-lg bg-white">
                      {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>

                  {/* Three lead time legs */}
                  <div className="md:col-span-2 p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                    <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1"><Layers className="w-3.5 h-3.5" /> Replenishment Horizon (Lead-Time Legs)</h4>
                    <p className="text-[11px] text-slate-500">Expose distinct components of supplier-to-factory transport. Overrides defaults from supplier profile.</p>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600">Supplier Production (Days)</label>
                        <input aria-label="Supplier lead time days" type="number" value={editItem.supplier_lead_time_days} onChange={e => setEditItem({ ...editItem, supplier_lead_time_days: Number(e.target.value) })} className="w-full p-1.5 text-xs border border-slate-300 rounded-md font-mono" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600">Freight Transit (Days)</label>
                        <input aria-label="Transit days" type="number" value={editItem.transit_days} onChange={e => setEditItem({ ...editItem, transit_days: Number(e.target.value) })} className="w-full p-1.5 text-xs border border-slate-300 rounded-md font-mono" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600">Customs Clearance (Days)</label>
                        <input aria-label="Customs clearance days" type="number" value={editItem.customs_clearance_days} onChange={e => setEditItem({ ...editItem, customs_clearance_days: Number(e.target.value) })} className="w-full p-1.5 text-xs border border-slate-300 rounded-md font-mono" />
                      </div>
                    </div>
                    {/* Readonly summaries */}
                    <div className="pt-2 flex items-center gap-6 border-t border-slate-200 text-xs font-semibold">
                      <div>
                        <span className="text-slate-500">Total Horizon Days: </span>
                        <span className="font-mono text-brand-600 font-bold bg-brand-50 px-2 py-0.5 rounded-md">
                          {Number(editItem.supplier_lead_time_days || 0) + Number(editItem.transit_days || 0) + Number(editItem.customs_clearance_days || 0)} days
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500">Est. Reorder Point: </span>
                        <span className="font-mono text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md">
                          {Math.round((Number(editItem.supplier_lead_time_days || 0) + Number(editItem.transit_days || 0) + Number(editItem.customs_clearance_days || 0)) * 1.25)} days
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700">Safety Stock Override (Months)</label>
                    <input aria-label="Safety stock months" type="number" step="0.1" min="0" value={editItem.safety_stock_months} onChange={e => setEditItem({ ...editItem, safety_stock_months: Number(e.target.value) })} className="w-full p-2 border border-slate-300 rounded-lg" />
                    <p className="text-[10px] text-slate-400">Leave at 0 to size the buffer from lead time. Any value above 0 pins it to that many months of cover.</p>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700">Minimum Order Qty (MOQ)</label>
                    <input aria-label="Moq" type="number" value={editItem.moq} onChange={e => setEditItem({ ...editItem, moq: Number(e.target.value) })} className="w-full p-2 border border-slate-300 rounded-lg" />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700">Max Daily Usage</label>
                    <input aria-label="Max usage" type="number" value={editItem.max_usage} onChange={e => setEditItem({ ...editItem, max_usage: Number(e.target.value) })} className="w-full p-2 border border-slate-300 rounded-lg" />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700">Material Controller</label>
                    <input aria-label="Controller" type="text" value={editItem.controller} onChange={e => setEditItem({ ...editItem, controller: e.target.value })} className="w-full p-2 border border-slate-300 rounded-lg" />
                  </div>

                  {/* Cost configs */}
                  <div className="md:col-span-2 p-4 bg-slate-50 border border-slate-200 rounded-xl grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block text-xs font-semibold text-slate-700">Manual Standard Cost</label>
                      <input aria-label="Standard cost" type="number" step="0.001" value={editItem.standard_cost} onChange={e => setEditItem({ ...editItem, standard_cost: Number(e.target.value) })} className="w-full p-2 border border-slate-300 rounded-lg font-mono" />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs font-semibold text-slate-700">Costing Basis Toggle</label>
                      <div className="flex gap-2 pt-1">
                        {['standard', 'weighted_avg'].map(basis => (
                          <button
                            key={basis}
                            type="button"
                            onClick={() => setEditItem({ ...editItem, cost_basis: basis })}
                            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border uppercase tracking-wider cursor-pointer ${
                              editItem.cost_basis === basis 
                                ? 'bg-brand-600 border-brand-600 text-white font-bold' 
                                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold'
                            }`}
                          >
                            {basis === 'standard' ? 'Standard Cost' : 'Weighted Avg'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="md:col-span-2 text-xs text-slate-500 font-sans">
                      * Choose standard to use manual pricing, or weighted_avg to utilize the average from live PO invoices.
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700">Status</label>
                    <select aria-label="Status" value={editItem.status} onChange={e => setEditItem({ ...editItem, status: e.target.value })} className="w-full p-2 border border-slate-300 rounded-lg bg-white">
                      <option value="running">Running</option>
                      <option value="obsolete">Obsolete</option>
                    </select>
                  </div>
                </div>
              )}

              {activeTab === 'products' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700">SKU Code</label>
                    <input aria-label="Sku" type="text" value={editItem.sku} onChange={e => setEditItem({ ...editItem, sku: e.target.value })} required className="w-full p-2 border border-slate-300 rounded-lg" />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700">Description</label>
                    <input aria-label="Name" type="text" value={editItem.name} onChange={e => setEditItem({ ...editItem, name: e.target.value })} required className="w-full p-2 border border-slate-300 rounded-lg" />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700">Category</label>
                    <select aria-label="Category id" value={editItem.category_id} onChange={e => setEditItem({ ...editItem, category_id: e.target.value })} className="w-full p-2 border border-slate-300 rounded-lg bg-white">
                      {prodCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700">Brand Group</label>
                    <select aria-label="Group id" value={editItem.group_id} onChange={e => setEditItem({ ...editItem, group_id: e.target.value })} className="w-full p-2 border border-slate-300 rounded-lg bg-white">
                      {prodGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700">Machine Line (PPS)</label>
                    <select aria-label="Product line" value={editItem.product_line} onChange={e => setEditItem({ ...editItem, product_line: e.target.value })} className="w-full p-2 border border-slate-300 rounded-lg bg-white">
                      {machines.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700">Pack Type</label>
                    <input aria-label="Pack type" type="text" value={editItem.pack_type} onChange={e => setEditItem({ ...editItem, pack_type: e.target.value })} placeholder="Jumbo / Medium" className="w-full p-2 border border-slate-300 rounded-lg" />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700">Size</label>
                    <input aria-label="Size" type="text" value={editItem.size} onChange={e => setEditItem({ ...editItem, size: e.target.value })} placeholder="Size 4 / Normal" className="w-full p-2 border border-slate-300 rounded-lg" />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700">Base Unit of Measure (UOM)</label>
                    <input aria-label="Uom" type="text" value={editItem.uom || 'PCS'} onChange={e => setEditItem({ ...editItem, uom: e.target.value })} placeholder="e.g. PCS, Carton, Bag, Box" required className="w-full p-2 border border-slate-300 rounded-lg font-mono" />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700">Selling Price (EGP)</label>
                    <input aria-label="Selling price" type="number" step="0.01" value={editItem.selling_price} onChange={e => setEditItem({ ...editItem, selling_price: Number(e.target.value) })} className="w-full p-2 border border-slate-300 rounded-lg font-mono" />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700">Standard Cost (EGP)</label>
                    <input aria-label="Standard cost" type="number" step="0.01" value={editItem.standard_cost} onChange={e => setEditItem({ ...editItem, standard_cost: Number(e.target.value) })} className="w-full p-2 border border-slate-300 rounded-lg font-mono" />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700">Pcs Per Bag</label>
                    <input aria-label="Pcs per bag" type="number" value={editItem.pcs_per_bag} onChange={e => setEditItem({ ...editItem, pcs_per_bag: Number(e.target.value) })} className="w-full p-2 border border-slate-300 rounded-lg font-mono" />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700">Bags Per Carton</label>
                    <input aria-label="Bags per carton" type="number" value={editItem.bags_per_carton} onChange={e => setEditItem({ ...editItem, bags_per_carton: Number(e.target.value) })} className="w-full p-2 border border-slate-300 rounded-lg font-mono" />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700">Status</label>
                    <select aria-label="Status" value={editItem.status} onChange={e => setEditItem({ ...editItem, status: e.target.value })} className="w-full p-2 border border-slate-300 rounded-lg bg-white">
                      <option value="running">Running</option>
                      <option value="obsolete">Obsolete</option>
                    </select>
                  </div>
                </div>
              )}

              {activeTab === 'uom_conversions' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block text-xs font-semibold text-slate-700">Rule Scope</label>
                      <select aria-label="Item type"
                        value={editItem.item_type || 'global'}
                        onChange={e => setEditItem({ ...editItem, item_type: e.target.value, item_id: '' })}
                        className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="global">Global Default (All Items)</option>
                        <option value="material">Specific Raw Material</option>
                        <option value="product">Specific Finished Product</option>
                      </select>
                    </div>

                    {editItem.item_type === 'material' && (
                      <div className="space-y-1">
                        <label className="block text-xs font-semibold text-slate-700">Select Material</label>
                        <select aria-label="Item id"
                          value={editItem.item_id || ''}
                          onChange={e => setEditItem({ ...editItem, item_id: e.target.value })}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                          required
                        >
                          <option value="">-- Choose Material --</option>
                          {materials.map(m => (
                            <option key={m.id} value={m.sku}>{m.sku} - {m.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {editItem.item_type === 'product' && (
                      <div className="space-y-1">
                        <label className="block text-xs font-semibold text-slate-700">Select Product</label>
                        <select aria-label="Item id"
                          value={editItem.item_id || ''}
                          onChange={e => setEditItem({ ...editItem, item_id: e.target.value })}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                          required
                        >
                          <option value="">-- Choose Product --</option>
                          {products.map(p => (
                            <option key={p.id} value={p.sku}>{p.sku} - {p.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="space-y-1">
                      <label className="block text-xs font-semibold text-slate-700">From UOM (Base Unit)</label>
                      <input aria-label="From uom"
                        type="text"
                        value={editItem.from_uom || ''}
                        onChange={e => setEditItem({ ...editItem, from_uom: e.target.value })}
                        placeholder="e.g. KG, Carton, Roll"
                        required
                        className="w-full p-2 border border-slate-300 rounded-lg font-mono"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-semibold text-slate-700">To UOM (Target Unit)</label>
                      <input aria-label="To uom"
                        type="text"
                        value={editItem.to_uom || ''}
                        onChange={e => setEditItem({ ...editItem, to_uom: e.target.value })}
                        placeholder="e.g. Grams, PCS, Meters"
                        required
                        className="w-full p-2 border border-slate-300 rounded-lg font-mono"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-semibold text-slate-700">Conversion Factor</label>
                      <input aria-label="Conversion factor"
                        type="number"
                        step="any"
                        value={editItem.conversion_factor || 1}
                        onChange={e => setEditItem({ ...editItem, conversion_factor: Number(e.target.value) })}
                        required
                        className="w-full p-2 border border-slate-300 rounded-lg font-mono"
                      />
                    </div>

                    <div className="space-y-1 md:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700">Description / Note</label>
                      <input aria-label="Description"
                        type="text"
                        value={editItem.description || ''}
                        onChange={e => setEditItem({ ...editItem, description: e.target.value })}
                        placeholder="e.g. Standard ratio 1 KG = 1,000 Grams"
                        className="w-full p-2 border border-slate-300 rounded-lg"
                      />
                    </div>

                    <div className="md:col-span-2 p-3 bg-brand-50 border border-brand-200 rounded-lg flex items-center justify-between font-mono text-xs text-brand-900">
                      <span className="font-semibold text-brand-700">Formula Live Preview:</span>
                      <span className="font-bold bg-white px-3 py-1 rounded border border-brand-200">
                        1 {editItem.from_uom || 'FROM'} = {Number(editItem.conversion_factor || 1).toLocaleString()} {editItem.to_uom || 'TO'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {['suppliers', 'machines', 'channels'].includes(activeTab) && (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700">Name</label>
                    <input aria-label="Name" type="text" value={editItem.name} onChange={e => setEditItem({ ...editItem, name: e.target.value })} required className="w-full p-2 border border-slate-300 rounded-lg" />
                  </div>
                  {activeTab === 'machines' && (
                    <div className="space-y-1">
                      <label className="block text-xs font-semibold text-slate-700">Description</label>
                      <input aria-label="Description" type="text" value={editItem.description} onChange={e => setEditItem({ ...editItem, description: e.target.value })} className="w-full p-2 border border-slate-300 rounded-lg" />
                    </div>
                  )}
                  {activeTab === 'suppliers' && (
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] text-slate-600 font-medium">Default Lead Time</label>
                        <input aria-label="Default lead time days" type="number" value={editItem.default_lead_time_days} onChange={e => setEditItem({ ...editItem, default_lead_time_days: Number(e.target.value) })} className="w-full p-2 border border-slate-300 rounded-lg" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 font-medium">Default Transit</label>
                        <input aria-label="Default transit days" type="number" value={editItem.default_transit_days} onChange={e => setEditItem({ ...editItem, default_transit_days: Number(e.target.value) })} className="w-full p-2 border border-slate-300 rounded-lg" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 font-medium">Default Customs</label>
                        <input aria-label="Default customs clearance days" type="number" value={editItem.default_customs_clearance_days} onChange={e => setEditItem({ ...editItem, default_customs_clearance_days: Number(e.target.value) })} className="w-full p-2 border border-slate-300 rounded-lg" />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 bg-slate-50 px-6 py-4 -mx-6 -mb-6 rounded-b-xl">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setEditItem(null); }}
                  className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  id="btn_submit_master_form"
                  type="submit"
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-700 cursor-pointer"
                >
                  Save Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
