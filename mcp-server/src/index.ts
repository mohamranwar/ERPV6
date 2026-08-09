/**
 * MCP server for the Sanita Supply Chain Planner.
 *
 * Exposes the planner's coverage, BOM costing, MRP, purchasing, logistics and
 * customs clearance capabilities as MCP tools over stdio.
 *
 * Data source: the live Supabase project when SUPABASE_URL and
 * SUPABASE_ANON_KEY are set, otherwise the bundled offline seed dataset. Every
 * tool response states which one produced it, so demo figures are never
 * mistaken for live ones.
 *
 * Note on logging: stdio transport uses stdout for protocol traffic, so all
 * diagnostics here go to stderr. Writing to stdout would corrupt the stream.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { dataSource, dataSourceNote, isLiveDatabase } from './engine.js';
import { registerCatalogTools } from './tools/catalog.js';
import { registerPlanningTools } from './tools/planning.js';
import { registerProcurementTools } from './tools/procurement.js';
import { registerClearanceTools } from './tools/clearance.js';

const SERVER_NAME = 'supply-chain-mcp-server';
const SERVER_VERSION = '1.0.0';

function printHelp(): void {
  process.stderr.write(
    `${SERVER_NAME} v${SERVER_VERSION}

MCP server exposing the Sanita Supply Chain Planner over stdio.

Environment:
  SUPABASE_URL        Supabase project URL. Optional.
  SUPABASE_ANON_KEY   Supabase anon key.    Optional.

  With both set, the server reads and writes the live database and all writes
  are subject to its Row Level Security policies (the account needs a
  public.users row with role 'planner' or 'admin' to write). With either
  missing, the server runs on the bundled offline seed dataset instead.

Tools:
  Catalog      supplychain_list_materials, supplychain_list_products,
               supplychain_get_bom_cost
  Planning     supplychain_get_material_coverage, supplychain_get_product_coverage,
               supplychain_get_material_projection, supplychain_run_mrp,
               supplychain_get_psi_analysis, supplychain_get_plan_vs_actual
  Procurement  supplychain_list_purchase_orders, supplychain_create_purchase_order,
               supplychain_update_purchase_order, supplychain_list_shipments,
               supplychain_record_shipment_arrival
  Clearance    supplychain_list_clearance_jobs, supplychain_update_clearance_job

Usage:
  supply-chain-mcp-server          Run as an MCP stdio server
  supply-chain-mcp-server --help   Show this message
`
  );
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerCatalogTools(server);
  registerPlanningTools(server);
  registerProcurementTools(server);
  registerClearanceTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(
    `${SERVER_NAME} v${SERVER_VERSION} running on stdio — data source: ${dataSource}. ${dataSourceNote}\n`
  );
  if (!isLiveDatabase) {
    process.stderr.write(
      'Warning: running on demo seed data. Writes will not reach a real database.\n'
    );
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exit(1);
});
