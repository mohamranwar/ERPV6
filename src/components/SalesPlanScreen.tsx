/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { fetchTableData, saveRecord, getPlanningPeriod } from '../supabaseClient';
import { Product, Channel, SalesPlan, InventorySnapshot, ProductionPlan } from '../types';
import { RefreshCw, Save, Sparkles } from 'lucide-react';
import CsvImportHelper from './CsvImportHelper';
import { useToast } from '../context/ToastConfirmContext';
import { useAuth } from '../context/AuthContext';
import { useTableFilters } from '../hooks/useTableFilters';
import SearchBar from './SearchBar';
import ScrollableTable from './ScrollableTable';
import ContentHeader from './ContentHeader';
import { toCartons, toPieces, pcsPerCarton, formatQty, unitLabel, type QtyUnit } from '../utils/uom';
import ErrorState from './ErrorState';
import DataStateWrapper from './DataStateWrapper';

type GrainType = 'day' | 'week' | 'month';

interface SalesPlanScreenProps {
  searchQuery?: string;
  setSearchQuery?: (val: string) => void;
  refreshKey?: number;
}

export default function SalesPlanScreen({
  searchQuery = '',
  setSearchQuery = () => {},
  refreshKey = 0,
}: SalesPlanScreenProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [salesPlans, setSalesPlans] = useState<SalesPlan[]>([]);
  const [inventorySnapshots, setInventorySnapshots] = useState<InventorySnapshot[]>([]);
  const [productionPlans, setProductionPlans] = useState<ProductionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter conditions
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');

  /**
   * The unit the planner types in. Sales plans are stored in PIECES and stay
   * that way — this only changes what the grid shows and accepts, converting
   * on the way in and out. Nothing downstream (the BOM explosion, coverage,
   * MRP) sees cartons at all.
   */
  const [entryUnit, setEntryUnit] = useState<QtyUnit>('pcs');

  /** Stored pieces -> the value shown in the cell. */
  const toDisplayValue = (pieces: string, p: Product): string => {
    if (entryUnit === 'pcs' || pieces === '') return pieces;
    const ctn = toCartons(Number(pieces) || 0, p);
    if (ctn === null) return pieces;
    // Trailing zeros stripped so the cell reads "12.5" and "12", not "12.50".
    return String(parseFloat(ctn.toFixed(2)));
  };

  /** Typed value -> pieces for storage. */
  const fromDisplayValue = (shown: string, p: Product): string => {
    if (entryUnit === 'pcs' || shown === '') return shown;
    const pcs = toPieces(Number(shown) || 0, p);
    if (pcs === null) return shown;
    return String(Math.round(pcs));
  };
  const [selectedGrain, setSelectedGrain] = useState<GrainType>('month');

  // Define columns based on grain
  const [columns, setColumns] = useState<string[]>([]);

  // Local grid edits state to enable batch saves
  const [gridEdits, setGridEdits] = useState<Record<string, number>>({}); // "product_id:period_start" -> quantity

  const { showToast } = useToast();

  const { hasRole } = useAuth();

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [prods, chans, plans, snaps, prodsPlans] = await Promise.all([
        fetchTableData<Product>('products'),
        fetchTableData<Channel>('channels'),
        fetchTableData<SalesPlan>('sales_plan'),
        fetchTableData<InventorySnapshot>('inventory_snapshots'),
        fetchTableData<ProductionPlan>('production_plan')
      ]);
      setProducts(prods);
      setChannels(chans);
      setSalesPlans(plans);
      setInventorySnapshots(snaps);
      setProductionPlans(prodsPlans);

      // Default to "All Channels" (empty string)
      setSelectedChannelId('');
    } catch (e: any) {
      setError(e instanceof Error ? e.message : String(e));
      showToast("Sales demand tables failed to load: " + e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [refreshKey]);

  // Compute time columns based on active grain
  useEffect(() => {
    const today = new Date(getPlanningPeriod()); // grid window starts at the active period
    const cols: string[] = [];

    if (selectedGrain === 'month') {
      for (let i = 0; i < 4; i++) {
        const d = new Date(today);
        d.setMonth(today.getMonth() + i);
        cols.push(d.toISOString().slice(0, 7) + '-01'); // YYYY-MM-01
      }
    } else if (selectedGrain === 'week') {
      for (let i = 0; i < 6; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + (i * 7));
        cols.push(d.toISOString().slice(0, 10)); // YYYY-MM-DD
      }
    } else { // day
      for (let i = 0; i < 10; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        cols.push(d.toISOString().slice(0, 10));
      }
    }
    setColumns(cols);
    setGridEdits({}); // Clear pending edit states
  }, [selectedGrain]);

  // Helper to sequentially calculate simulated rolling ending stock and return suggested sales forecast
  const getSuggestedSales = (productId: string, targetColDate: string): number => {
    const snap = inventorySnapshots.find(i => i.item_type === 'product' && i.item_id === productId);
    let currentStock = snap ? snap.quantity : 15000;

    const defaultDemand = 50000;
    const safetyStock = Math.round(currentStock * 0.4 || defaultDemand);

    const sortedCols = [...columns].sort((a, b) => a.localeCompare(b));
    
    for (const col of sortedCols) {
      const prod = productionPlans.find(pr => pr.product_id === productId && pr.period_start === col);
      const prodQty = prod ? prod.quantity : 0;

      const editKey = `${productId}:${col}`;
      let salesQty = 0;
      if (gridEdits[editKey] !== undefined) {
        salesQty = gridEdits[editKey];
      } else {
        if (selectedChannelId) {
          const rec = salesPlans.find(s => 
            s.product_id === productId && 
            s.channel_id === selectedChannelId && 
            s.period_type === selectedGrain && 
            s.period_start === col
          );
          salesQty = rec ? rec.quantity : 0;
        } else {
          const recs = salesPlans.filter(s => 
            s.product_id === productId && 
            s.period_type === selectedGrain && 
            s.period_start === col
          );
          salesQty = recs.reduce((sum, r) => sum + r.quantity, 0);
        }
      }

      if (col === targetColDate) {
        return Math.max(0, Math.round(currentStock + prodQty - safetyStock));
      }

      currentStock = currentStock + prodQty - salesQty;
    }

    return 0;
  };

  const handleCellChange = (productId: string, colDate: string, value: string) => {
    const key = `${productId}:${colDate}`;
    setGridEdits(prev => ({
      ...prev,
      [key]: Number(value) || 0
    }));
  };

  const applySuggestion = (productId: string, colDate: string) => {
    const suggested = getSuggestedSales(productId, colDate);
    handleCellChange(productId, colDate, String(suggested));
    showToast(`Suggested stock flat-line target of ${suggested.toLocaleString()} applied!`, 'success');
  };

  const handleSaveGrid = async () => {
    if (!hasRole('planner')) {
      showToast('Your account is read-only - Planner or Admin access is required to save the demand plan.', 'error');
      return;
    }
    if (!selectedChannelId) {
      showToast("Cannot save changes when 'All Channels' is active. Please select a specific distribution channel.", "error");
      return;
    }
    const keys = Object.keys(gridEdits);
    if (keys.length === 0) return;

    setLoading(true);
    try {
      for (const key of keys) {
        const [productId, periodStart] = key.split(':');
        const quantity = gridEdits[key];

        const existing = salesPlans.find(s => 
          s.product_id === productId && 
          s.channel_id === selectedChannelId && 
          s.period_type === selectedGrain && 
          s.period_start === periodStart
        );

        const recordToSave: SalesPlan = {
          id: existing ? existing.id : `SP_REC_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          product_id: productId,
          channel_id: selectedChannelId,
          period_type: selectedGrain,
          period_start: periodStart,
          quantity: quantity
        };

        await saveRecord<SalesPlan>('sales_plan', recordToSave);
      }

      const updatedPlans = await fetchTableData<SalesPlan>('sales_plan');
      setSalesPlans(updatedPlans);
      setGridEdits({});
      showToast("Sales demand plans saved successfully!", "success");
    } catch (err: any) {
      showToast("Save failed: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleCsvImport = async (data: any[]) => {
    if (!hasRole('planner')) {
      showToast('Your account is read-only - Planner or Admin access is required to import demand plans.', 'error');
      return;
    }
    if (!selectedChannelId) {
      showToast("Import blocked: please select a distribution channel before uploading a CSV.", "error");
      return;
    }
    setLoading(true);
    try {
      for (const row of data) {
        const targetChannelId = row.channel_id || selectedChannelId;
        if (!targetChannelId) {
          throw new Error("No destination channel specified for imported records.");
        }
        const existing = salesPlans.find(s => 
          s.product_id === row.product_id && 
          s.channel_id === targetChannelId &&
          s.period_type === (row.period_type || selectedGrain) &&
          s.period_start === row.period_start
        );

        const finalRow: SalesPlan = {
          id: existing ? existing.id : `SP_REC_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          product_id: row.product_id,
          channel_id: targetChannelId,
          period_type: row.period_type || selectedGrain,
          period_start: row.period_start,
          quantity: Number(row.quantity || 0)
        };
        await saveRecord<SalesPlan>('sales_plan', finalRow);
      }
      await loadData();
      showToast(`Imported ${data.length} demand records successfully!`, "success");
    } catch (err: any) {
      showToast("Import failed: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  // Filter products using standard hook
  const { filtered: filteredProducts, hasActiveSearch } = useTableFilters<Product>(
    products,
    ['name', 'sku', 'brand'],
    {},
    searchQuery,
    setSearchQuery
  );

  const getCellValue = (productId: string, colDate: string): string => {
    const editKey = `${productId}:${colDate}`;
    if (gridEdits[editKey] !== undefined) {
      return String(gridEdits[editKey]);
    }

    if (!selectedChannelId) {
      const recs = salesPlans.filter(s => 
        s.product_id === productId && 
        s.period_type === selectedGrain && 
        s.period_start === colDate
      );
      const total = recs.reduce((sum, r) => sum + r.quantity, 0);
      return total > 0 ? String(total) : '0';
    }

    const rec = salesPlans.find(s => 
      s.product_id === productId && 
      s.channel_id === selectedChannelId && 
      s.period_type === selectedGrain && 
      s.period_start === colDate
    );

    return rec ? String(rec.quantity) : '';
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

  return (
    <div className="space-y-6" id="sales_plan_screen">
      <ContentHeader
        title="Sales Demand Forecast"
        actions={
          <div className="flex items-center gap-2.5">
            {selectedChannelId && (
              <CsvImportHelper 
                fields={[
                  { key: 'product_id', label: 'Product ID *', required: true },
                  { key: 'period_start', label: 'Period Start (YYYY-MM-DD) *', required: true },
                  { key: 'quantity', label: 'Qty *', required: true, defaultValue: 0 },
                  { key: 'channel_id', label: 'Channel ID (Optional)' },
                  { key: 'period_type', label: 'Grain (Optional: day/week/month)' }
                ]}
                onImport={handleCsvImport}
                title="Import Sales Plan"
              />
            )}
            <button
              id="btn_save_sales_grid"
              onClick={handleSaveGrid}
              disabled={Object.keys(gridEdits).length === 0 || !selectedChannelId}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xs cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              Save Changes ({Object.keys(gridEdits).length})
            </button>
          </div>
        }
      />

      <ErrorState error={error} onRetry={loadData} />

      {/* Control bar */}
      <div className="flex flex-wrap items-center gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200 font-sans">
        {/* Entry unit. Storage stays in pieces either way. */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Enter in</span>
          <div className="flex bg-white rounded-lg border border-slate-300 p-0.5">
            {(['pcs', 'cartons'] as QtyUnit[]).map(u => (
              <button
                key={u}
                onClick={() => setEntryUnit(u)}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-colors cursor-pointer ${
                  entryUnit === u ? 'bg-brand-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {unitLabel(u)}
              </button>
            ))}
          </div>
        </div>

        {/* Grain Switcher */}
        <div className="flex bg-white rounded-lg border border-slate-300 p-0.5" id="grain_toggle_container">
          {(['day', 'week', 'month'] as GrainType[]).map(grain => (
            <button
              key={grain}
              id={`grain_btn_${grain}`}
              onClick={() => setSelectedGrain(grain)}
              className={`px-3 py-1 text-xs font-bold capitalize rounded-md transition-all cursor-pointer ${
                selectedGrain === grain 
                  ? 'bg-blue-600 text-white shadow-xs' 
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {grain}
            </button>
          ))}
        </div>

        {/* Channel selection */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Channel:</span>
          <select aria-label="Select channel id"
            id="sales_channel_picker"
            value={selectedChannelId}
            onChange={(e) => { setSelectedChannelId(e.target.value); setGridEdits({}); }}
            className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-hidden font-bold text-slate-700 cursor-pointer"
          >
            <option value="">All Channels (Read-Only)</option>
            {channels.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Search */}
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Filter SKUs..."
          className="flex-1 min-w-[200px]"
          hasActiveSearch={hasActiveSearch}
        />

        <button onClick={loadData} aria-label="Refresh data" className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors cursor-pointer" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <div className="card-elevated overflow-hidden font-sans">
          <ScrollableTable>
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider sticky top-0">
                <tr>
                  <th className="px-4 py-3">Product / SKU</th>
                  <th className="px-4 py-3">Brand</th>
                  <th className="px-4 py-3">Machine</th>
                  {columns.map(col => (
                    <th key={col} className="px-4 py-3 text-right font-mono min-w-[150px]">
                      {formatHeader(col)}
                      <span className="block text-[9px] font-sans font-bold text-slate-400 normal-case tracking-normal">
                        entered in {unitLabel(entryUnit)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs text-slate-900">
                {filteredProducts.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{p.name}</div>
                      <div className="text-[11px] font-mono font-semibold text-indigo-700">{p.sku}</div>
                      {/* Pack configuration in the row itself, so the carton
                          figures beside it can be checked without leaving the
                          screen. Says so plainly when it is missing, since
                          cartons cannot be derived at all in that case. */}
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {pcsPerCarton(p) !== null
                          ? `${p.pcs_per_bag} × ${p.bags_per_carton} = ${pcsPerCarton(p)} PCS/CTN`
                          : 'No pack config — cartons unavailable'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{p.brand}</td>
                    <td className="px-4 py-3">
                      <span className="px-1.5 py-0.5 bg-slate-100 rounded-xs text-[10px] font-mono font-medium text-slate-600">
                        {p.product_line}
                      </span>
                    </td>
                    {columns.map(col => {
                      // Storage is always pieces. When the planner is working
                      // in cartons the cell shows and accepts cartons, and the
                      // conversion happens on the way in and out — the plan
                      // row itself never changes unit.
                      const piecesVal = getCellValue(p.id, col);
                      const cellVal = toDisplayValue(piecesVal, p);
                      const isBlank = piecesVal === '' || piecesVal === '0';
                      const suggestion = isBlank && selectedChannelId ? getSuggestedSales(p.id, col) : 0;
                      const piecesNum = Number(piecesVal) || 0;

                      return (
                        <td key={col} className="px-4 py-2 text-right">
                          <div className="flex flex-col items-end gap-1">
                            <input
                              type="number"
                              placeholder={suggestion > 0 ? String(toDisplayValue(String(suggestion), p)) : '0'}
                              // Per-cell label: a static one would announce every
                              // product x period intersection the same way.
                              aria-label={`Sales quantity for ${p.sku}, ${col}, in ${unitLabel(entryUnit)}`}
                              value={cellVal}
                              disabled={!selectedChannelId || (entryUnit === 'cartons' && pcsPerCarton(p) === null)}
                              onChange={(e) => handleCellChange(p.id, col, fromDisplayValue(e.target.value, p))}
                              className={`w-full text-right p-1.5 border border-transparent rounded-lg focus:outline-hidden font-bold font-mono text-xs ${
                                !selectedChannelId 
                                  ? 'bg-slate-100 text-slate-500 cursor-not-allowed' 
                                  : 'bg-slate-50/30 text-slate-800 hover:border-slate-200 focus:border-blue-500 focus:bg-white'
                              }`}
                            />
                            {/* The other reading, always visible: the figure
                                never has to be converted in someone's head to
                                be checked against a customer document. */}
                            {piecesNum > 0 && (
                              <span className="text-[9.5px] font-mono text-slate-400">
                                {entryUnit === 'pcs'
                                  ? (pcsPerCarton(p) !== null
                                      ? `${formatQty(piecesNum, p, 'cartons')} CTN`
                                      : 'no pack config')
                                  : `${formatQty(piecesNum, p, 'pcs')} PCS`}
                              </span>
                            )}
                            {!selectedChannelId && (
                              <span className="text-[8px] text-slate-400 font-medium">Aggregated</span>
                            )}
                            {selectedChannelId && isBlank && suggestion > 0 && (
                              <button
                                onClick={() => applySuggestion(p.id, col)}
                                className="text-[9px] text-blue-600 hover:text-blue-800 font-bold flex items-center gap-0.5 cursor-pointer"
                                title="Click to apply stock flat-line suggested demand value"
                              >
                                <Sparkles className="w-2.5 h-2.5 text-blue-500" />
                                {formatQty(suggestion, p, entryUnit)} {unitLabel(entryUnit)}
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        </div>
      )}
    </div>
  );
}
