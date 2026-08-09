import React, { useState, useMemo } from 'react';
import { 
  Calculator, CheckCircle2, AlertTriangle, AlertOctagon, 
  ArrowRight, RefreshCw, Layers, Box, Calendar, ShieldAlert,
  Sparkles, TrendingUp, Info
} from 'lucide-react';
import { getMaterials, getProducts, getBOMHeaders, getBOMSlots, getBOMOptions, getInventorySnapshots, getShipments, getPurchaseOrders } from '../supabaseClient';
import { Product, Material, BOMSlot, BOMOption } from '../types';
import ContentHeader from './ContentHeader';
import { CURRENCY } from '../utils/uom';
import ScrollableTable from './ScrollableTable';
import SKUSearchPicker from './SKUSearchPicker';

interface WhatIfSimulatorProps {
  searchQuery?: string;
  setSearchQuery?: (q: string) => void;
  onNavigate?: (screen: any) => void;
  refreshKey?: number;
}

interface SimulatedMaterialRequirement {
  slot_name: string;
  material_id: string;
  material_name: string;
  sku: string;
  qty_per_unit: number;
  scrap_percent: number;
  priority: number;
  unit: string;
  required_qty: number;
  on_hand_qty: number;
  in_transit_qty: number;
  total_available: number;
  net_balance: number;
  status: 'covered' | 'transit_covered' | 'shortage';
  max_producible_units: number;
  alternate_material?: {
    material_id: string;
    material_name: string;
    on_hand_qty: number;
  };
}

export default function WhatIfSimulator({ searchQuery = '', setSearchQuery, onNavigate, refreshKey }: WhatIfSimulatorProps) {
  const products = useMemo(() => getProducts(), [refreshKey]);
  const materials = useMemo(() => getMaterials(), [refreshKey]);
  const bomHeaders = useMemo(() => getBOMHeaders(), [refreshKey]);
  const bomSlots = useMemo(() => getBOMSlots(), [refreshKey]);
  const bomOptions = useMemo(() => getBOMOptions(), [refreshKey]);
  const inventory = useMemo(() => getInventorySnapshots(), [refreshKey]);
  const shipments = useMemo(() => getShipments(), [refreshKey]);
  const purchaseOrders = useMemo(() => getPurchaseOrders(), [refreshKey]);

  // Active selected product
  const [selectedProductId, setSelectedProductId] = useState<string>(products[0]?.id || '');
  // Target production quantity in PCS
  const [targetVolume, setTargetVolume] = useState<number>(50000);
  // Option to auto-use alternate materials if primary has shortage
  const [useAlternates, setUseAlternates] = useState<boolean>(true);
  // Stress Scenario 1: Supplier lead-time delay in days (0 to 30)
  const [supplierDelayDays, setSupplierDelayDays] = useState<number>(0);
  // Stress Scenario 2: Market demand surge percentage (0% to 50%)
  const [demandSurgePercent, setDemandSurgePercent] = useState<number>(0);

  const selectedProduct = useMemo(() => {
    return products.find(p => p.id === selectedProductId) || products[0];
  }, [products, selectedProductId]);

  const effectiveTargetVolume = useMemo(() => {
    return Math.round(targetVolume * (1 + demandSurgePercent / 100));
  }, [targetVolume, demandSurgePercent]);

  // Perform BOM Explosion & Material Availability Check
  const simulationResults = useMemo(() => {
    if (!selectedProduct) return { requirements: [], maxProducible: 0, bottleneckMaterial: null, totalCost: 0 };

    // Find active BOM for this product
    const bomHeader = bomHeaders.find(b => b.product_id === selectedProduct.id && b.is_active);
    if (!bomHeader) {
      return { requirements: [], maxProducible: 0, bottleneckMaterial: null, totalCost: 0 };
    }

    const slotsForBOM = bomSlots.filter(s => s.bom_id === bomHeader.id);
    const requirements: SimulatedMaterialRequirement[] = [];

    let minProducible = Infinity;
    let bottleneck: SimulatedMaterialRequirement | null = null;
    let totalEstMaterialCost = 0;

    slotsForBOM.forEach(slot => {
      // Find options for slot sorted by priority
      const optionsForSlot = bomOptions.filter(o => o.slot_id === slot.id).sort((a, b) => a.priority - b.priority);
      if (optionsForSlot.length === 0) return;

      const primaryOption = optionsForSlot[0];
      const altOption = optionsForSlot.find(o => o.priority > 1);

      const primaryMat = materials.find(m => m.id === primaryOption.material_id);
      if (!primaryMat) return;

      // On-hand stock
      const matInv = inventory.find(i => i.item_type === 'material' && i.item_id === primaryMat.id);
      const onHand = matInv ? matInv.quantity : 0;

      // In-transit stock (discounted if supplier lead-time delay is simulated > 14 days)
      const matShipments = shipments.filter(s => s.material_id === primaryMat.id);
      const rawTransitQty = matShipments.reduce((acc, s) => acc + (s.qty || 0), 0);
      const inTransitQty = supplierDelayDays > 14 ? Math.round(rawTransitQty * 0.5) : rawTransitQty;
      
      let totalAvail = onHand + inTransitQty;

      // Required qty for effective target volume
      const grossQtyPerUnit = primaryOption.qty_per_unit * (1 + primaryOption.scrap_percent / 100);
      const requiredQty = Math.ceil(effectiveTargetVolume * grossQtyPerUnit);

      // Check alternate material info if enabled and primary is short
      let altInfo;
      let altStockUsed = 0;

      if (altOption) {
        const altMat = materials.find(m => m.id === altOption.material_id);
        if (altMat) {
          const altInv = inventory.find(i => i.item_type === 'material' && i.item_id === altMat.id);
          const altOnHand = altInv ? altInv.quantity : 0;
          altInfo = {
            material_id: altMat.id,
            material_name: `${altMat.name} (${altMat.sku})`,
            on_hand_qty: altOnHand
          };

          if (useAlternates && totalAvail < requiredQty) {
            altStockUsed = altOnHand;
            totalAvail += altOnHand;
          }
        }
      }

      const netBalance = totalAvail - requiredQty;
      let status: 'covered' | 'transit_covered' | 'shortage' = 'covered';
      if (onHand >= requiredQty) {
        status = 'covered';
      } else if (totalAvail >= requiredQty) {
        status = 'transit_covered';
      } else {
        status = 'shortage';
      }

      // Max units that can be produced using this material
      const maxUnitsForThisMat = Math.floor(totalAvail / grossQtyPerUnit);
      if (maxUnitsForThisMat < minProducible) {
        minProducible = maxUnitsForThisMat;
      }

      const lineCost = requiredQty * (primaryMat.standard_cost || 0);
      totalEstMaterialCost += lineCost;

      const reqObj: SimulatedMaterialRequirement = {
        slot_name: slot.slot_name,
        material_id: primaryMat.id,
        material_name: primaryMat.name,
        sku: primaryMat.sku,
        qty_per_unit: primaryOption.qty_per_unit,
        scrap_percent: primaryOption.scrap_percent,
        priority: primaryOption.priority,
        unit: 'Units',
        required_qty: requiredQty,
        on_hand_qty: onHand,
        in_transit_qty: inTransitQty,
        total_available: totalAvail,
        net_balance: netBalance,
        status,
        max_producible_units: maxUnitsForThisMat,
        alternate_material: altInfo
      };

      requirements.push(reqObj);

      if (!bottleneck || reqObj.max_producible_units < bottleneck.max_producible_units) {
        bottleneck = reqObj;
      }
    });

    return {
      requirements,
      maxProducible: minProducible === Infinity ? 0 : minProducible,
      bottleneckMaterial: bottleneck,
      totalCost: totalEstMaterialCost
    };
  }, [selectedProduct, effectiveTargetVolume, supplierDelayDays, useAlternates, bomHeaders, bomSlots, bomOptions, materials, inventory, shipments]);

  const coverageRatio = useMemo(() => {
    if (effectiveTargetVolume <= 0) return 100;
    return Math.min(100, Math.round((simulationResults.maxProducible / effectiveTargetVolume) * 100));
  }, [simulationResults.maxProducible, effectiveTargetVolume]);

  return (
    <div className="space-y-6" id="what_if_simulator_screen">
      <ContentHeader
        title="What-If Production & Stress Scenario Simulator"
        subtitle="Simulate production feasibility, supplier lead-time delays, demand surges, and alternate material switches."
      />

      {/* Simulator Inputs Bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-sky-600" />
            <h3 className="font-semibold text-slate-900 text-sm">Simulation & Stress Parameters</h3>
          </div>
          <span className="text-xs text-slate-500 font-mono">Real-Time Multi-Constraint Engine</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
          {/* Target SKU Selection */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Select Finished Product (SKU & Name)
            </label>
            <SKUSearchPicker
              id="whatif_product_picker"
              products={products}
              selectedProductId={selectedProductId}
              onSelectProduct={setSelectedProductId}
              className="w-full"
            />
            {selectedProduct && (
              <p className="mt-1.5 text-[11px] text-slate-500 flex items-center gap-1.5">
                <Box className="w-3.5 h-3.5 text-slate-400" />
                Line: <span className="font-semibold text-slate-700">{selectedProduct.product_line}</span> | Pack: <span className="font-semibold text-slate-700">{selectedProduct.pack_type}</span>
              </p>
            )}
          </div>

          {/* Target Volume Slider + Input */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-slate-700">Target Volume</label>
              <span className="text-xs font-mono font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded border border-sky-200">
                {targetVolume.toLocaleString()} PCS
              </span>
            </div>
            <input aria-label="Target volume"
              type="range"
              min={5000}
              max={300000}
              step={5000}
              value={targetVolume}
              onChange={(e) => setTargetVolume(parseInt(e.target.value))}
              className="w-full accent-sky-600 cursor-pointer mt-2"
            />
            <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-1">
              <span>5k</span>
              <span>150k</span>
              <span>300k</span>
            </div>
          </div>

          {/* Stress Scenario 1: Supplier Lead Time Delay Slider */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-amber-800 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-amber-600" /> Supplier Transit Delay
              </label>
              <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${
                supplierDelayDays > 0 ? 'bg-amber-100 text-amber-900 border-amber-300' : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}>
                +{supplierDelayDays} Days
              </span>
            </div>
            <input aria-label="Supplier delay days"
              type="range"
              min={0}
              max={30}
              step={5}
              value={supplierDelayDays}
              onChange={(e) => setSupplierDelayDays(parseInt(e.target.value))}
              className="w-full accent-amber-600 cursor-pointer mt-2"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              {supplierDelayDays > 14 ? '⚠️ Heavy port delay: -50% in-transit availability' : 'Standard freight transit window'}
            </p>
          </div>

          {/* Stress Scenario 2: Demand Surge Slider */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-indigo-800 flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5 text-indigo-600" /> Market Demand Surge
              </label>
              <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${
                demandSurgePercent > 0 ? 'bg-indigo-100 text-indigo-900 border-indigo-300' : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}>
                +{demandSurgePercent}%
              </span>
            </div>
            <input aria-label="Demand surge percent"
              type="range"
              min={0}
              max={50}
              step={5}
              value={demandSurgePercent}
              onChange={(e) => setDemandSurgePercent(parseInt(e.target.value))}
              className="w-full accent-indigo-600 cursor-pointer mt-2"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              Effective Run: <b className="font-mono text-slate-800">{effectiveTargetVolume.toLocaleString()} PCS</b>
            </p>
          </div>
        </div>

        {/* Alternate Material Auto-Routing Toggle */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useAlternates}
              onChange={(e) => setUseAlternates(e.target.checked)}
              className="w-4 h-4 text-sky-600 rounded border-slate-300 focus:ring-sky-500 cursor-pointer"
            />
            <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              Auto-Route Deficits to Approved Priority 2 Alternate Materials
            </span>
          </label>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">Quick Volume:</span>
            {[25000, 50000, 100000, 200000].map((vol) => (
              <button
                key={vol}
                onClick={() => setTargetVolume(vol)}
                className={`px-2.5 py-0.5 text-xs font-medium rounded border transition-all ${
                  targetVolume === vol
                    ? 'bg-sky-600 text-white border-sky-600 font-semibold shadow-2xs'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {(vol / 1000).toFixed(0)}k PCS
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Cards Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Feasibility Summary */}
        <div className={`rounded-xl border p-4 transition-all shadow-sm ${
          coverageRatio >= 100 
            ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950' 
            : coverageRatio >= 60 
            ? 'bg-amber-50/70 border-amber-200 text-amber-950' 
            : 'bg-rose-50/70 border-rose-200 text-rose-950'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider opacity-80">Plan Feasibility</span>
            {coverageRatio >= 100 ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            ) : coverageRatio >= 60 ? (
              <AlertTriangle className="w-5 h-5 text-amber-600" />
            ) : (
              <AlertOctagon className="w-5 h-5 text-rose-600" />
            )}
          </div>
          <div className="text-2xl font-black font-mono">
            {coverageRatio}% <span className="text-xs font-normal">Covered</span>
          </div>
          <p className="text-xs mt-1 font-medium">
            {coverageRatio >= 100 
              ? 'Full raw material coverage available for target run.' 
              : `Can only fulfill ${coverageRatio}% of target volume.`}
          </p>
        </div>

        {/* Max Producible Units */}
        <div className="card-elevated p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Max Producible</span>
            <Sparkles className="w-4 h-4 text-sky-600" />
          </div>
          <div className="text-2xl font-black font-mono text-slate-900">
            {simulationResults.maxProducible.toLocaleString()} <span className="text-xs text-slate-500 font-normal">PCS</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Based on current stock & in-transit availability
          </p>
        </div>

        {/* Limiting Constraint / Bottleneck */}
        <div className="card-elevated p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Bottleneck Material</span>
            <ShieldAlert className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-sm font-bold text-slate-900 truncate">
            {simulationResults.bottleneckMaterial ? simulationResults.bottleneckMaterial.material_name : 'None'}
          </div>
          <p className="text-xs text-slate-500 mt-1 font-mono truncate">
            {simulationResults.bottleneckMaterial ? `Limits run to ${simulationResults.bottleneckMaterial.max_producible_units.toLocaleString()} PCS` : 'All materials sufficient'}
          </p>
        </div>

        {/* Est. Material Cost */}
        <div className="card-elevated p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 font-mono">Est. Material Cost</span>
            <TrendingUp className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-2xl font-black font-mono text-slate-900">
            ${simulationResults.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Direct BOM material requirement cost
          </p>
        </div>
      </div>

      {/* Material Breakdown Table */}
      <div className="card-elevated overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h4 className="font-semibold text-slate-900 text-sm">BOM Component Material Availability Breakdown</h4>
            <p className="text-xs text-slate-500">Detailed requirement vs stock & in-transit analysis for {selectedProduct?.name}</p>
          </div>
          <div className="flex items-center gap-3 text-xs font-medium">
            <span className="flex items-center gap-1.5 text-emerald-700 bg-emerald-50 px-2 py-1 rounded border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Stock Covered
            </span>
            <span className="flex items-center gap-1.5 text-sky-700 bg-sky-50 px-2 py-1 rounded border border-sky-200">
              <span className="w-2 h-2 rounded-full bg-sky-500"></span> In-Transit Covered
            </span>
            <span className="flex items-center gap-1.5 text-rose-700 bg-rose-50 px-2 py-1 rounded border border-rose-200">
              <span className="w-2 h-2 rounded-full bg-rose-500"></span> Shortage
            </span>
          </div>
        </div>

        <ScrollableTable>
          <table className="min-w-full divide-y divide-slate-200 text-left">
            <thead>
              <tr>
                <th className="px-4 py-3 text-left">BOM Slot</th>
                <th className="px-4 py-3 text-left">Component Material (Name & SKU)</th>
                <th className="px-4 py-3 text-right font-mono">Unit Qty & Scrap</th>
                <th className="px-4 py-3 text-right font-mono">Simulated Requirement</th>
                <th className="px-4 py-3 text-right font-mono">On-Hand Stock</th>
                <th className="px-4 py-3 text-right font-mono">In-Transit Qty</th>
                <th className="px-4 py-3 text-right font-mono">Net Balance</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right font-mono">Max Capacity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-800">
              {simulationResults.requirements.map((req, idx) => (
                <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-4 py-3 font-semibold text-slate-900">{req.slot_name}</td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{req.material_name}</div>
                    <div className="text-[11px] font-mono text-slate-500">{req.sku}</div>
                    {req.alternate_material && (
                      <div className="mt-1 text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 inline-block font-sans">
                        Alt Available: {req.alternate_material.material_name} ({req.alternate_material.on_hand_qty.toLocaleString()} stock)
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">
                    {req.qty_per_unit} <span className="text-[10px] text-slate-400">(+{req.scrap_percent}%)</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">
                    {req.required_qty.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-700">
                    {req.on_hand_qty.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sky-700">
                    +{req.in_transit_qty.toLocaleString()}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono font-bold ${
                    req.net_balance >= 0 ? 'text-emerald-600' : 'text-rose-600'
                  }`}>
                    {req.net_balance > 0 ? `+${req.net_balance.toLocaleString()}` : req.net_balance.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {req.status === 'covered' && (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Stock Covered
                      </span>
                    )}
                    {req.status === 'transit_covered' && (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-sky-100 text-sky-800 border border-sky-300 inline-flex items-center gap-1">
                        <Info className="w-3 h-3 text-sky-600" /> In-Transit Covered
                      </span>
                    )}
                    {req.status === 'shortage' && (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-300 inline-flex items-center gap-1">
                        <AlertOctagon className="w-3 h-3 text-rose-600" /> Shortage
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">
                    {req.max_producible_units.toLocaleString()} PCS
                  </td>
                </tr>
              ))}
              {simulationResults.requirements.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                    No active BOM defined for the selected product. Please define BOM structure in Master Data.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </div>
    </div>
  );
}
