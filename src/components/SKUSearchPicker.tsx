/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Product } from '../types';
import { Search, ChevronDown, Check, X, Box } from 'lucide-react';

interface SKUSearchPickerProps {
  id?: string;
  products: Product[];
  selectedProductId: string;
  onSelectProduct: (productId: string) => void;
  className?: string;
  placeholder?: string;
}

export default function SKUSearchPicker({
  id = 'bom_product_picker',
  products,
  selectedProductId,
  onSelectProduct,
  className = '',
  placeholder = 'Search SKU Code or Name...'
}: SKUSearchPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedProduct = useMemo(
    () => products.find(p => p.id === selectedProductId),
    [products, selectedProductId]
  );

  // Filter products by SKU code or product name
  const filteredProducts = useMemo(() => {
    if (!searchTerm.trim()) return products;
    const term = searchTerm.toLowerCase().trim();
    return products.filter(p => 
      p.sku.toLowerCase().includes(term) ||
      p.name.toLowerCase().includes(term) ||
      (p.brand && p.brand.toLowerCase().includes(term)) ||
      (p.product_line && p.product_line.toLowerCase().includes(term))
    );
  }, [products, searchTerm]);

  // Handle outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto focus search input when opened
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const handleSelect = (productId: string) => {
    onSelectProduct(productId);
    setIsOpen(false);
    setSearchTerm('');
  };

  return (
    <div className={`relative inline-block ${className}`} ref={containerRef}>
      {/* Hidden native select with id matching the target selector so standard select queries remain valid */}
      <select aria-label="Select product id"
        id={id}
        value={selectedProductId}
        onChange={(e) => onSelectProduct(e.target.value)}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      >
        {products.map(p => (
          <option key={p.id} value={p.id}>
            {p.sku} - {p.name}
          </option>
        ))}
      </select>

      {/* Main Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        className="w-full flex items-center justify-between gap-2 px-3.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg font-semibold text-slate-800 shadow-xs hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all cursor-pointer min-w-[240px]"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <div className="flex items-center gap-2 min-w-0 truncate">
          <Box className="w-3.5 h-3.5 text-blue-600 shrink-0" />
          {selectedProduct ? (
            <span className="truncate">
              <span className="font-mono font-bold text-blue-700 me-1.5">{selectedProduct.sku}</span>
              <span className="text-slate-700 font-medium">{selectedProduct.name}</span>
            </span>
          ) : (
            <span className="text-slate-400">Select Product / SKU...</span>
          )}
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-180 text-blue-600' : ''}`} />
      </button>

      {/* Dropdown Popover */}
      {isOpen && (
        <div className="absolute end-0 lg:start-0 mt-1.5 w-80 max-w-[90vw] bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          {/* Search Header */}
          <div className="p-2 border-b border-slate-100 bg-slate-50/80 flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0 ms-1" />
            <input aria-label="Search term"
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={placeholder}
              className="w-full py-1 px-1.5 text-xs bg-transparent border-none text-slate-800 font-medium placeholder:text-slate-400 focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Escape') setIsOpen(false);
                if (e.key === 'Enter' && filteredProducts.length > 0) {
                  handleSelect(filteredProducts[0].id);
                }
              }}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-200/60"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* SKU Options List */}
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 p-1">
            {filteredProducts.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-500 font-medium">
                No SKU matching "{searchTerm}"
              </div>
            ) : (
              filteredProducts.map(product => {
                const isSelected = product.id === selectedProductId;
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => handleSelect(product.id)}
                    className={`w-full text-start px-3 py-2 text-xs rounded-lg flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                      isSelected ? 'bg-blue-50/80 text-blue-900 font-bold' : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-blue-600 text-[11px] shrink-0">{product.sku}</span>
                        {product.product_line && (
                          <span className="text-[9px] font-mono px-1 py-0.2 bg-slate-100 text-slate-600 rounded border border-slate-200">
                            {product.product_line}
                          </span>
                        )}
                      </div>
                      <div className="text-[12px] font-medium text-slate-800 truncate mt-0.5">
                        {product.name}
                      </div>
                    </div>
                    {isSelected && (
                      <Check className="w-3.5 h-3.5 text-blue-600 shrink-0 ms-1" />
                    )}
                  </button>
                );
              })
            )}
          </div>
          {/* Footer count indicator */}
          <div className="px-3 py-1.5 bg-slate-50 border-t border-slate-100 text-[10px] text-slate-400 font-mono flex justify-between">
            <span>{filteredProducts.length} SKU{filteredProducts.length !== 1 ? 's' : ''} found</span>
            <span>Search by Code or Name</span>
          </div>
        </div>
      )}
    </div>
  );
}
