/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useFirstLoad } from '../hooks/useFirstLoad';
import { 
  fetchTableData, saveRecord, deleteRecord, 
  getVBOMCostDetail, getVFGCost, createProductAndBOM 
} from '../supabaseClient';
import { Product, Material, BOMHeader, BOMSlot, BOMOption, VBOMCostDetail, VFGCost, UOMConversion } from '../types';
import { isUomCompatible, getConversionFactor, normalizeQuantity } from '../utils/uomNormalization';
import { Layers, Plus, Trash2, Edit2, CheckCircle, ArrowUp, ArrowDown, TrendingUp, Info, DollarSign, Package } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { useToast } from '../context/ToastConfirmContext';
import { useAuth } from '../context/AuthContext';
import { useFocusTrap } from '../hooks/useFocusTrap';
import SearchBar from './SearchBar';
import ContentHeader from './ContentHeader';
import ErrorState from './ErrorState';
import DataStateWrapper from './DataStateWrapper';
import SKUSearchPicker from './SKUSearchPicker';
import { toQuantity, toNumberInRange } from '../utils/number';

interface BOMEditorScreenProps {
  searchQuery?: string;
  setSearchQuery?: (val: string) => void;
  refreshKey?: number;
}

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
      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-100 text-slate-800 border border-slate-200 cursor-help hover:bg-brand-50 hover:border-brand-300 hover:text-brand-700 transition-colors">
        {uom || 'PCS'}
      </span>
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:flex flex-col z-50 w-56 p-2 bg-slate-900 text-white text-[10px] rounded-lg shadow-xl pointer-events-none">
        <div className="font-bold text-slate-200 border-b border-slate-700 pb-1 mb-1 flex items-center justify-between">
          <span>UOM Conversion Rule</span>
          <span className="text-[9px] font-mono text-brand-400">{uom}</span>
        </div>
        {matching.length > 0 ? (
          <div className="space-y-1 font-mono">
            {matching.map(c => (
              <div key={c.id} className="text-emerald-400 font-medium text-[10px]">
                1 {c.from_uom} = {c.conversion_factor.toLocaleString()} {c.to_uom}
                {c.description && <span className="text-slate-400 text-[8px] block font-sans italic">{c.description}</span>}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-slate-400 italic text-[9px]">
            Base unit. Standard 1:1 ratio.
          </div>
        )}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
      </div>
    </div>
  );
};

export default function BOMEditorScreen({
  searchQuery = '',
  setSearchQuery = () => {},
  refreshKey = 0,
}: BOMEditorScreenProps) {
  const { showToast, confirm: askConfirm } = useToast();
  const { hasRole } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('');

  // BOM relational items
  const [activeBomHeader, setActiveBomHeader] = useState<BOMHeader | null>(null);
  const [slots, setSlots] = useState<BOMSlot[]>([]);
  const [options, setOptions] = useState<BOMOption[]>([]);

  // Derived View States
  const [costDetails, setCostDetails] = useState<VBOMCostDetail[]>([]);
  const [fgCost, setFgCost] = useState<VFGCost | null>(null);

  const [loading, setLoading] = useState(true);
  const { isFirstLoad, markLoaded } = useFirstLoad('bom');

  const [error, setError] = useState<string | null>(null);

  // Form states
  const [showSlotModal, setShowSlotModal] = useState(false);
  const [newSlotName, setNewSlotName] = useState('');

  const [showNewSkuModal, setShowNewSkuModal] = useState(false);
  const [newSkuCode, setNewSkuCode] = useState('');
  const [newSkuName, setNewSkuName] = useState('');
  const [newSkuUom, setNewSkuUom] = useState('PCS');
  const [newSkuPrice, setNewSkuPrice] = useState(1.5);
  const [newSkuLine, setNewSkuLine] = useState('SOFY Line 1');

  const [showOptionModal, setShowOptionModal] = useState(false);
  const [selectedSlotForOption, setSelectedSlotForOption] = useState<string>('');
  const [newOptionMaterialId, setNewOptionMaterialId] = useState('');
  const [newOptionUom, setNewOptionUom] = useState('PCS');
  const [newOptionQty, setNewOptionQty] = useState(1.0);
  const [newOptionScrap, setNewOptionScrap] = useState(3.0);

  // Edit Qty/Scrap Inline State
  const [editingOptionId, setEditingOptionId] = useState<string>('');
  const [editingQty, setEditingQty] = useState(0);
  const [editingScrap, setEditingScrap] = useState(0);

  const [uomConversions, setUomConversions] = useState<UOMConversion[]>([]);

  const slotModalRef = useRef<HTMLDivElement>(null);
  const optionModalRef = useRef<HTMLDivElement>(null);
  const newSkuModalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(slotModalRef, showSlotModal, () => setShowSlotModal(false));
  useFocusTrap(optionModalRef, showOptionModal, () => setShowOptionModal(false));
  // The new-SKU dialog had semantics but no trap, unlike its two siblings.
  useFocusTrap(newSkuModalRef, showNewSkuModal, () => setShowNewSkuModal(false));

  async function loadInitialData() {
    try {
      const [prods, mats, uoms] = await Promise.all([
        fetchTableData<Product>('products'),
        fetchTableData<Material>('materials'),
        fetchTableData<UOMConversion>('uom_conversions')
      ]);
      setProducts(prods);
      setMaterials(mats);
      setUomConversions(uoms);
      if (prods.length > 0) {
        setSelectedProductId(prods[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      console.error("Failed to fetch initial products/materials for BOM", e);
    }
  }

  useEffect(() => {
    loadInitialData();
  }, [refreshKey]);

  // Reload BOM relational records whenever selectedProductId changes
  useEffect(() => {
    if (!selectedProductId) return;
    loadActiveBOM();
  }, [selectedProductId]);

  async function loadActiveBOM() {
    setLoading(true);
    setError(null);
    try {
      // Find headers
      const headers = await fetchTableData<BOMHeader>('bom_headers');
      let activeH = headers.find(h => h.product_id === selectedProductId && h.is_active);
      
      // If none active, show a placeholder BOM header so the user doesn't see
      // an empty screen. Only persist it for accounts that may write: this is
      // a *read* path fired by a useEffect on product selection, so persisting
      // unconditionally meant a read-only viewer silently created a
      // bom_headers row in the database just by browsing to a SKU.
      if (!activeH) {
        const fallbackHeader: BOMHeader = {
          id: `BH_AUTO_${selectedProductId}`,
          product_id: selectedProductId,
          description: `Auto-generated BOM for SKU`,
          is_active: true
        };
        activeH = hasRole('planner')
          ? await saveRecord<BOMHeader>('bom_headers', fallbackHeader)
          : fallbackHeader; // in-memory only for viewers
      }
      setActiveBomHeader(activeH);

      // Load slots and options
      const allSlots = await fetchTableData<BOMSlot>('bom_slots');
      const allOptions = await fetchTableData<BOMOption>('bom_options');

      const activeSlots = allSlots.filter(s => s.bom_id === activeH!.id);
      const activeSlotIds = activeSlots.map(s => s.id);
      const activeOptions = allOptions.filter(o => activeSlotIds.includes(o.slot_id));

      setSlots(activeSlots);
      setOptions(activeOptions);

      // Re-trigger view summaries
      await refreshSummaries();
    } catch (e) {
      console.error("Failed to load active BOM", e);
    } finally {
      setLoading(false);
      markLoaded();
    }
  }

  async function refreshSummaries() {
    if (!selectedProductId) return;
    const [cDetails, fCost] = await Promise.all([
      getVBOMCostDetail(selectedProductId),
      getVFGCost(selectedProductId)
    ]);
    setCostDetails(cDetails);
    setFgCost(fCost);
  }

  const openSlotModal = () => {
    if (!hasRole('planner')) {
      showToast('Your account is read-only - Planner or Admin access is required to add BOM slots.', 'error');
      return;
    }
    setShowSlotModal(true);
  };

  const handleCreateNewSkuAndBOM = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasRole('planner')) {
      showToast('Planner or Admin access is required to create new SKUs.', 'error');
      return;
    }
    if (!newSkuCode.trim() || !newSkuName.trim()) {
      showToast('Please enter both SKU code and Product Name.', 'error');
      return;
    }

    try {
      const { product } = await createProductAndBOM({
        sku: newSkuCode.trim().toUpperCase(),
        name: newSkuName.trim(),
        description: newSkuName.trim(),
        brand: 'SOFY',
        variant: 'Standard',
        group_id: 'grp_sofy',
        category_id: 'cat_pants',
        product_line: newSkuLine,
        pack_type: 'Standard',
        size: 'Medium',
        selling_price: newSkuPrice,
        standard_cost: 0,
        pcs_per_bag: 20,
        bags_per_carton: 4,
        status: 'running',
        uom: newSkuUom.trim().toUpperCase() || 'PCS'
      });

      setProducts(prev => [...prev, product]);
      setSelectedProductId(product.id);
      setShowNewSkuModal(false);
      setNewSkuCode('');
      setNewSkuName('');
      showToast(`Created new product SKU ${product.sku} and initialized BOM!`, 'success');
    } catch (err) {
      showToast('Failed to create product SKU.', 'error');
    }
  };

  const openOptionModal = (slotId: string) => {
    if (!hasRole('planner')) {
      showToast('Your account is read-only - Planner or Admin access is required to add BOM materials.', 'error');
      return;
    }
    setSelectedSlotForOption(slotId);
    setNewOptionMaterialId('');
    setNewOptionUom('PCS');
    setShowOptionModal(true);
  };

  // Action: Add Slot
  const handleAddSlot = async (e: React.FormEvent) => {
    if (!hasRole('planner')) {
      showToast('Your account is read-only - Planner or Admin access is required to add BOM slots.', 'error');
      return;
    }
    e.preventDefault();
    if (!activeBomHeader || !newSlotName.trim()) return;

    const newSlot: BOMSlot = {
      id: '',
      bom_id: activeBomHeader.id,
      slot_name: newSlotName.trim()
    };

    try {
      const saved = await saveRecord<BOMSlot>('bom_slots', newSlot);
      setSlots(prev => [...prev, saved]);
      setNewSlotName('');
      setShowSlotModal(false);
      showToast("Slot added successfully!", "success");
    } catch (err) {
      showToast("Failed to add slot.", "error");
    }
  };


  // Action: Add Option
  const handleAddOption = async (e: React.FormEvent) => {
    if (!hasRole('planner')) {
      showToast('Your account is read-only - Planner or Admin access is required to add BOM materials.', 'error');
      return;
    }
    e.preventDefault();
    if (!selectedSlotForOption || !newOptionMaterialId) {
      showToast('Please choose a material for this BOM slot.', 'error');
      return;
    }

    if (!newOptionUom || !newOptionUom.trim()) {
      showToast("Unit of Measure (UOM) is required. Please specify a unit.", "error");
      return;
    }

    const mat = materials.find(m => m.id === newOptionMaterialId);
    if (mat) {
      const matUom = mat.uom || 'PCS';
      const optUom = newOptionUom.trim().toUpperCase();
      if (!isUomCompatible(optUom, matUom, uomConversions, mat.sku)) {
        showToast(
          `UOM mismatch detected: Consumption unit "${optUom}" is incompatible with inventory master record unit "${matUom}". Please define a conversion factor in the Master Data module before saving.`,
          "error"
        );
        return;
      }
    }

    // Get current options for this slot to find priority
    const slotOpts = options.filter(o => o.slot_id === selectedSlotForOption);
    const maxPriority = slotOpts.reduce((max, o) => Math.max(max, o.priority), 0);

    const newOpt: BOMOption = {
      id: '',
      slot_id: selectedSlotForOption,
      material_id: newOptionMaterialId,
      qty_per_unit: newOptionQty,
      scrap_percent: newOptionScrap,
      priority: maxPriority + 1,
      uom: newOptionUom.trim().toUpperCase()
    };

    try {
      const saved = await saveRecord<BOMOption>('bom_options', newOpt);
      setOptions(prev => [...prev, saved]);
      setShowOptionModal(false);
      setNewOptionMaterialId('');
      setNewOptionQty(1.0);
      setNewOptionScrap(3.0);
      showToast("BOM Option saved!", "success");
      await refreshSummaries();
    } catch (err) {
      showToast("Failed to save BOM Option.", "error");
    }
  };


  // Action: Swap/Make Primary
  const handleMakePrimary = async (optionId: string, slotId: string) => {
    if (!hasRole('planner')) {
      showToast('Your account is read-only - Planner or Admin access is required to change the primary material.', 'error');
      return;
    }
    // Locate all options for this slot
    const slotOpts = options.filter(o => o.slot_id === slotId);
    const targetOpt = slotOpts.find(o => o.id === optionId);
    if (!targetOpt || targetOpt.priority === 1) return; // already primary

    // Increase priority of current primary to let this one take priority 1
    const currentPrimary = slotOpts.find(o => o.priority === 1);

    const updatedOptions = [...options];

    try {
      if (currentPrimary) {
        const uPrimary = { ...currentPrimary, priority: targetOpt.priority };
        const savedPrimary = await saveRecord<BOMOption>('bom_options', uPrimary);
        updatedOptions.map(o => o.id === savedPrimary.id ? savedPrimary : o);
      }

      const uTarget = { ...targetOpt, priority: 1 };
      const savedTarget = await saveRecord<BOMOption>('bom_options', uTarget);
      
      const finalOptions = updatedOptions.map(o => {
        if (o.id === savedTarget.id) return savedTarget;
        if (currentPrimary && o.id === currentPrimary.id) return { ...o, priority: targetOpt.priority };
        return o;
      });

      setOptions(finalOptions);
      showToast("Priority updated successfully!", "success");
      await refreshSummaries();
    } catch (err) {
      showToast("Failed to swap BOM priority.", "error");
    }
  };


  // Action: Save Inline Qty / Scrap edit
  const handleSaveInlineEdit = async (opt: BOMOption) => {
    if (!hasRole('planner')) {
      showToast('Your account is read-only - Planner or Admin access is required to edit BOM lines.', 'error');
      return;
    }
    const updated = { 
      ...opt, 
      qty_per_unit: toQuantity(editingQty), 
      scrap_percent: toNumberInRange(editingScrap, 0, 100) 
    };

    try {
      const saved = await saveRecord<BOMOption>('bom_options', updated);
      setOptions(prev => prev.map(o => o.id === opt.id ? saved : o));
      setEditingOptionId('');
      showToast("Option values updated!", "success");
      await refreshSummaries();
    } catch (err) {
      showToast("Failed to edit option values.", "error");
    }
  };


  // Action: Delete Option
  const handleDeleteOption = async (optionId: string) => {
    if (!hasRole('admin')) {
      showToast('Deleting records requires an Admin account.', 'error');
      return;
    }
    const isConfirmed = await askConfirm("Are you sure you want to remove this material option from the BOM?", "Delete Option");
    if (!isConfirmed) return;
    try {
      await deleteRecord('bom_options', optionId);
      setOptions(prev => prev.filter(o => o.id !== optionId));
      showToast("Option removed from BOM.", "success");
      await refreshSummaries();
    } catch (err) {
      showToast("Delete failed.", "error");
    }
  };

  // Action: Delete Slot
  const handleDeleteSlot = async (slotId: string) => {
    if (!hasRole('admin')) {
      showToast('Deleting records requires an Admin account.', 'error');
      return;
    }
    const isConfirmed = await askConfirm("Delete this slot and all of its associated material options?", "Delete Slot");
    if (!isConfirmed) return;
    try {
      // First delete associated options
      const assocOptions = options.filter(o => o.slot_id === slotId);
      for (const opt of assocOptions) {
        await deleteRecord('bom_options', opt.id);
      }
      await deleteRecord('bom_slots', slotId);

      setSlots(prev => prev.filter(s => s.id !== slotId));
      setOptions(prev => prev.filter(o => o.slot_id !== slotId));
      showToast("Slot and all associated options deleted.", "success");
      await refreshSummaries();
    } catch (err) {
      showToast("Delete slot failed.", "error");
    }
  };


  const selectedProduct = products.find(p => p.id === selectedProductId);

  const filteredSlots = useMemo(() => {
    return slots.filter(slot => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      if (slot.slot_name.toLowerCase().includes(q)) return true;
      const slotOpts = options.filter(o => o.slot_id === slot.id);
      return slotOpts.some(opt => {
        const mat = materials.find(m => m.id === opt.material_id);
        return mat && (mat.name.toLowerCase().includes(q) || mat.sku.toLowerCase().includes(q));
      });
    });
  }, [slots, searchQuery, options, materials]);

  return (
    <div className="space-y-6" id="bom_editor_screen">
      <ContentHeader
        title="BOM"
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <SearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search BOM components..."
              className="w-48"
            />
            <SKUSearchPicker
              id="bom_product_picker"
              products={products}
              selectedProductId={selectedProductId}
              onSelectProduct={setSelectedProductId}
            />
            <button
              id="btn_add_new_sku_bom"
              onClick={() => {
                if (!hasRole('planner')) {
                  showToast('Your account is read-only - Planner or Admin access is required.', 'error');
                  return;
                }
                setShowNewSkuModal(true);
              }}
              className="btn-base btn-teal gap-1 shadow-sm"
            >
              <Package className="w-3.5 h-3.5 text-white" />
              New SKU
            </button>
            <button
              id="btn_add_slot"
              onClick={openSlotModal}
              className="btn-base btn-emerald gap-1 shadow-sm"
            >
              <Plus className="w-3.5 h-3.5 text-white" />
              Add Slot
            </button>
          </div>
        }
      />

      <ErrorState error={error} onRetry={loadActiveBOM} />

      {(loading && isFirstLoad) ? (
        <div className="flex justify-center items-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main BOM List */}
          <div className="lg:col-span-2 space-y-4">
            {filteredSlots.length === 0 ? (
              <div className="p-12 text-center border-2 border-dashed border-slate-200 rounded-xl space-y-3">
                <Layers className="w-8 h-8 text-slate-400 mx-auto" />
                <h4 className="text-sm font-semibold text-slate-600">
                  {searchQuery ? 'No matching slots found' : 'No components slots created yet'}
                </h4>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  {searchQuery 
                    ? 'Try refining your search query or clear it to view all.' 
                    : 'Click "Add Slot" above to define structural positions like Top Sheet Surface, Core Absorbent, or Polybag.'}
                </p>
              </div>
            ) : (
              filteredSlots.map(slot => {
                const slotOpts = options.filter(o => o.slot_id === slot.id)
                  .sort((a, b) => a.priority - b.priority);

                return (
                  <div key={slot.id} className="card-elevated overflow-hidden">
                    {/* Slot Header */}
                    <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-brand-600" />
                        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">{slot.slot_name}</h3>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openOptionModal(slot.id)}
                          className="flex items-center gap-0.5 px-2 py-1 text-[10px] font-bold text-brand-600 hover:bg-brand-50 rounded-sm"
                        >
                          <Plus className="w-3 h-3" /> Add Material
                        </button>
                        <button
                          onClick={() => handleDeleteSlot(slot.id)}
                          className="p-1 text-slate-400 hover:text-red-600 rounded-sm hover:bg-red-50"
                          title="Delete entire slot"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Slot Material Options */}
                    <div className="divide-y divide-slate-100">
                      {slotOpts.map(opt => {
                        const mat = materials.find(m => m.id === opt.material_id);
                        const isPrimary = opt.priority === 1;
                        const isEditing = editingOptionId === opt.id;

                        // Lookup live cost calculation
                        const liveCost = costDetails.find(d => d.material_id === opt.material_id && d.slot_id === slot.id);

                        return (
                          <div key={opt.id} className={`p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 ${isPrimary ? 'bg-emerald-50/10' : ''}`}>
                            <div className="flex-1 space-y-1">
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm ${
                                  isPrimary ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                                }`}>
                                  {isPrimary ? 'Primary (MRP Active)' : 'Alternate'}
                                </span>
                                <span className="text-xs font-semibold text-slate-900">{mat ? mat.name : 'Unknown Material'}</span>
                                <span className="text-[10px] text-slate-400 font-mono font-medium">({mat ? mat.sku : ''})</span>
                                {mat?.uom && (
                                  <UOMBadgeWithTooltip uom={mat.uom} itemIdOrSku={mat.sku} conversions={uomConversions} />
                                )}
                              </div>
                              <div className="text-xs text-slate-500 font-sans">
                                Unit Standard Cost: <span className="font-semibold text-slate-700 font-mono">EGP {mat?.standard_cost.toFixed(3)}</span> 
                                {mat?.cost_basis === 'weighted_avg' && <span className="text-[10px] text-brand-500 font-medium"> (using Weighted-Avg PO)</span>}
                              </div>
                            </div>

                            {/* Qty & Scrap Inputs / Labels */}
                            <div className="flex items-center gap-4">
                              {isEditing ? (
                                <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200">
                                  <div className="w-20">
                                    <span className="block text-[9px] font-semibold uppercase text-slate-400 mb-0.5">Qty / Unit</span>
                                    <input aria-label="Editing qty" 
                                      type="number" 
                                      step="0.001" 
                                      value={editingQty} 
                                      onChange={e => setEditingQty(toQuantity(e.target.value))} 
                                      className="w-full p-1 text-xs font-mono border border-slate-300 rounded-md" 
                                    />
                                  </div>
                                  <div className="w-20">
                                    <span className="block text-[9px] font-semibold uppercase text-slate-400 mb-0.5">Scrap %</span>
                                    <input aria-label="Editing scrap" 
                                      type="number" 
                                      step="0.1" 
                                      value={editingScrap} 
                                      onChange={e => setEditingScrap(toQuantity(e.target.value))} 
                                      className="w-full p-1 text-xs font-mono border border-slate-300 rounded-md" 
                                    />
                                  </div>
                                  <button
                                    onClick={() => handleSaveInlineEdit(opt)}
                                    className="px-2 py-1 text-[10px] font-bold text-white bg-brand-600 rounded-md hover:bg-brand-700 self-end h-7"
                                  >
                                    Apply
                                  </button>
                                </div>
                              ) : (
                                <div className="text-right">
                                  <p className="text-xs text-slate-700">
                                    Qty: <span className="font-semibold font-mono">{opt.qty_per_unit}</span> <span className="text-[10px] font-mono font-medium text-slate-500">{mat?.uom || ''}</span>
                                  </p>
                                  <p className="text-[10px] text-slate-400">
                                    Scrap: <span className="font-semibold font-mono">{opt.scrap_percent}%</span>
                                  </p>
                                </div>
                              )}

                              <div className="text-right w-28">
                                <p className="text-xs font-semibold text-slate-900 font-mono">
                                  EGP {liveCost ? liveCost.line_cost.toFixed(4) : '0.0000'}
                                </p>
                                <p className="text-[9px] text-slate-400 uppercase tracking-wider">Line cost</p>
                              </div>

                              {/* Controls */}
                              <div className="flex items-center gap-1.5 border-l border-slate-100 pl-4">
                                {!isPrimary && (
                                  <button
                                    onClick={() => handleMakePrimary(opt.id, slot.id)}
                                    className="px-2 py-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 whitespace-nowrap"
                                  >
                                    Set Primary
                                  </button>
                                )}
                                {!isEditing && (
                                  <button
                                    onClick={() => {
                                      setEditingOptionId(opt.id);
                                      setEditingQty(opt.qty_per_unit);
                                      setEditingScrap(opt.scrap_percent);
                                    }}
                                    className="p-1 text-slate-400 hover:text-brand-600 rounded-sm hover:bg-slate-100"
                                    title="Edit qty/scrap"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  onClick={() => handleDeleteOption(opt.id)}
                                  className="p-1 text-slate-400 hover:text-red-600 rounded-sm hover:bg-red-50"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {slotOpts.length === 0 && (
                        <div className="p-4 text-center text-slate-400 text-xs">No material options assigned to this slot. Click "Add Material" above.</div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* BOM Financial Analyzer Sidebar */}
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-6">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-3 flex items-center gap-1.5">
                <DollarSign className="w-4 h-4 text-emerald-600" /> Live BOM Financials
              </h3>

              {fgCost ? (
                <div className="space-y-6">
                  {/* KPI cards inside sidebar */}
                  <div className="space-y-2">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Unit Selling Price</span>
                    <h4 className="text-xl font-bold text-slate-900 font-mono">EGP {fgCost.selling_price.toFixed(2)}</h4>
                  </div>

                  <div className="space-y-3 pt-3 border-t border-slate-100">
                    <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Material Cost Breakdown (Primary)</h4>
                    
                    {fgCost.total_material_cost > 0 && (
                      <div className="h-36 w-full my-1">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={[
                                { name: 'Raw Materials', value: fgCost.rm_cost, color: '#3b82f6' },
                                { name: 'Packaging', value: fgCost.pk_cost, color: '#f59e0b' },
                                { name: 'Consumables', value: fgCost.con_cost, color: '#10b981' },
                              ].filter(d => d.value > 0)}
                              cx="50%"
                              cy="50%"
                              innerRadius={30}
                              outerRadius={55}
                              paddingAngle={4}
                              dataKey="value"
                            >
                              {[
                                { name: 'Raw Materials', value: fgCost.rm_cost, color: '#3b82f6' },
                                { name: 'Packaging', value: fgCost.pk_cost, color: '#f59e0b' },
                                { name: 'Consumables', value: fgCost.con_cost, color: '#10b981' },
                              ].filter(d => d.value > 0).map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <RechartsTooltip
                              content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const item = payload[0];
                                return (
                                  <div className="bg-slate-900 text-white rounded px-2 py-1 text-[11px] shadow-lg">
                                    <p className="font-semibold">{item.name}</p>
                                    <p>EGP {Number(item.value).toFixed(4)}</p>
                                  </div>
                                );
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    <div className="space-y-1.5 text-xs text-slate-600 font-sans">
                      <div className="flex justify-between">
                        <span>Raw Materials (RM)</span>
                        <span className="font-mono font-medium">EGP {fgCost.rm_cost.toFixed(4)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Packaging (PK)</span>
                        <span className="font-mono font-medium">EGP {fgCost.pk_cost.toFixed(4)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Consumables (CON)</span>
                        <span className="font-mono font-medium">EGP {fgCost.con_cost.toFixed(4)}</span>
                      </div>
                      <div className="flex justify-between pt-2 border-t border-dashed border-slate-200 font-bold text-slate-900">
                        <span>Total COGS (Material)</span>
                        <span className="font-mono">EGP {fgCost.total_material_cost.toFixed(4)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-emerald-50/50 border border-emerald-100 rounded-lg p-4 space-y-2">
                    <h5 className="text-[10px] font-semibold text-emerald-800 uppercase tracking-wider flex items-center gap-1">
                      <TrendingUp className="w-3.5 h-3.5" /> Margin Analysis
                    </h5>
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs text-emerald-900">Contribution Margin:</span>
                      <span className="text-sm font-extrabold text-emerald-700 font-mono">EGP {fgCost.margin_per_unit.toFixed(2)}</span>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs text-emerald-900">Gross Margin %:</span>
                      <span className="text-sm font-extrabold text-emerald-700 font-mono">{fgCost.margin_percent.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400">Add primary material slots to evaluate contribution margin metrics.</p>
              )}
            </div>

            {/* Quick Tips Box */}
            <div className="bg-brand-50/50 border border-brand-100 p-4 rounded-xl text-xs text-brand-800 space-y-1.5">
              <h4 className="font-semibold flex items-center gap-1"><Info className="w-3.5 h-3.5" /> Plan alignment tip</h4>
              <p className="leading-relaxed">The MRP engine explodes weekly production quantities only using materials set to <b>"Primary"</b>. Alternate materials serve as a structural cost benchmark here.</p>
            </div>
          </div>
        </div>
      )}

      {/* Add Slot Modal */}
      {showSlotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs" ref={slotModalRef} role="dialog" aria-modal="true" aria-label="Add BOM slot">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden flex flex-col border border-slate-100">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Add New Component Slot</h3>
              <button onClick={() => setShowSlotModal(false)} className="text-slate-400 hover:text-slate-600 text-lg font-medium">&times;</button>
            </div>
            <form onSubmit={handleAddSlot} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">Slot Name</label>
                <input aria-label="Slot name"
                  type="text"
                  value={newSlotName}
                  onChange={e => setNewSlotName(e.target.value)}
                  placeholder="e.g. Back Sheet Surface, Elastic Leg Cuff"
                  required
                  className="w-full p-2 border border-slate-300 rounded-lg text-xs"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setShowSlotModal(false)} className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
                <button type="submit" className="px-3.5 py-1.5 text-xs font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-700">Add Slot</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Option Modal */}
      {showOptionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs" ref={optionModalRef} role="dialog" aria-modal="true" aria-label="Add BOM option">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden flex flex-col border border-slate-100">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Add Material Option to Slot</h3>
              <button onClick={() => setShowOptionModal(false)} className="text-slate-400 hover:text-slate-600 text-lg font-medium">&times;</button>
            </div>
            <form onSubmit={handleAddOption} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">Select Material</label>
                <select aria-label="Option material id"
                  value={newOptionMaterialId}
                  onChange={e => {
                    const id = e.target.value;
                    setNewOptionMaterialId(id);
                    const mat = materials.find(m => m.id === id);
                    if (mat && mat.uom) {
                      setNewOptionUom(mat.uom);
                    }
                  }}
                  required
                  className="w-full p-2 border border-slate-300 rounded-lg text-xs"
                >
                  <option value="">-- Choose Material --</option>
                  {materials.map(m => (
                    <option key={m.id} value={m.id}>{m.sku} - {m.name} ({m.uom || 'PCS'})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700">Qty Per Unit</label>
                  <input aria-label="Option qty"
                    type="number"
                    step="0.001"
                    value={newOptionQty}
                    onChange={e => setNewOptionQty(toQuantity(e.target.value))}
                    required
                    className="w-full p-2 border border-slate-300 rounded-lg text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    UOM <span className="text-red-500">*</span>
                  </label>
                  <input aria-label="Option uom"
                    type="text"
                    value={newOptionUom}
                    onChange={e => setNewOptionUom(e.target.value)}
                    placeholder="e.g. G, KG, PCS"
                    required
                    className="w-full p-2 border border-slate-300 rounded-lg text-xs font-mono uppercase"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700">Scrap %</label>
                  <input aria-label="Option scrap"
                    type="number"
                    step="0.1"
                    value={newOptionScrap}
                    onChange={e => setNewOptionScrap(toQuantity(e.target.value))}
                    required
                    className="w-full p-2 border border-slate-300 rounded-lg text-xs font-mono"
                  />
                </div>
              </div>
              {newOptionMaterialId && (
                <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                  <span className="font-semibold text-slate-700">Master Item UOM:</span>{' '}
                  <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-300 text-slate-800">
                    {materials.find(m => m.id === newOptionMaterialId)?.uom || 'PCS'}
                  </span>
                  {newOptionUom.trim().toUpperCase() !== (materials.find(m => m.id === newOptionMaterialId)?.uom || 'PCS') && (
                    <span className="block mt-1 text-brand-700">
                      💡 System will automatically convert <span className="font-mono font-semibold">{newOptionUom.trim().toUpperCase()}</span> to <span className="font-mono font-semibold">{materials.find(m => m.id === newOptionMaterialId)?.uom || 'PCS'}</span> via UOM conversion rules.
                    </span>
                  )}
                </div>
              )}
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setShowOptionModal(false)} className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
                <button type="submit" className="px-3.5 py-1.5 text-xs font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-700">Add Material</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* New SKU Modal */}
      {showNewSkuModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs" role="dialog" aria-modal="true" aria-label="Create new SKU">
          <div ref={newSkuModalRef} className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col border border-slate-100">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Package className="w-4 h-4 text-brand-600" />
                Add New Product SKU & BOM
              </h3>
              <button onClick={() => setShowNewSkuModal(false)} className="text-slate-400 hover:text-slate-600 text-lg font-medium cursor-pointer">&times;</button>
            </div>
            <form onSubmit={handleCreateNewSkuAndBOM} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700">SKU Code</label>
                  <input aria-label="Sku code"
                    type="text"
                    value={newSkuCode}
                    onChange={e => setNewSkuCode(e.target.value)}
                    placeholder="e.g. SF-PNT-XL-01"
                    required
                    className="w-full p-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700">Base UOM</label>
                  <input aria-label="Sku uom"
                    type="text"
                    value={newSkuUom}
                    onChange={e => setNewSkuUom(e.target.value)}
                    placeholder="e.g. PCS, Carton, Bag"
                    required
                    className="w-full p-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">Product Description / Name</label>
                <input aria-label="Sku name"
                  type="text"
                  value={newSkuName}
                  onChange={e => setNewSkuName(e.target.value)}
                  placeholder="e.g. SOFY Ultra Soft Pants XL 28s"
                  required
                  className="w-full p-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700">Machine Line</label>
                  <select aria-label="Sku line"
                    value={newSkuLine}
                    onChange={e => setNewSkuLine(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="SOFY Line 1">SOFY Line 1</option>
                    <option value="SOFY Line 2">SOFY Line 2</option>
                    <option value="VOXY Line 1">VOXY Line 1</option>
                    <option value="Atlas Line 1">Atlas Line 1</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700">Selling Price (EGP)</label>
                  <input aria-label="Sku price"
                    type="number"
                    step="0.01"
                    value={newSkuPrice}
                    onChange={e => setNewSkuPrice(toQuantity(e.target.value))}
                    required
                    className="w-full p-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="p-3 bg-brand-50 border border-brand-200 rounded-lg text-slate-700 text-[11px] leading-relaxed">
                ✨ Creating a new SKU will automatically generate an active BOM record so you can immediately begin slotting raw materials and packaging.
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setShowNewSkuModal(false)} className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer">
                  Cancel
                </button>
                <button type="submit" className="px-3.5 py-1.5 text-xs font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-700 cursor-pointer">
                  Create Product SKU & BOM
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
