/**
 * Catalog tools: materials, products and BOM cost structure.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { engine } from '../engine.js';
import {
  ResponseFormat,
  responseFormatSchema,
  paginationSchema,
  paginate,
  toolResult,
  toolError,
  matchesQuery,
  num,
  sourceFooter,
} from '../format.js';
import type { Material, Product } from '../../../src/types';

export function registerCatalogTools(server: McpServer): void {
  // ── materials ───────────────────────────────────────────────────────────
  server.registerTool(
    'supplychain_list_materials',
    {
      title: 'List Materials',
      description: `List raw materials, packaging and consumables in the planner's master data, with lead times, costs and stocking UOM.

Use this to resolve a material name or SKU to the material_id that the coverage, projection and purchasing tools require.

Args:
  - query (string, optional): case-insensitive substring matched against name, sku and id
  - material_group ('RM' | 'PK' | 'CON', optional): RM = raw material, PK = packaging, CON = consumable
  - status ('running' | 'obsolete', optional): defaults to all
  - origin ('local' | 'foreign', optional)
  - limit (number): 1-200, default 50
  - offset (number): default 0
  - response_format ('markdown' | 'json'): default 'markdown'

Returns JSON with schema:
  {
    "total": number, "count": number, "offset": number,
    "has_more": boolean, "next_offset": number,
    "items": [{
      "id": string,                      // e.g. "MT1" — pass to other tools
      "name": string, "sku": string,
      "material_group": "RM"|"PK"|"CON",
      "uom": string,                     // base stocking UOM, e.g. "KG"
      "origin_type": "local"|"foreign",
      "total_lead_time_days": number,    // supplier + transit + customs
      "moq": number, "standard_cost": number,
      "cost_basis": "standard"|"weighted_avg",
      "safety_stock_months": number,     // 0 means sized from lead time
      "status": "running"|"obsolete"
    }]
  }

Examples:
  - "What's the lead time on fluff pulp?" -> query="pulp"
  - "List every packaging item" -> material_group="PK"
  - Don't use for stock levels or risk — use supplychain_get_material_coverage.`,
      inputSchema: {
        query: z.string().max(120).optional().describe('Substring matched against name, sku and id'),
        material_group: z.enum(['RM', 'PK', 'CON']).optional().describe('RM, PK or CON'),
        status: z.enum(['running', 'obsolete']).optional(),
        origin: z.enum(['local', 'foreign']).optional(),
        ...paginationSchema,
        response_format: responseFormatSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async params => {
      try {
        const materials = await engine.fetchTableData<Material>('materials');
        const categories = await engine.fetchTableData<{ id: string; material_group: string }>(
          'material_categories'
        );
        const groupOf = (m: Material): string =>
          categories.find(c => c.id === m.category_id)?.material_group ?? 'RM';

        const filtered = materials
          .filter(m => matchesQuery(m as unknown as Record<string, unknown>, ['name', 'sku', 'id'], params.query))
          .filter(m => !params.material_group || groupOf(m) === params.material_group)
          .filter(m => !params.status || m.status === params.status)
          .filter(m => !params.origin || m.origin_type === params.origin)
          .map(m => ({
            id: m.id,
            name: m.name,
            sku: m.sku,
            material_group: groupOf(m),
            uom: m.uom ?? 'PCS',
            origin_type: m.origin_type ?? null,
            total_lead_time_days: m.total_lead_time_days,
            moq: m.moq,
            standard_cost: m.standard_cost,
            cost_basis: m.cost_basis,
            safety_stock_months: m.safety_stock_months,
            status: m.status,
          }));

        const page = paginate(filtered, params.limit, params.offset);
        const md = [
          `# Materials (${page.total} matched, showing ${page.count})`,
          '',
          '| ID | Name | SKU | Grp | UOM | Lead | MOQ | Cost | Status |',
          '|----|------|-----|-----|-----|------|-----|------|--------|',
          ...page.items.map(
            m =>
              `| ${m.id} | ${m.name} | ${m.sku} | ${m.material_group} | ${m.uom} | ${m.total_lead_time_days}d | ${num(m.moq, 0)} | ${num(m.standard_cost, 2)} | ${m.status} |`
          ),
          page.has_more ? `\n_${page.total - page.offset - page.count} more — use offset=${page.next_offset}._` : '',
          sourceFooter(),
        ].join('\n');

        return toolResult(md, page as unknown as Record<string, unknown>, params.response_format);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  // ── products ────────────────────────────────────────────────────────────
  server.registerTool(
    'supplychain_list_products',
    {
      title: 'List Finished-Goods Products',
      description: `List finished-goods SKUs with pricing, pack configuration and product line.

Use this to resolve a product name to the product_id required by the BOM cost and product coverage tools.

Args:
  - query (string, optional): substring matched against name, sku and id
  - status ('running' | 'obsolete', optional)
  - product_line (string, optional): machine/line assignment, e.g. "SOFY"
  - limit (number): 1-200, default 50
  - offset (number): default 0
  - response_format ('markdown' | 'json'): default 'markdown'

Returns JSON with schema:
  {
    "total": number, "count": number, "offset": number, "has_more": boolean,
    "items": [{
      "id": string,            // e.g. "P1" — pass to other tools
      "name": string, "sku": string, "brand": string,
      "product_line": string, "pack_type": string, "size": string,
      "selling_price": number, "standard_cost": number,
      "pcs_per_bag": number, "bags_per_carton": number,
      "status": "running"|"obsolete"
    }]
  }

Examples:
  - "What do we sell in the Maxi range?" -> query="maxi"
  - "List everything on the SOFY line" -> product_line="SOFY"`,
      inputSchema: {
        query: z.string().max(120).optional(),
        status: z.enum(['running', 'obsolete']).optional(),
        product_line: z.string().max(60).optional(),
        ...paginationSchema,
        response_format: responseFormatSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async params => {
      try {
        const products = await engine.fetchTableData<Product>('products');
        const filtered = products
          .filter(p => matchesQuery(p as unknown as Record<string, unknown>, ['name', 'sku', 'id'], params.query))
          .filter(p => !params.status || p.status === params.status)
          .filter(
            p =>
              !params.product_line ||
              (p.product_line ?? '').toLowerCase() === params.product_line.toLowerCase()
          )
          .map(p => ({
            id: p.id,
            name: p.name,
            sku: p.sku,
            brand: p.brand,
            product_line: p.product_line,
            pack_type: p.pack_type,
            size: p.size,
            selling_price: p.selling_price,
            standard_cost: p.standard_cost,
            pcs_per_bag: p.pcs_per_bag,
            bags_per_carton: p.bags_per_carton,
            status: p.status,
          }));

        const page = paginate(filtered, params.limit, params.offset);
        const md = [
          `# Products (${page.total} matched, showing ${page.count})`,
          '',
          '| ID | Name | SKU | Line | Size | Price | Status |',
          '|----|------|-----|------|------|-------|--------|',
          ...page.items.map(
            p => `| ${p.id} | ${p.name} | ${p.sku} | ${p.product_line} | ${p.size} | ${num(p.selling_price)} | ${p.status} |`
          ),
          page.has_more ? `\n_Use offset=${page.next_offset} for more._` : '',
          sourceFooter(),
        ].join('\n');

        return toolResult(md, page as unknown as Record<string, unknown>, params.response_format);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  // ── BOM cost ────────────────────────────────────────────────────────────
  server.registerTool(
    'supplychain_get_bom_cost',
    {
      title: 'Get BOM Cost Breakdown',
      description: `Return the full bill-of-materials cost breakdown for one finished-goods product, plus the rolled-up RM/PK/CON split and gross margin.

Quantities are normalised through the UOM conversion table, so a BOM line stated in Grams against a material stocked in KG is converted before costing. Only priority-1 (primary) lines roll into the totals; higher priorities are approved alternates shown for reference.

Args:
  - product_id (string, required): e.g. "P1". Resolve via supplychain_list_products.
  - response_format ('markdown' | 'json'): default 'markdown'

Returns JSON with schema:
  {
    "product_id": string, "product_name": string,
    "selling_price": number,
    "rm_cost": number, "pk_cost": number, "con_cost": number,
    "total_material_cost": number,
    "margin_percent": number | null,
    "lines": [{
      "material_id": string, "material_name": string,
      "slot_name": string,          // BOM function, e.g. "Top Sheet Surface"
      "priority": number,           // 1 = primary (costed), 2+ = alternate
      "qty_per_unit": number,       // as authored, in the BOM's own uom
      "uom": string,
      "scrap_percent": number,
      "unit_cost": number,
      "line_cost": number           // UOM-normalised, scrap-inclusive
    }]
  }

Examples:
  - "What does P1 cost to make?" -> product_id="P1"
  - "Which material dominates the cost of the Maxi?" -> product_id="P1", then read lines

Error Handling:
  - Returns an error naming the product_id if no active BOM exists for it.`,
      inputSchema: {
        product_id: z.string().min(1).describe('Product ID, e.g. "P1"'),
        response_format: responseFormatSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async params => {
      try {
        const [detail, cost, products] = await Promise.all([
          engine.getVBOMCostDetail(params.product_id),
          engine.getVFGCost(params.product_id),
          engine.fetchTableData<Product>('products'),
        ]);

        if (!cost || detail.length === 0) {
          return toolError(
            new Error(`No active BOM found for product "${params.product_id}".`),
            'Confirm the product ID with supplychain_list_products. Products without an active BOM have no cost structure yet.'
          );
        }

        const product = products.find(p => p.id === params.product_id);
        const out = {
          product_id: params.product_id,
          product_name: product?.name ?? params.product_id,
          selling_price: product?.selling_price ?? 0,
          rm_cost: cost.rm_cost,
          pk_cost: cost.pk_cost,
          con_cost: cost.con_cost,
          total_material_cost: cost.total_material_cost,
          margin_percent: cost.margin_percent,
          lines: detail.map(d => ({
            material_id: d.material_id,
            material_name: d.material_name,
            slot_name: d.slot_name,
            priority: d.priority,
            qty_per_unit: d.qty_per_unit,
            uom: d.uom ?? '',
            scrap_percent: d.scrap_percent,
            unit_cost: d.unit_cost,
            line_cost: d.line_cost,
          })),
        };

        const md = [
          `# BOM cost — ${out.product_name} (${out.product_id})`,
          '',
          `- **Selling price**: ${num(out.selling_price)}`,
          `- **Raw materials (RM)**: ${num(out.rm_cost, 4)}`,
          `- **Packaging (PK)**: ${num(out.pk_cost, 4)}`,
          `- **Consumables (CON)**: ${num(out.con_cost, 4)}`,
          `- **Total material cost**: ${num(out.total_material_cost, 4)}`,
          `- **Margin**: ${out.margin_percent === null ? '—' : num(out.margin_percent, 2) + '%'}`,
          '',
          '## Lines',
          '',
          '| Slot | Material | Pri | Qty/unit | UOM | Scrap | Unit cost | Line cost |',
          '|------|----------|-----|----------|-----|-------|-----------|-----------|',
          ...out.lines.map(
            l =>
              `| ${l.slot_name} | ${l.material_name} | ${l.priority}${l.priority === 1 ? '' : ' (alt)'} | ${num(l.qty_per_unit, 4)} | ${l.uom} | ${num(l.scrap_percent, 1)}% | ${num(l.unit_cost, 4)} | ${num(l.line_cost, 6)} |`
          ),
          '',
          '_Only priority-1 lines roll into the totals above._',
          sourceFooter(),
        ].join('\n');

        return toolResult(md, out as unknown as Record<string, unknown>, params.response_format);
      } catch (e) {
        return toolError(e);
      }
    }
  );
}
