/**
 * Shared response utilities.
 *
 * Every tool routes its output through here so pagination metadata, truncation
 * behaviour, error shape and the markdown/JSON split stay identical across the
 * whole server rather than being reinvented per tool.
 */
import { z } from 'zod';
import { dataSource } from './engine.js';

/** Maximum characters in a single tool response before truncation kicks in. */
export const CHARACTER_LIMIT = 25_000;

export enum ResponseFormat {
  MARKDOWN = 'markdown',
  JSON = 'json',
}

export const responseFormatSchema = z
  .nativeEnum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe("Output format: 'markdown' for human-readable, 'json' for machine-readable");

export const paginationSchema = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(50)
    .describe('Maximum number of items to return (1-200, default 50)'),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Number of items to skip, for paging through results (default 0)'),
};

export interface Paged<T> {
  total: number;
  count: number;
  offset: number;
  items: T[];
  has_more: boolean;
  next_offset?: number;
}

/** Slices a fully-materialised array into a paginated envelope. */
export function paginate<T>(all: T[], limit: number, offset: number): Paged<T> {
  const items = all.slice(offset, offset + limit);
  const hasMore = all.length > offset + items.length;
  return {
    total: all.length,
    count: items.length,
    offset,
    items,
    has_more: hasMore,
    ...(hasMore ? { next_offset: offset + items.length } : {}),
  };
}

/**
 * MCP tool result shape. The index signature is required: the SDK's
 * CallToolResult permits arbitrary extra keys, and without it TypeScript
 * refuses to accept this narrower type as a handler return value.
 */
export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Builds a tool result, enforcing CHARACTER_LIMIT.
 *
 * Truncation drops items rather than slicing the string, so the response stays
 * valid JSON and the agent is told exactly how to get the rest instead of
 * being handed a corrupted payload.
 */
export function toolResult(
  markdown: string,
  structured: Record<string, unknown>,
  format: ResponseFormat
): ToolResult {
  let text = format === ResponseFormat.MARKDOWN ? markdown : JSON.stringify(structured, null, 2);

  if (text.length > CHARACTER_LIMIT) {
    const items = (structured as { items?: unknown[] }).items;
    if (Array.isArray(items) && items.length > 1) {
      const keep = Math.max(1, Math.floor(items.length / 2));
      const truncated = {
        ...structured,
        items: items.slice(0, keep),
        count: keep,
        truncated: true,
        truncation_message:
          `Response truncated from ${items.length} to ${keep} items to stay within the ` +
          `${CHARACTER_LIMIT}-character limit. Use 'offset' to page through the rest, ` +
          `or narrow the query with the available filters.`,
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(truncated, null, 2) }],
        structuredContent: truncated,
      };
    }
    text =
      text.slice(0, CHARACTER_LIMIT) +
      `\n\n[truncated at ${CHARACTER_LIMIT} characters — narrow the query to see the rest]`;
  }

  return { content: [{ type: 'text', text }], structuredContent: structured };
}

/**
 * Converts a thrown value into an actionable tool error.
 *
 * Error text is written for an agent that has to decide what to do next, so it
 * names the likely cause and a concrete remedy rather than just restating the
 * exception.
 */
export function toolError(error: unknown, hint?: string): ToolResult {
  const raw = error instanceof Error ? error.message : String(error);
  let guidance = hint ?? '';

  if (/rejected by the database|row-level security|violates row-level/i.test(raw)) {
    guidance =
      'The database refused this write. The account behind SUPABASE_ANON_KEY needs a ' +
      "row in public.users with role 'planner' or 'admin' and status 'active' " +
      '(see section 10 of schema.sql).';
  } else if (/affected no rows/i.test(raw)) {
    guidance =
      'Either the record ID does not exist, or your account lacks permission to change it. ' +
      'Confirm the ID with the matching list tool first.';
  } else if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(raw)) {
    guidance =
      'Could not reach Supabase. Check SUPABASE_URL is correct and the project is running. ' +
      'Unset both env vars to fall back to the offline seed dataset.';
  }

  return {
    isError: true,
    content: [{ type: 'text', text: guidance ? `Error: ${raw}\n\n${guidance}` : `Error: ${raw}` }],
  };
}

/** Numbers in this domain are quantities; keep them readable but exact. */
export function num(n: number | null | undefined, dp = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const rounded = Number(n.toFixed(dp));
  return rounded.toLocaleString('en-US', { maximumFractionDigits: dp });
}

/** Standard footer so every response states which dataset produced it. */
export function sourceFooter(): string {
  return `\n\n_Source: ${dataSource === 'supabase' ? 'live Supabase database' : 'offline seed dataset (demo data)'}._`;
}

/** Case-insensitive substring match across the given fields. */
export function matchesQuery(record: Record<string, unknown>, fields: string[], q?: string): boolean {
  if (!q || !q.trim()) return true;
  const needle = q.trim().toLowerCase();
  return fields.some(f => String(record[f] ?? '').toLowerCase().includes(needle));
}
