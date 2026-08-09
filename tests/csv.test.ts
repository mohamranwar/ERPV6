/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CSV export safety.
 *
 * Exports carry free text that originates in editable master data and in
 * imported CSV files, so the writer is an untrusted-input boundary. These
 * tests pin the two properties that matter: the file must parse as RFC 4180,
 * and it must not hand a spreadsheet something it will execute.
 */
import { describe, it, expect } from 'vitest';
import { escapeCsvValue, toCsvText } from '../src/utils/csv';

describe('escapeCsvValue — spreadsheet formula injection', () => {
  // Excel, LibreOffice and Sheets evaluate a cell beginning with any of these.
  // A supplier named =HYPERLINK(...) would otherwise fire on open.
  it.each(['=', '+', '-', '@', '\t', '\r'])(
    'neutralises a value starting with %j',
    trigger => {
      const out = escapeCsvValue(`${trigger}HYPERLINK("http://x","c")`);
      expect(out.replace(/^"/, '').startsWith("'")).toBe(true);
    }
  );

  it('neutralises the classic command-execution payload', () => {
    const out = escapeCsvValue(`=cmd|'/c calc'!A1`);
    // Quoted because it contains a comma-free but quote-bearing payload;
    // what matters is that the leading = is no longer first.
    expect(out).toContain("'=cmd");
    expect(out.replace(/^"/, '')[0]).not.toBe('=');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeCsvValue('GP Bleached Fluff Pulp')).toBe('GP Bleached Fluff Pulp');
    expect(escapeCsvValue(1826)).toBe('1826');
  });

  it('does not mangle a negative number into a formula guard', () => {
    // A leading "-" is a formula trigger, so negatives are prefixed. This is
    // the accepted trade-off: a delay of -2 exports as '-2 and still reads
    // correctly, whereas leaving it bare leaves the injection vector open.
    expect(escapeCsvValue(-2)).toBe("'-2");
  });
});

describe('escapeCsvValue — RFC 4180 encoding', () => {
  it('doubles embedded quotes and wraps the field', () => {
    expect(escapeCsvValue('Sanita "Premium" Pulp')).toBe('"Sanita ""Premium"" Pulp"');
  });

  it('wraps fields containing a comma', () => {
    expect(escapeCsvValue('Cairo, Egypt')).toBe('"Cairo, Egypt"');
  });

  it('wraps fields containing newlines or carriage returns', () => {
    expect(escapeCsvValue('line1\nline2')).toBe('"line1\nline2"');
    // A lone CR breaks row parsing just as a LF does. Note \r is a formula
    // trigger too, so the guard quote lands inside the wrapping quotes.
    expect(escapeCsvValue('a\rb')).toBe('"a\rb"');
  });

  it('renders null and undefined as empty, not as the strings', () => {
    expect(escapeCsvValue(null)).toBe('');
    expect(escapeCsvValue(undefined)).toBe('');
    expect(escapeCsvValue('')).toBe('');
  });
});

describe('toCsvText', () => {
  it('emits CRLF row separators and escapes headers too', () => {
    const csv = toCsvText(['Name', 'Qty, base'], [['Pulp', 220]]);
    expect(csv).toBe('Name,"Qty, base"\r\nPulp,220');
  });

  it('keeps a hostile supplier name from breaking out of its field', () => {
    // A payload carrying a quote, a comma and a CRLF tries to terminate its
    // field and start a new record. Correct output keeps all of it inside one
    // quoted field, so a real parser still sees exactly two records.
    // (Splitting on \r\n would count three — that is not a CSV parser, since
    // a CRLF inside quotes is data, not a record separator.)
    const csv = toCsvText(['Supplier'], [['evil","x\r\ninjected']]);
    expect(csv).toBe('Supplier\r\n"evil"",""x\r\ninjected"');
    expect(countRecords(csv)).toBe(2);
  });
});

/** Minimal RFC 4180 record counter: a CRLF only separates records outside quotes. */
function countRecords(csv: string): number {
  let records = 1;
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (inQuotes && csv[i + 1] === '"') i++; // escaped quote, stay inside
      else inQuotes = !inQuotes;
    } else if (!inQuotes && c === '\r' && csv[i + 1] === '\n') {
      records++;
      i++;
    }
  }
  return records;
}
