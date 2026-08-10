/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useAsyncLoad, type LoadSignal } from '../hooks/useAsyncLoad';
import { getVMaterialCoverage, getVProductCoverage, getPlanningPeriod, formatPlanningPeriod } from '../supabaseClient';
import { VMaterialCoverage, VProductCoverage } from '../types';
import { Layers, Package, RefreshCw } from 'lucide-react';
import { useTableFilters } from '../hooks/useTableFilters';
import SearchBar from './SearchBar';
import ScrollableTable from './ScrollableTable';
import ContentHeader from './ContentHeader';
import DataStateWrapper from './DataStateWrapper';

const NEVER_CANCELLED: LoadSignal = { cancelled: false };


interface CoverageScreenProps {
  searchQuery?: string;
  setSearchQuery?: (val: string) => void;
  refreshKey?: number;
}

export default function CoverageScreen({
  searchQuery = '',
  setSearchQuery = () => {},
  refreshKey = 0,
}: CoverageScreenProps) {
  const [activeTab, setActiveTab] = useState<'materials' | 'products'>('materials');
  // Month name for the basis dropdown, so it cannot claim July while the
  // engine is reporting on another period.
  const periodLabel = formatPlanningPeriod(getPlanningPeriod()).split(' ')[0];
  const [materialCoverages, setMaterialCoverages] = useState<VMaterialCoverage[]>([]);
  const [productCoverages, setProductCoverages] = useState<VProductCoverage[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed load used to be swallowed into console.error, so the screen
  // rendered an empty table and a planner could not tell "the database is
  // unreachable" from "there is genuinely no coverage data".
  const [error, setError] = useState<string | null>(null);
  const [demandBasis, setDemandBasis] = useState<'forecast' | 'sales'>('forecast');

  async function loadData(signal: LoadSignal = NEVER_CANCELLED) {
    setLoading(true);
    setError(null);
    try {
      const [mCov, pCov] = await Promise.all([
        getVMaterialCoverage(demandBasis),
        getVProductCoverage(demandBasis)
      ]);
      if (signal.cancelled) return;
      setMaterialCoverages(mCov);
      setProductCoverages(pCov);
    } catch (e) {
      if (signal.cancelled) return;
      setError(e instanceof Error ? e.message : 'Failed to fetch inventory coverage details.');
    } finally {
      if (!signal.cancelled) setLoading(false);
    }
  }

  useAsyncLoad(loadData, [demandBasis, refreshKey]);

  const getCoverageRowColor = (months: number) => {
    if (months < 1.0) return 'bg-red-50 text-red-900 border-red-200'; // OOS
    if (months <= 2.0) return 'bg-amber-50 text-amber-950 border-amber-200'; // Amber warning
    if (months <= 3.0) return 'bg-emerald-50 text-emerald-950 border-emerald-200'; // Normal
    return 'bg-blue-50 text-blue-950 border-blue-200'; // Overstock
  };

  const getBadgeStyle = (months: number) => {
    if (months < 1.0) return 'bg-red-100 text-red-800 font-bold';
    if (months <= 2.0) return 'bg-amber-100 text-amber-800 font-bold';
    if (months <= 3.0) return 'bg-emerald-100 text-emerald-800 font-bold';
    return 'bg-blue-100 text-blue-800 font-bold';
  };

  // Filtration using useTableFilters hook
  const { filtered: filteredMaterials, hasActiveSearch: materialActiveSearch } = useTableFilters<VMaterialCoverage>(
    materialCoverages,
    ['material_name', 'sku', 'category_name'],
    {},
    searchQuery,
    setSearchQuery
  );

  const { filtered: filteredProducts, hasActiveSearch: productActiveSearch } = useTableFilters<VProductCoverage>(
    productCoverages,
    ['product_name', 'sku', 'product_line'],
    {},
    searchQuery,
    setSearchQuery
  );

  const activeSearch = activeTab === 'materials' ? materialActiveSearch : productActiveSearch;

  return (
    <div className="space-y-6" id="coverage_screen">
      <ContentHeader
        title="Stock Coverage Analysis"
        actions={
          <div className="flex items-center gap-1.5 bg-slate-100 p-0.5 rounded-lg" id="coverage_tabs_container">
            <button
              id="btn_cov_materials"
              onClick={() => { setActiveTab('materials'); setSearchQuery(''); }}
              className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'materials' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Materials Coverage
            </button>
            <button
              id="btn_cov_products"
              onClick={() => { setActiveTab('products'); setSearchQuery(''); }}
              className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'products' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              Finished Goods (SKUs)
            </button>
          </div>
        }
      />

      {/* The header and tab switcher stay mounted so the screen keeps its
          identity while data is loading, failing or empty. */}
      <DataStateWrapper
        loading={loading}
        error={error}
        isEmpty={!loading && !error && materialCoverages.length === 0 && productCoverages.length === 0}
        onRetry={loadData}
        emptyMessage="No coverage data for the selected period. Check that a sales or production plan exists for it."
      >

      {/* Legends, Demand Basis Selector & Search bar */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-center bg-slate-50 p-4 rounded-xl border border-slate-200">
        {/* Search */}
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={`Search ${activeTab}...`}
          className="lg:col-span-1"
          hasActiveSearch={activeSearch}
        />

        {/* Demand Basis Switcher */}
        <div className="flex items-center gap-1.5 lg:justify-center">
          <span className="text-[10px] font-bold text-slate-500 uppercase">Basis:</span>
          <select aria-label="Demand basis"
            value={demandBasis}
            onChange={(e) => setDemandBasis(e.target.value as 'forecast' | 'sales')}
            className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-700 font-bold focus:outline-hidden cursor-pointer"
          >
            <option value="forecast">Forecast-based ({periodLabel} Plan)</option>
            <option value="sales">Sales-based ({periodLabel} Actuals)</option>
          </select>
        </div>

        {/* Legend block */}
        <div className="lg:col-span-2 flex flex-wrap gap-1.5 lg:justify-end text-[10px] font-bold tracking-wider uppercase font-sans">
          <div className="flex items-center gap-1.5 px-2 py-1 bg-red-100 text-red-800 border border-red-200 rounded-md">
            <span>&lt; 1 Mo (OOS)</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-100 text-amber-800 border border-amber-200 rounded-md">
            <span>1-2 Mo (Warning)</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-md">
            <span>2-3 Mo (Optimal)</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 bg-blue-100 text-blue-800 border border-blue-200 rounded-md">
            <span>&gt; 3 Mo (Overstock)</span>
          </div>
          
          <button onClick={loadData} aria-label="Refresh data" className="p-1 hover:bg-slate-200 text-slate-500 rounded ml-2 cursor-pointer" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
          {activeTab === 'materials' ? (
            <div className="overflow-x-auto">
              <ScrollableTable>
                <table className="min-w-full text-left text-[11px] border-collapse">
                  <thead className="bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 border-r border-slate-200">Material (Name & SKU)</th>
                      <th className="px-3 py-2 border-r border-slate-200">Category</th>
                      <th className="px-3 py-2 border-r border-slate-200 text-right">Physical On-Hand Stock</th>
                      <th className="px-3 py-2 border-r border-slate-200 text-right">Average Monthly Demand</th>
                      <th className="px-3 py-2 border-r border-slate-200 text-right">On-Hand Coverage</th>
                      <th className="px-3 py-2 text-right font-bold">Total Coverage (With Cargo)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-900">
                    {filteredMaterials.map(m => {
                      const rowColor = getCoverageRowColor(m.coverage_months);

                      return (
                        <tr key={m.material_id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-3 py-2 border-r border-slate-200">
                            <div className="font-bold text-slate-900">{m.material_name}</div>
                            <div className="text-[10px] font-mono text-slate-500 font-medium">{m.sku}</div>
                          </td>
                          <td className="px-3 py-2 text-slate-500 border-r border-slate-200">{m.category_name}</td>
                          <td className="px-3 py-2 text-right font-semibold font-mono border-r border-slate-200">
                            {m.opening_stock.toLocaleString()}
                            <span className="text-[9px] text-slate-400 ms-1">{m.uom}</span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-500 border-r border-slate-200">
                            {m.monthly_demand > 0 ? (
                              <>
                                {m.monthly_demand.toLocaleString()}
                                <span className="text-[9px] text-slate-400 ms-1">{m.uom}</span>
                              </>
                            ) : (
                              <span className="text-slate-400 italic text-[10px]">no forecast</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right border-r border-slate-200">
                            <span className={`px-2 py-0.5 rounded-[4px] font-mono text-sm font-bold ${getBadgeStyle(m.coverage_months_no_transit)}`}>
                              {m.coverage_months_no_transit} mo
                            </span>
                          </td>
                          <td className={`px-3 py-2 text-right font-bold ${rowColor}`}>
                            <span className={`px-2 py-0.5 rounded-[4px] font-mono text-sm font-bold border ${
                              m.coverage_months < 1.0 ? 'border-red-300 bg-red-100 text-red-900' : 
                              m.coverage_months <= 2.0 ? 'border-amber-300 bg-amber-100 text-amber-900' :
                              m.coverage_months <= 3.0 ? 'border-emerald-300 bg-emerald-100 text-emerald-900' : 'border-blue-300 bg-blue-100 text-blue-900'
                            }`}>
                              {m.coverage_months} mo
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredMaterials.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-3 py-8 text-center text-slate-400 font-medium">
                          {searchQuery ? `No materials match "${searchQuery}".` : 'No material coverage data available.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </ScrollableTable>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <ScrollableTable>
                <table className="min-w-full text-left text-[11px] border-collapse">
                  <thead className="bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 border-r border-slate-200">Product (Name & SKU)</th>
                      <th className="px-3 py-2 border-r border-slate-200">Machine assignment</th>
                      <th className="px-3 py-2 border-r border-slate-200 text-right">Finished Goods Stock</th>
                      <th className="px-3 py-2 border-r border-slate-200 text-right">Average Sales Demand</th>
                      <th className="px-3 py-2 text-right font-bold">Finished Stock Coverage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-900">
                    {filteredProducts.map(p => {
                      const rowColor = getCoverageRowColor(p.coverage_months);

                      return (
                        <tr key={p.product_id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-3 py-2 border-r border-slate-200">
                            <div className="font-bold text-slate-900">{p.product_name}</div>
                            <div className="text-[10px] font-mono text-slate-500 font-medium">{p.sku}</div>
                          </td>
                          <td className="px-3 py-2 border-r border-slate-200">
                            <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 text-[9px] font-semibold uppercase font-mono rounded-[3px]">
                              {p.product_line}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-600 border-r border-slate-200">
                            {p.opening_stock.toLocaleString()}
                            <span className="text-[9px] text-slate-400 ms-1">{p.uom}</span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-400 border-r border-slate-200">
                            {p.monthly_demand.toLocaleString()}
                            <span className="text-[9px] text-slate-400 ms-1">{p.uom}</span>
                          </td>
                          <td className={`px-3 py-2 text-right font-bold ${rowColor}`}>
                            <span className={`px-2 py-0.5 rounded-[4px] font-mono text-sm font-bold border ${
                              p.coverage_months < 1.0 ? 'border-red-300 bg-red-100 text-red-900' : 
                              p.coverage_months <= 2.0 ? 'border-amber-300 bg-amber-100 text-amber-900' :
                              p.coverage_months <= 3.0 ? 'border-emerald-300 bg-emerald-100 text-emerald-900' : 'border-blue-300 bg-blue-100 text-blue-900'
                            }`}>
                              {p.coverage_months} mo
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredProducts.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-8 text-center text-slate-400 font-medium">
                          {searchQuery ? `No products match "${searchQuery}".` : 'No product coverage data available.'}
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
      </DataStateWrapper>
    </div>
  );
}
