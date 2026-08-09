/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type UserRole = 'admin' | 'planner' | 'viewer';

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: UserRole; // admin = full access incl. deletes & DB settings; planner = create/edit; viewer = read-only
  status: 'active' | 'inactive';
}

export interface Supplier {
  id: string;
  name: string;
  default_lead_time_days: number;
  default_transit_days: number;
  default_customs_clearance_days: number;
  status: 'active' | 'inactive';
}

export interface Channel {
  id: string;
  name: string;
  status: 'active' | 'inactive';
}

export interface Machine {
  id: string;
  name: string;
  description: string;
  monthly_capacity?: number;
}

export interface ProductCategory {
  id: string;
  name: string;
}

export interface ProductGroup {
  id: string;
  name: string;
  category_id: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  description: string;
  group_id: string;
  category_id: string;
  brand: string;
  variant: string;
  product_line: string; // Machine assignment (e.g. SOFY, VOXY, Atlas, Pants, Import)
  pack_type: string;
  size: string;
  status: 'running' | 'obsolete';
  pcs_per_bag: number;
  bags_per_carton: number;
  selling_price: number;
  standard_cost: number;
  uom?: string; // Base UOM, e.g. PCS, Carton, Bag, Box
}

export interface MaterialCategory {
  id: string;
  name: string;
  material_group: 'RM' | 'PK' | 'CON'; // RM = Raw Material, PK = Packaging, CON = Consumables
}

export interface Material {
  id: string;
  name: string;
  sku: string;
  description: string;
  category_id: string;
  supplier_id: string;
  origin_type?: 'local' | 'foreign'; // Local vs Foreign material sourcing
  supplier_lead_time_days: number;
  transit_days: number;
  customs_clearance_days: number;
  total_lead_time_days: number; // Computed: supplier + transit + customs
  reorder_point_days: number; // Computed
  safety_stock_months: number;
  moq: number;
  max_usage: number;
  controller: string;
  status: 'running' | 'obsolete';
  standard_cost: number;
  cost_basis: 'standard' | 'weighted_avg';
  uom?: string; // Base UOM, e.g. KG, Grams, SQM, Roll, Meters, PCS, Sheet
}

export interface MaterialAlternative {
  id: string;
  material_id: string;
  alternative_material_id: string;
}

export interface BOMHeader {
  id: string;
  product_id: string;
  description: string;
  is_active: boolean;
}

export interface BOMSlot {
  id: string;
  bom_id: string;
  slot_name: string; // E.g., "top sheet", "back sheet", "polybag"
}

export interface BOMOption {
  id: string;
  slot_id: string;
  material_id: string;
  qty_per_unit: number;
  scrap_percent: number;
  priority: number; // 1 = Primary, 2 = Alternate, etc.
  uom?: string; // Consumption UOM, e.g. Grams, KG, Meters, SQM, PCS
}

export interface UOMConversion {
  id: string;
  item_type?: 'global' | 'material' | 'product';
  item_id?: string; // Optional specific material or product ID
  from_uom: string; // e.g. 'KG'
  to_uom: string;   // e.g. 'Grams'
  conversion_factor: number; // e.g. 1000 (1 KG = 1000 Grams)
  description?: string;
}

export interface SalesPlan {
  id: string;
  product_id: string;
  channel_id: string;
  period_type: 'day' | 'week' | 'month';
  period_start: string; // ISO date string (YYYY-MM-DD)
  quantity: number;
}

/**
 * Fulfilment status of a single SKU line within an export order.
 *
 * Separate from the order's own status because SKUs on one order do not move
 * together: one can be produced and staged while another has not started. The
 * order-level status describes the commercial state of the whole order; this
 * describes where each individual SKU actually is.
 */
export type ExportLineStatus =
  | 'pending'
  | 'in_production'
  | 'produced'
  | 'staged'
  | 'shipped'
  | 'on_hold';

export interface ExportOrderLineItem {
  id: string;
  product_id: string;
  forecast_qty: number;
  confirmed_order_qty: number;
  produced_stock_qty: number; // Linked stock produced specifically for this order line
  /** Per-SKU fulfilment status. Absent on older rows, treated as 'pending'. */
  line_status?: ExportLineStatus;
  notes?: string;
}

export interface ExportForecast {
  id: string;
  order_number: string; // e.g. EXP-2026-001
  country_code: string; // e.g. KSA, UAE, IRQ, JOR, KNY, NGA, DZA, LBY, DEU
  country_name: string;
  customer_name: string;
  period_start: string; // YYYY-MM-01
  target_ship_date: string; // Estimated Shipping Date (ETS)
  order_status: 'draft' | 'confirmed' | 'in_production' | 'ready_to_ship' | 'shipped' | 'delivered' | 'on_hold';
  shipping_port?: string;
  container_count?: number;
  payment_term?: string;
  lc_reference?: string;
  export_license_status?: 'approved' | 'pending' | 'not_required';
  merged_to_sales_plan: boolean;
  notes?: string;
  created_at?: string;
  items: ExportOrderLineItem[];
}

export interface ProductionPlan {
  id: string;
  product_id: string;
  machine_id: string;
  period_type: 'day' | 'week' | 'month';
  period_start: string; // ISO date string (YYYY-MM-DD)
  quantity: number;
}

export interface SalesActual {
  id: string;
  product_id: string;
  channel_id: string;
  period_start: string;
  quantity: number;
}

export interface ProductionActual {
  id: string;
  product_id: string;
  machine_id: string;
  period_start: string;
  quantity: number;
}

export interface InventorySnapshot {
  id: string;
  item_type: 'product' | 'material';
  item_id: string;
  snapshot_date: string;
  quantity: number;
}

export interface PurchaseOrder {
  id: string;
  material_id: string;
  supplier_id: string;
  order_no: string;
  qty: number;
  remaining_qty: number;
  required_date: string;
  original_delivery_date?: string; // Target original delivery commitment
  revised_delivery_date?: string; // Updated estimated/revised delivery date
  origin_type?: 'local' | 'foreign';
  status: 'pending' | 'in_transit' | 'completed';
  timing: 'Normal' | 'Need to be Closed' | 'Check with Proc.';
  po_date: string;
  unit_price?: number;
}

export interface Shipment {
  id: string;
  material_id: string;
  supplier_id: string;
  po_id?: string; // Optional PO reference
  qty: number;
  invoice_no: string;
  bl_no?: string;
  container_count?: number;
  ship_method?: 'sea' | 'air' | 'land';
  origin_type?: 'local' | 'foreign';
  etd?: string;
  port_eta?: string;
  port_name?: string;
  customs_clearance_days?: number;
  original_delivery_date?: string;
  revised_delivery_date?: string;
  factory_arrival_date: string | null; // Tentative arrival date, can be null
  delay: number; // in days
}

export interface MRPResult {
  id: string;
  run_id: string;
  run_date: string;
  material_id: string;
  week_start_date: string;
  projected_available: number;
  safety_stock: number;
  net_requirements: number;
  /** Quantity that must be *ordered* in this period to land a lead time later. */
  planned_order_releases: number;
  /** Quantity that must *arrive* in this period to hold the safety level. */
  planned_order_receipts?: number;
  /**
   * Receipts whose release date already fell before the run start - late on
   * arrival, and not recoverable by ordering on time.
   */
  past_due_releases?: number;
  gross_requirements?: number;
  scheduled_receipts?: number;
}

export interface ClosedPeriod {
  id: string;
  period: string; // Period start date (e.g. YYYY-MM-DD or YYYY-MM)
  run_id: string;
  closed_at: string;
  closed_by: string;
  grain: 'day' | 'week' | 'month';
  horizon: number;
  notes?: string;
  total_materials: number;
  at_risk_count: number;
  planned_value: number;
}

// VIEW REPRESENTATIONS (or local client calculations mimicking these)

export interface VMaterialCoverage {
  material_id: string;
  material_name: string;
  sku: string;
  /** Base stocking UOM. Carried on the view so a screen showing a quantity
      never has to join back to materials just to say what the number means —
      the material base mixes KG, SQM and PCS. */
  uom: string;
  category_id: string;
  category_name: string;
  material_group: 'RM' | 'PK' | 'CON';
  opening_stock: number;
  monthly_demand: number;
  coverage_months: number; // Coverage with in-transit and pending
  coverage_months_no_transit: number; // Coverage with stock only
  oos_risk_flag: boolean;
  overstock_flag: boolean;
}

export interface VProductCoverage {
  product_id: string;
  product_name: string;
  sku: string;
  /** Base UOM for the finished good (normally PCS). */
  uom: string;
  product_line: string;
  opening_stock: number;
  monthly_demand: number;
  coverage_months: number;
  below_safety_flag: boolean;
}

export interface VFGPSIAnalysis {
  row_id: string;
  category_id: string;
  category_name: string;
  group_id: string;
  group_name: string;
  brand: string;
  product_line: string;
  pack_type: string;
  size: string;
  status: string;
  start_stock: number;
  sales_forecast: number;
  actual_sales: number;
  /** How many actual rows exist, so "not reported yet" is distinguishable from "sold nothing". */
  sales_actual_records: number;
  production_actual_records: number;
  /** null when there is no plan to measure against. */
  sales_achievement_percent: number | null;
  production_plan: number;
  actual_production: number;
  /** null when there is no plan to measure against. */
  production_achievement_percent: number | null;
  expected_stock: number;
  coverage_months: number;
  sales_value: number;
}

export interface VBOMCostDetail {
  product_id: string;
  slot_id: string;
  slot_name: string;
  material_id: string;
  material_name: string;
  material_group: 'RM' | 'PK' | 'CON';
  qty_per_unit: number;
  scrap_percent: number;
  unit_cost: number;
  line_cost: number; // qty_per_unit * (1 + scrap_percent/100) * unit_cost
  priority: number;
  uom?: string;
}

export interface VFGCost {
  product_id: string;
  product_name: string;
  sku: string;
  selling_price: number;
  rm_cost: number;
  pk_cost: number;
  con_cost: number;
  total_material_cost: number;
  margin_per_unit: number;
  margin_percent: number;
}

export interface VMaterialWeightedAvgCost {
  material_id: string;
  weighted_avg_cost: number;
}

export interface VMaterialEffectiveCost {
  material_id: string;
  effective_cost: number; // standard_cost or weighted_avg_cost based on cost_basis toggle
}

export interface VMaterialMonthlyProjection {
  material_id: string;
  period_start: string; // YYYY-MM-DD (start of month)
  opening_stock: number;
  plan_consumption: number;
  in_transit_qty: number;
  pending_po_qty: number;
  ending_stock: number;
  ending_coverage_days: number;
  reorder_flag: boolean;
}

export interface VPlanVsActual {
  item_id: string; // product_id
  item_name: string; // product_name
  sku: string;
  period: string; // YYYY-MM
  plan_qty: number;
  actual_qty: number;
  variance_qty: number;
  /** null when there is no plan to measure against (0 planned units). */
  achievement_percent: number | null;
}

/**
 * A proposal to cover a shortfall with an approved BOM alternate.
 *
 * Raised when a primary material cannot arrive in time and the same BOM slot
 * carries a lower-priority option whose lead time can. It is a suggestion for
 * a planner, never an automatic plan change - substituting a component is a
 * quality and commercial decision, not an arithmetic one.
 */
export interface SubstitutionProposal {
  id: string;
  material_id: string;
  material_name: string;
  alternate_material_id: string;
  alternate_material_name: string;
  slot_id: string;
  slot_name: string;
  /** Which product's BOM this slot belongs to - slot names repeat across products. */
  product_id: string;
  product_name: string;
  /** Units of the primary that cannot arrive on time. */
  shortfall_qty: number;
  /** The share of that shortfall the alternate's lead time can actually cover. */
  coverable_qty: number;
  /** Equivalent quantity of the alternate, converted through both BOM lines. */
  alternate_qty: number;
  /** Units the alternate cannot rescue either, because even its lead time is too long. */
  uncoverable_qty: number;
  primary_lead_time_days: number;
  alternate_lead_time_days: number;
  /** Earliest date the alternate could land if ordered on the run start date. */
  earliest_arrival: string;
  /** First planning bucket the alternate can serve, or null if it can serve none. */
  covers_from_period: string | null;
  /** Alternate stock already on hand, which may cover part of it with no order at all. */
  alternate_on_hand: number;
  /** Cost of the alternate for one product unit, less the primary's. Negative is cheaper. */
  unit_cost_delta: number;
}

// ──────────────────────────────────────────────────────────
//  Customs Clearance module
// ──────────────────────────────────────────────────────────

/** The clearing agent company (e.g. "Expeditors Egypt") */
export interface ClearanceCompany {
  id: string;
  name: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  country?: string;
}

/**
 * One clearance job — covers the customs lifecycle of a single shipment
 * from port arrival through factory delivery.
 */
export interface ClearanceJob {
  id: string;
  shipment_id: string;          // FK → Shipment
  company_id: string;           // FK → ClearanceCompany
  /** Date the vessel/truck arrived at origin port */
  port_arrival_date?: string;
  /** Planned factory arrival given when job was opened */
  planned_factory_date?: string;
  /** Actual date the goods reached the factory */
  actual_factory_date?: string;
  status: 'pending' | 'in_progress' | 'partial_release' | 'cleared' | 'held';
  notes?: string;
}

/**
 * One container within a clearance job.
 * A single shipment may have multiple containers, each with its own timeline.
 */
export interface ClearanceContainer {
  id: string;
  job_id: string;               // FK → ClearanceJob
  container_no: string;         // e.g. "MSCU1234567"
  seal_no?: string;
  size_ft?: 20 | 40 | 45;
  gross_weight_kg?: number;
  /** Port arrival for this specific container (may differ from job-level) */
  port_arrival_date?: string;
  customs_exam_date?: string;
  release_date?: string;
  /** Actual factory gate arrival */
  factory_arrival_date?: string;
  /** Status independent of sibling containers (supports partial release) */
  status: 'pending' | 'under_exam' | 'released' | 'delivered';
  /** Accrued demurrage in days (port charges after free period) */
  demurrage_days?: number;
  /** Accrued detention in days (equipment charges at destination) */
  detention_days?: number;
}

/** Supporting documents required for customs clearance */
export interface ClearanceDocument {
  id: string;
  job_id: string;               // FK → ClearanceJob
  doc_type: 'bill_of_lading' | 'commercial_invoice' | 'packing_list' |
            'certificate_of_origin' | 'import_license' | 'phyto_certificate' |
            'customs_declaration' | 'other';
  doc_ref?: string;
  received_date?: string;
  submitted_date?: string;
  approved_date?: string;
  status: 'pending' | 'received' | 'submitted' | 'approved' | 'rejected';
  notes?: string;
}

/** Individual charge lines against a clearance job (customs duties, handling, etc.) */
export interface ClearanceCharge {
  id: string;
  job_id: string;               // FK → ClearanceJob
  container_id?: string;        // optional FK → ClearanceContainer
  charge_type: 'customs_duty' | 'vat' | 'port_handling' | 'demurrage' |
               'detention' | 'inspection' | 'agency_fee' | 'other';
  currency: string;             // e.g. "EGP" | "USD"
  amount: number;
  paid_date?: string;
  notes?: string;
}
