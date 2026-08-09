/**
 * Procurement and inbound logistics: purchase orders and shipments.
 * Includes the write tools, which go through the app's own saveRecord so that
 * database rejections (RLS denials in particular) surface as errors rather
 * than being silently written to a local store.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { engine } from '../engine.js';
import {
  responseFormatSchema,
  paginationSchema,
  paginate,
  toolResult,
  toolError,
  num,
  sourceFooter,
} from '../format.js';
import type { PurchaseOrder, Shipment, Material, Supplier } from '../../../src/types';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

export function registerProcurementTools(server: McpServer): void {
  // ── list POs ────────────────────────────────────────────────────────────
  server.registerTool(
    'supplychain_list_purchase_orders',
    {
      title: 'List Purchase Orders',
      description: `List purchase orders with delivery dates, delay against the original commitment, and status.

delay_days is revised_delivery_date minus original_delivery_date: positive means slipped, negative means pulled in.

Args:
  - material_id (string, optional)
  - supplier_id (string, optional)
  - status ('pending' | 'in_transit' | 'completed', optional)
  - delayed_only (boolean): only POs where delay_days > 0 (default false)
  - limit / offset / response_format as usual

Returns JSON with schema:
  {
    "total": number, "count": number, "offset": number, "has_more": boolean,
    "summary": { "delayed": number, "pending": number },
    "items": [{
      "id": string, "order_no": string,
      "material_id": string, "material_name": string,
      "supplier_id": string, "supplier_name": string,
      "qty": number, "remaining_qty": number, "unit_price": number | null,
      "po_date": string, "required_date": string,
      "original_delivery_date": string | null,
      "revised_delivery_date": string | null,
      "delay_days": number,
      "status": "pending"|"in_transit"|"completed",
      "origin_type": "local"|"foreign"|null
    }]
  }

Examples:
  - "Which POs are late?" -> delayed_only=true
  - "Open orders for MT1" -> material_id="MT1", status="pending"`,
      inputSchema: {
        material_id: z.string().optional(),
        supplier_id: z.string().optional(),
        status: z.enum(['pending', 'in_transit', 'completed']).optional(),
        delayed_only: z.boolean().default(false),
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
        const [pos, materials, suppliers] = await Promise.all([
          engine.fetchTableData<PurchaseOrder>('purchase_orders'),
          engine.fetchTableData<Material>('materials'),
          engine.fetchTableData<Supplier>('suppliers'),
        ]);

        const mapped = pos.map(po => {
          const orig = po.original_delivery_date ?? po.required_date ?? po.po_date;
          const rev = po.revised_delivery_date ?? orig;
          const delay =
            orig && rev
              ? Math.round((new Date(rev).getTime() - new Date(orig).getTime()) / 86_400_000)
              : 0;
          return {
            id: po.id,
            order_no: po.order_no,
            material_id: po.material_id,
            material_name: materials.find(m => m.id === po.material_id)?.name ?? po.material_id,
            supplier_id: po.supplier_id,
            supplier_name: suppliers.find(s => s.id === po.supplier_id)?.name ?? po.supplier_id,
            qty: po.qty,
            remaining_qty: po.remaining_qty,
            unit_price: po.unit_price ?? null,
            po_date: po.po_date,
            required_date: po.required_date,
            original_delivery_date: po.original_delivery_date ?? null,
            revised_delivery_date: po.revised_delivery_date ?? null,
            delay_days: delay,
            status: po.status,
            origin_type: po.origin_type ?? null,
          };
        });

        let filtered = mapped
          .filter(p => !params.material_id || p.material_id === params.material_id)
          .filter(p => !params.supplier_id || p.supplier_id === params.supplier_id)
          .filter(p => !params.status || p.status === params.status);
        if (params.delayed_only) filtered = filtered.filter(p => p.delay_days > 0);

        const page = paginate(filtered, params.limit, params.offset);
        const out = {
          summary: {
            delayed: mapped.filter(p => p.delay_days > 0).length,
            pending: mapped.filter(p => p.status === 'pending').length,
          },
          ...page,
        };

        const md = [
          `# Purchase orders (${page.total} matched, showing ${page.count})`,
          '',
          `${out.summary.delayed} delayed, ${out.summary.pending} pending.`,
          '',
          '| PO | Material | Supplier | Qty | Required | Revised | Delay | Status |',
          '|----|----------|----------|-----|----------|---------|-------|--------|',
          ...page.items.map(
            p =>
              `| ${p.order_no} | ${p.material_name} | ${p.supplier_name} | ${num(p.qty, 0)} | ${p.required_date ?? '—'} | ${p.revised_delivery_date ?? '—'} | ${p.delay_days > 0 ? '⚠️ +' + p.delay_days + 'd' : p.delay_days < 0 ? p.delay_days + 'd' : '—'} | ${p.status} |`
          ),
          sourceFooter(),
        ].join('\n');

        return toolResult(md, out as unknown as Record<string, unknown>, params.response_format);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  // ── create PO (WRITE) ───────────────────────────────────────────────────
  server.registerTool(
    'supplychain_create_purchase_order',
    {
      title: 'Create Purchase Order',
      description: `Create a new purchase order.

This WRITES to the planning database. When connected to Supabase the write is subject to Row Level Security: the account must map to a public.users row with role 'planner' or 'admin'. A refusal is reported as an error, never as success.

Quantities must be expressed in the material's BASE stocking UOM (see 'uom' from supplychain_list_materials). Supplying a gram-scale number for a material stocked in KG will corrupt coverage and MRP for that material.

Args:
  - material_id (string, required)
  - supplier_id (string, required)
  - order_no (string, required): human reference, e.g. "PO-2026-114"
  - qty (number, required): positive, in the material's base UOM
  - po_date (string, required): YYYY-MM-DD
  - required_date (string, required): YYYY-MM-DD, when it must arrive
  - unit_price (number, optional): per base UOM; feeds weighted-average costing
  - origin_type ('local' | 'foreign', optional)
  - status ('pending' | 'in_transit' | 'completed'): default 'pending'

Returns JSON with schema:
  { "created": true, "purchase_order": { ...full PO record including generated id } }

Examples:
  - "Order 500 KG of MT1 from S1 for 15 Sept" ->
      material_id="MT1", supplier_id="S1", qty=500, required_date="2026-09-15"

Error Handling:
  - "rejected by the database" means RLS refused the write — the account needs planner or admin.
  - Unknown material_id or supplier_id is rejected before any write is attempted.`,
      inputSchema: {
        material_id: z.string().min(1),
        supplier_id: z.string().min(1),
        order_no: z.string().min(1).max(60),
        qty: z.number().positive('Quantity must be greater than zero'),
        po_date: isoDate,
        required_date: isoDate,
        unit_price: z.number().nonnegative().optional(),
        origin_type: z.enum(['local', 'foreign']).optional(),
        status: z.enum(['pending', 'in_transit', 'completed']).default('pending'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async params => {
      try {
        // Validate references before writing, so a typo produces a clear
        // message instead of a dangling foreign key.
        const [materials, suppliers] = await Promise.all([
          engine.fetchTableData<Material>('materials'),
          engine.fetchTableData<Supplier>('suppliers'),
        ]);
        const material = materials.find(m => m.id === params.material_id);
        if (!material) {
          return toolError(
            new Error(`Unknown material_id "${params.material_id}".`),
            'List valid IDs with supplychain_list_materials.'
          );
        }
        if (!suppliers.some(s => s.id === params.supplier_id)) {
          return toolError(
            new Error(`Unknown supplier_id "${params.supplier_id}".`),
            'Valid supplier IDs appear in the supplier_id field of supplychain_list_purchase_orders.'
          );
        }

        const record: PurchaseOrder = {
          id: '',
          material_id: params.material_id,
          supplier_id: params.supplier_id,
          order_no: params.order_no,
          qty: params.qty,
          remaining_qty: params.qty,
          required_date: params.required_date,
          original_delivery_date: params.required_date,
          revised_delivery_date: params.required_date,
          origin_type: params.origin_type ?? material.origin_type,
          status: params.status,
          timing: 'Normal',
          po_date: params.po_date,
          ...(params.unit_price !== undefined ? { unit_price: params.unit_price } : {}),
        };

        const saved = await engine.saveRecord<PurchaseOrder>('purchase_orders', record);
        const out = { created: true, purchase_order: saved };
        const md = [
          `✅ Created purchase order **${saved.order_no}** (\`${saved.id}\`)`,
          '',
          `- Material: ${material.name} (${saved.material_id})`,
          `- Quantity: ${num(saved.qty, 2)} ${material.uom ?? ''}`,
          `- Required: ${saved.required_date}`,
          `- Status: ${saved.status}`,
          sourceFooter(),
        ].join('\n');
        return toolResult(md, out as unknown as Record<string, unknown>, 'markdown' as never);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  // ── update PO (WRITE) ───────────────────────────────────────────────────
  server.registerTool(
    'supplychain_update_purchase_order',
    {
      title: 'Update Purchase Order',
      description: `Update delivery dates, quantity, price or status on an existing purchase order. Typically used to record a supplier's revised delivery date, which is what drives the delay reporting.

Only the fields you supply are changed; everything else is preserved.

This WRITES to the planning database and is subject to the same RLS rules as creation.

Args:
  - id (string, required): PO record id (the "id" field, not order_no)
  - revised_delivery_date (string, optional): YYYY-MM-DD
  - required_date (string, optional): YYYY-MM-DD
  - qty (number, optional): positive, base UOM
  - remaining_qty (number, optional): non-negative
  - unit_price (number, optional)
  - status ('pending' | 'in_transit' | 'completed', optional)
  - timing ('Normal' | 'Need to be Closed' | 'Check with Proc.', optional)

Returns JSON with schema:
  { "updated": true, "changed_fields": string[], "purchase_order": { ... } }

Examples:
  - "Supplier pushed PO1 to 20 Sept" -> id="PO1", revised_delivery_date="2026-09-20"
  - "Mark PO3 received" -> id="PO3", status="completed", remaining_qty=0

Error Handling:
  - Returns an error naming the id if no such PO exists.`,
      inputSchema: {
        id: z.string().min(1).describe('Purchase order record id, e.g. "PO1"'),
        revised_delivery_date: isoDate.optional(),
        required_date: isoDate.optional(),
        qty: z.number().positive().optional(),
        remaining_qty: z.number().nonnegative().optional(),
        unit_price: z.number().nonnegative().optional(),
        status: z.enum(['pending', 'in_transit', 'completed']).optional(),
        timing: z.enum(['Normal', 'Need to be Closed', 'Check with Proc.']).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async params => {
      try {
        const pos = await engine.fetchTableData<PurchaseOrder>('purchase_orders');
        const existing = pos.find(p => p.id === params.id);
        if (!existing) {
          return toolError(
            new Error(`No purchase order with id "${params.id}".`),
            'Find the correct id with supplychain_list_purchase_orders (use the "id" field, not "order_no").'
          );
        }

        const patch: Partial<PurchaseOrder> = {};
        const changed: string[] = [];
        const assign = <K extends keyof PurchaseOrder>(k: K, v: PurchaseOrder[K] | undefined) => {
          if (v !== undefined) {
            patch[k] = v;
            changed.push(k as string);
          }
        };
        assign('revised_delivery_date', params.revised_delivery_date);
        assign('required_date', params.required_date);
        assign('qty', params.qty);
        assign('remaining_qty', params.remaining_qty);
        assign('unit_price', params.unit_price);
        assign('status', params.status);
        assign('timing', params.timing);

        if (!changed.length) {
          return toolError(
            new Error('No fields supplied to update.'),
            'Pass at least one changeable field, e.g. revised_delivery_date or status.'
          );
        }

        const saved = await engine.saveRecord<PurchaseOrder>('purchase_orders', {
          ...existing,
          ...patch,
        });
        const out = { updated: true, changed_fields: changed, purchase_order: saved };
        const md = [
          `✅ Updated purchase order **${saved.order_no}** (\`${saved.id}\`)`,
          '',
          `Changed: ${changed.join(', ')}`,
          '',
          `- Required: ${saved.required_date} · Revised: ${saved.revised_delivery_date ?? '—'}`,
          `- Qty ${num(saved.qty, 2)} (remaining ${num(saved.remaining_qty, 2)}) · Status ${saved.status}`,
          sourceFooter(),
        ].join('\n');
        return toolResult(md, out as unknown as Record<string, unknown>, 'markdown' as never);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  // ── list shipments ──────────────────────────────────────────────────────
  server.registerTool(
    'supplychain_list_shipments',
    {
      title: 'List Inbound Shipments',
      description: `List inbound shipments with ETD, port ETA, customs days and factory arrival.

A shipment is in transit exactly while factory_arrival_date is null; once set, it has landed and no longer counts as incoming stock in coverage calculations.

Args:
  - material_id (string, optional)
  - in_transit_only (boolean): only shipments not yet arrived (default false)
  - ship_method ('sea' | 'air' | 'land', optional)
  - limit / offset / response_format as usual

Returns JSON with schema:
  {
    "total": number, "count": number, "has_more": boolean,
    "summary": { "in_transit": number, "arrived": number },
    "items": [{
      "id": string, "invoice_no": string, "bl_no": string | null,
      "material_id": string, "material_name": string,
      "supplier_name": string, "po_id": string | null,
      "qty": number, "container_count": number | null,
      "ship_method": string | null, "port_name": string | null,
      "etd": string | null, "port_eta": string | null,
      "customs_clearance_days": number,
      "factory_arrival_date": string | null,   // null = still in transit
      "in_transit": boolean, "delay": number
    }]
  }

Examples:
  - "What's on the water?" -> in_transit_only=true`,
      inputSchema: {
        material_id: z.string().optional(),
        in_transit_only: z.boolean().default(false),
        ship_method: z.enum(['sea', 'air', 'land']).optional(),
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
        const [shipments, materials, suppliers] = await Promise.all([
          engine.fetchTableData<Shipment>('shipments'),
          engine.fetchTableData<Material>('materials'),
          engine.fetchTableData<Supplier>('suppliers'),
        ]);

        const mapped = shipments.map(s => ({
          id: s.id,
          invoice_no: s.invoice_no,
          bl_no: s.bl_no ?? null,
          material_id: s.material_id,
          material_name: materials.find(m => m.id === s.material_id)?.name ?? s.material_id,
          supplier_name: suppliers.find(x => x.id === s.supplier_id)?.name ?? s.supplier_id,
          po_id: s.po_id ?? null,
          qty: s.qty,
          container_count: s.container_count ?? null,
          ship_method: s.ship_method ?? null,
          port_name: s.port_name ?? null,
          etd: s.etd ?? null,
          port_eta: s.port_eta ?? null,
          customs_clearance_days: s.customs_clearance_days ?? 0,
          factory_arrival_date: s.factory_arrival_date,
          in_transit: s.factory_arrival_date === null,
          delay: s.delay,
        }));

        let filtered = mapped
          .filter(s => !params.material_id || s.material_id === params.material_id)
          .filter(s => !params.ship_method || s.ship_method === params.ship_method);
        if (params.in_transit_only) filtered = filtered.filter(s => s.in_transit);

        const page = paginate(filtered, params.limit, params.offset);
        const out = {
          summary: {
            in_transit: mapped.filter(s => s.in_transit).length,
            arrived: mapped.filter(s => !s.in_transit).length,
          },
          ...page,
        };

        const md = [
          `# Shipments (${page.total} matched, showing ${page.count})`,
          '',
          `${out.summary.in_transit} in transit, ${out.summary.arrived} arrived.`,
          '',
          '| Invoice | Material | Qty | Method | Port ETA | Factory | State |',
          '|---------|----------|-----|--------|----------|---------|-------|',
          ...page.items.map(
            s =>
              `| ${s.invoice_no} | ${s.material_name} | ${num(s.qty, 0)} | ${s.ship_method ?? '—'} | ${s.port_eta ?? '—'} | ${s.factory_arrival_date ?? '—'} | ${s.in_transit ? '🚢 in transit' : '✅ arrived'} |`
          ),
          sourceFooter(),
        ].join('\n');

        return toolResult(md, out as unknown as Record<string, unknown>, params.response_format);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  // ── record shipment arrival (WRITE) ─────────────────────────────────────
  server.registerTool(
    'supplychain_record_shipment_arrival',
    {
      title: 'Record Shipment Factory Arrival',
      description: `Record that an inbound shipment has arrived at the factory, by setting its factory_arrival_date.

This matters beyond bookkeeping: coverage and MRP treat a shipment as incoming stock only while factory_arrival_date is null. Setting it moves the quantity from "in transit" to "on hand" in every downstream calculation, so record arrivals promptly or coverage will overstate incoming supply.

This WRITES to the planning database and is subject to RLS (planner or admin).

Args:
  - id (string, required): shipment record id
  - factory_arrival_date (string, required): YYYY-MM-DD
  - delay (number, optional): days late against the original commitment; recalculated automatically when omitted

Returns JSON with schema:
  { "updated": true, "shipment": { ... }, "delay_days": number }

Examples:
  - "SH2 landed today" -> id="SH2", factory_arrival_date="2026-08-08"`,
      inputSchema: {
        id: z.string().min(1).describe('Shipment record id, e.g. "SH2"'),
        factory_arrival_date: isoDate,
        delay: z.number().int().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async params => {
      try {
        const shipments = await engine.fetchTableData<Shipment>('shipments');
        const existing = shipments.find(s => s.id === params.id);
        if (!existing) {
          return toolError(
            new Error(`No shipment with id "${params.id}".`),
            'Find the correct id with supplychain_list_shipments.'
          );
        }

        const baseline = existing.original_delivery_date ?? existing.port_eta ?? null;
        const computedDelay =
          params.delay ??
          (baseline
            ? Math.round(
                (new Date(params.factory_arrival_date).getTime() - new Date(baseline).getTime()) /
                  86_400_000
              )
            : existing.delay);

        const saved = await engine.saveRecord<Shipment>('shipments', {
          ...existing,
          factory_arrival_date: params.factory_arrival_date,
          revised_delivery_date: params.factory_arrival_date,
          delay: computedDelay,
        });

        const out = { updated: true, shipment: saved, delay_days: computedDelay };
        const md = [
          `✅ Recorded arrival of shipment **${saved.invoice_no}** (\`${saved.id}\`)`,
          '',
          `- Factory arrival: ${saved.factory_arrival_date}`,
          `- Delay vs original commitment: ${computedDelay > 0 ? `⚠️ ${computedDelay} day(s) late` : computedDelay < 0 ? `${Math.abs(computedDelay)} day(s) early` : 'on time'}`,
          '',
          '_This quantity now counts as on-hand rather than in-transit in coverage and MRP._',
          sourceFooter(),
        ].join('\n');
        return toolResult(md, out as unknown as Record<string, unknown>, 'markdown' as never);
      } catch (e) {
        return toolError(e);
      }
    }
  );
}
