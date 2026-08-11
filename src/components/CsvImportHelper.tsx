/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { Upload, HelpCircle, Check, AlertTriangle } from 'lucide-react';

interface CsvImportHelperProps {
  fields: { key: string; label: string; required?: boolean; defaultValue?: any }[];
  onImport: (mappedData: any[]) => void;
  title?: string;
}

export default function CsvImportHelper({ fields, onImport, title = "Import from CSV" }: CsvImportHelperProps) {
  const [isOpen, setIsOpen] = useState(false);
  // Confines Tab to the import dialog and closes it on Escape.
  const importModalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(importModalRef, isOpen, () => setIsOpen(false));
  const [csvText, setCsvText] = useState('');
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<string[][]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({}); // field.key -> csvHeader
  const [preview, setPreview] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleParse = () => {
    setError(null);
    if (!csvText.trim()) {
      setError('Please paste some CSV content first.');
      return;
    }

    try {
      // Split rows, handle basic quotes
      const lines = csvText.split(/\r?\n/);
      const rows = lines
        .map(line => {
          // Simple split, handles commas inside quotes roughly
          const matches = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || line.split(',');
          return matches.map(cell => cell.replace(/^"|"$/g, '').trim());
        })
        .filter(row => row.length > 0 && row.some(cell => cell !== ''));

      if (rows.length < 2) {
        setError('CSV must contain a header row and at least one data row.');
        return;
      }

      const headers = rows[0];
      const dataRows = rows.slice(1);

      setParsedHeaders(headers);
      setParsedRows(dataRows);

      // Auto-map based on fuzzy name match
      const initialMappings: Record<string, string> = {};
      fields.forEach(field => {
        const match = headers.find(h => 
          h.toLowerCase() === field.key.toLowerCase() || 
          h.toLowerCase().replace(/[^a-z0-9]/g, '') === field.label.toLowerCase().replace(/[^a-z0-9]/g, '')
        );
        if (match) {
          initialMappings[field.key] = match;
        } else {
          initialMappings[field.key] = '';
        }
      });
      setMappings(initialMappings);
      generatePreview(initialMappings, dataRows, headers);
    } catch (err: any) {
      setError('Failed to parse CSV text: ' + err.message);
    }
  };

  const handleMappingChange = (fieldKey: string, csvHeader: string) => {
    const updated = { ...mappings, [fieldKey]: csvHeader };
    setMappings(updated);
    generatePreview(updated, parsedRows, parsedHeaders);
  };

  const generatePreview = (currentMappings: Record<string, string>, rows: string[][], headers: string[]) => {
    const mapped = rows.slice(0, 5).map(row => {
      const obj: any = {};
      fields.forEach(field => {
        const mappedHeader = currentMappings[field.key];
        const headerIdx = headers.indexOf(mappedHeader);
        if (headerIdx > -1 && row[headerIdx] !== undefined) {
          const val = row[headerIdx];
          // Try to convert to number if possible
          if (!isNaN(Number(val)) && val !== '') {
            obj[field.key] = Number(val);
          } else {
            obj[field.key] = val;
          }
        } else {
          obj[field.key] = field.defaultValue !== undefined ? field.defaultValue : null;
        }
      });
      return obj;
    });
    setPreview(mapped);
  };

  const handleExecuteImport = () => {
    // Check required fields
    const missing = fields.filter(f => f.required && !mappings[f.key]);
    if (missing.length > 0) {
      setError(`Required mappings missing: ${missing.map(m => m.label).join(', ')}`);
      return;
    }

    const allMapped = parsedRows.map(row => {
      const obj: any = {};
      fields.forEach(field => {
        const mappedHeader = mappings[field.key];
        const headerIdx = parsedHeaders.indexOf(mappedHeader);
        if (headerIdx > -1 && row[headerIdx] !== undefined) {
          const val = row[headerIdx];
          if (!isNaN(Number(val)) && val !== '') {
            obj[field.key] = Number(val);
          } else {
            obj[field.key] = val;
          }
        } else {
          obj[field.key] = field.defaultValue !== undefined ? field.defaultValue : null;
        }
      });
      return obj;
    });

    onImport(allMapped);
    setCsvText('');
    setParsedHeaders([]);
    setParsedRows([]);
    setPreview([]);
    setIsOpen(false);
  };

  return (
    <div className="inline-block" id="csv_import_container">
      <button
        id="btn_toggle_import_modal"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg shadow-xs hover:bg-slate-50 focus:outline-hidden"
      >
        <Upload className="w-3.5 h-3.5" />
        {title}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs" role="dialog" aria-modal="true" aria-label="Import data from CSV">
          <div ref={importModalRef} className="bg-white rounded-xl shadow-xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh] border border-slate-100">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
              <button 
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-medium"
              >
                &times;
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Paste CSV Data (Include a header row as the first line)
                </label>
                <textarea aria-label="Csv text"
                  id="csv_textarea"
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  placeholder="SKU,Name,Standard Cost,MOQ&#10;RM-PLP-01,Bleached Fluff Pulp,1.5,20000&#10;RM-NWT-18,Top Sheet Nonwoven,0.8,15000"
                  className="w-full h-32 p-3 text-xs font-mono border border-slate-300 rounded-lg focus:ring-1 focus:ring-brand-500 focus:outline-hidden"
                />
                <div className="flex justify-between items-center mt-2">
                  <span className="text-[10px] text-slate-400">Values can be comma or tab-separated.</span>
                  <button
                    id="btn_parse_csv"
                    onClick={handleParse}
                    className="px-3 py-1 text-xs font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-700"
                  >
                    Parse Data
                  </button>
                </div>
              </div>

              {error && (
                <div className="p-3 bg-red-50 rounded-lg flex items-start gap-2 text-red-700 text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {parsedHeaders.length > 0 && (
                <div className="space-y-4 pt-2 border-t border-slate-100">
                  <div>
                    <h4 className="text-xs font-semibold text-slate-900 mb-2">Map CSV Columns to System Fields</h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-lg border border-slate-100">
                      {fields.map(field => (
                        <div key={field.key} className="space-y-1">
                          <label className="block text-[11px] font-medium text-slate-700">
                            {field.label} {field.required && <span className="text-red-500">*</span>}
                          </label>
                          <select aria-label="Mappings"
                            value={mappings[field.key] || ''}
                            onChange={(e) => handleMappingChange(field.key, e.target.value)}
                            className="w-full p-1.5 text-xs bg-white border border-slate-300 rounded-md focus:ring-1 focus:ring-brand-500"
                          >
                            <option value="">-- Don't Import --</option>
                            {parsedHeaders.map(h => (
                              <option key={h} value={h}>{h}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>

                  {preview.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-slate-900 mb-2">Data Mapping Preview (First 5 Rows)</h4>
                      <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <table className="min-w-full divide-y divide-slate-200 text-left">
                          <thead className="bg-slate-50">
                            <tr>
                              {fields.map(f => (
                                <th key={f.key} className="px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                                  {f.label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-slate-200 text-xs">
                            {preview.map((pRow, idx) => (
                              <tr key={idx} className="hover:bg-slate-50">
                                {fields.map(f => (
                                  <td key={f.key} className="px-3 py-2 text-slate-900 whitespace-nowrap">
                                    {pRow[f.key] !== null ? String(pRow[f.key]) : <span className="text-slate-300 font-mono">null</span>}
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

            <div className="flex justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-100">
              <button
                onClick={() => setIsOpen(false)}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                id="btn_finalize_import"
                disabled={parsedRows.length === 0}
                onClick={handleExecuteImport}
                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Import {parsedRows.length > 0 ? `${parsedRows.length} Rows` : 'Data'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
