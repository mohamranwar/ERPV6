/**
 * Customs clearance: jobs, per-container timelines, documents and charges.
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
import type {
  ClearanceJob,
  ClearanceContainer,
  ClearanceDocument,
  ClearanceCharge,
  ClearanceCompany,
  Shipment,
  Material,
} from '../../../src/types';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

function daysBetween(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null;
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

export function registerClearanceTools(server: McpServer): void {
  // ── list clearance jobs ─────────────────────────────────────────────────
  server.registerTool(
    'supplychain_list_clearance_jobs',
    {
      title: 'List Customs Clearance Jobs',
      description: `List customs clearance jobs with port-to-factory cycle time, container progress, outstanding documents and accrued demurrage.

Containers are tracked individually because a shipment can be partially released: each container moves through exam, release and delivery on its own timeline and accrues demurrage separately.

Charges are landed-cost reporting only. They deliberately do NOT feed BOM cost or product margin.

Args:
  - status ('pending' | 'in_progress' | 'partial_release' | 'cleared' | 'held', optional)
  - include_detail (boolean): include per-container, document and charge detail (default true)
  - limit / offset / response_format as usual

Returns JSON with schema:
  {
    "total": number, "count": number, "has_more": boolean,
    "summary": {
      "active_jobs": number,
      "avg_cycle_time_days": number | null,   // port arrival -> factory, cleared jobs only
      "total_demurrage_days": number,
      "containers_awaiting_delivery": number,
      "pending_documents": number
    },
    "items": [{
      "id": string, "shipment_id": string, "invoice_no": string | null,
      "material_name": string, "company_name": string,
      "status": string,
      "port_arrival_date": string | null,
      "planned_factory_date": string | null,
      "actual_factory_date": string | null,
      "cycle_time_days": number | null,
      "container_count": number,
      "containers_delivered": number,
      "pending_document_count": number,
      "demurrage_days": number,
      "charges_by_currency": { "<CUR>": number },
      "containers": [{ "container_no": string, "status": string,
                       "port_arrival_date": string|null, "customs_exam_date": string|null,
                       "release_date": string|null, "factory_arrival_date": string|null,
                       "demurrage_days": number, "detention_days": number }],
      "documents": [{ "doc_type": string, "status": string, "doc_ref": string|null }],
      "charges":   [{ "charge_type": string, "currency": string, "amount": number, "paid": boolean }]
    }]
  }

Examples:
  - "What's stuck in customs?" -> status="in_progress"
  - "How much demurrage are we accruing?" -> read summary.total_demurrage_days
  - "Which jobs are missing paperwork?" -> read pending_document_count per item`,
      inputSchema: {
        status: z
          .enum(['pending', 'in_progress', 'partial_release', 'cleared', 'held'])
          .optional(),
        include_detail: z.boolean().default(true),
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
        const [jobs, containers, documents, charges, companies, shipments, materials] =
          await Promise.all([
            engine.fetchTableData<ClearanceJob>('clearance_jobs'),
            engine.fetchTableData<ClearanceContainer>('clearance_containers'),
            engine.fetchTableData<ClearanceDocument>('clearance_documents'),
            engine.fetchTableData<ClearanceCharge>('clearance_charges'),
            engine.fetchTableData<ClearanceCompany>('clearance_companies'),
            engine.fetchTableData<Shipment>('shipments'),
            engine.fetchTableData<Material>('materials'),
          ]);

        const mapped = jobs.map(j => {
          const jobCtrs = containers.filter(c => c.job_id === j.id);
          const jobDocs = documents.filter(d => d.job_id === j.id);
          const jobChgs = charges.filter(c => c.job_id === j.id);
          const shipment = shipments.find(s => s.id === j.shipment_id);
          const material = materials.find(m => m.id === shipment?.material_id);

          const byCurrency: Record<string, number> = {};
          for (const c of jobChgs) byCurrency[c.currency] = (byCurrency[c.currency] ?? 0) + c.amount;

          return {
            id: j.id,
            shipment_id: j.shipment_id,
            invoice_no: shipment?.invoice_no ?? null,
            material_name: material?.name ?? shipment?.material_id ?? '—',
            company_name: companies.find(c => c.id === j.company_id)?.name ?? j.company_id,
            status: j.status,
            port_arrival_date: j.port_arrival_date ?? null,
            planned_factory_date: j.planned_factory_date ?? null,
            actual_factory_date: j.actual_factory_date ?? null,
            cycle_time_days: daysBetween(
              j.port_arrival_date,
              j.actual_factory_date ?? j.planned_factory_date
            ),
            container_count: jobCtrs.length,
            containers_delivered: jobCtrs.filter(c => c.status === 'delivered').length,
            pending_document_count: jobDocs.filter(d => d.status === 'pending').length,
            demurrage_days: jobCtrs.reduce((s, c) => s + (c.demurrage_days ?? 0), 0),
            charges_by_currency: byCurrency,
            ...(params.include_detail
              ? {
                  containers: jobCtrs.map(c => ({
                    container_no: c.container_no,
                    status: c.status,
                    port_arrival_date: c.port_arrival_date ?? null,
                    customs_exam_date: c.customs_exam_date ?? null,
                    release_date: c.release_date ?? null,
                    factory_arrival_date: c.factory_arrival_date ?? null,
                    demurrage_days: c.demurrage_days ?? 0,
                    detention_days: c.detention_days ?? 0,
                  })),
                  documents: jobDocs.map(d => ({
                    doc_type: d.doc_type,
                    status: d.status,
                    doc_ref: d.doc_ref ?? null,
                  })),
                  charges: jobChgs.map(c => ({
                    charge_type: c.charge_type,
                    currency: c.currency,
                    amount: c.amount,
                    paid: Boolean(c.paid_date),
                  })),
                }
              : {}),
          };
        });

        const cycleTimes = mapped
          .map(m => (m.actual_factory_date ? m.cycle_time_days : null))
          .filter((n): n is number => n !== null);

        const summary = {
          active_jobs: mapped.filter(
            m => m.status === 'in_progress' || m.status === 'partial_release'
          ).length,
          avg_cycle_time_days: cycleTimes.length
            ? Math.round(cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length)
            : null,
          total_demurrage_days: mapped.reduce((s, m) => s + m.demurrage_days, 0),
          containers_awaiting_delivery: containers.filter(c => c.status === 'released').length,
          pending_documents: mapped.reduce((s, m) => s + m.pending_document_count, 0),
        };

        const filtered = params.status ? mapped.filter(m => m.status === params.status) : mapped;
        const page = paginate(filtered, params.limit, params.offset);
        const out = { summary, ...page };

        const md = [
          `# Customs clearance jobs (${page.total} matched, showing ${page.count})`,
          '',
          `${summary.active_jobs} active · avg cycle time ${summary.avg_cycle_time_days ?? '—'} days · ${summary.total_demurrage_days} demurrage days accrued · ${summary.pending_documents} document(s) outstanding`,
          '',
          '| Job | Material | Agent | Status | Port | Factory | Cycle | Containers | Docs due | Demurrage |',
          '|-----|----------|-------|--------|------|---------|-------|-----------|----------|-----------|',
          ...page.items.map(
            j =>
              `| ${j.id} | ${j.material_name} | ${j.company_name} | ${j.status.replace(/_/g, ' ')} | ${j.port_arrival_date ?? '—'} | ${j.actual_factory_date ?? j.planned_factory_date ?? '—'}${j.actual_factory_date ? '' : ' _(plan)_'} | ${j.cycle_time_days ?? '—'}d | ${j.containers_delivered}/${j.container_count} | ${j.pending_document_count > 0 ? '⚠️ ' + j.pending_document_count : '—'} | ${j.demurrage_days > 0 ? j.demurrage_days + 'd' : '—'} |`
          ),
          sourceFooter(),
        ].join('\n');

        return toolResult(md, out as unknown as Record<string, unknown>, params.response_format);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  // ── update clearance job (WRITE) ────────────────────────────────────────
  server.registerTool(
    'supplychain_update_clearance_job',
    {
      title: 'Update Customs Clearance Job',
      description: `Update the status, dates or notes on a customs clearance job.

Only the fields you supply are changed.

This WRITES to the planning database and is subject to RLS (planner or admin).

Args:
  - id (string, required): clearance job id, e.g. "CJ1"
  - status ('pending' | 'in_progress' | 'partial_release' | 'cleared' | 'held', optional)
  - port_arrival_date (string, optional): YYYY-MM-DD
  - planned_factory_date (string, optional): YYYY-MM-DD
  - actual_factory_date (string, optional): YYYY-MM-DD — setting this completes the cycle
  - notes (string, optional)

Returns JSON with schema:
  { "updated": true, "changed_fields": string[], "job": { ... }, "cycle_time_days": number | null }

Examples:
  - "CJ1 cleared customs today" -> id="CJ1", status="cleared", actual_factory_date="2026-08-08"
  - "Put CJ1 on hold, missing certificate of origin" -> id="CJ1", status="held", notes="..."`,
      inputSchema: {
        id: z.string().min(1),
        status: z
          .enum(['pending', 'in_progress', 'partial_release', 'cleared', 'held'])
          .optional(),
        port_arrival_date: isoDate.optional(),
        planned_factory_date: isoDate.optional(),
        actual_factory_date: isoDate.optional(),
        notes: z.string().max(1000).optional(),
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
        const jobs = await engine.fetchTableData<ClearanceJob>('clearance_jobs');
        const existing = jobs.find(j => j.id === params.id);
        if (!existing) {
          return toolError(
            new Error(`No clearance job with id "${params.id}".`),
            'Find the correct id with supplychain_list_clearance_jobs.'
          );
        }

        const patch: Partial<ClearanceJob> = {};
        const changed: string[] = [];
        const assign = <K extends keyof ClearanceJob>(k: K, v: ClearanceJob[K] | undefined) => {
          if (v !== undefined) {
            patch[k] = v;
            changed.push(k as string);
          }
        };
        assign('status', params.status);
        assign('port_arrival_date', params.port_arrival_date);
        assign('planned_factory_date', params.planned_factory_date);
        assign('actual_factory_date', params.actual_factory_date);
        assign('notes', params.notes);

        if (!changed.length) {
          return toolError(
            new Error('No fields supplied to update.'),
            'Pass at least one changeable field, e.g. status or actual_factory_date.'
          );
        }

        const saved = await engine.saveRecord<ClearanceJob>('clearance_jobs', {
          ...existing,
          ...patch,
        });
        const cycle = daysBetween(saved.port_arrival_date, saved.actual_factory_date);
        const out = { updated: true, changed_fields: changed, job: saved, cycle_time_days: cycle };
        const md = [
          `✅ Updated clearance job \`${saved.id}\``,
          '',
          `Changed: ${changed.join(', ')}`,
          '',
          `- Status: ${saved.status.replace(/_/g, ' ')}`,
          `- Port arrival: ${saved.port_arrival_date ?? '—'} · Factory: ${saved.actual_factory_date ?? saved.planned_factory_date ?? '—'}`,
          cycle !== null ? `- Port-to-factory cycle time: **${cycle} days**` : '',
          sourceFooter(),
        ].join('\n');
        return toolResult(md, out as unknown as Record<string, unknown>, 'markdown' as never);
      } catch (e) {
        return toolError(e);
      }
    }
  );
}
