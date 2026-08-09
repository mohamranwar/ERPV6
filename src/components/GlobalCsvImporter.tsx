/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, Check, AlertTriangle, AlertCircle, Info, RefreshCw, FileText, Database, 
  HelpCircle, ChevronRight, Play, Server, Trash2, ArrowRight, Download 
} from 'lucide-react';
import { fetchTableData, saveRecord } from '../supabaseClient';
import { useToast } from '../context/ToastConfirmContext';
import { useAuth } from '../context/AuthContext';

interface FieldConfig {
  key: string;
  label: string;
  required: boolean;
  type: 'string' | 'number' | 'date' | 'enum';
  enumValues?: string[];
  description: string;
}

interface TableConfig {
  id: string;
  name: string;
  dbTable: string;
  description: string;
  fields: FieldConfig[];
}

const SUPPORTED_TABLES: TableConfig[] = [
  {
    id: 'sales_plan',
    name: 'Sales Demand Plan',
    dbTable: 'sales_plan',
    description: 'Demand forecasts grouped by product, channel, and period start.',
    fields: [
      { key: 'product_id', label: 'Product (ID or SKU)', required: true, type: 'string', description: 'Product identifier (ID or SKU in Products Master).' },
      { key: 'channel_id', label: 'Channel (ID or Name)', required: true, type: 'string', description: 'Sales channel identifier (ID or Name in Channels).' },
      { key: 'period_type', label: 'Grain', required: true, type: 'enum', enumValues: ['day', 'week', 'month'], description: 'Time grain: "day", "week", or "month".' },
      { key: 'period_start', label: 'Period Start Date', required: true, type: 'date', description: 'ISO start date (YYYY-MM-DD, e.g. 2026-07-01).' },
      { key: 'quantity', label: 'Forecast Quantity', required: true, type: 'number', description: 'Numeric demand quantity.' }
    ]
  },
  {
    id: 'production_plan',
    name: 'MPS Production Plan',
    dbTable: 'production_plan',
    description: 'Master Production Schedule (MPS) values mapped to SKUs and Machinery.',
    fields: [
      { key: 'product_id', label: 'Product (ID or SKU)', required: true, type: 'string', description: 'Product identifier (ID or SKU).' },
      { key: 'machine_id', label: 'Machine (ID or Name)', required: false, type: 'string', description: 'Assigned machine. Falls back to product machine line if blank.' },
      { key: 'period_type', label: 'Grain', required: true, type: 'enum', enumValues: ['day', 'week', 'month'], description: 'Time grain: "day", "week", or "month".' },
      { key: 'period_start', label: 'Period Start Date', required: true, type: 'date', description: 'ISO date (YYYY-MM-DD).' },
      { key: 'quantity', label: 'Production Quantity', required: true, type: 'number', description: 'Volume to produce.' }
    ]
  },
  {
    id: 'products',
    name: 'Products (Master Data)',
    dbTable: 'products',
    description: 'Master record of finished goods, sizes, and pricing configurations.',
    fields: [
      { key: 'id', label: 'Product ID', required: true, type: 'string', description: 'Unique identifier, e.g. "P1", "P2".' },
      { key: 'sku', label: 'SKU Code', required: true, type: 'string', description: 'Stock keeping unit (alphanumeric).' },
      { key: 'name', label: 'Product Name', required: true, type: 'string', description: 'Descriptive human-readable name.' },
      { key: 'product_line', label: 'Machine Line', required: true, type: 'enum', enumValues: ['SOFY', 'VOXY', 'Atlas', 'Pants', 'Import'], description: 'Machinery line: "SOFY", "VOXY", "Atlas", "Pants", or "Import".' },
      { key: 'selling_price', label: 'Selling Price (EGP)', required: false, type: 'number', description: 'Wholesale unit selling price.' },
      { key: 'standard_cost', label: 'Standard Cost (EGP)', required: false, type: 'number', description: 'Production cost per unit.' },
      { key: 'size', label: 'Size', required: false, type: 'string', description: 'E.g., "Regular", "Super", "M", "L".' },
      { key: 'pack_type', label: 'Pack Type', required: false, type: 'string', description: 'E.g., "Single", "Duo", "Economy".' },
      { key: 'pcs_per_bag', label: 'Pieces per Bag', required: false, type: 'number', description: 'Count inside a pack.' },
      { key: 'bags_per_carton', label: 'Bags per Carton', required: false, type: 'number', description: 'Bags per shipping box.' }
    ]
  },
  {
    id: 'materials',
    name: 'Materials (Master Data)',
    dbTable: 'materials',
    description: 'Raw materials, packaging, lead times, safety stocks, and MOQ criteria.',
    fields: [
      { key: 'id', label: 'Material ID', required: true, type: 'string', description: 'Unique material ID, e.g. "MT1", "MT2".' },
      { key: 'sku', label: 'SKU Code', required: true, type: 'string', description: 'Raw material SKU identifier.' },
      { key: 'name', label: 'Material Name', required: true, type: 'string', description: 'Human readable material name.' },
      { key: 'category_id', label: 'Category ID', required: true, type: 'string', description: 'Material category code, e.g. "MC1" (Fluff), "MC2" (SAP).' },
      { key: 'supplier_id', label: 'Default Supplier ID', required: true, type: 'string', description: 'Supplier ID (must exist in Suppliers).' },
      { key: 'supplier_lead_time_days', label: 'Supplier Lead Time (Days)', required: false, type: 'number', description: 'Days between order and supplier dispatch.' },
      { key: 'transit_days', label: 'Transit Time (Days)', required: false, type: 'number', description: 'Transport transit duration.' },
      { key: 'customs_clearance_days', label: 'Customs Days', required: false, type: 'number', description: 'Port clearance days.' },
      { key: 'moq', label: 'Minimum Order Qty (MOQ)', required: false, type: 'number', description: 'MOQ for orders.' },
      { key: 'safety_stock_months', label: 'Safety Stock (Months)', required: false, type: 'number', description: 'Desired target inventory safety buffer.' },
      { key: 'standard_cost', label: 'Standard Cost (EGP)', required: false, type: 'number', description: 'Unit cost.' }
    ]
  },
  {
    id: 'suppliers',
    name: 'Suppliers (Master Data)',
    dbTable: 'suppliers',
    description: 'Active supply vendors, default transit terms, and general status.',
    fields: [
      { key: 'id', label: 'Supplier ID', required: true, type: 'string', description: 'Unique supplier ID, e.g. "S1", "S2".' },
      { key: 'name', label: 'Supplier Name', required: true, type: 'string', description: 'Corporate name.' },
      { key: 'default_lead_time_days', label: 'Default Lead Time', required: false, type: 'number', description: 'Fallback supplier lead days.' },
      { key: 'default_transit_days', label: 'Default Transit Days', required: false, type: 'number', description: 'Fallback shipping days.' },
      { key: 'status', label: 'Status', required: false, type: 'enum', enumValues: ['active', 'inactive'], description: 'Supplier status: "active" or "inactive".' }
    ]
  },
  {
    id: 'channels',
    name: 'Channels (Master Data)',
    dbTable: 'channels',
    description: 'Client channels (e.g. Modern Trade, Retail, Export) for demand mapping.',
    fields: [
      { key: 'id', label: 'Channel ID', required: true, type: 'string', description: 'E.g. "C1", "C2".' },
      { key: 'name', label: 'Channel Name', required: true, type: 'string', description: 'Channel name.' },
      { key: 'status', label: 'Status', required: false, type: 'enum', enumValues: ['active', 'inactive'], description: 'Channel status: "active" or "inactive".' }
    ]
  }
];

interface ValidationError {
  rowIdx: number;
  field: string;
  value: string;
  message: string;
  severity: 'error' | 'warning';
}

export default function GlobalCsvImporter({ onClose, refreshKey = 0 }: { onClose?: () => void; refreshKey?: number }) {
  const { showToast } = useToast();
  const { hasRole } = useAuth();

  // UI Selection
  const [selectedTableId, setSelectedTableId] = useState<string>('sales_plan');
  const [csvText, setCsvText] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Note: GlobalCsvImporter renders as a full in-app screen (App.tsx swaps it
  // in for the main viewport via the 'csv_importer' ScreenID), not as an
  // overlay/dialog - there's no backdrop or fixed-position wrapper here. A
  // hard Tab focus-trap (like the one on the Supabase config modal and the
  // global confirm dialog) would therefore actively break keyboard access to
  // the sidebar nav for as long as this screen is open, which is a
  // regression rather than a fix. useFocusTrap is intentionally NOT applied
  // here for that reason - it's reserved for actual modal dialogs.

  // Parsing & Mapping States
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<string[][]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({}); // systemFieldKey -> csvHeader
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [mappedData, setMappedData] = useState<any[]>([]);
  const [isValidated, setIsValidated] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [loadingSchema, setLoadingSchema] = useState(false);

  // Relational Lookup Caches for Cross-Validation
  const [dbProducts, setDbProducts] = useState<any[]>([]);
  const [dbChannels, setDbChannels] = useState<any[]>([]);
  const [dbMachines, setDbMachines] = useState<any[]>([]);
  const [dbSuppliers, setDbSuppliers] = useState<any[]>([]);

  const activeTable = SUPPORTED_TABLES.find(t => t.id === selectedTableId)!;

  // Load relation data for real-time validation checks
  async function loadRelationalCaches() {
    setLoadingSchema(true);
    try {
      const [prods, chans, macs, sups] = await Promise.all([
        fetchTableData<any>('products'),
        fetchTableData<any>('channels'),
        fetchTableData<any>('machines'),
        fetchTableData<any>('suppliers')
      ]);
      setDbProducts(prods);
      setDbChannels(chans);
      setDbMachines(macs);
      setDbSuppliers(sups);
    } catch (e: any) {
      showToast("Error loading verification datasets: " + e.message, 'error');
    } finally {
      setLoadingSchema(false);
    }
  }

  useEffect(() => {
    loadRelationalCaches();
    // Reset parser upon switching tables
    setCsvText('');
    setParsedHeaders([]);
    setParsedRows([]);
    setMappings({});
    setValidationErrors([]);
    setMappedData([]);
    setIsValidated(false);
  }, [selectedTableId, refreshKey]);

  // Handle Drag & Drop Events
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setCsvText(event.target.result as string);
        showToast(`File ${file.name} loaded. Click "Parse Data" to configure mappings.`, 'success');
      }
    };
    reader.readAsText(file);
  };

  // Parsing CSV Text
  const handleParse = () => {
    setValidationErrors([]);
    setMappedData([]);
    setIsValidated(false);

    if (!csvText.trim()) {
      showToast('Please upload a file or paste CSV content first.', 'error');
      return;
    }

    try {
      const lines = csvText.split(/\r?\n/);
      const rows = lines
        .map(line => {
          // Robust comma split honoring double quotes
          const cells: string[] = [];
          let currentCell = '';
          let inQuotes = false;
          
          for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
              inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
              cells.push(currentCell.trim());
              currentCell = '';
            } else {
              currentCell += char;
            }
          }
          cells.push(currentCell.trim());
          return cells.map(cell => cell.replace(/^"|"$/g, '').trim());
        })
        .filter(row => row.length > 0 && row.some(cell => cell !== ''));

      if (rows.length < 2) {
        showToast('CSV must contain a header row and at least one data row.', 'error');
        return;
      }

      const headers = rows[0];
      const dataRows = rows.slice(1);

      setParsedHeaders(headers);
      setParsedRows(dataRows);

      // Automated Fuzzy Mapping Alignments
      const initialMappings: Record<string, string> = {};
      activeTable.fields.forEach(field => {
        const fuzzyNames = [
          field.key.toLowerCase(),
          field.label.toLowerCase(),
          field.key.replace('_', ' ').toLowerCase(),
          field.label.toLowerCase().replace(/[^a-z0-9]/g, '')
        ];

        const bestMatch = headers.find(header => {
          const normHeader = header.trim().toLowerCase();
          return fuzzyNames.includes(normHeader) || 
                 normHeader.includes(field.key.toLowerCase()) ||
                 fuzzyNames.includes(normHeader.replace(/[^a-z0-9]/g, ''));
        });

        initialMappings[field.key] = bestMatch || '';
      });

      setMappings(initialMappings);
      showToast('CSV columns parsed successfully. Check field mappings below.', 'success');
    } catch (err: any) {
      showToast('Parsing failure: ' + err.message, 'error');
    }
  };

  const handleMappingChange = (fieldKey: string, csvHeader: string) => {
    setMappings(prev => ({
      ...prev,
      [fieldKey]: csvHeader
    }));
    setIsValidated(false);
  };

  // Perform Rigorous Data Mapping and Validation (Section B)
  const handleValidate = () => {
    const missingRequired = activeTable.fields.filter(f => f.required && !mappings[f.key]);
    if (missingRequired.length > 0) {
      showToast(`Missing required mappings: ${missingRequired.map(f => f.label).join(', ')}`, 'error');
      return;
    }

    const errors: ValidationError[] = [];
    const mapped: any[] = [];

    parsedRows.forEach((row, rowIdx) => {
      const rowNum = rowIdx + 2; // header is row 1, 1-indexed for user visibility
      const record: any = {};
      
      activeTable.fields.forEach(field => {
        const mappedHeader = mappings[field.key];
        const headerIdx = parsedHeaders.indexOf(mappedHeader);
        let rawVal = '';

        if (headerIdx > -1 && row[headerIdx] !== undefined) {
          rawVal = row[headerIdx].trim();
        }

        // Apply fallback value if field is optional and blank
        if (rawVal === '') {
          if (field.required) {
            errors.push({
              rowIdx: rowNum,
              field: field.key,
              value: '',
              message: `Field "${field.label}" is required but empty.`,
              severity: 'error'
            });
            return;
          }
          record[field.key] = null;
          return;
        }

        // Parse & Type Cast Validation
        if (field.type === 'number') {
          const num = Number(rawVal);
          if (isNaN(num)) {
            errors.push({
              rowIdx: rowNum,
              field: field.key,
              value: rawVal,
              message: `"${rawVal}" is not a valid number.`,
              severity: 'error'
            });
          } else if (num < 0) {
            errors.push({
              rowIdx: rowNum,
              field: field.key,
              value: rawVal,
              message: `Value must be positive. Received ${rawVal}.`,
              severity: 'warning'
            });
            record[field.key] = num;
          } else {
            record[field.key] = num;
          }
        } else if (field.type === 'date') {
          // Expect YYYY-MM-DD
          const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
          const isISO = dateRegex.test(rawVal);
          const parsedMs = Date.parse(rawVal);
          
          if (!isISO || isNaN(parsedMs)) {
            // Attempt smart auto-correction for dates (e.g. 7/1/2026, Jul-26)
            let corrected = '';
            try {
              const d = new Date(rawVal);
              if (!isNaN(d.getTime())) {
                corrected = d.toISOString().split('T')[0];
              }
            } catch(e){}

            if (corrected) {
              errors.push({
                rowIdx: rowNum,
                field: field.key,
                value: rawVal,
                message: `Date format error. Automatically corrected "${rawVal}" to "${corrected}".`,
                severity: 'warning'
              });
              record[field.key] = corrected;
            } else {
              errors.push({
                rowIdx: rowNum,
                field: field.key,
                value: rawVal,
                message: `"${rawVal}" is not a valid date. Expected format: YYYY-MM-DD.`,
                severity: 'error'
              });
            }
          } else {
            record[field.key] = rawVal;
          }
        } else if (field.type === 'enum' && field.enumValues) {
          const valLower = rawVal.toLowerCase();
          const match = field.enumValues.find(ev => ev.toLowerCase() === valLower);
          
          if (!match) {
            errors.push({
              rowIdx: rowNum,
              field: field.key,
              value: rawVal,
              message: `"${rawVal}" is invalid. Must be one of: ${field.enumValues.join(', ')}.`,
              severity: 'error'
            });
          } else {
            record[field.key] = match;
          }
        } else {
          record[field.key] = rawVal;
        }

        // --- SECTION B: ADVANCED RELATIONAL INTEGRITY CHECKING ---
        // Validate relational foreign keys to ensure database references align properly
        if (field.key === 'product_id' && rawVal !== '') {
          // Resolve product ID or SKU
          const match = dbProducts.find(p => p.id === rawVal || p.sku.toLowerCase() === rawVal.toLowerCase());
          if (!match) {
            errors.push({
              rowIdx: rowNum,
              field: 'product_id',
              value: rawVal,
              message: `Product SKU/ID "${rawVal}" not found in Products Master database.`,
              severity: 'error'
            });
          } else {
            record.product_id = match.id; // Map actual ID rather than raw SKU
          }
        }

        if (field.key === 'channel_id' && rawVal !== '') {
          const match = dbChannels.find(c => c.id === rawVal || c.name.toLowerCase() === rawVal.toLowerCase());
          if (!match) {
            errors.push({
              rowIdx: rowNum,
              field: 'channel_id',
              value: rawVal,
              message: `Channel Name/ID "${rawVal}" not found in Channels database.`,
              severity: 'error'
            });
          } else {
            record.channel_id = match.id;
          }
        }

        if (field.key === 'machine_id' && rawVal !== '') {
          const match = dbMachines.find(m => m.id === rawVal || m.name.toLowerCase() === rawVal.toLowerCase());
          if (!match) {
            errors.push({
              rowIdx: rowNum,
              field: 'machine_id',
              value: rawVal,
              message: `Machine "${rawVal}" not found. Will default to product line machine assignment.`,
              severity: 'warning'
            });
          } else {
            record.machine_id = match.id;
          }
        }

        if (field.key === 'supplier_id' && rawVal !== '') {
          const match = dbSuppliers.find(s => s.id === rawVal || s.name.toLowerCase() === rawVal.toLowerCase());
          if (!match) {
            errors.push({
              rowIdx: rowNum,
              field: 'supplier_id',
              value: rawVal,
              message: `Supplier "${rawVal}" not found in database.`,
              severity: 'error'
            });
          } else {
            record.supplier_id = match.id;
          }
        }
      });

      // Insert incremental random UUID like saveRecord expects
      if (!record.id) {
        record.id = `${activeTable.dbTable.toUpperCase().slice(0, 3)}_${Date.now()}_${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
      }

      mapped.push(record);
    });

    setValidationErrors(errors);
    setMappedData(mapped);
    setIsValidated(true);

    const fatalCount = errors.filter(e => e.severity === 'error').length;
    const warnCount = errors.filter(e => e.severity === 'warning').length;

    if (fatalCount > 0) {
      showToast(`Validation finished. Found ${fatalCount} fatal errors. Please repair CSV data.`, 'error');
    } else if (warnCount > 0) {
      showToast(`Validation completed with ${warnCount} warnings. Data is importable!`, 'success');
    } else {
      showToast(`All ${mapped.length} rows verified clean! Ready to import.`, 'success');
    }
  };

  // Commit Mapped Records to database via saveRecord Wrapper
  const handleExecuteImport = async () => {
    if (!hasRole('planner')) {
      showToast('Your account is read-only - Planner or Admin access is required to import data.', 'error');
      return;
    }
    const fatalCount = validationErrors.filter(e => e.severity === 'error').length;
    if (fatalCount > 0) {
      showToast("Cannot import. Please resolve fatal validation errors first.", "error");
      return;
    }

    if (mappedData.length === 0) {
      showToast("No data to import.", "error");
      return;
    }

    setIsImporting(true);
    try {
      let count = 0;
      for (const rec of mappedData) {
        // Resolve machine fallback for production plan
        if (selectedTableId === 'production_plan' && !rec.machine_id) {
          const prod = dbProducts.find(p => p.id === rec.product_id);
          const machineName = prod ? prod.product_line : 'Pants';
          const defaultMac = dbMachines.find(m => m.name === machineName);
          rec.machine_id = defaultMac ? defaultMac.id : 'M4';
        }

        await saveRecord(activeTable.dbTable, rec);
        count++;
      }

      showToast(`Successfully imported ${count} records into ${activeTable.name}!`, "success");
      
      // Clean states
      setCsvText('');
      setParsedHeaders([]);
      setParsedRows([]);
      setMappings({});
      setValidationErrors([]);
      setMappedData([]);
      setIsValidated(false);

      if (onClose) onClose();
    } catch (err: any) {
      showToast("Import execution failed: " + err.message, "error");
    } finally {
      setIsImporting(false);
    }
  };

  const getTemplateCsv = (): string => {
    const headers = activeTable.fields.map(f => f.key).join(',');
    const exampleRow = activeTable.fields.map(f => {
      if (f.type === 'number') return '10000';
      if (f.type === 'date') return '2026-07-01';
      if (f.type === 'enum' && f.enumValues) return f.enumValues[0];
      if (f.key === 'product_id') return 'P1';
      if (f.key === 'channel_id') return 'C1';
      if (f.key === 'supplier_id') return 'S1';
      if (f.key === 'sku') return 'RM-FLF-01';
      return 'Value';
    }).join(',');
    return `${headers}\n${exampleRow}`;
  };

  const downloadTemplate = () => {
    const blob = new Blob([getTemplateCsv()], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('href', url);
    a.setAttribute('download', `${selectedTableId}_import_template.csv`);
    a.click();
    showToast('Template downloaded successfully!', 'success');
  };

  const hasFatalErrors = validationErrors.some(e => e.severity === 'error');

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col max-h-[85vh] font-sans" id="csv_importer_panel">
      {/* Target Table Selector Ribbon */}
      <div className="px-6 py-4 bg-slate-900 text-white flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-xl shrink-0">
            <Database className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h2 className="text-sm font-extrabold uppercase tracking-wider text-white">Central Planning Import Hub</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">Ingest spreadsheet logs, sales plans, production lines, or master SKUs.</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Target:</span>
          <select aria-label="Select table id"
            id="csv_importer_table_selector"
            value={selectedTableId}
            onChange={(e) => setSelectedTableId(e.target.value)}
            className="bg-slate-800 text-slate-100 border border-slate-700 rounded-xl px-3 py-1.5 text-xs font-bold focus:outline-hidden focus:ring-1 focus:ring-blue-500 cursor-pointer"
          >
            {SUPPORTED_TABLES.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="p-6 overflow-y-auto space-y-6 flex-1 max-h-[calc(85vh-140px)]">
        {/* Table Description Jumbotron */}
        <div className="bg-slate-50 border border-slate-200/60 p-4.5 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1 max-w-xl">
            <h4 className="text-xs font-extrabold text-slate-800 uppercase tracking-wide">Target Table Schema Details</h4>
            <p className="text-[11px] text-slate-500 font-medium leading-relaxed">{activeTable.description}</p>
          </div>

          <button
            onClick={downloadTemplate}
            className="btn-base btn-sky gap-1.5 shadow-sm shrink-0 self-start md:self-auto"
            title="Download formatted sample CSV file"
          >
            <Download className="w-3.5 h-3.5 text-white" />
            Get Template CSV
          </button>
        </div>

        {/* Upload Container Zone */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Drag & Drop File Upload */}
          <div 
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
              dragActive 
                ? 'border-blue-500 bg-blue-50/50 scale-[0.99]' 
                : 'border-slate-300 hover:border-slate-400 bg-slate-50/30 hover:bg-slate-50/70'
            }`}
            onClick={() => fileInputRef.current?.click()}
          >
            <input 
              ref={fileInputRef}
              type="file" 
              accept=".csv"
              onChange={handleFileSelect}
              className="hidden" 
            />
            <div className="p-4 bg-white shadow-3xs rounded-2xl border border-slate-200 mb-3 text-slate-400">
              <Upload className="w-6 h-6 text-blue-600" />
            </div>
            <p className="text-xs font-bold text-slate-800">Drag & drop your CSV spreadsheet here</p>
            <p className="text-[10px] text-slate-400 mt-1">Or click to select a file from local explorer</p>
          </div>

          {/* Direct Text Paste Area */}
          <div className="flex flex-col h-full">
            <textarea aria-label="Csv text"
              id="global_csv_paste_area"
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={`Paste raw spreadsheet contents here...\nExample:\n${getTemplateCsv()}`}
              className="w-full h-full min-h-[140px] p-4 text-xs font-mono border border-slate-300 rounded-2xl focus:ring-1 focus:ring-blue-500 focus:outline-hidden bg-slate-50/10 focus:bg-white resize-y shadow-3xs"
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px] font-semibold text-slate-400 flex items-center gap-1">
                <Info className="w-3.5 h-3.5" /> Commas, semicolons, or tab-delimited values accepted.
              </span>
              <button
                id="global_csv_parse_btn"
                onClick={handleParse}
                className="btn-base btn-purple gap-1.5 shadow-sm"
              >
                <RefreshCw className="w-3.5 h-3.5 text-white" />
                Parse Data
              </button>
            </div>
          </div>
        </div>

        {/* Mapping alignments step */}
        {parsedHeaders.length > 0 && (
          <div className="space-y-4 pt-4 border-t border-slate-100" id="csv_mapping_section">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-[10px] font-extrabold uppercase tracking-wide">Step 1</span>
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Map CSV Columns to System Schema</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 bg-slate-50 p-5 rounded-2xl border border-slate-100 shadow-3xs">
              {activeTable.fields.map(field => (
                <div key={field.key} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="block text-[11px] font-bold text-slate-800">
                      {field.label} {field.required && <span className="text-red-500 font-extrabold">*</span>}
                    </label>
                    <span className="text-[9px] font-bold text-slate-400 uppercase font-mono px-1 py-0.5 bg-slate-200/50 rounded">{field.type}</span>
                  </div>
                  <select aria-label="Mappings"
                    value={mappings[field.key] || ''}
                    onChange={(e) => handleMappingChange(field.key, e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl text-slate-700 font-semibold focus:ring-1 focus:ring-blue-500 focus:outline-hidden cursor-pointer"
                  >
                    <option value="">-- Don't Import (Fallback to Null) --</option>
                    {parsedHeaders.map(h => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                  <p className="text-[9px] leading-relaxed text-slate-400 font-medium">{field.description}</p>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2">
              <button
                id="global_csv_validate_btn"
                onClick={handleValidate}
                className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-all shadow-xs"
              >
                <Play className="w-3.5 h-3.5" />
                Validate Mapping Integrity
              </button>
            </div>
          </div>
        )}

        {/* Validation Errors Reporting Panel (Section B) */}
        {isValidated && (
          <div className="space-y-4 pt-4 border-t border-slate-100" id="csv_validation_report_section">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded text-[10px] font-extrabold uppercase tracking-wide">Step 2</span>
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Integrity Audit &amp; Validation</h3>
              </div>

              <div className="flex items-center gap-3">
                <span className="px-2.5 py-1 bg-red-100 text-red-800 border border-red-200 rounded-lg text-[10px] font-bold uppercase">
                  {validationErrors.filter(e => e.severity === 'error').length} Fatal Errors
                </span>
                <span className="px-2.5 py-1 bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-[10px] font-bold uppercase">
                  {validationErrors.filter(e => e.severity === 'warning').length} Warnings
                </span>
              </div>
            </div>

            {/* Error reporting list panel */}
            {validationErrors.length > 0 ? (
              <div className="bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden shadow-3xs max-h-56 overflow-y-auto">
                <div className="px-4 py-2 bg-slate-100 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Audit Logs ({validationErrors.length} entries)
                </div>
                <div className="divide-y divide-slate-200">
                  {validationErrors.map((err, idx) => (
                    <div key={idx} className={`p-3.5 flex items-start gap-3 text-xs leading-relaxed ${err.severity === 'error' ? 'bg-red-50/20' : 'bg-amber-50/10'}`}>
                      {err.severity === 'error' ? (
                        <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 space-y-0.5">
                        <div className="flex items-center gap-2 font-bold text-slate-800">
                          <span>Row {err.rowIdx}</span>
                          <span className="h-3 w-[1px] bg-slate-300"></span>
                          <span className="font-mono text-[10px] text-slate-500 font-semibold uppercase">[{err.field}]</span>
                          {err.value && (
                            <>
                              <span className="h-3 w-[1px] bg-slate-300"></span>
                              <span className="font-sans font-medium text-slate-400">Value: "{err.value}"</span>
                            </>
                          )}
                        </div>
                        <p className="text-slate-600 font-medium">{err.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl flex items-center gap-3 text-emerald-800 text-xs">
                <Check className="w-5 h-5 text-emerald-600 shrink-0" />
                <span className="font-semibold">Data integrity validation complete! No fatal structural or relational errors discovered.</span>
              </div>
            )}

            {/* Mapping Preview Table */}
            {mappedData.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-slate-800 mb-2 uppercase tracking-wide">Proposed Upload Preview (First 5 Rows)</h4>
                <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-3xs bg-white">
                  <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                    <thead className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      <tr>
                        {activeTable.fields.map(f => (
                          <th key={f.key} className="px-4 py-2.5">
                            {f.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-slate-700 font-medium">
                      {mappedData.slice(0, 5).map((pRow, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                          {activeTable.fields.map(f => (
                            <td key={f.key} className="px-4 py-2 whitespace-nowrap">
                              {pRow[f.key] !== null && pRow[f.key] !== undefined ? (
                                String(pRow[f.key])
                              ) : (
                                <span className="text-slate-300 font-mono text-[10px]">null</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Primary Execution Action Ribbon (Footer) */}
      <div className="flex justify-between items-center gap-3 px-6 py-4.5 bg-slate-50 border-t border-slate-200 shrink-0">
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          {parsedRows.length > 0 && `${parsedRows.length} parsed lines pending validation`}
        </div>

        <div className="flex gap-2.5">
          {onClose && (
            <button
              onClick={onClose}
              className="px-4.5 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 hover:border-slate-400 active:bg-slate-100 transition-all shadow-3xs"
            >
              Cancel
            </button>
          )}
          <button
            id="global_csv_import_execute_btn"
            disabled={!isValidated || hasFatalErrors || isImporting || mappedData.length === 0}
            onClick={handleExecuteImport}
            className="btn-base btn-emerald gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isImporting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />
                Importing...
              </>
            ) : (
              <>
                <Server className="w-3.5 h-3.5 text-white" />
                Commit {mappedData.length} Records
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
