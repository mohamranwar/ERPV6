/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Modal } from './ui/Modal';
import { Eye, EyeOff, GripVertical, ArrowUp, ArrowDown, RotateCcw, Check, Sparkles, LayoutGrid } from 'lucide-react';

export interface WidgetConfig {
  id: string;
  title: string;
  category: 'KPIs' | 'Executive Charts' | 'Operations' | 'Detailed Analytics';
  visible: boolean;
  width: 'full' | 'half';
  height?: 'sm' | 'md' | 'lg';
}

export interface DashboardPreset {
  id: string;
  name: string;
  description?: string;
  isBuiltIn?: boolean;
  configs: WidgetConfig[];
}

export const DEFAULT_WIDGET_CONFIGS: WidgetConfig[] = [
  { id: 'kpi_cards', title: 'Executive KPI Cards Row', category: 'KPIs', visible: true, width: 'full', height: 'md' },
  { id: 'operational_cards', title: 'Operational Control Cards Row', category: 'Operations', visible: true, width: 'full', height: 'md' },
  
  // The 6 Executive Charts
  { id: 'sales_by_pcs', title: 'Sales By PCS (BC vs FC)', category: 'Executive Charts', visible: true, width: 'half', height: 'md' },
  { id: 'production_by_pcs', title: 'Production By PCS (BC vs FC)', category: 'Executive Charts', visible: true, width: 'half', height: 'md' },
  { id: 'rm_coverage_months', title: 'Raw Material Coverage (Months)', category: 'Executive Charts', visible: true, width: 'half', height: 'md' },
  { id: 'rm_stock_usage_po', title: 'Raw Material Stock (STK, Usage, PO)', category: 'Executive Charts', visible: true, width: 'half', height: 'md' },
  { id: 'fg_stock_coverage', title: 'FG Stock Coverage (Months)', category: 'Executive Charts', visible: true, width: 'half', height: 'md' },
  { id: 'fg_stk_vs_sales', title: 'FG STK VS Sales Volume', category: 'Executive Charts', visible: true, width: 'half', height: 'md' },
  
  // Additional Analytics
  { id: 'rm_cat_coverage', title: 'Raw Material Stock Coverage by Category', category: 'Detailed Analytics', visible: true, width: 'half', height: 'md' },
  { id: 'po_status', title: 'Monthly Purchase Orders (PO) & Status Breakdown', category: 'Detailed Analytics', visible: true, width: 'half', height: 'md' },
  { id: 'fg_cat_matrix', title: 'Finished Goods Stock Coverage Matrix by Category', category: 'Detailed Analytics', visible: true, width: 'half', height: 'md' },
  { id: 'machine_capacity', title: 'Machine Capacity & Plant Utilization', category: 'Detailed Analytics', visible: true, width: 'half', height: 'md' },
  { id: 'category_achievement', title: 'Sales Achievement by Category Progress', category: 'Detailed Analytics', visible: true, width: 'full', height: 'md' },
  { id: 'container_funnel', title: 'Container Flow & Customs Funnel', category: 'Operations', visible: true, width: 'half', height: 'md' },
  { id: 'line_mtd', title: 'MTD Production vs Sold by Line', category: 'Operations', visible: true, width: 'half', height: 'md' },
  { id: 'lowest_materials', title: 'Top 20 Lowest Coverage Materials', category: 'Detailed Analytics', visible: true, width: 'full', height: 'md' },
  { id: 'psi_overview', title: 'PSI Overview (Forecast vs Actuals vs Production)', category: 'Detailed Analytics', visible: true, width: 'full', height: 'md' },
];

/**
 * Widget titles, by id.
 *
 * Derived from DEFAULT_WIDGET_CONFIGS rather than written out again: these
 * titles were previously duplicated as hardcoded <h3> text in
 * DashboardScreen.renderWidget, and all three of the "Detailed Analytics"
 * panels had drifted apart from their registry entry. A user toggling
 * "Raw Material Coverage by Category" in the customiser was shown a panel
 * headed "Raw Material Stock Coverage by Category".
 *
 * One definition, two consumers.
 */
export const DEFAULT_WIDGET_TITLES: Record<string, string> =
  Object.fromEntries(DEFAULT_WIDGET_CONFIGS.map(w => [w.id, w.title]));

export const BUILTIN_PRESETS: DashboardPreset[] = [
  {
    id: 'default_all',
    name: 'Full Supply Chain Tower',
    description: 'Complete operational view with all metrics, charts, and analysis tables.',
    isBuiltIn: true,
    configs: DEFAULT_WIDGET_CONFIGS,
  },
  {
    id: 'executive',
    name: 'Executive & Board Deck',
    description: 'High-level executive KPIs, volume trends, and sales achievement targets.',
    isBuiltIn: true,
    configs: DEFAULT_WIDGET_CONFIGS.map(w => ({
      ...w,
      visible: ['kpi_cards', 'sales_by_pcs', 'production_by_pcs', 'rm_coverage_months', 'rm_stock_usage_po', 'fg_stock_coverage', 'fg_stk_vs_sales', 'category_achievement'].includes(w.id),
      width: ['kpi_cards', 'category_achievement'].includes(w.id) ? 'full' : 'half',
    })),
  },
  {
    id: 'logistics',
    name: 'Procurement & Customs Deck',
    description: 'In-transit shipments, PO status, container funnel, and raw material stock.',
    isBuiltIn: true,
    configs: DEFAULT_WIDGET_CONFIGS.map(w => ({
      ...w,
      visible: ['operational_cards', 'rm_coverage_months', 'rm_stock_usage_po', 'po_status', 'container_funnel', 'lowest_materials'].includes(w.id),
      width: ['operational_cards', 'lowest_materials'].includes(w.id) ? 'full' : 'half',
    })),
  },
  {
    id: 'plant_ops',
    name: 'Plant & Production Operations',
    description: 'Machine utilization load, production line performance, and PSI analysis.',
    isBuiltIn: true,
    configs: DEFAULT_WIDGET_CONFIGS.map(w => ({
      ...w,
      visible: ['kpi_cards', 'production_by_pcs', 'fg_stock_coverage', 'machine_capacity', 'line_mtd', 'psi_overview'].includes(w.id),
      width: ['kpi_cards', 'psi_overview'].includes(w.id) ? 'full' : 'half',
    })),
  },
];

interface DashboardCustomizerModalProps {
  open: boolean;
  onClose: () => void;
  widgets: WidgetConfig[];
  onSave: (newWidgets: WidgetConfig[]) => void;
  onReset: () => void;
}

export default function DashboardCustomizerModal({
  open,
  onClose,
  widgets,
  onSave,
  onReset,
}: DashboardCustomizerModalProps) {
  const [items, setItems] = useState<WidgetConfig[]>(widgets);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  React.useEffect(() => {
    setItems(widgets);
  }, [widgets, open]);

  const toggleVisible = (id: string) => {
    setItems(prev => prev.map(w => w.id === id ? { ...w, visible: !w.visible } : w));
  };

  const toggleWidth = (id: string) => {
    setItems(prev => prev.map(w => w.id === id ? { ...w, width: w.width === 'full' ? 'half' : 'full' } : w));
  };

  const cycleHeight = (id: string) => {
    setItems(prev => prev.map(w => {
      if (w.id !== id) return w;
      const current = w.height || 'md';
      const nextHeight: 'sm' | 'md' | 'lg' = current === 'sm' ? 'md' : current === 'md' ? 'lg' : 'sm';
      return { ...w, height: nextHeight };
    }));
  };

  const moveItem = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    setItems(next);
  };

  // Drag & Drop event handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    const next = [...items];
    const [draggedItem] = next.splice(draggedIndex, 1);
    next.splice(index, 0, draggedItem);
    setDraggedIndex(index);
    setItems(next);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const handleSave = () => {
    onSave(items);
    onClose();
  };

  const handleReset = () => {
    onReset();
    setItems(DEFAULT_WIDGET_CONFIGS);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Customize Dashboard Layout & Widgets"
      width="max-w-2xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <button
            type="button"
            onClick={handleReset}
            className="btn-base btn-secondary gap-1.5 text-xs text-slate-600 hover:text-slate-900"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Defaults
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="btn-base btn-secondary text-xs">
              Cancel
            </button>
            <button type="button" onClick={handleSave} className="btn-base btn-primary gap-1.5 text-xs">
              <Check className="w-3.5 h-3.5" />
              Save Dashboard Layout
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="p-3 bg-brand-50/80 border border-brand-100 rounded-xl text-xs text-brand-900 flex items-start gap-2.5">
          <Sparkles className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Drag and drop to reorder dashboard widgets</p>
            <p className="text-brand-700 mt-0.5">
              Drag widgets using the handle icon, toggle visibility ON/OFF, or change card width between Half-width and Full-width.
            </p>
          </div>
        </div>

        <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
          {items.map((item, idx) => (
            <div
              key={item.id}
              draggable
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              className={`flex items-center justify-between gap-3 p-3 rounded-xl border transition-all ${
                item.visible
                  ? 'bg-white border-slate-200 shadow-sm hover:border-slate-300'
                  : 'bg-slate-50 border-slate-200 opacity-60'
              } ${draggedIndex === idx ? 'border-brand-500 bg-brand-50/50 scale-[1.01]' : ''}`}
            >
              {/* Left drag handle + index + Title */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <button
                  type="button"
                  className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 p-1"
                  title="Drag to reorder"
                >
                  <GripVertical className="w-4 h-4" />
                </button>
                <span className="font-mono text-[11px] font-bold text-slate-400 w-5 text-center">
                  #{idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-slate-800 truncate">{item.title}</p>
                  <span className="text-[10px] text-slate-500 font-medium">{item.category}</span>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-2 shrink-0">
                {/* Width selector */}
                <button
                  type="button"
                  onClick={() => toggleWidth(item.id)}
                  className={`px-2 py-1 rounded text-[10.5px] font-mono font-bold transition-colors ${
                    item.width === 'full'
                      ? 'bg-brand-100 text-brand-700 border border-brand-200'
                      : 'bg-slate-100 text-slate-600 border border-slate-200'
                  }`}
                  title="Toggle Width (Full vs Half Width)"
                >
                  {item.width === 'full' ? 'Full Width' : 'Half Width'}
                </button>

                {/* Height selector */}
                <button
                  type="button"
                  onClick={() => cycleHeight(item.id)}
                  className="px-2 py-1 rounded text-[10.5px] font-mono font-bold bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200 hover:text-slate-900 transition-colors"
                  title="Cycle Height (Sm = 180px, Md = 240px, Lg = 360px)"
                >
                  H: {(item.height || 'md').toUpperCase()}
                </button>

                {/* Move Up/Down Buttons */}
                <div className="flex items-center gap-0.5 border border-slate-200 rounded bg-slate-50">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => moveItem(idx, 'up')}
                    className="p-1 text-slate-500 hover:text-slate-800 disabled:opacity-30 disabled:hover:text-slate-500"
                    title="Move Up"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === items.length - 1}
                    onClick={() => moveItem(idx, 'down')}
                    className="p-1 text-slate-500 hover:text-slate-800 disabled:opacity-30 disabled:hover:text-slate-500"
                    title="Move Down"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Visibility Toggle */}
                <button
                  type="button"
                  onClick={() => toggleVisible(item.id)}
                  className={`p-1.5 rounded-lg border transition-colors ${
                    item.visible
                      ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100'
                      : 'bg-slate-100 text-slate-400 border-slate-200 hover:bg-slate-200'
                  }`}
                  title={item.visible ? 'Visible on Dashboard' : 'Hidden from Dashboard'}
                >
                  {item.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
