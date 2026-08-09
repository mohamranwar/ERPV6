/**
 * Planning tools: stock coverage, monthly projection, MRP, PSI and variance.
 * These are the analytical core — the questions a planner actually asks.
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

const periodSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Period must be a YYYY-MM-DD date, normally the 1st of a month')
  .optional()
  .describe('Planning period start, e.g. "2026-08-01". Defaults to the currently selected period.');

export function registerPlanningTools(server: McpServer): void {
  // ── material coverage ───────────────────────────────────────────────────
  server.registerTool(
    'supplychain_get_material_coverage',
    {
      title: 'Get Material Stock Coverage',
      description: `Months of stock cover per material, with out-of-stock and overstock risk flags. This is the primary "what is at risk" tool.

Coverage counts opening stock plus in-transit shipments plus pending purchase orders, divided by the period's demand exploded through the BOM. A shipment counts as in-transit only while its factory_arrival_date is null.

When a period has no forecast, monthly_demand is 0 and coverage is reported as "no forecast" rather than being filled in with a fallback number.

Args:
  - period (string, optional): YYYY-MM-DD, e.g. "2026-08-01"
  - demand_basis ('forecast' | 'sales'): forecast uses the sales plan, sales uses recorded actuals (default 'forecast')
  - risk_only (boolean): return only materials flagged at risk or overstocked (default false)
  - sort_by ('coverage' | 'name'): default 'coverage' (lowest cover first — most urgent)
  - limit (number): 1-200, default 50
  - offset (number): default 0
  - response_format ('markdown' | 'json'): default 'markdown'

Returns JSON with schema:
  {
    "period": string, "demand_basis": string,
    "total": number, "count": number, "offset": number, "has_more": boolean,
    "summary": { "at_risk": number, "overstocked": number, "no_forecast": number },
    "items": [{
      "material_id": string, "material_name": string, "sku": string,
      "material_group": "RM"|"PK"|"CON",
      "opening_stock": number,
      "monthly_demand": number,           // 0 means no forecast this period
      "coverage_months": number,          // includes in-transit + pending POs
      "coverage_months_no_transit": number,
      "oos_risk_flag": boolean,
      "overstock_flag": boolean,
      "has_forecast": boolean
    }]
  }

Examples:
  - "What's at risk this month?" -> risk_only=true
  - "Coverage for August" -> period="2026-08-01"
  - "Are we overstocked anywhere?" -> risk_only=true, then filter overstock_flag`,
      inputSchema: {
        period: periodSchema,
        demand_basis: z.enum(['forecast', 'sales']).default('forecast'),
        risk_only: z.boolean().default(false).describe('Only return flagged materials'),
        sort_by: z.enum(['coverage', 'name']).default('coverage'),
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
        const period = params.period ?? engine.getPlanningPeriod();
        const rows = await engine.getVMaterialCoverage(params.demand_basis, period);

        const mapped = rows.map(r => ({
          material_id: r.material_id,
          material_name: r.material_name,
          sku: r.sku,
          material_group: r.material_group,
          opening_stock: r.opening_stock,
          monthly_demand: r.monthly_demand,
          coverage_months: r.coverage_months,
          coverage_months_no_transit: r.coverage_months_no_transit,
          oos_risk_flag: r.oos_risk_flag,
          overstock_flag: r.overstock_flag,
          has_forecast: r.monthly_demand > 0,
        }));

        const summary = {
          at_risk: mapped.filter(m => m.oos_risk_flag).length,
          overstocked: mapped.filter(m => m.overstock_flag).length,
          no_forecast: mapped.filter(m => !m.has_forecast).length,
        };

        let filtered = params.risk_only
          ? mapped.filter(m => m.oos_risk_flag || m.overstock_flag)
          : mapped;
        filtered =
          params.sort_by === 'name'
            ? [...filtered].sort((a, b) => a.material_name.localeCompare(b.material_name))
            : [...filtered].sort((a, b) => a.coverage_months - b.coverage_months);

        const page = paginate(filtered, params.limit, params.offset);
        const out = { period, demand_basis: params.demand_basis, summary, ...page };

        const md = [
          `# Material coverage — ${engine.formatPlanningPeriod(period)}`,
          '',
          `Demand basis: **${params.demand_basis}**. ${summary.at_risk} at risk, ${summary.overstocked} overstocked, ${summary.no_forecast} with no forecast.`,
          '',
          '| Material | SKU | Grp | Stock | Demand/mo | Cover | Flag |',
          '|----------|-----|-----|-------|-----------|-------|------|',
          ...page.items.map(m => {
            const flag = m.oos_risk_flag ? '🔴 OOS risk' : m.overstock_flag ? '🔵 overstock' : '🟢 ok';
            const cover = m.has_forecast ? `${num(m.coverage_months, 2)} mo` : '_no forecast_';
            return `| ${m.material_name} | ${m.sku} | ${m.material_group} | ${num(m.opening_stock, 1)} | ${m.has_forecast ? num(m.monthly_demand, 1) : '—'} | ${cover} | ${flag} |`;
          }),
          page.has_more ? `\n_Use offset=${page.next_offset} for more._` : '',
          sourceFooter(),
        ].join('\n');

        return toolResult(md, out as unknown as Record<string, unknown>, params.response_format);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  // ── product coverage ────────────────────────────────────────────────────
  server.registerTool(
    'supplychain_get_product_coverage',
    {
      title: 'Get Finished-Goods Coverage',
      description: `Months of finished-goods stock cover per product against demand, with a below-safety flag.

Args:
  - period (string, optional): YYYY-MM-DD
  - demand_basis ('forecast' | 'sales'): default 'forecast'
  - risk_only (boolean): only products below safety (default false)
  - limit / offset / response_format as usual

Returns JSON with schema:
  {
    "period": string, "demand_basis": string,
    "total": number, "count": number, "has_more": boolean,
    "items": [{
      "product_id": string, "product_name": string, "sku": string,
      "product_line": string,
      "opening_stock": number, "monthly_demand": number,
      "coverage_months": number, "below_safety_flag": boolean
    }]
  }

Examples:
  - "Which finished goods run out first?" -> risk_only=true`,
      inputSchema: {
        period: periodSchema,
        demand_basis: z.enum(['forecast', 'sales']).default('forecast'),
        risk_only: z.boolean().default(false),
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
        const period = params.period ?? engine.getPlanningPeriod();
        const rows = await engine.getVProductCoverage(params.demand_basis, period);
        const mapped = rows.map(r => ({
          product_id: r.product_id,
          product_name: r.product_name,
          sku: r.sku,
          product_line: r.product_line,
          opening_stock: r.opening_stock,
          monthly_demand: r.monthly_demand,
          coverage_months: r.coverage_months,
          below_safety_flag: r.below_safety_flag,
        }));
        const filtered = params.risk_only ? mapped.filter(m => m.below_safety_flag) : mapped;
        const sorted = [...filtered].sort((a, b) => a.coverage_months - b.coverage_months);
        const page = paginate(sorted, params.limit, params.offset);
        const out = { period, demand_basis: params.demand_basis, ...page };

        const md = [
          `# Finished-goods coverage — ${engine.formatPlanningPeriod(period)}`,
          '',
          '| Product | SKU | Line | Stock | Demand/mo | Cover | Below safety |',
          '|---------|-----|------|-------|-----------|-------|--------------|',
          ...page.items.map(
            p =>
              `| ${p.product_name} | ${p.sku} | ${p.product_line} | ${num(p.opening_stock, 0)} | ${num(p.monthly_demand, 0)} | ${num(p.coverage_months, 2)} mo | ${p.below_safety_flag ? '⚠️ yes' : 'no'} |`
          ),
          sourceFooter(),
        ].join('\n');

        return toolResult(md, out as unknown as Record<string, unknown>, params.response_format);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  // ── monthly projection ──────────────────────────────────────────────────
  server.registerTool(
    'supplychain_get_material_projection',
    {
      title: 'Get Material Monthly Projection',
      description: `Month-by-month stock projection for a single material: opening stock, planned consumption exploded from the production plan, incoming receipts, and ending stock/coverage.

Use this to answer "when exactly does this run out?" after coverage has flagged a risk.

Args:
  - material_id (string, required): e.g. "MT1"
  - response_format ('markdown' | 'json'): default 'markdown'

Returns JSON with schema:
  {
    "material_id": string, "material_name": string, "uom": string,
    "periods": [{
      "period_start": string,        // YYYY-MM-DD
      "opening_stock": number,
      "plan_consumption": number,    // exploded from the MPS through the BOM
      "incoming": number,
      "ending_stock": number,
      "ending_coverage_days": number
    }],
    "first_stockout_period": string | null   // first period ending at zero stock
  }

Examples:
  - "When does MT1 run out?" -> material_id="MT1", read first_stockout_period`,
      inputSchema: {
        material_id: z.string().min(1).describe('Material ID, e.g. "MT1"'),
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
        const rows = await engine.getVMaterialMonthlyProjection(params.material_id);
        if (!rows.length) {
          return toolError(
            new Error(`No projection available for material "${params.material_id}".`),
            'Confirm the material ID with supplychain_list_materials.'
          );
        }
        const materials = await engine.fetchTableData<{ id: string; name: string; uom?: string }>('materials');
        const mat = materials.find(m => m.id === params.material_id);
        const stockout = rows.find(r => r.ending_stock <= 0);

        const out = {
          material_id: params.material_id,
          material_name: mat?.name ?? params.material_id,
          uom: mat?.uom ?? '',
          periods: rows.map(r => ({
            period_start: r.period_start,
            opening_stock: r.opening_stock,
            plan_consumption: r.plan_consumption,
            incoming: (r as unknown as { incoming?: number }).incoming ?? 0,
            ending_stock: r.ending_stock,
            ending_coverage_days: r.ending_coverage_days,
          })),
          first_stockout_period: stockout?.period_start ?? null,
        };

        const md = [
          `# Projection — ${out.material_name} (${out.material_id})${out.uom ? ` · ${out.uom}` : ''}`,
          '',
          out.first_stockout_period
            ? `⚠️ **Projected to reach zero stock in ${out.first_stockout_period}.**`
            : '🟢 No stockout projected in the planned horizon.',
          '',
          '| Period | Opening | Consumption | Incoming | Ending | Cover (days) |',
          '|--------|---------|-------------|----------|--------|--------------|',
          ...out.periods.map(
            p =>
              `| ${p.period_start} | ${num(p.opening_stock, 1)} | ${num(p.plan_consumption, 1)} | ${num(p.incoming, 1)} | ${num(p.ending_stock, 1)} | ${num(p.ending_coverage_days, 0)} |`
          ),
          sourceFooter(),
        ].join('\n');

        return toolResult(md, out as unknown as Record<string, unknown>, params.response_format);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  // ── MRP ─────────────────────────────────────────────────────────────────
  server.registerTool(
    'supplychain_run_mrp',
    {
      title: 'Run MRP',
      description: `Run the material requirements planning solver over a horizon and return net requirements, planned order releases/receipts, past-due shortages and approved-alternate substitution proposals.

This is a simulation: it computes and returns a plan but does not create purchase orders. Use supplychain_create_purchase_order to act on the result.

A "past due" release is a receipt whose required order date already fell before the run start — it cannot be recovered by ordering on time, which is what makes substitution proposals worth looking at.

Args:
  - start_period (string, optional): YYYY-MM-DD, defaults to the selected planning period
  - horizon (number): number of buckets, 1-12 (default 3)
  - grain ('week' | 'month'): bucket size (default 'month')
  - material_id (string, optional): restrict output to one material
  - shortages_only (boolean): only rows with net requirements or past-due releases (default false)
  - response_format ('markdown' | 'json'): default 'markdown'

Returns JSON with schema:
  {
    "run_id": string, "start_period": string, "horizon": number, "grain": string,
    "summary": {
      "materials_with_shortfall": number,
      "total_past_due": number,
      "substitution_proposals": number
    },
    "results": [{
      "material_id": string, "period": string,
      "gross_requirements": number, "scheduled_receipts": number,
      "projected_available": number, "safety_stock": number,
      "net_requirements": number,
      "planned_order_receipts": number,
      "planned_order_releases": number,
      "past_due_releases": number
    }],
    "substitutions": [{
      "material_id": string, "material_name": string,
      "alternate_material_id": string, "alternate_material_name": string,
      "product_name": string, "slot_name": string,
      "shortfall_qty": number, "coverable_qty": number,
      "alternate_qty": number, "uncoverable_qty": number,
      "earliest_arrival": string,
      "unit_cost_delta": number     // negative means the alternate is cheaper
    }]
  }

Examples:
  - "Run MRP for the next quarter" -> horizon=3, grain="month"
  - "What can't we cover?" -> shortages_only=true, then read substitutions`,
      inputSchema: {
        start_period: periodSchema,
        horizon: z.number().int().min(1).max(12).default(3),
        grain: z.enum(['week', 'month']).default('month'),
        material_id: z.string().optional(),
        shortages_only: z.boolean().default(false),
        response_format: responseFormatSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async params => {
      try {
        const start = params.start_period ?? engine.getPlanningPeriod();
        const { run_id, results, substitutions } = await engine.runMRP(
          start,
          params.horizon,
          params.grain
        );

        let rows = results;
        if (params.material_id) rows = rows.filter(r => r.material_id === params.material_id);
        if (params.shortages_only)
          rows = rows.filter(r => r.net_requirements > 0 || (r.past_due_releases ?? 0) > 0);

        const subs = params.material_id
          ? substitutions.filter(s => s.material_id === params.material_id)
          : substitutions;

        const out = {
          run_id,
          start_period: start,
          horizon: params.horizon,
          grain: params.grain,
          summary: {
            materials_with_shortfall: new Set(
              results.filter(r => r.net_requirements > 0).map(r => r.material_id)
            ).size,
            total_past_due: results.reduce((s, r) => s + (r.past_due_releases ?? 0), 0),
            substitution_proposals: subs.length,
          },
          results: rows.map(r => ({
            material_id: r.material_id,
            period: r.week_start_date,
            gross_requirements: r.gross_requirements ?? 0,
            scheduled_receipts: r.scheduled_receipts ?? 0,
            projected_available: r.projected_available,
            safety_stock: r.safety_stock,
            net_requirements: r.net_requirements,
            planned_order_receipts: r.planned_order_receipts ?? 0,
            planned_order_releases: r.planned_order_releases,
            past_due_releases: r.past_due_releases ?? 0,
          })),
          substitutions: subs.map(s => ({
            material_id: s.material_id,
            material_name: s.material_name,
            alternate_material_id: s.alternate_material_id,
            alternate_material_name: s.alternate_material_name,
            product_name: s.product_name,
            slot_name: s.slot_name,
            shortfall_qty: s.shortfall_qty,
            coverable_qty: s.coverable_qty,
            alternate_qty: s.alternate_qty,
            uncoverable_qty: s.uncoverable_qty,
            earliest_arrival: s.earliest_arrival,
            unit_cost_delta: s.unit_cost_delta,
          })),
        };

        const md = [
          `# MRP run — ${start}, ${params.horizon} ${params.grain}(s)`,
          '',
          `Run ID \`${run_id}\`. ${out.summary.materials_with_shortfall} material(s) with a shortfall, ${num(out.summary.total_past_due, 0)} units past due, ${out.summary.substitution_proposals} substitution proposal(s).`,
          '',
          '| Material | Period | Gross | Sched | Proj avail | Safety | Net req | Release | Past due |',
          '|----------|--------|-------|-------|-----------|--------|---------|---------|----------|',
          ...out.results.map(
            r =>
              `| ${r.material_id} | ${r.period} | ${num(r.gross_requirements, 0)} | ${num(r.scheduled_receipts, 0)} | ${num(r.projected_available, 0)} | ${num(r.safety_stock, 0)} | ${num(r.net_requirements, 0)} | ${num(r.planned_order_releases, 0)} | ${r.past_due_releases > 0 ? '⚠️ ' + num(r.past_due_releases, 0) : '—'} |`
          ),
          ...(out.substitutions.length
            ? [
                '',
                '## Substitution proposals',
                '',
                '| Short material | Alternate | Product / slot | Shortfall | Coverable | Alt qty | Earliest | Cost Δ/unit |',
                '|----------------|-----------|----------------|-----------|-----------|---------|----------|-------------|',
                ...out.substitutions.map(
                  s =>
                    `| ${s.material_name} | ${s.alternate_material_name} | ${s.product_name} / ${s.slot_name} | ${num(s.shortfall_qty, 0)} | ${num(s.coverable_qty, 0)} | ${num(s.alternate_qty, 0)} | ${s.earliest_arrival} | ${s.unit_cost_delta < 0 ? '' : '+'}${num(s.unit_cost_delta, 4)} |`
                ),
              ]
            : []),
          sourceFooter(),
        ].join('\n');

        return toolResult(md, out as unknown as Record<string, unknown>, params.response_format);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  // ── PSI ─────────────────────────────────────────────────────────────────
  server.registerTool(
    'supplychain_get_psi_analysis',
    {
      title: 'Get PSI Analysis',
      description: `Production / Sales / Inventory matrix for a period: start stock, sales forecast vs actual, production plan vs actual, expected closing stock and achievement percentages.

Achievement is null (not 0) where nothing was planned, so an unplanned SKU is not misreported as a total miss.

Args:
  - period (string, optional): YYYY-MM-DD
  - response_format ('markdown' | 'json'): default 'markdown'

Returns JSON with schema:
  {
    "period": string,
    "items": [{
      "row_id": string, "product_name": string,
      "start_stock": number,
      "sales_forecast": number, "actual_sales": number,
      "sales_achievement_percent": number | null,
      "production_plan": number, "actual_production": number,
      "production_achievement_percent": number | null,
      "expected_stock": number, "coverage_months": number,
      "sales_actual_records": number      // 0 means "not reported yet"
    }]
  }`,
      inputSchema: { period: periodSchema, response_format: responseFormatSchema },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async params => {
      try {
        const period = params.period ?? engine.getPlanningPeriod();
        const rows = await engine.getVFGPSIAnalysis(period);
        const out = {
          period,
          items: rows.map(r => ({
            row_id: r.row_id,
            product_name: (r as unknown as { product_name?: string }).product_name ?? r.row_id,
            start_stock: r.start_stock,
            sales_forecast: r.sales_forecast,
            actual_sales: r.actual_sales,
            sales_achievement_percent: r.sales_achievement_percent,
            production_plan: r.production_plan,
            actual_production: (r as unknown as { actual_production?: number }).actual_production ?? 0,
            production_achievement_percent: r.production_achievement_percent,
            expected_stock: r.expected_stock,
            coverage_months: r.coverage_months,
            sales_actual_records: r.sales_actual_records,
          })),
        };
        const md = [
          `# PSI — ${engine.formatPlanningPeriod(period)}`,
          '',
          '| Product | Start | Fcst | Actual | Ach% | Prod plan | Expected close | Cover |',
          '|---------|-------|------|--------|------|-----------|----------------|-------|',
          ...out.items.map(
            i =>
              `| ${i.product_name} | ${num(i.start_stock, 0)} | ${num(i.sales_forecast, 0)} | ${i.sales_actual_records === 0 ? '_none_' : num(i.actual_sales, 0)} | ${i.sales_achievement_percent === null ? '_no plan_' : num(i.sales_achievement_percent, 1) + '%'} | ${num(i.production_plan, 0)} | ${num(i.expected_stock, 0)} | ${num(i.coverage_months, 2)} |`
          ),
          sourceFooter(),
        ].join('\n');
        return toolResult(md, out as unknown as Record<string, unknown>, params.response_format);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  // ── plan vs actual ──────────────────────────────────────────────────────
  server.registerTool(
    'supplychain_get_plan_vs_actual',
    {
      title: 'Get Plan vs Actual Variance',
      description: `Variance and achievement of plan against actuals for a period, for either sales or production.

Achievement is null where the plan was zero.

Args:
  - basis ('sales' | 'production'): default 'sales'
  - period (string, optional): YYYY-MM-DD
  - response_format ('markdown' | 'json'): default 'markdown'

Returns JSON with schema:
  {
    "period": string, "basis": string,
    "items": [{
      "item_id": string, "item_name": string,
      "plan_qty": number, "actual_qty": number,
      "variance_qty": number,
      "achievement_percent": number | null
    }]
  }`,
      inputSchema: {
        basis: z.enum(['sales', 'production']).default('sales'),
        period: periodSchema,
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
        const period = params.period ?? engine.getPlanningPeriod();
        const rows = await engine.getVPlanVsActual(params.basis, period);
        const out = {
          period,
          basis: params.basis,
          items: rows.map(r => ({
            item_id: r.item_id,
            item_name: (r as unknown as { item_name?: string }).item_name ?? r.item_id,
            plan_qty: r.plan_qty,
            actual_qty: r.actual_qty,
            variance_qty: r.variance_qty,
            achievement_percent: r.achievement_percent,
          })),
        };
        const md = [
          `# Plan vs actual (${params.basis}) — ${engine.formatPlanningPeriod(period)}`,
          '',
          '| Item | Plan | Actual | Variance | Achievement |',
          '|------|------|--------|----------|-------------|',
          ...out.items.map(
            i =>
              `| ${i.item_name} | ${num(i.plan_qty, 0)} | ${num(i.actual_qty, 0)} | ${i.variance_qty >= 0 ? '+' : ''}${num(i.variance_qty, 0)} | ${i.achievement_percent === null ? '_no plan_' : num(i.achievement_percent, 1) + '%'} |`
          ),
          sourceFooter(),
        ].join('\n');
        return toolResult(md, out as unknown as Record<string, unknown>, params.response_format);
      } catch (e) {
        return toolError(e);
      }
    }
  );
}
