/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createClient } from '@supabase/supabase-js';
import {
  Supplier, Channel, Machine, ProductCategory, ProductGroup, Product, MaterialCategory, Material, MaterialAlternative, BOMHeader, BOMSlot, BOMOption, SalesPlan, ExportForecast, ProductionPlan, SalesActual, ProductionActual, InventorySnapshot, PurchaseOrder, Shipment, MRPResult, ClosedPeriod, VMaterialCoverage, VProductCoverage, VFGPSIAnalysis, VBOMCostDetail, VFGCost, VMaterialWeightedAvgCost, VMaterialEffectiveCost, VMaterialMonthlyProjection, VPlanVsActual, AppUser, SubstitutionProposal, UOMConversion,
  ClearanceCompany, ClearanceJob, ClearanceContainer, ClearanceDocument, ClearanceCharge
} from './types';
import { normalizeQuantity } from './utils/uomNormalization';

// Let's load credentials from localStorage first, fallback to env vars if present
const STORAGE_URL_KEY = 'sc_planner_supabase_url';
const STORAGE_KEY_KEY = 'sc_planner_supabase_anon_key';

export function getStoredCredentials() {
  const url = localStorage.getItem(STORAGE_URL_KEY) || '';
  const key = localStorage.getItem(STORAGE_KEY_KEY) || '';
  return { url, key };
}

export function saveStoredCredentials(url: string, key: string) {
  localStorage.setItem(STORAGE_URL_KEY, url);
  localStorage.setItem(STORAGE_KEY_KEY, key);
}

export function clearStoredCredentials() {
  localStorage.removeItem(STORAGE_URL_KEY);
  localStorage.removeItem(STORAGE_KEY_KEY);
}

const creds = getStoredCredentials();
export const supabase = creds.url && creds.key ? createClient(creds.url, creds.key) : null;

export function isSupabaseConnected(): boolean {
  const c = getStoredCredentials();
  return !!(c.url && c.key);
}

// ==========================================
// OFFLINE / LOCAL STORAGE SEED DATA (MOCK DB)
// ==========================================

const INITIAL_SUPPLIERS: Supplier[] = [
  { id: 'S1', name: 'Saudi Pulp Co', default_lead_time_days: 15, default_transit_days: 12, default_customs_clearance_days: 7, status: 'active' },
  { id: 'S2', name: 'Global Polymers Ltd', default_lead_time_days: 20, default_transit_days: 18, default_customs_clearance_days: 10, status: 'active' },
  { id: 'S3', name: 'Al-Aman Packaging', default_lead_time_days: 7, default_transit_days: 3, default_customs_clearance_days: 2, status: 'active' },
  { id: 'S4', name: 'Egypt Cellulose Corp', default_lead_time_days: 10, default_transit_days: 5, default_customs_clearance_days: 3, status: 'active' },
  { id: 'S5', name: 'Suez Chem Industrial', default_lead_time_days: 25, default_transit_days: 14, default_customs_clearance_days: 8, status: 'active' }
];

const INITIAL_CHANNELS: Channel[] = [
  { id: 'C1', name: 'Zeina Distributor', status: 'active' },
  { id: 'C2', name: 'Pharma Chain Co', status: 'active' },
  { id: 'C3', name: 'E-Commerce / Retail', status: 'active' },
  { id: 'C4', name: 'Export Global', status: 'active' }
];

const INITIAL_MACHINES: Machine[] = [
  { id: 'M1', name: 'SOFY', description: 'Feminine hygiene pads high-speed machine', monthly_capacity: 550000 },
  { id: 'M2', name: 'VOXY', description: 'Ultra-thin and panty-liner line', monthly_capacity: 300000 },
  { id: 'M3', name: 'Atlas', description: 'Feminine pad & adult diaper flexible machine', monthly_capacity: 300000 },
  { id: 'M4', name: 'Pants', description: 'Baby pull-up diapers main machine', monthly_capacity: 400000 },
  { id: 'M5', name: 'Import', description: 'Virtual machine for imported finished goods', monthly_capacity: 300000 }
];

const INITIAL_PRODUCT_CATEGORIES: ProductCategory[] = [
  { id: 'PC1', name: 'Baby Diapers' },
  { id: 'PC2', name: 'Feminine Care' },
  { id: 'PC3', name: 'Adult Care' }
];

const INITIAL_PRODUCT_GROUPS: ProductGroup[] = [
  { id: 'PG1', name: 'BabyJoy', category_id: 'PC1' },
  { id: 'PG2', name: 'SOFY', category_id: 'PC2' },
  { id: 'PG3', name: 'Moony', category_id: 'PC1' },
  { id: 'PG4', name: 'Teemo', category_id: 'PC1' },
  { id: 'PG5', name: 'Atlas', category_id: 'PC2' }
];

const INITIAL_PRODUCTS: Product[] = [
  { id: 'P1', name: 'BabyJoy Maxi Size 4 Large', sku: 'BJ-M4', description: 'High absorption baby diapers', group_id: 'PG1', category_id: 'PC1', brand: 'BabyJoy', variant: 'Maxi', product_line: 'Pants', pack_type: 'Jumbo', size: 'Size 4', status: 'running', pcs_per_bag: 44, bags_per_carton: 4, selling_price: 18.5, standard_cost: 11.2, uom: 'PCS' },
  { id: 'P2', name: 'SOFY Slim Wings Normal', sku: 'SF-SLW', description: 'Super slim pads with side wings', group_id: 'PG2', category_id: 'PC2', brand: 'SOFY', variant: 'Slim', product_line: 'SOFY', pack_type: 'Single Pack', size: 'Normal', status: 'running', pcs_per_bag: 30, bags_per_carton: 8, selling_price: 12.0, standard_cost: 6.5, uom: 'PCS' },
  { id: 'P3', name: 'Atlas Night Comfort Extra', sku: 'AT-NC', description: 'Longer pads for nighttime coverage', group_id: 'PG5', category_id: 'PC2', brand: 'Atlas', variant: 'Night', product_line: 'Atlas', pack_type: 'Jumbo Pack', size: 'Extra Large', status: 'running', pcs_per_bag: 20, bags_per_carton: 12, selling_price: 14.5, standard_cost: 7.8, uom: 'PCS' },
  { id: 'P4', name: 'Moony Newborn Premium', sku: 'MN-NB', description: 'Imported ultra-soft diaper', group_id: 'PG3', category_id: 'PC1', brand: 'Moony', variant: 'Newborn', product_line: 'Import', pack_type: 'Medium', size: 'Size 1', status: 'running', pcs_per_bag: 54, bags_per_carton: 4, selling_price: 25.0, standard_cost: 16.5, uom: 'PCS' },
  { id: 'P5', name: 'Teemo Pant Premium', sku: 'TM-PP', description: 'Premium soft diaper pants', group_id: 'PG4', category_id: 'PC1', brand: 'Teemo', variant: 'Pant', product_line: 'Pants', pack_type: 'Carton', size: 'Size 5', status: 'running', pcs_per_bag: 40, bags_per_carton: 4, selling_price: 21.0, standard_cost: 12.4, uom: 'PCS' },
  { id: 'P6', name: 'SOFY Panty Liners Dry', sku: 'SF-PLD', description: 'Daily wear breathable panty liners', group_id: 'PG2', category_id: 'PC2', brand: 'SOFY', variant: 'Panty Liner', product_line: 'VOXY', pack_type: 'Single Pack', size: 'Regular', status: 'running', pcs_per_bag: 40, bags_per_carton: 10, selling_price: 8.5, standard_cost: 4.1, uom: 'PCS' }
];

const INITIAL_MATERIAL_CATEGORIES: MaterialCategory[] = [
  { id: 'MC1', name: '01- Fluff Pulp', material_group: 'RM' },
  { id: 'MC2', name: '18- Nonwoven Top Sheet', material_group: 'RM' },
  { id: 'MC3', name: '28- Polybag outer', material_group: 'PK' },
  { id: 'MC4', name: '29- Corrugated Carton', material_group: 'PK' },
  { id: 'MC5', name: '12- SAP Absorbent Polymer', material_group: 'RM' },
  { id: 'MC6', name: '30- Elastic Side Panel', material_group: 'RM' }
];

const INITIAL_MATERIALS: Material[] = [
  { id: 'MT1', name: 'GP Bleached Fluff Pulp', sku: 'RM-PLP-01', description: 'Southern Pine Fluff Pulp', category_id: 'MC1', supplier_id: 'S1', origin_type: 'foreign', supplier_lead_time_days: 15, transit_days: 12, customs_clearance_days: 7, total_lead_time_days: 34, reorder_point_days: 45, safety_stock_months: 0, moq: 20000, max_usage: 1200, controller: 'Mohamed Amr', status: 'running', standard_cost: 1.5, cost_basis: 'standard', uom: 'KG' },
  { id: 'MT2', name: 'Spunbond Top Sheet 15gsm', sku: 'RM-NWT-18', description: 'Hydrophilic Top Sheet nonwoven', category_id: 'MC2', supplier_id: 'S2', origin_type: 'foreign', supplier_lead_time_days: 20, transit_days: 18, customs_clearance_days: 10, total_lead_time_days: 48, reorder_point_days: 60, safety_stock_months: 0, moq: 15000, max_usage: 800, controller: 'Mohamed Amr', status: 'running', standard_cost: 0.8, cost_basis: 'standard', uom: 'SQM' },
  { id: 'MT3', name: 'Teemo Printed Polybag Large', sku: 'PK-PLB-28', description: 'LDPE Printed Polybag Outer', category_id: 'MC3', supplier_id: 'S3', origin_type: 'local', supplier_lead_time_days: 7, transit_days: 3, customs_clearance_days: 0, total_lead_time_days: 10, reorder_point_days: 20, safety_stock_months: 0, moq: 5000, max_usage: 500, controller: 'Amr Anwar', status: 'running', standard_cost: 0.3, cost_basis: 'standard', uom: 'PCS' },
  { id: 'MT4', name: 'Corrugated Master Carton Big', sku: 'PK-CTN-29', description: 'Double Wall Corrugated Box', category_id: 'MC4', supplier_id: 'S3', origin_type: 'local', supplier_lead_time_days: 5, transit_days: 3, customs_clearance_days: 0, total_lead_time_days: 8, reorder_point_days: 15, safety_stock_months: 0, moq: 2000, max_usage: 300, controller: 'Amr Anwar', status: 'running', standard_cost: 1.2, cost_basis: 'weighted_avg', uom: 'PCS' },
  { id: 'MT5', name: 'Sumitomo SAP High-Speed', sku: 'RM-SAP-12', description: 'Super Absorbent Polymer particles', category_id: 'MC5', supplier_id: 'S5', origin_type: 'foreign', supplier_lead_time_days: 25, transit_days: 14, customs_clearance_days: 8, total_lead_time_days: 47, reorder_point_days: 55, safety_stock_months: 2.5, moq: 10000, max_usage: 1000, controller: 'Mohamed Amr', status: 'running', standard_cost: 2.2, cost_basis: 'standard', uom: 'KG' },
  { id: 'MT6', name: 'Local Spunbond Top Sheet', sku: 'RM-NWT-18-ALT', description: 'Local Hydrophilic Nonwoven alternative', category_id: 'MC2', supplier_id: 'S4', origin_type: 'local', supplier_lead_time_days: 10, transit_days: 5, customs_clearance_days: 0, total_lead_time_days: 15, reorder_point_days: 25, safety_stock_months: 0, moq: 8000, max_usage: 700, controller: 'Mohamed Amr', status: 'running', standard_cost: 0.72, cost_basis: 'standard', uom: 'SQM' }
];

const INITIAL_ALTERNATIVES: MaterialAlternative[] = [
  { id: 'A1', material_id: 'MT2', alternative_material_id: 'MT6' },
  { id: 'A2', material_id: 'MT6', alternative_material_id: 'MT2' }
];

const INITIAL_BOM_HEADERS: BOMHeader[] = [
  { id: 'BH1', product_id: 'P1', description: 'BOM for BabyJoy Maxi S4', is_active: true },
  { id: 'BH2', product_id: 'P2', description: 'BOM for SOFY Slim Wings', is_active: true },
  { id: 'BH3', product_id: 'P3', description: 'BOM for Atlas Night Comfort', is_active: true },
  { id: 'BH4', product_id: 'P5', description: 'BOM for Teemo Pant Premium', is_active: true }
];

const INITIAL_BOM_SLOTS: BOMSlot[] = [
  // For P1 (BabyJoy)
  { id: 'BS1', bom_id: 'BH1', slot_name: 'Core Fluff Pulp' },
  { id: 'BS2', bom_id: 'BH1', slot_name: 'Top Sheet Surface' },
  { id: 'BS3', bom_id: 'BH1', slot_name: 'Super Absorbent Polymer' },
  { id: 'BS4', bom_id: 'BH1', slot_name: 'Packaging Carton' },
  // For P2 (SOFY)
  { id: 'BS5', bom_id: 'BH2', slot_name: 'Top Sheet Surface' },
  { id: 'BS6', bom_id: 'BH2', slot_name: 'Core Cellulose' },
  { id: 'BS7', bom_id: 'BH2', slot_name: 'Packaging Outer Bag' }
];

const INITIAL_BOM_OPTIONS: BOMOption[] = [
  // For P1: Core Pulp
  { id: 'BO1', slot_id: 'BS1', material_id: 'MT1', qty_per_unit: 4.5, scrap_percent: 3, priority: 1, uom: 'Grams' },
  // For P1: Top Sheet (Primary = MT2, Alt = MT6)
  { id: 'BO2', slot_id: 'BS2', material_id: 'MT2', qty_per_unit: 1.2, scrap_percent: 5, priority: 1, uom: 'SQM' },
  { id: 'BO3', slot_id: 'BS2', material_id: 'MT6', qty_per_unit: 1.25, scrap_percent: 4, priority: 2, uom: 'SQM' },
  // For P1: SAP
  { id: 'BO4', slot_id: 'BS3', material_id: 'MT5', qty_per_unit: 2.0, scrap_percent: 2, priority: 1, uom: 'Grams' },
  // For P1: Carton
  { id: 'BO5', slot_id: 'BS4', material_id: 'MT4', qty_per_unit: 0.25, scrap_percent: 1, priority: 1, uom: 'PCS' },

  // For P2: Top Sheet (Primary = MT2, Alt = MT6)
  { id: 'BO6', slot_id: 'BS5', material_id: 'MT2', qty_per_unit: 0.8, scrap_percent: 4, priority: 1, uom: 'SQM' },
  { id: 'BO7', slot_id: 'BS5', material_id: 'MT6', qty_per_unit: 0.8, scrap_percent: 3, priority: 2, uom: 'SQM' },
  // For P2: Core Cellulose (MT1)
  { id: 'BO8', slot_id: 'BS6', material_id: 'MT1', qty_per_unit: 2.1, scrap_percent: 2, priority: 1, uom: 'Grams' },
  // For P2: Outer Bag (MT3)
  { id: 'BO9', slot_id: 'BS7', material_id: 'MT3', qty_per_unit: 0.125, scrap_percent: 0, priority: 1, uom: 'PCS' }
];

const INITIAL_UOM_CONVERSIONS: UOMConversion[] = [
  { id: 'UOM1', item_type: 'global', from_uom: 'KG', to_uom: 'Grams', conversion_factor: 1000, description: '1 Kilogram = 1,000 Grams' },
  { id: 'UOM2', item_type: 'global', from_uom: 'Ton', to_uom: 'KG', conversion_factor: 1000, description: '1 Metric Ton = 1,000 Kilograms' },
  { id: 'UOM3', item_type: 'global', from_uom: 'Meters', to_uom: 'CM', conversion_factor: 100, description: '1 Meter = 100 Centimeters' },
  { id: 'UOM4', item_type: 'global', from_uom: 'Roll', to_uom: 'Meters', conversion_factor: 500, description: '1 Standard Roll = 500 Meters' },
  { id: 'UOM5', item_type: 'product', item_id: 'P1', from_uom: 'Carton', to_uom: 'PCS', conversion_factor: 176, description: '1 Carton (P1) = 176 PCS (4 bags x 44 pcs)' },
  { id: 'UOM6', item_type: 'product', item_id: 'P2', from_uom: 'Carton', to_uom: 'PCS', conversion_factor: 240, description: '1 Carton (P2) = 240 PCS (8 bags x 30 pcs)' }
];

// SALES PLAN (Monthly grain pre-seeded for Jul, Aug, Sep, Oct 2026)
const INITIAL_SALES_PLAN: SalesPlan[] = [
  { id: 'SP1', product_id: 'P1', channel_id: 'C1', period_type: 'month', period_start: '2026-07-01', quantity: 150000 },
  { id: 'SP2', product_id: 'P1', channel_id: 'C2', period_type: 'month', period_start: '2026-07-01', quantity: 50000 },
  { id: 'SP3', product_id: 'P1', channel_id: 'C3', period_type: 'month', period_start: '2026-07-01', quantity: 30000 },
  { id: 'SP4', product_id: 'P1', channel_id: 'C4', period_type: 'month', period_start: '2026-07-01', quantity: 45000 },

  { id: 'SP5', product_id: 'P2', channel_id: 'C1', period_type: 'month', period_start: '2026-07-01', quantity: 200000 },
  { id: 'SP6', product_id: 'P2', channel_id: 'C2', period_type: 'month', period_start: '2026-07-01', quantity: 80000 },

  { id: 'SP7', product_id: 'P1', channel_id: 'C1', period_type: 'month', period_start: '2026-08-01', quantity: 160000 },
  { id: 'SP8', product_id: 'P1', channel_id: 'C2', period_type: 'month', period_start: '2026-08-01', quantity: 55000 },
  { id: 'SP9', product_id: 'P2', channel_id: 'C1', period_type: 'month', period_start: '2026-08-01', quantity: 210000 },

  { id: 'SP10', product_id: 'P1', channel_id: 'C1', period_type: 'month', period_start: '2026-09-01', quantity: 170000 },
  { id: 'SP11', product_id: 'P2', channel_id: 'C1', period_type: 'month', period_start: '2026-09-01', quantity: 220000 }
];

const INITIAL_EXPORT_FORECASTS: ExportForecast[] = [
  {
    id: 'EF1',
    order_number: 'EXP-2026-001',
    country_code: 'KSA',
    country_name: 'Saudi Arabia',
    customer_name: 'Panda Retail Group',
    period_start: '2026-07-01',
    target_ship_date: '2026-07-20',
    order_status: 'in_production',
    shipping_port: 'Damietta Port',
    container_count: 5,
    payment_term: 'LC 60 Days',
    lc_reference: 'LC-KSA-99012',
    export_license_status: 'approved',
    merged_to_sales_plan: true,
    notes: 'Priority shipment for Ramadan inventory buildup.',
    items: [
      { id: 'LI-101', product_id: 'P1', forecast_qty: 45000, confirmed_order_qty: 45000, produced_stock_qty: 35000, line_status: 'in_production', notes: 'SOFY Night Comfort 30s' },
      { id: 'LI-102', product_id: 'P2', forecast_qty: 35000, confirmed_order_qty: 35000, produced_stock_qty: 35000, line_status: 'produced', notes: 'SOFY Panty Liner 40s (100% Produced)' },
      { id: 'LI-103', product_id: 'P3', forecast_qty: 20000, confirmed_order_qty: 20000, produced_stock_qty: 12000, line_status: 'in_production', notes: 'Atlas Maxi Wing 24s' },
      { id: 'LI-104', product_id: 'P4', forecast_qty: 15000, confirmed_order_qty: 15000, produced_stock_qty: 0, line_status: 'pending', notes: 'VOXY Ultra Slim 16s' }
    ]
  },
  {
    id: 'EF2',
    order_number: 'EXP-2026-002',
    country_code: 'UAE',
    country_name: 'United Arab Emirates',
    customer_name: 'Al-Maya Distribution',
    period_start: '2026-07-01',
    target_ship_date: '2026-07-25',
    order_status: 'confirmed',
    shipping_port: 'Alexandria Port',
    container_count: 3,
    payment_term: 'CAD 30 Days',
    lc_reference: 'CAD-UAE-4410',
    export_license_status: 'approved',
    merged_to_sales_plan: true,
    notes: 'SOFY Panty Liners promotional batch.',
    items: [
      { id: 'LI-201', product_id: 'P2', forecast_qty: 30000, confirmed_order_qty: 30000, produced_stock_qty: 15000, line_status: 'in_production' },
      { id: 'LI-202', product_id: 'P5', forecast_qty: 25000, confirmed_order_qty: 25000, produced_stock_qty: 10000, line_status: 'in_production' },
      { id: 'LI-203', product_id: 'P1', forecast_qty: 18000, confirmed_order_qty: 18000, produced_stock_qty: 18000, line_status: 'produced' }
    ]
  },
  {
    id: 'EF3',
    order_number: 'EXP-2026-003',
    country_code: 'IRQ',
    country_name: 'Iraq',
    customer_name: 'Baghdad Hygiene Co',
    period_start: '2026-08-01',
    target_ship_date: '2026-08-15',
    order_status: 'draft',
    shipping_port: 'Alexandria Port',
    container_count: 4,
    payment_term: 'TT 30% Deposit',
    export_license_status: 'pending',
    merged_to_sales_plan: false,
    notes: 'Awaiting export clearance approval from Ministry.',
    items: [
      { id: 'LI-301', product_id: 'P1', forecast_qty: 60000, confirmed_order_qty: 50000, produced_stock_qty: 0, line_status: 'pending' },
      { id: 'LI-302', product_id: 'P3', forecast_qty: 40000, confirmed_order_qty: 35000, produced_stock_qty: 0, line_status: 'pending' },
      { id: 'LI-303', product_id: 'P4', forecast_qty: 20000, confirmed_order_qty: 20000, produced_stock_qty: 0, line_status: 'pending' }
    ]
  },
  {
    id: 'EF4',
    order_number: 'EXP-2026-004',
    country_code: 'JOR',
    country_name: 'Jordan',
    customer_name: 'Amman Pharma Trading',
    period_start: '2026-08-01',
    target_ship_date: '2026-08-10',
    order_status: 'ready_to_ship',
    shipping_port: 'Nuweiba Land Port',
    container_count: 2,
    payment_term: 'LC Sight',
    lc_reference: 'LC-JOR-8812',
    export_license_status: 'approved',
    merged_to_sales_plan: false,
    notes: 'Atlas Night Comfort extra shipment.',
    items: [
      { id: 'LI-401', product_id: 'P3', forecast_qty: 25000, confirmed_order_qty: 25000, produced_stock_qty: 25000, line_status: 'produced', notes: '100% stock linked & ready' },
      { id: 'LI-402', product_id: 'P5', forecast_qty: 15000, confirmed_order_qty: 15000, produced_stock_qty: 15000, line_status: 'produced', notes: '100% stock linked & ready' }
    ]
  },
  {
    id: 'EF5',
    order_number: 'EXP-2026-005',
    country_code: 'KNY',
    country_name: 'Kenya',
    customer_name: 'Nairobi Health Imports',
    period_start: '2026-09-01',
    target_ship_date: '2026-09-20',
    order_status: 'draft',
    shipping_port: 'Suez Port',
    container_count: 3,
    payment_term: 'LC 90 Days',
    export_license_status: 'not_required',
    merged_to_sales_plan: false,
    notes: 'COMESA trade agreement tariff exemption applies.',
    items: [
      { id: 'LI-501', product_id: 'P5', forecast_qty: 40000, confirmed_order_qty: 0, produced_stock_qty: 0, line_status: 'pending' },
      { id: 'LI-502', product_id: 'P1', forecast_qty: 30000, confirmed_order_qty: 0, produced_stock_qty: 0, line_status: 'pending' }
    ]
  }
];

// PRODUCTION PLAN (MPS) - Assigned to machines
const INITIAL_PRODUCTION_PLAN: ProductionPlan[] = [
  { id: 'PP1', product_id: 'P1', machine_id: 'M4', period_type: 'month', period_start: '2026-07-01', quantity: 260000 },
  { id: 'PP2', product_id: 'P2', machine_id: 'M1', period_type: 'month', period_start: '2026-07-01', quantity: 290000 },

  { id: 'PP3', product_id: 'P1', machine_id: 'M4', period_type: 'month', period_start: '2026-08-01', quantity: 280000 },
  { id: 'PP4', product_id: 'P2', machine_id: 'M1', period_type: 'month', period_start: '2026-08-01', quantity: 300000 },

  { id: 'PP5', product_id: 'P1', machine_id: 'M4', period_type: 'month', period_start: '2026-09-01', quantity: 250000 },
  { id: 'PP6', product_id: 'P2', machine_id: 'M1', period_type: 'month', period_start: '2026-09-01', quantity: 280000 }
];

// ACTUALS
const INITIAL_SALES_ACTUAL: SalesActual[] = [
  { id: 'SA1', product_id: 'P1', channel_id: 'C1', period_start: '2026-07-01', quantity: 142000 },
  { id: 'SA2', product_id: 'P1', channel_id: 'C2', period_start: '2026-07-01', quantity: 49000 },
  { id: 'SA3', product_id: 'P2', channel_id: 'C1', period_start: '2026-07-01', quantity: 215000 }
];

const INITIAL_PRODUCTION_ACTUAL: ProductionActual[] = [
  { id: 'PA1', product_id: 'P1', machine_id: 'M4', period_start: '2026-07-01', quantity: 255000 },
  { id: 'PA2', product_id: 'P2', machine_id: 'M1', period_start: '2026-07-01', quantity: 288000 }
];

// OPENING STOCK Snapshot as of 2026-07-01
const INITIAL_INVENTORY: InventorySnapshot[] = [
  // Products stock (pcs)
  { id: 'IV1', item_type: 'product', item_id: 'P1', snapshot_date: '2026-07-01', quantity: 65000 },
  { id: 'IV2', item_type: 'product', item_id: 'P2', snapshot_date: '2026-07-01', quantity: 110000 },
  { id: 'IV3', item_type: 'product', item_id: 'P3', snapshot_date: '2026-07-01', quantity: 15000 },
  { id: 'IV4', item_type: 'product', item_id: 'P4', snapshot_date: '2026-07-01', quantity: 8000 },
  { id: 'IV5', item_type: 'product', item_id: 'P5', snapshot_date: '2026-07-01', quantity: 22000 },
  { id: 'IV6', item_type: 'product', item_id: 'P6', snapshot_date: '2026-07-01', quantity: 45000 },

  // Materials stock — quantities in each material's base UOM.
  // MT1 and MT5 are KG; the BOM options use Grams (normalised at explosion time).
  { id: 'IV7', item_type: 'material', item_id: 'MT1', snapshot_date: '2026-07-01', quantity: 220 }, // OOS Risk soon (~0.12 months at Jul demand)
  { id: 'IV8', item_type: 'material', item_id: 'MT2', snapshot_date: '2026-07-01', quantity: 180000 },
  { id: 'IV9', item_type: 'material', item_id: 'MT3', snapshot_date: '2026-07-01', quantity: 3000 },  // Under MOQ / OOS Risk
  { id: 'IV10', item_type: 'material', item_id: 'MT4', snapshot_date: '2026-07-01', quantity: 175000 }, // Healthy ~3 months cover (incl. PO5)
  { id: 'IV11', item_type: 'material', item_id: 'MT5', snapshot_date: '2026-07-01', quantity: 1750 }, // Overstock > 3 months cover
  { id: 'IV12', item_type: 'material', item_id: 'MT6', snapshot_date: '2026-07-01', quantity: 12000 }
];

// PURCHASE ORDERS
const INITIAL_POS: PurchaseOrder[] = [
  { id: 'PO1', material_id: 'MT1', supplier_id: 'S1', order_no: 'PO-2026-001', qty: 150, remaining_qty: 150, required_date: '2026-07-28', original_delivery_date: '2026-07-28', revised_delivery_date: '2026-08-02', origin_type: 'foreign', status: 'pending', timing: 'Normal', po_date: '2026-07-05', unit_price: 1.5 },
  { id: 'PO2', material_id: 'MT2', supplier_id: 'S2', order_no: 'PO-2026-002', qty: 100000, remaining_qty: 0, required_date: '2026-07-15', original_delivery_date: '2026-07-15', revised_delivery_date: '2026-07-15', origin_type: 'foreign', status: 'completed', timing: 'Normal', po_date: '2026-06-25', unit_price: 0.8 },
  { id: 'PO3', material_id: 'MT3', supplier_id: 'S3', order_no: 'PO-2026-003', qty: 25000, remaining_qty: 25000, required_date: '2026-07-10', original_delivery_date: '2026-07-10', revised_delivery_date: '2026-07-12', origin_type: 'local', status: 'in_transit', timing: 'Need to be Closed', po_date: '2026-07-01', unit_price: 0.3 },
  { id: 'PO4', material_id: 'MT5', supplier_id: 'S5', order_no: 'PO-2026-004', qty: 80, remaining_qty: 80, required_date: '2026-08-05', original_delivery_date: '2026-08-05', revised_delivery_date: '2026-08-05', origin_type: 'foreign', status: 'pending', timing: 'Check with Proc.', po_date: '2026-07-10', unit_price: 2.2 },
  { id: 'PO5', material_id: 'MT4', supplier_id: 'S3', order_no: 'PO-2026-005', qty: 50000, remaining_qty: 50000, required_date: '2026-07-20', original_delivery_date: '2026-07-20', revised_delivery_date: '2026-07-21', origin_type: 'local', status: 'pending', timing: 'Normal', po_date: '2026-07-12', unit_price: 1.2 }
];

// SHIPMENTS & IN-TRANSIT FOLLOW-UP
const INITIAL_SHIPMENTS: Shipment[] = [
  { 
    id: 'SH1', material_id: 'MT3', supplier_id: 'S3', po_id: 'PO3', qty: 25000, 
    invoice_no: 'INV-S3-9871', bl_no: 'LOCAL-DELIVERY-NOTE', container_count: 1, 
    ship_method: 'land', origin_type: 'local', etd: '2026-07-02', port_eta: '2026-07-08', port_name: 'Local Plant Delivery', 
    customs_clearance_days: 0, original_delivery_date: '2026-07-10', revised_delivery_date: '2026-07-11', factory_arrival_date: '2026-07-11', delay: 1 
  },
  { 
    id: 'SH2', material_id: 'MT1', supplier_id: 'S1', po_id: 'PO1', qty: 80,
    invoice_no: 'INV-S1-2290', bl_no: 'BL-S1-55410', container_count: 4, 
    ship_method: 'sea', origin_type: 'foreign', etd: '2026-07-10', port_eta: '2026-07-22', port_name: 'Damietta', 
    customs_clearance_days: 7, original_delivery_date: '2026-07-28', revised_delivery_date: '2026-08-02', factory_arrival_date: null, delay: 5 
  },
  { 
    id: 'SH3', material_id: 'MT2', supplier_id: 'S2', po_id: 'PO2', qty: 60000, 
    invoice_no: 'INV-S2-4412', bl_no: 'BL-S2-33100', container_count: 3, 
    ship_method: 'sea', origin_type: 'foreign', etd: '2026-06-18', port_eta: '2026-07-06', port_name: 'Alexandria', 
    customs_clearance_days: 10, original_delivery_date: '2026-07-18', revised_delivery_date: '2026-07-16', factory_arrival_date: '2026-07-16', delay: -2 // Arrived early
  }
];

const INITIAL_MRP_RESULTS: MRPResult[] = [];

// ── Customs Clearance seed data ────────────────────────────────────────────
const INITIAL_CLEARANCE_COMPANIES: ClearanceCompany[] = [
  { id: 'CC1', name: 'Expeditors Egypt', contact_name: 'Hisham Kamel', contact_email: 'hkamel@expeditors.com', contact_phone: '+20-2-2480-0100', country: 'EG' },
  { id: 'CC2', name: 'Kuehne+Nagel Alexandria', contact_name: 'Dina Fawzy', contact_email: 'dina.fawzy@kuehne-nagel.com', country: 'EG' },
];

const INITIAL_CLEARANCE_JOBS: ClearanceJob[] = [
  {
    id: 'CJ1', shipment_id: 'SH2', company_id: 'CC1',
    port_arrival_date: '2026-07-22', planned_factory_date: '2026-07-29',
    actual_factory_date: null as unknown as string,
    status: 'in_progress', notes: 'Awaiting certificate of origin from S1'
  },
  {
    id: 'CJ2', shipment_id: 'SH3', company_id: 'CC2',
    port_arrival_date: '2026-07-06', planned_factory_date: '2026-07-14',
    actual_factory_date: '2026-07-16',
    status: 'cleared', notes: 'Released two days late due to port congestion'
  },
];

const INITIAL_CLEARANCE_CONTAINERS: ClearanceContainer[] = [
  // SH2 — 4 containers, in_progress
  { id: 'CN1', job_id: 'CJ1', container_no: 'MSCU1234567', seal_no: 'SL-001', size_ft: 40, gross_weight_kg: 18200, port_arrival_date: '2026-07-22', status: 'under_exam', demurrage_days: 3, detention_days: 0 },
  { id: 'CN2', job_id: 'CJ1', container_no: 'MSCU7654321', seal_no: 'SL-002', size_ft: 40, gross_weight_kg: 17900, port_arrival_date: '2026-07-22', status: 'under_exam', demurrage_days: 3, detention_days: 0 },
  { id: 'CN3', job_id: 'CJ1', container_no: 'MSCU9988776', seal_no: 'SL-003', size_ft: 40, gross_weight_kg: 18500, port_arrival_date: '2026-07-22', customs_exam_date: '2026-07-24', release_date: '2026-07-26', status: 'released', demurrage_days: 4, detention_days: 1 },
  { id: 'CN4', job_id: 'CJ1', container_no: 'MSCU1122334', seal_no: 'SL-004', size_ft: 40, gross_weight_kg: 17600, port_arrival_date: '2026-07-22', status: 'pending', demurrage_days: 0, detention_days: 0 },
  // SH3 — 3 containers, cleared
  { id: 'CN5', job_id: 'CJ2', container_no: 'CMAU3344556', seal_no: 'SL-010', size_ft: 40, gross_weight_kg: 22000, port_arrival_date: '2026-07-06', customs_exam_date: '2026-07-09', release_date: '2026-07-13', factory_arrival_date: '2026-07-16', status: 'delivered', demurrage_days: 7, detention_days: 2 },
  { id: 'CN6', job_id: 'CJ2', container_no: 'CMAU6677889', seal_no: 'SL-011', size_ft: 40, gross_weight_kg: 21500, port_arrival_date: '2026-07-06', customs_exam_date: '2026-07-09', release_date: '2026-07-13', factory_arrival_date: '2026-07-16', status: 'delivered', demurrage_days: 7, detention_days: 2 },
  { id: 'CN7', job_id: 'CJ2', container_no: 'CMAU9900112', seal_no: 'SL-012', size_ft: 40, gross_weight_kg: 20800, port_arrival_date: '2026-07-06', customs_exam_date: '2026-07-08', release_date: '2026-07-12', factory_arrival_date: '2026-07-15', status: 'delivered', demurrage_days: 6, detention_days: 0 },
];

const INITIAL_CLEARANCE_DOCUMENTS: ClearanceDocument[] = [
  { id: 'CD1', job_id: 'CJ1', doc_type: 'bill_of_lading', doc_ref: 'BL-S1-55410', received_date: '2026-07-18', submitted_date: '2026-07-23', status: 'submitted' },
  { id: 'CD2', job_id: 'CJ1', doc_type: 'commercial_invoice', doc_ref: 'INV-S1-2290', received_date: '2026-07-18', submitted_date: '2026-07-23', status: 'submitted' },
  { id: 'CD3', job_id: 'CJ1', doc_type: 'packing_list', received_date: '2026-07-18', status: 'received' },
  { id: 'CD4', job_id: 'CJ1', doc_type: 'certificate_of_origin', status: 'pending', notes: 'Awaiting from supplier' },
  { id: 'CD5', job_id: 'CJ2', doc_type: 'bill_of_lading', doc_ref: 'BL-S2-33100', received_date: '2026-07-02', submitted_date: '2026-07-07', approved_date: '2026-07-10', status: 'approved' },
  { id: 'CD6', job_id: 'CJ2', doc_type: 'commercial_invoice', doc_ref: 'INV-S2-4412', received_date: '2026-07-02', submitted_date: '2026-07-07', approved_date: '2026-07-10', status: 'approved' },
  { id: 'CD7', job_id: 'CJ2', doc_type: 'customs_declaration', doc_ref: 'CD-2026-44120', submitted_date: '2026-07-10', approved_date: '2026-07-13', status: 'approved' },
];

const INITIAL_CLEARANCE_CHARGES: ClearanceCharge[] = [
  // CJ1 charges (in-progress — only some known yet)
  { id: 'CH1', job_id: 'CJ1', charge_type: 'port_handling', currency: 'EGP', amount: 12500 },
  { id: 'CH2', job_id: 'CJ1', container_id: 'CN3', charge_type: 'demurrage', currency: 'USD', amount: 400, notes: '4 days × $100/day' },
  { id: 'CH3', job_id: 'CJ1', container_id: 'CN3', charge_type: 'detention', currency: 'USD', amount: 150 },
  // CJ2 charges (cleared — fully known)
  { id: 'CH4', job_id: 'CJ2', charge_type: 'customs_duty', currency: 'EGP', amount: 185000, paid_date: '2026-07-13' },
  { id: 'CH5', job_id: 'CJ2', charge_type: 'vat', currency: 'EGP', amount: 74000, paid_date: '2026-07-13' },
  { id: 'CH6', job_id: 'CJ2', charge_type: 'port_handling', currency: 'EGP', amount: 18000, paid_date: '2026-07-14' },
  { id: 'CH7', job_id: 'CJ2', charge_type: 'demurrage', currency: 'USD', amount: 2100, paid_date: '2026-07-14', notes: '7 days × $100 × 3 containers' },
  { id: 'CH8', job_id: 'CJ2', charge_type: 'agency_fee', currency: 'EGP', amount: 8500, paid_date: '2026-07-15' },
];

// Seeded demo accounts for the offline auth/roles system (see AuthContext.tsx).
// admin = full access incl. deletes & the Supabase connection dialog.
// planner = can create/edit plans, POs, master data (no deletes, no DB settings).
// viewer = read-only across every screen.
const INITIAL_USERS: AppUser[] = [
  { id: 'U1', name: 'Mohamed Amr', email: 'mohamed.amr@supplychain.com', role: 'admin', status: 'active' },
  { id: 'U2', name: 'Amr Anwar', email: 'amr.anwar@supplychain.com', role: 'planner', status: 'active' },
  { id: 'U3', name: 'Guest Viewer', email: 'guest@supplychain.com', role: 'viewer', status: 'active' }
];

// Helper function to initialize database state in localStorage
function getLocalDB() {
  const db: {
    suppliers: Supplier[];
    channels: Channel[];
    machines: Machine[];
    product_categories: ProductCategory[];
    product_groups: ProductGroup[];
    products: Product[];
    material_categories: MaterialCategory[];
    materials: Material[];
    material_alternatives: MaterialAlternative[];
    bom_headers: BOMHeader[];
    bom_slots: BOMSlot[];
    bom_options: BOMOption[];
    sales_plan: SalesPlan[];
    production_plan: ProductionPlan[];
    sales_actual: SalesActual[];
    production_actual: ProductionActual[];
    inventory_snapshots: InventorySnapshot[];
    purchase_orders: PurchaseOrder[];
    shipments: Shipment[];
    mrp_results: MRPResult[];
    closed_periods: ClosedPeriod[];
    users: AppUser[];
    uom_conversions: UOMConversion[];
    export_forecasts: ExportForecast[];
    clearance_companies: ClearanceCompany[];
    clearance_jobs: ClearanceJob[];
    clearance_containers: ClearanceContainer[];
    clearance_documents: ClearanceDocument[];
    clearance_charges: ClearanceCharge[];
  } = {
    suppliers: INITIAL_SUPPLIERS,
    channels: INITIAL_CHANNELS,
    machines: INITIAL_MACHINES,
    product_categories: INITIAL_PRODUCT_CATEGORIES,
    product_groups: INITIAL_PRODUCT_GROUPS,
    products: INITIAL_PRODUCTS,
    material_categories: INITIAL_MATERIAL_CATEGORIES,
    materials: INITIAL_MATERIALS,
    material_alternatives: INITIAL_ALTERNATIVES,
    bom_headers: INITIAL_BOM_HEADERS,
    bom_slots: INITIAL_BOM_SLOTS,
    bom_options: INITIAL_BOM_OPTIONS,
    sales_plan: INITIAL_SALES_PLAN,
    production_plan: INITIAL_PRODUCTION_PLAN,
    sales_actual: INITIAL_SALES_ACTUAL,
    production_actual: INITIAL_PRODUCTION_ACTUAL,
    inventory_snapshots: INITIAL_INVENTORY,
    purchase_orders: INITIAL_POS,
    shipments: INITIAL_SHIPMENTS,
    mrp_results: INITIAL_MRP_RESULTS,
    closed_periods: [],
    users: INITIAL_USERS,
    uom_conversions: INITIAL_UOM_CONVERSIONS,
    export_forecasts: INITIAL_EXPORT_FORECASTS,
    clearance_companies: INITIAL_CLEARANCE_COMPANIES,
    clearance_jobs: INITIAL_CLEARANCE_JOBS,
    clearance_containers: INITIAL_CLEARANCE_CONTAINERS,
    clearance_documents: INITIAL_CLEARANCE_DOCUMENTS,
    clearance_charges: INITIAL_CLEARANCE_CHARGES,
  };

  // A browser that has never held this app needs seeding, not migrating - the
  // seed is already at the current schema.
  const isFreshInstall = !localStorage.getItem('sc_db_materials');

  const keys = Object.keys(db) as Array<keyof typeof db>;
  keys.forEach(k => {
    const key = `sc_db_${k}`;
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, JSON.stringify(db[k]));
    }
  });

  if (isFreshInstall) {
    localStorage.setItem(STORAGE_SCHEMA_KEY, String(SCHEMA_VERSION));
  } else {
    runLocalMigrations();
  }
}

/** Bump when a released schema change needs existing local data adjusted. */
const SCHEMA_VERSION = 5;
const STORAGE_SCHEMA_KEY = 'sc_db_schema_version';

/**
 * Tables are seeded once and never overwritten, so a shipped semantic change
 * has to be applied to data already sitting in a planner's browser.
 */
export function runLocalMigrations() {
  const stored = Number(localStorage.getItem(STORAGE_SCHEMA_KEY) || '1');
  if (stored >= SCHEMA_VERSION) return;

  // v2: safety_stock_months stopped being the buffer formula and became an
  // opt-in override, with 0 meaning "size it from lead time".
  if (stored < 2) {
    const key = 'sc_db_materials';
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        const materials = JSON.parse(raw) as Material[];
        materials.forEach(m => { m.safety_stock_months = 0; });
        localStorage.setItem(key, JSON.stringify(materials));
      } catch {
        // Corrupt table
      }
    }
  }

  // v3: Add UOM conversions table and default UOMs for products & materials
  if (stored < 3) {
    if (!localStorage.getItem('sc_db_uom_conversions')) {
      localStorage.setItem('sc_db_uom_conversions', JSON.stringify(INITIAL_UOM_CONVERSIONS));
    }
    // Update products without uom
    const pKey = 'sc_db_products';
    const pRaw = localStorage.getItem(pKey);
    if (pRaw) {
      try {
        const prods = JSON.parse(pRaw) as Product[];
        let changed = false;
        prods.forEach(p => {
          if (!p.uom) { p.uom = 'PCS'; changed = true; }
        });
        if (changed) localStorage.setItem(pKey, JSON.stringify(prods));
      } catch {}
    }
    // Update materials without uom
    const mKey = 'sc_db_materials';
    const mRaw = localStorage.getItem(mKey);
    if (mRaw) {
      try {
        const mats = JSON.parse(mRaw) as Material[];
        let changed = false;
        mats.forEach(m => {
          if (!m.uom) {
            if (m.category_id === 'MC1' || m.category_id === 'MC5') m.uom = 'KG';
            else if (m.category_id === 'MC2') m.uom = 'SQM';
            else m.uom = 'PCS';
            changed = true;
          }
        });
        if (changed) localStorage.setItem(mKey, JSON.stringify(mats));
      } catch {}
    }
  }

  // v4/v5: Add/migrate Export Forecast by Country table to multi-SKU structure
  if (stored < 5) {
    const raw = localStorage.getItem('sc_db_export_forecasts');
    let reseed = false;
    if (!raw) {
      reseed = true;
    } else {
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0 || !parsed[0].items) {
          reseed = true;
        }
      } catch {
        reseed = true;
      }
    }
    if (reseed) {
      localStorage.setItem('sc_db_export_forecasts', JSON.stringify(INITIAL_EXPORT_FORECASTS));
    }
  }

  localStorage.setItem(STORAGE_SCHEMA_KEY, String(SCHEMA_VERSION));
}

// Ensure the local storage is seeded on first load
getLocalDB();

export function readLocalTable<T>(table: string): T[] {
  const key = `sc_db_${table}`;
  const data = localStorage.getItem(key);
  return data ? JSON.parse(data) : [];
}

export function writeLocalTable<T>(table: string, data: T[]) {
  const key = `sc_db_${table}`;
  localStorage.setItem(key, JSON.stringify(data));
}

// Synchronous local getters for calculation engines
export function getMaterials(): Material[] { return readLocalTable<Material>('materials'); }
export function getProducts(): Product[] { return readLocalTable<Product>('products'); }
export function getBOMHeaders(): BOMHeader[] { return readLocalTable<BOMHeader>('bom_headers'); }
export function getBOMSlots(): BOMSlot[] { return readLocalTable<BOMSlot>('bom_slots'); }
export function getBOMOptions(): BOMOption[] { return readLocalTable<BOMOption>('bom_options'); }
export function getInventorySnapshots(): InventorySnapshot[] { return readLocalTable<InventorySnapshot>('inventory_snapshots'); }
export function getShipments(): Shipment[] { return readLocalTable<Shipment>('shipments'); }
export function getPurchaseOrders(): PurchaseOrder[] { return readLocalTable<PurchaseOrder>('purchase_orders'); }
export function getExportForecasts(): ExportForecast[] { return readLocalTable<ExportForecast>('export_forecasts'); }

export async function syncExportForecastsToSalesPlan(targetIds?: string[]): Promise<{ mergedCount: number; totalVolumeMerged: number }> {
  const exportList = await fetchTableData<ExportForecast>('export_forecasts');
  const salesPlans = await fetchTableData<SalesPlan>('sales_plan');
  
  const toSync = exportList.filter(e => !targetIds || targetIds.includes(e.id));
  if (toSync.length === 0) return { mergedCount: 0, totalVolumeMerged: 0 };

  let totalVolumeMerged = 0;
  let mergedCount = 0;

  // Group export quantities by product_id and period_start
  const exportTotals: Record<string, number> = {};
  
  toSync.forEach(item => {
    if (item.items && item.items.length > 0) {
      item.items.forEach(li => {
        const key = `${li.product_id}:${item.period_start}`;
        const qty = li.confirmed_order_qty > 0 ? li.confirmed_order_qty : li.forecast_qty;
        exportTotals[key] = (exportTotals[key] || 0) + qty;
        totalVolumeMerged += qty;
      });
    }
    item.merged_to_sales_plan = true;
    mergedCount++;
  });

  const exportChannelId = 'C4'; // Export Global channel

  for (const key of Object.keys(exportTotals)) {
    const [productId, periodStart] = key.split(':');
    const exportQty = exportTotals[key];

    const existingIndex = salesPlans.findIndex(
      sp => sp.product_id === productId && sp.period_start === periodStart && sp.channel_id === exportChannelId
    );

    if (existingIndex >= 0) {
      salesPlans[existingIndex].quantity = exportQty;
      await saveRecord<SalesPlan>('sales_plan', salesPlans[existingIndex]);
    } else {
      const newPlan: SalesPlan = {
        id: `SP_EXP_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        product_id: productId,
        channel_id: exportChannelId,
        period_type: 'month',
        period_start: periodStart,
        quantity: exportQty
      };
      salesPlans.push(newPlan);
      await saveRecord<SalesPlan>('sales_plan', newPlan);
    }
  }

  for (const item of toSync) {
    await saveRecord<ExportForecast>('export_forecasts', item);
  }

  return { mergedCount, totalVolumeMerged };
}

// ==========================================
// UNIVERSAL API LAYER Wrapper
// ==========================================

export async function fetchTableData<T>(table: string): Promise<T[]> {
  if (isSupabaseConnected() && supabase) {
    try {
      const { data, error } = await supabase.from(table).select('*');
      if (error) throw error;
      const result = data as T[];
      writeLocalTable<T>(table, result);
      return result;
    } catch (err: any) {
      console.warn(`Supabase fetch failed for ${table}, falling back to Local Storage:`, err.message || err);
      return readLocalTable<T>(table);
    }
  }
  return readLocalTable<T>(table);
}

// ==========================================
// LOCAL STORAGE CACHING & STALE-WHILE-REVALIDATE LAYER
// ==========================================

const PLAN_CACHE_PREFIX = 'sc_cache_';

export function getCachedPlanResult<T>(cacheKey: string): T | null {
  try {
    const raw = localStorage.getItem(`${PLAN_CACHE_PREFIX}${cacheKey}`);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn(`Failed to read cached plan result for ${cacheKey}`, e);
    return null;
  }
}

export function setCachedPlanResult<T>(cacheKey: string, data: T): void {
  try {
    localStorage.setItem(`${PLAN_CACHE_PREFIX}${cacheKey}`, JSON.stringify(data));
  } catch (e) {
    console.warn(`Failed to set cached plan result for ${cacheKey}`, e);
  }
}

export function clearPlanResultCache(cacheKey?: string): void {
  try {
    if (cacheKey) {
      localStorage.removeItem(`${PLAN_CACHE_PREFIX}${cacheKey}`);
    } else {
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith(PLAN_CACHE_PREFIX)) {
          localStorage.removeItem(key);
        }
      });
    }
  } catch (e) {
    console.warn('Failed to clear plan result cache', e);
  }
}

/**
 * Synchronous getter for cached table data from LocalStorage
 */
export function getCachedTableData<T>(table: string): T[] {
  return readLocalTable<T>(table);
}

/**
 * Executes a stale-while-revalidate fetch for master data tables.
 * Instantly returns cached local data (isStale = true) if available while
 * revalidating asynchronously against Supabase in the background.
 */
export async function fetchTableDataWithSWR<T>(
  table: string,
  onRevalidated?: (freshData: T[]) => void
): Promise<{ data: T[]; isStale: boolean; promise: Promise<T[]> }> {
  const cached = readLocalTable<T>(table);
  const isStale = cached.length > 0;

  const promise = fetchTableData<T>(table).then(fresh => {
    if (onRevalidated && JSON.stringify(fresh) !== JSON.stringify(cached)) {
      onRevalidated(fresh);
    }
    return fresh;
  });

  if (isStale) {
    return { data: cached, isStale: true, promise };
  }

  const fresh = await promise;
  return { data: fresh, isStale: false, promise };
}

/**
 * Executes a stale-while-revalidate fetch for plan results and analytical queries.
 * Instantly returns cached local results if present while executing the remote query
 * in the background.
 */
export async function fetchPlanWithSWR<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  onRevalidated?: (freshData: T) => void
): Promise<{ data: T; isStale: boolean; promise: Promise<T> }> {
  const cached = getCachedPlanResult<T>(cacheKey);
  const isStale = cached !== null;

  const promise = fetcher().then(fresh => {
    setCachedPlanResult(cacheKey, fresh);
    if (onRevalidated && JSON.stringify(fresh) !== JSON.stringify(cached)) {
      onRevalidated(fresh);
    }
    return fresh;
  });

  if (isStale && cached !== null) {
    return { data: cached, isStale: true, promise };
  }

  const fresh = await promise;
  return { data: fresh, isStale: false, promise };
}

export async function saveRecord<T extends { id: string }>(table: string, record: T): Promise<T> {
  if (isSupabaseConnected() && supabase) {
    // When a database IS connected, a failed write must surface to the user.
    // Silently falling back to localStorage here meant a server-side rejection
    // (RLS policy denial, constraint violation, network loss) was written
    // locally and reported to the planner as "saved successfully" - the record
    // then existed only in that one browser and diverged from the database.
    // Decision 8: offline writes fail loudly. Callers already try/catch and
    // raise an error toast.
    const { data, error } = await supabase.from(table).upsert(record).select().single();
    if (error) throw new Error(`Save to "${table}" was rejected by the database: ${error.message}`);
    return data as T;
  }

  // No database configured at all - offline/demo mode writes to localStorage.

  const current = readLocalTable<T>(table);
  const existsIdx = current.findIndex(r => r.id === record.id);
  
  let updatedRecord = { ...record };
  if (existsIdx > -1) {
    current[existsIdx] = updatedRecord;
  } else {
    // If id is empty or temp, generate UUID-like id
    if (!record.id || record.id.startsWith('temp_')) {
      updatedRecord.id = 'ID_' + Math.random().toString(36).substr(2, 9).toUpperCase();
    }
    current.push(updatedRecord);
  }
  writeLocalTable<T>(table, current);
  return updatedRecord;
}

export async function deleteRecord<T extends { id: string }>(table: string, id: string): Promise<boolean> {
  if (isSupabaseConnected() && supabase) {
    // Same reasoning as saveRecord: a delete the database refused must not be
    // applied locally and reported as success (decision 8).
    //
    // Checking `error` alone is NOT enough. A Row Level Security policy blocks
    // a DELETE by filtering the row out of the statement's scope, not by
    // raising - so a delete the policy forbids returns no error and simply
    // affects zero rows. Selecting the deleted rows back is what distinguishes
    // "deleted" from "silently refused": an empty result means the row either
    // does not exist or RLS would not let this account touch it.
    const { data, error } = await supabase.from(table).delete().eq('id', id).select();
    if (error) throw new Error(`Delete from "${table}" was rejected by the database: ${error.message}`);
    if (!data || data.length === 0) {
      throw new Error(
        `Delete from "${table}" affected no rows - the record no longer exists, ` +
        `or your account is not permitted to delete it.`
      );
    }
    return true;
  }

  // No database configured at all - offline/demo mode.

  const current = readLocalTable<T>(table);
  const filtered = current.filter(r => r.id !== id);
  writeLocalTable<T>(table, filtered);
  return true;
}

// ==========================================
// CLIENT-SIDE VIEWS CALCULATORS (Offline Engine)
// ==========================================

export async function getVMaterialCoverage(
  demandBasis: 'forecast' | 'sales' = 'forecast',
  period: string = getPlanningPeriod()
): Promise<VMaterialCoverage[]> {
  const cacheKey = `v_material_coverage_${demandBasis}_${period}`;
  if (isSupabaseConnected() && supabase) {
    try {
      const { data, error } = await supabase.from('v_material_coverage').select('*');
      if (!error && data) {
        const result = data as VMaterialCoverage[];
        writeLocalTable('v_material_coverage', result);
        setCachedPlanResult(cacheKey, result);
        return result;
      }
    } catch (e) {
      console.warn("Fallback to local coverage calculations");
    }
  }

  // Local calculation:
  const materials = readLocalTable<Material>('materials');
  const matCats = readLocalTable<MaterialCategory>('material_categories');
  const inventory = readLocalTable<InventorySnapshot>('inventory_snapshots');
  const salesPlan = readLocalTable<SalesPlan>('sales_plan');
  const salesActual = readLocalTable<SalesActual>('sales_actual');
  const shipments = readLocalTable<Shipment>('shipments');
  const pos = readLocalTable<PurchaseOrder>('purchase_orders');

  // Let's calculate the monthly usage for each material
  const usageMap: Record<string, number> = {};
  materials.forEach(m => { usageMap[m.id] = 0; });

  // Determine demand per product based on toggle
  const productDemandMap: Record<string, number> = {};
  const products = readLocalTable<Product>('products');
  products.forEach(p => {
    let quantity = 0;
    if (demandBasis === 'sales') {
      const actuals = salesActual.filter(s => s.product_id === p.id && isInPeriod(s.period_start, period));
      const totalActual = actuals.reduce((sum, s) => sum + s.quantity, 0);
      if (totalActual > 0) {
        quantity = totalActual;
      } else {
        // Fallback to forecast
        const forecasts = salesPlan.filter(s => s.product_id === p.id && isInPeriod(s.period_start, period));
        quantity = forecasts.reduce((sum, s) => sum + s.quantity, 0);
      }
    } else {
      // Forecast-based
      const forecasts = salesPlan.filter(s => s.product_id === p.id && isInPeriod(s.period_start, period));
      quantity = forecasts.reduce((sum, s) => sum + s.quantity, 0);
    }
    productDemandMap[p.id] = quantity;
  });

  // Explode to material usage
  Object.entries(explodeBOM(productDemandMap)).forEach(([materialId, qty]) => {
    if (usageMap[materialId] !== undefined) usageMap[materialId] += qty;
  });

  const res = materials.map(m => {
    const cat = matCats.find(c => c.id === m.category_id);
    const mSnapshots = inventory.filter(i => i.item_type === 'material' && i.item_id === m.id);
    const stockSnapshot = mSnapshots.find(i => i.snapshot_date === period) || mSnapshots[0];
    const stock = stockSnapshot ? stockSnapshot.quantity : 0;
    
    // Monthly consumption from the exploded BOM. When no forecast exists for
    // this period the demand is 0 — the coverage screen shows "no forecast"
    // rather than falling back to a magic number (decision 6).
    const monthlyDemand = usageMap[m.id] || 0;

    // In-transit: shipments that have NOT yet arrived at factory
    const transitQty = shipments
      .filter(s => s.material_id === m.id && s.factory_arrival_date === null)
      .reduce((sum, s) => sum + s.qty, 0);

    // Pending PO quantity (not completed and not in transit)
    const pendingPoQty = pos
      .filter(p => p.material_id === m.id && p.status === 'pending')
      .reduce((sum, p) => sum + p.remaining_qty, 0);

    const totalAvailable = stock + transitQty + pendingPoQty;

    const coverageMonths = monthsOfCover(totalAvailable, monthlyDemand);
    const coverageMonthsNoTransit = monthsOfCover(stock, monthlyDemand);

    return {
      material_id: m.id,
      material_name: m.name,
      sku: m.sku,
      // Carried on the view so a screen showing a quantity never has to join
      // back to materials to say what the number means.
      uom: m.uom || 'PCS',
      category_id: m.category_id,
      category_name: cat ? cat.name : 'Unknown',
      material_group: cat ? cat.material_group : 'RM',
      opening_stock: stock,
      monthly_demand: Math.round(monthlyDemand),
      coverage_months: parseFloat(coverageMonths.toFixed(2)),
      coverage_months_no_transit: parseFloat(coverageMonthsNoTransit.toFixed(2)),
      oos_risk_flag: coverageMonths < 1.0,
      overstock_flag: coverageMonths > 3.0
    };
  });

  setCachedPlanResult(cacheKey, res);
  return res;
}

export async function getVProductCoverage(
  demandBasis: 'forecast' | 'sales' = 'forecast',
  period: string = getPlanningPeriod()
): Promise<VProductCoverage[]> {
  const cacheKey = `v_product_coverage_${demandBasis}_${period}`;
  if (isSupabaseConnected() && supabase) {
    try {
      const { data, error } = await supabase.from('v_product_coverage').select('*');
      if (!error && data) {
        const result = data as VProductCoverage[];
        writeLocalTable('v_product_coverage', result);
        setCachedPlanResult(cacheKey, result);
        return result;
      }
    } catch (e) {
      console.warn("Fallback to local product coverage calculations");
    }
  }

  const products = readLocalTable<Product>('products');
  const inventory = readLocalTable<InventorySnapshot>('inventory_snapshots');
  const salesPlan = readLocalTable<SalesPlan>('sales_plan');
  const salesActual = readLocalTable<SalesActual>('sales_actual');

  // Compute monthly sales demand
  const demandMap: Record<string, number> = {};
  products.forEach(p => {
    let quantity = 0;
    if (demandBasis === 'sales') {
      const actuals = salesActual.filter(s => s.product_id === p.id && isInPeriod(s.period_start, period));
      const totalActual = actuals.reduce((sum, s) => sum + s.quantity, 0);
      if (totalActual > 0) {
        quantity = totalActual;
      } else {
        const forecasts = salesPlan.filter(s => s.product_id === p.id && isInPeriod(s.period_start, period));
        quantity = forecasts.reduce((sum, s) => sum + s.quantity, 0);
      }
    } else {
      const forecasts = salesPlan.filter(s => s.product_id === p.id && isInPeriod(s.period_start, period));
      quantity = forecasts.reduce((sum, s) => sum + s.quantity, 0);
    }
    demandMap[p.id] = quantity;
  });

  const res = products.map(p => {
    const pSnapshots = inventory.filter(i => i.item_type === 'product' && i.item_id === p.id);
    const stockSnapshot = pSnapshots.find(i => i.snapshot_date === period) || pSnapshots[0];
    const stock = stockSnapshot ? stockSnapshot.quantity : 0;
    const monthlyDemand = demandMap[p.id] || 0; // 0 = no forecast this period

    const coverageMonths = monthsOfCover(stock, monthlyDemand);

    return {
      product_id: p.id,
      product_name: p.name,
      sku: p.sku,
      uom: p.uom || 'PCS',
      product_line: p.product_line,
      opening_stock: stock,
      monthly_demand: Math.round(monthlyDemand),
      coverage_months: parseFloat(coverageMonths.toFixed(2)),
      below_safety_flag: coverageMonths < 1.0
    };
  });

  setCachedPlanResult(cacheKey, res);
  return res;
}

export async function getVFGPSIAnalysis(period: string = getPlanningPeriod()): Promise<VFGPSIAnalysis[]> {
  const cacheKey = `v_fg_psi_analysis_${period}`;
  if (isSupabaseConnected() && supabase) {
    try {
      const { data, error } = await supabase.from('v_fg_psi_analysis').select('*');
      if (!error && data) {
        const result = data as VFGPSIAnalysis[];
        writeLocalTable('v_fg_psi_analysis', result);
        setCachedPlanResult(cacheKey, result);
        return result;
      }
    } catch (e) {
      console.warn("Fallback to local PSI analysis calculations");
    }
  }

  const products = readLocalTable<Product>('products');
  const categories = readLocalTable<ProductCategory>('product_categories');
  const groups = readLocalTable<ProductGroup>('product_groups');
  const inventory = readLocalTable<InventorySnapshot>('inventory_snapshots');
  const salesPlan = readLocalTable<SalesPlan>('sales_plan');
  const productionPlan = readLocalTable<ProductionPlan>('production_plan');
  const salesActual = readLocalTable<SalesActual>('sales_actual');
  const productionActual = readLocalTable<ProductionActual>('production_actual');

  return products.map(p => {
    const cat = categories.find(c => c.id === p.category_id);
    const grp = groups.find(g => g.id === p.group_id);
    
    const startStockSnap = inventory.find(i => i.item_type === 'product' && i.item_id === p.id);
    const start_stock = startStockSnap ? startStockSnap.quantity : 0;

    const sales_forecast = salesPlan
      .filter(s => s.product_id === p.id && isInPeriod(s.period_start, period))
      .reduce((sum, s) => sum + s.quantity, 0);

    const salesActualRows = salesActual
      .filter(s => s.product_id === p.id && isInPeriod(s.period_start, period));
    const actual_sales = salesActualRows.reduce((sum, s) => sum + s.quantity, 0);

    // No plan means there is no target to have hit or missed. Reporting 0%
    // painted an un-planned SKU as a total failure - the same mistake
    // getVPlanVsActual used to make before it was changed to report null.
    const sales_achievement_percent = sales_forecast > 0 ? (actual_sales / sales_forecast) * 100 : null;

    const prod_plan = productionPlan
      .filter(s => s.product_id === p.id && isInPeriod(s.period_start, period))
      .reduce((sum, s) => sum + s.quantity, 0);

    const productionActualRows = productionActual
      .filter(s => s.product_id === p.id && isInPeriod(s.period_start, period));
    const actual_production = productionActualRows.reduce((sum, s) => sum + s.quantity, 0);

    const production_achievement_percent = prod_plan > 0 ? (actual_production / prod_plan) * 100 : null;

    const expected_stock = start_stock + prod_plan - sales_forecast;
    const coverage_months = monthsOfCover(expected_stock, sales_forecast);
    const sales_value = sales_forecast * p.selling_price;

    return {
      row_id: p.id,
      category_id: p.category_id,
      category_name: cat ? cat.name : 'Unknown',
      group_id: p.group_id,
      group_name: grp ? grp.name : 'Unknown',
      brand: p.brand,
      product_line: p.product_line,
      pack_type: p.pack_type,
      size: p.size,
      status: p.status,
      start_stock,
      sales_forecast,
      actual_sales,
      // Row counts, not just sums: a month nobody has reported on yet and a
      // month that genuinely sold nothing both total zero, and only the second
      // is a miss.
      sales_actual_records: salesActualRows.length,
      production_actual_records: productionActualRows.length,
      sales_achievement_percent: sales_achievement_percent === null
        ? null
        : parseFloat(sales_achievement_percent.toFixed(1)),
      production_plan: prod_plan,
      actual_production,
      production_achievement_percent: production_achievement_percent === null
        ? null
        : parseFloat(production_achievement_percent.toFixed(1)),
      expected_stock,
      coverage_months: parseFloat(coverage_months.toFixed(2)),
      sales_value
    };
  });
}

export async function getVBOMCostDetail(productId: string): Promise<VBOMCostDetail[]> {
  const cacheKey = `v_bom_cost_detail_${productId}`;
  if (isSupabaseConnected() && supabase) {
    try {
      const { data, error } = await supabase.from('v_bom_cost_detail').select('*').eq('product_id', productId);
      if (!error && data) {
        const result = data as VBOMCostDetail[];
        setCachedPlanResult(cacheKey, result);
        return result;
      }
    } catch (e) {
      console.warn("Fallback to local BOM cost calculations");
    }
  }

  const bomHeaders = readLocalTable<BOMHeader>('bom_headers');
  const bomSlots = readLocalTable<BOMSlot>('bom_slots');
  const bomOptions = readLocalTable<BOMOption>('bom_options');
  const materials = readLocalTable<Material>('materials');
  const matCats = readLocalTable<MaterialCategory>('material_categories');
  const uomConversions = readLocalTable<UOMConversion>('uom_conversions');

  const bom = bomHeaders.find(b => b.product_id === productId && b.is_active);
  if (!bom) return [];

  const slots = bomSlots.filter(s => s.bom_id === bom.id);
  const details: VBOMCostDetail[] = [];

  slots.forEach(slot => {
    const options = bomOptions.filter(o => o.slot_id === slot.id);
    options.forEach(opt => {
      const mat = materials.find(m => m.id === opt.material_id);
      if (!mat) return;
      const cat = matCats.find(c => c.id === mat.category_id);
      
      // Normalize Qty per unit to base material UOM
      const optUom = opt.uom || mat.uom || 'PCS';
      const matUom = mat.uom || optUom;
      const norm = normalizeQuantity(opt.qty_per_unit, optUom, matUom, uomConversions, mat.sku);
      const normalizedBaseQty = norm.normalizedQty;

      // Determine effective cost based on cost_basis toggle
      const unit_cost = mat.cost_basis === 'weighted_avg' 
        ? getWeightedAvgCost(mat.id) 
        : mat.standard_cost;

      const line_cost = normalizedBaseQty * (1 + opt.scrap_percent / 100) * unit_cost;

      details.push({
        product_id: productId,
        slot_id: slot.id,
        slot_name: slot.slot_name,
        material_id: mat.id,
        material_name: mat.name,
        material_group: cat ? cat.material_group : 'RM',
        qty_per_unit: opt.qty_per_unit,
        scrap_percent: opt.scrap_percent,
        unit_cost,
        line_cost: parseFloat(line_cost.toFixed(4)),
        priority: opt.priority,
        uom: opt.uom || mat.uom || 'PCS'
      });
    });
  });

  setCachedPlanResult(cacheKey, details);
  return details;
}

function getWeightedAvgCost(materialId: string): number {
  // Weighted average of actual PO unit_prices, weighted by PO quantity.
  const pos = readLocalTable<PurchaseOrder>('purchase_orders');
  const materials = readLocalTable<Material>('materials');
  const mat = materials.find(m => m.id === materialId);
  const defaultCost = mat ? mat.standard_cost : 1.0;

  const matPos = pos.filter(p => p.material_id === materialId && p.qty > 0 && p.unit_price != null);
  if (matPos.length === 0) return defaultCost;

  const totalCost = matPos.reduce((sum, p) => sum + (p.qty * (p.unit_price ?? defaultCost)), 0);
  const totalQty = matPos.reduce((sum, p) => sum + p.qty, 0);

  return parseFloat((totalCost / totalQty).toFixed(4));
}

export async function getVFGCost(productId: string): Promise<VFGCost | null> {
  const cacheKey = `v_fg_cost_${productId}`;
  if (isSupabaseConnected() && supabase) {
    try {
      const { data, error } = await supabase.from('v_fg_cost').select('*').eq('product_id', productId).maybeSingle();
      if (!error && data) {
        const result = data as VFGCost;
        setCachedPlanResult(cacheKey, result);
        return result;
      }
    } catch (e) {
      console.warn("Fallback to local FGCost calculation");
    }
  }

  const products = readLocalTable<Product>('products');
  const p = products.find(prod => prod.id === productId);
  if (!p) return null;

  const details = await getVBOMCostDetail(productId);
  // Sum cost of primary options only (priority = 1)
  let rm_cost = 0;
  let pk_cost = 0;
  let con_cost = 0;

  details.filter(d => d.priority === 1).forEach(d => {
    if (d.material_group === 'RM') rm_cost += d.line_cost;
    else if (d.material_group === 'PK') pk_cost += d.line_cost;
    else con_cost += d.line_cost;
  });

  const total_material_cost = rm_cost + pk_cost + con_cost;
  const margin_per_unit = p.selling_price - total_material_cost;
  const margin_percent = p.selling_price > 0 ? (margin_per_unit / p.selling_price) * 100 : 0;

  const res = {
    product_id: p.id,
    product_name: p.name,
    sku: p.sku,
    selling_price: p.selling_price,
    rm_cost: parseFloat(rm_cost.toFixed(4)),
    pk_cost: parseFloat(pk_cost.toFixed(4)),
    con_cost: parseFloat(con_cost.toFixed(4)),
    total_material_cost: parseFloat(total_material_cost.toFixed(4)),
    margin_per_unit: parseFloat(margin_per_unit.toFixed(4)),
    margin_percent: parseFloat(margin_percent.toFixed(2))
  };

  setCachedPlanResult(cacheKey, res);
  return res;
}

// ==========================================
// THE ACTIVE PLANNING PERIOD
// ==========================================

/**
 * The month the seeded dataset is built around. Only a fallback now - the
 * active period is whatever the planner has selected.
 */
export const PLANNING_ANCHOR = '2026-07-01';

const STORAGE_PERIOD_KEY = 'sc_planner_planning_period';

/** First day of the month containing `date`, as YYYY-MM-01. */
function monthStart(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Whether a plan or actual row belongs to a planning period.
 *
 * Planning is monthly, but `period_start` is a full date and nothing stops a
 * row landing mid-month - the CSV importer accepts whatever the file carries.
 * Matching on exact date equality silently dropped those rows, and because
 * only the MRP path matched on the month, a 2026-08-15 row would drive the
 * solver while Coverage, PSI and Plan vs Actuals all reported zero for it.
 * Every caller now asks the same question: is this row in this month?
 */
export function isInPeriod(rowPeriodStart: string, period: string): boolean {
  if (!rowPeriodStart || !period) return false;
  return rowPeriodStart.slice(0, 7) === period.slice(0, 7);
}

/**
 * Months of stock cover.
 *
 * With no demand there is no meaningful ratio, so the two cases are reported
 * apart: stock sitting against no demand is effectively unlimited cover, while
 * no stock and no demand is no cover at all. Returning a flat 99 for both made
 * an empty, unused item look like the healthiest line on the screen.
 */
export const UNLIMITED_COVER_MONTHS = 99;

export function monthsOfCover(available: number, monthlyDemand: number): number {
  if (monthlyDemand > 0) return available / monthlyDemand;
  return available > 0 ? UNLIMITED_COVER_MONTHS : 0;
}

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Local-time YYYY-MM-DD, avoiding the UTC shift `toISOString()` introduces. */
export function toDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Calendar length of the month containing `dateStr`, in days. */
export function daysInMonthOf(dateStr: string): number {
  const d = new Date(dateStr);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/** Every month that has sales or production plan rows, oldest first. */
export function getPlannedPeriods(): string[] {
  const months = new Set<string>();
  readLocalTable<SalesPlan>('sales_plan').forEach(r => months.add(`${r.period_start.slice(0, 7)}-01`));
  readLocalTable<ProductionPlan>('production_plan').forEach(r => months.add(`${r.period_start.slice(0, 7)}-01`));
  return [...months].sort();
}

/**
 * Where to open the app when the planner has not chosen a period yet.
 *
 * The real current month is the right answer whenever the data supports it.
 * When it does not - a dataset that stops before today, or a demo dataset
 * seeded in the past - falling back to the newest month that does have a plan
 * beats showing a set of empty grids and letting the planner guess why.
 */
function resolveDefaultPlanningPeriod(): string {
  const currentMonth = monthStart(new Date());
  const planned = getPlannedPeriods();
  if (planned.length === 0 || planned.includes(currentMonth)) return currentMonth;

  const past = planned.filter(p => p <= currentMonth);
  return past.length > 0 ? past[past.length - 1] : planned[0];
}

/**
 * The month every analysis screen reports on: stock coverage, plan vs actual,
 * PSI, and the dashboard KPIs. Persisted so it survives a refresh, the same
 * way the Supabase credentials are.
 */
export function getPlanningPeriod(): string {
  return localStorage.getItem(STORAGE_PERIOD_KEY) || resolveDefaultPlanningPeriod();
}

export function setPlanningPeriod(period: string) {
  localStorage.setItem(STORAGE_PERIOD_KEY, period);
}

/** Renders a period as e.g. "August 2026". */
export function formatPlanningPeriod(period: string): string {
  const [y, m] = period.split('-');
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Per-unit material consumption implied by the active BOMs, as
 * `{ [productId]: { [materialId]: qtyPerFinishedUnit } }`, scrap included.
 *
 * This is the single definition of "what does one unit of this product
 * consume" for the whole offline engine. Stock coverage, the MRP run and the
 * Material Check drill-down all build on it, so they cannot drift apart the
 * way they did when each maintained its own explosion loop.
 *
 * Rules: only priority-1 (primary) options consume - alternates exist as a
 * costing benchmark and are never planned against. A slot is expected to hold
 * exactly one primary; if a slot somehow holds several, the first one wins
 * rather than all of them summing, which would silently double-count.
 */
function getPrimaryBomConsumption(): Record<string, Record<string, number>> {
  const products = readLocalTable<Product>('products');
  const bomHeaders = readLocalTable<BOMHeader>('bom_headers');
  const bomSlots = readLocalTable<BOMSlot>('bom_slots');
  const bomOptions = readLocalTable<BOMOption>('bom_options');
  const materials = readLocalTable<Material>('materials');
  const uomConversions = readLocalTable<UOMConversion>('uom_conversions');

  const activeBoms = bomHeaders.filter(b => b.is_active);
  const consumption: Record<string, Record<string, number>> = {};

  products.forEach(p => {
    const bom = activeBoms.find(b => b.product_id === p.id);
    if (!bom) return;
    const perUnit: Record<string, number> = {};
    bomSlots
      .filter(s => s.bom_id === bom.id)
      .forEach(slot => {
        const opt = bomOptions.find(o => o.slot_id === slot.id && o.priority === 1);
        if (!opt) return;
        const mat = materials.find(m => m.id === opt.material_id);
        const optUom = opt.uom || (mat ? mat.uom : 'PCS');
        const matUom = mat ? mat.uom : optUom;
        const norm = normalizeQuantity(opt.qty_per_unit, optUom, matUom, uomConversions, mat?.sku);
        const normalizedQty = norm.normalizedQty * (1 + opt.scrap_percent / 100);

        perUnit[opt.material_id] =
          (perUnit[opt.material_id] || 0) + normalizedQty;
      });
    consumption[p.id] = perUnit;
  });

  return consumption;
}

/**
 * Primary consumption split by the BOM slot that drives it.
 *
 * A material can sit in more than one slot - MT2 is the top sheet for both
 * product families - and each slot converts to its alternate at its own ratio.
 * Attributing the shortfall by slot keeps a substitution proposal honest:
 * without it, two slots each claim the whole gap and the numbers double.
 */
export function primaryConsumptionBySlot(
  demandByProduct: Record<string, number>
): Record<string, Record<string, number>> {
  const bomHeaders = readLocalTable<BOMHeader>('bom_headers').filter(b => b.is_active);
  const bomSlots = readLocalTable<BOMSlot>('bom_slots');
  const bomOptions = readLocalTable<BOMOption>('bom_options');
  const materials = readLocalTable<Material>('materials');
  const uomConversions = readLocalTable<UOMConversion>('uom_conversions');

  const out: Record<string, Record<string, number>> = {};
  Object.entries(demandByProduct).forEach(([productId, qty]) => {
    if (!qty) return;
    const bom = bomHeaders.find(b => b.product_id === productId);
    if (!bom) return;
    bomSlots
      .filter(sl => sl.bom_id === bom.id)
      .forEach(slot => {
        const opt = bomOptions.find(o => o.slot_id === slot.id && o.priority === 1);
        if (!opt) return;
        const mat = materials.find(m => m.id === opt.material_id);
        const optUom = opt.uom || (mat ? mat.uom : 'PCS');
        const matUom = mat ? mat.uom : optUom;
        const norm = normalizeQuantity(opt.qty_per_unit, optUom, matUom, uomConversions, mat?.sku);
        const used = qty * norm.normalizedQty * (1 + opt.scrap_percent / 100);
        out[opt.material_id] = out[opt.material_id] || {};
        out[opt.material_id][slot.id] = (out[opt.material_id][slot.id] || 0) + used;
      });
  });
  return out;
}

/**
 * Explodes a per-product demand map into gross material requirements.
 * Callers decide what the demand represents - a sales forecast, a month of
 * the MPS, a single week of it - and the explosion rules stay identical.
 */
export function explodeBOM(demandByProduct: Record<string, number>): Record<string, number> {
  const consumption = getPrimaryBomConsumption();
  const requirements: Record<string, number> = {};

  Object.entries(demandByProduct).forEach(([productId, demand]) => {
    if (!demand) return;
    const perUnit = consumption[productId];
    if (!perUnit) return;
    Object.entries(perUnit).forEach(([materialId, qty]) => {
      requirements[materialId] = (requirements[materialId] || 0) + demand * qty;
    });
  });

  return requirements;
}

/** Nominal days in a month, used to turn monthly plan volumes into daily rates. */
export const DAYS_PER_MONTH = 30;

/**
 * Extra cover held on top of pure lead-time demand, as a multiplier.
 *
 * 1.0 would buy exactly enough to survive one replenishment cycle with no
 * margin, which leaves nothing for demand variability or a late supplier.
 * 1.25 gives a quarter of a lead time in slack.
 */
export const SAFETY_SERVICE_FACTOR = 1.25;

/** Lead time assumed when a material has none recorded, in days. */
const FALLBACK_LEAD_TIME_DAYS = 30;

/**
 * Target buffer stock for a material, in units.
 *
 * Safety stock exists to cover demand during the replenishment lead time:
 * once stock is committed, the exposure lasts exactly as long as it takes to
 * get more, so lead time - not an arbitrary number of months - is what sets
 * the buffer. A 12-day polybag and a 48-day nonwoven carry very different
 * risk, and sizing both off `safety_stock_months` charged the same months of
 * cover to each.
 *
 * A buffer is a stock level, not a flow, so it does not change with the
 * bucket size of the run: the same quantity applies whether the MRP is
 * bucketed weekly or monthly.
 *
 * Materials the plan never consumes (obsolete items, or ones with no active
 * BOM) fall back to the master-data usage rate so they still get a sane
 * target instead of zero.
 */
export function getSafetyStockQty(material: Material, avgMonthlyRequirement: number): number {
  const dailyDemand = avgMonthlyRequirement > 0
    ? avgMonthlyRequirement / DAYS_PER_MONTH
    : (material.max_usage || 500);

  // A planner who types a figure into `safety_stock_months` has made a
  // deliberate call - a volatile item, a supplier on watch, a contractual
  // minimum - and that beats the computed default.
  if (hasSafetyStockOverride(material)) {
    return material.safety_stock_months * dailyDemand * DAYS_PER_MONTH;
  }

  const leadDays = material.total_lead_time_days > 0
    ? material.total_lead_time_days
    : FALLBACK_LEAD_TIME_DAYS;
  return dailyDemand * leadDays * SAFETY_SERVICE_FACTOR;
}

/**
 * Whether this material's buffer is pinned by hand. Zero (the default) means
 * "size it from lead time"; any positive value is an explicit months-of-cover
 * instruction from a planner.
 */
export function hasSafetyStockOverride(material: Material): boolean {
  return material.safety_stock_months > 0;
}

/**
 * Months of cover the buffer represents, for display. Reads back the
 * override when one is set, otherwise the lead-time-derived figure.
 */
export function getSafetyStockMonths(material: Material): number {
  if (hasSafetyStockOverride(material)) return material.safety_stock_months;
  const leadDays = material.total_lead_time_days > 0
    ? material.total_lead_time_days
    : FALLBACK_LEAD_TIME_DAYS;
  return (leadDays * SAFETY_SERVICE_FACTOR) / DAYS_PER_MONTH;
}

/** Sums a plan table into `{ [productId]: qty }` for one month (YYYY-MM). */
function plannedQtyByProductForMonth(
  plan: Array<{ product_id: string; period_start: string; quantity: number }>,
  month: string
): Record<string, number> {
  const byProduct: Record<string, number> = {};
  plan
    .filter(row => isInPeriod(row.period_start, month))
    .forEach(row => {
      byProduct[row.product_id] = (byProduct[row.product_id] || 0) + row.quantity;
    });
  return byProduct;
}

export async function getVMaterialMonthlyProjection(
  materialId: string,
  grain: 'day' | 'week' | 'month' = 'month',
  horizon?: number
): Promise<VMaterialMonthlyProjection[]> {
  const materials = readLocalTable<Material>('materials');
  const inventory = readLocalTable<InventorySnapshot>('inventory_snapshots');
  const pos = readLocalTable<PurchaseOrder>('purchase_orders');
  const shipments = readLocalTable<Shipment>('shipments');
  const mat = materials.find(m => m.id === materialId);
  if (!mat) return [];

  const defaultHorizon = horizon || (grain === 'month' ? 4 : grain === 'week' ? 8 : 14);
  const periods = getCurrentPeriods(getPlanningPeriod(), defaultHorizon, grain);
  const results: VMaterialMonthlyProjection[] = [];

  // Get initial stock
  const snap = inventory.find(i => i.item_type === 'material' && i.item_id === materialId);
  let currentStock = snap ? snap.quantity : 0;

  const prodPlan = readLocalTable<ProductionPlan>('production_plan');

  periods.forEach((p, idx) => {
    let usage = 0;
    let mTransit = 0;
    let mPOs = 0;
    let periodDays = 30;

    if (grain === 'month') {
      periodDays = 30;
      usage = explodeBOM(plannedQtyByProductForMonth(prodPlan, p.slice(0, 7)))[materialId] || 0;
      mTransit = shipments
        .filter(s => s.material_id === materialId && s.factory_arrival_date && s.factory_arrival_date.startsWith(p.slice(0, 7)))
        .reduce((sum, s) => sum + s.qty, 0);
      mPOs = pos
        .filter(po => po.material_id === materialId && po.status === 'pending' && po.required_date && po.required_date.startsWith(p.slice(0, 7)))
        .reduce((sum, po) => sum + po.remaining_qty, 0);
    } else if (grain === 'week') {
      periodDays = 7;
      const startMs = new Date(p).getTime();
      const endMs = startMs + 7 * MS_PER_DAY;
      const monthUsage = explodeBOM(plannedQtyByProductForMonth(prodPlan, p.slice(0, 7)))[materialId] || 0;
      const daysInMonth = daysInMonthOf(p);
      usage = monthUsage * (7 / daysInMonth);

      mTransit = shipments
        .filter(s => {
          if (s.material_id !== materialId || !s.factory_arrival_date) return false;
          const tMs = new Date(s.factory_arrival_date).getTime();
          return tMs >= startMs && tMs < endMs;
        })
        .reduce((sum, s) => sum + s.qty, 0);

      mPOs = pos
        .filter(po => {
          if (po.material_id !== materialId || po.status !== 'pending' || !po.required_date) return false;
          const tMs = new Date(po.required_date).getTime();
          return tMs >= startMs && tMs < endMs;
        })
        .reduce((sum, po) => sum + po.remaining_qty, 0);
    } else {
      // Day grain
      periodDays = 1;
      const dailyPlan = prodPlan.filter(r => r.period_type === 'day' && r.period_start === p);
      if (dailyPlan.length > 0) {
        const byProd: Record<string, number> = {};
        dailyPlan.forEach(r => { byProd[r.product_id] = (byProd[r.product_id] || 0) + r.quantity; });
        usage = explodeBOM(byProd)[materialId] || 0;
      } else {
        const monthUsage = explodeBOM(plannedQtyByProductForMonth(prodPlan, p.slice(0, 7)))[materialId] || 0;
        const daysInMonth = daysInMonthOf(p);
        usage = monthUsage / daysInMonth;
      }

      mTransit = shipments
        .filter(s => {
          if (s.material_id !== materialId || !s.factory_arrival_date) return false;
          return s.factory_arrival_date === p || s.factory_arrival_date.startsWith(p);
        })
        .reduce((sum, s) => sum + s.qty, 0);

      mPOs = pos
        .filter(po => {
          if (po.material_id !== materialId || po.status !== 'pending' || !po.required_date) return false;
          return po.required_date === p || po.required_date.startsWith(p);
        })
        .reduce((sum, po) => sum + po.remaining_qty, 0);
    }

    const ending_stock = currentStock + mTransit + mPOs - usage;
    const dailyDemand = usage / periodDays;
    const ending_coverage_days = dailyDemand > 0
      ? Math.max(0, Math.round(ending_stock / dailyDemand))
      : (ending_stock > 0 ? 999 : 0);
    const reorder_flag = ending_coverage_days < mat.reorder_point_days;

    results.push({
      material_id: materialId,
      period_start: p,
      opening_stock: Math.round(currentStock),
      plan_consumption: Math.round(usage),
      in_transit_qty: Math.round(mTransit),
      pending_po_qty: Math.round(mPOs),
      ending_stock: Math.round(ending_stock),
      ending_coverage_days,
      reorder_flag
    });

    currentStock = Math.max(0, ending_stock);
  });

  return results;
}

export async function getVPlanVsActual(
  type: 'sales' | 'production',
  period: string = getPlanningPeriod()
): Promise<VPlanVsActual[]> {
  const cacheKey = `v_${type}_plan_vs_actual_${period}`;
  if (isSupabaseConnected() && supabase) {
    try {
      const view = type === 'sales' ? 'v_sales_plan_vs_actual' : 'v_production_plan_vs_actual';
      const { data, error } = await supabase.from(view).select('*');
      if (!error && data) {
        const result = data as VPlanVsActual[];
        writeLocalTable(`v_${type}_plan_vs_actual`, result);
        setCachedPlanResult(cacheKey, result);
        return result;
      }
    } catch (e) {
      console.warn("Fallback to local plan vs actual calculation");
    }
  }

  const products = readLocalTable<Product>('products');
  const planTable = type === 'sales' ? 'sales_plan' : 'production_plan';
  const actualTable = type === 'sales' ? 'sales_actual' : 'production_actual';

  const plan = readLocalTable<any>(planTable);
  const actual = readLocalTable<any>(actualTable);

  const results: VPlanVsActual[] = [];

  products.forEach(p => {
    const pPlan = plan.filter(pl => pl.product_id === p.id && isInPeriod(pl.period_start, period));
    const pActual = actual.filter(ac => ac.product_id === p.id && isInPeriod(ac.period_start, period));

    const plan_qty = pPlan.reduce((sum, pl) => sum + pl.quantity, 0);
    const actual_qty = pActual.reduce((sum, ac) => sum + ac.quantity, 0);
    const variance_qty = actual_qty - plan_qty;
    // No plan means there is nothing to achieve against - reporting 100% here
    // would flag un-planned SKUs as perfectly on target.
    const achievement_percent = plan_qty > 0 ? (actual_qty / plan_qty) * 100 : null;

    results.push({
      item_id: p.id,
      item_name: p.name,
      sku: p.sku,
      period: period.slice(0, 7),
      plan_qty,
      actual_qty,
      variance_qty,
      achievement_percent: achievement_percent === null ? null : parseFloat(achievement_percent.toFixed(1))
    });
  });

  setCachedPlanResult(cacheKey, results);
  return results;
}

// ==========================================
// THE MRP CALCULATION ENGINE
// ==========================================

// ==========================================
// DATE PERIOD GENERATOR HELPER
// ==========================================

export function getCurrentPeriods(startDateStr: string, horizon: number, grain: 'day' | 'week' | 'month' = 'month'): string[] {
  const result: string[] = [];
  const start = new Date(startDateStr);
  if (isNaN(start.getTime()) || horizon <= 0) return [];

  if (grain === 'month') {
    // Set to first day of month
    const d = new Date(start.getFullYear(), start.getMonth(), 1);
    for (let i = 0; i < horizon; i++) {
      const current = new Date(d.getFullYear(), d.getMonth() + i, 1);
      const y = current.getFullYear();
      const m = String(current.getMonth() + 1).padStart(2, '0');
      result.push(`${y}-${m}-01`);
    }
  } else if (grain === 'week') {
    // Week grain: starts on startDateStr, increment by 7 days
    for (let i = 0; i < horizon; i++) {
      const current = new Date(start.getTime() + i * 7 * 24 * 60 * 60 * 1000);
      const y = current.getFullYear();
      const m = String(current.getMonth() + 1).padStart(2, '0');
      const day = String(current.getDate()).padStart(2, '0');
      result.push(`${y}-${m}-${day}`);
    }
  } else {
    // Day grain: starts on startDateStr, increment by 1 day
    for (let i = 0; i < horizon; i++) {
      const current = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
      const y = current.getFullYear();
      const m = String(current.getMonth() + 1).padStart(2, '0');
      const day = String(current.getDate()).padStart(2, '0');
      result.push(`${y}-${m}-${day}`);
    }
  }
  return result;
}

// ==========================================
// THE MRP CALCULATION ENGINE
// ==========================================

/**
 * Index of the bucket containing `ms`, or -1 when it falls before the run
 * starts. Buckets are contiguous, so the last one that has already begun is
 * the one that contains the instant.
 */
function periodIndexForMs(
  periods: Array<{ startMs: number }>,
  ms: number
): number {
  if (periods.length === 0 || ms < periods[0].startMs) return -1;
  for (let i = periods.length - 1; i >= 0; i--) {
    if (ms >= periods[i].startMs) return i;
  }
  return -1;
}

/**
 * Approved substitutes for a material, taken from the BOM itself.
 *
 * A slot lists its options in priority order: priority 1 is what the plan
 * consumes, anything above it is a qualified alternative someone has already
 * approved for that position. Because each option carries its own
 * qty_per_unit and scrap, the exchange is rarely one-for-one - MT2 at 1.2 with
 * 5% scrap and MT6 at 1.25 with 4% are different quantities of a different
 * material doing the same job.
 */
export function getBomAlternates(materialId: string): Array<{
  slot_id: string;
  slot_name: string;
  product_id: string;
  alternate_material_id: string;
  /** Alternate units needed per one unit of the primary it replaces. */
  conversion: number;
  primary_per_unit: number;
  alternate_per_unit: number;
}> {
  const slots = readLocalTable<BOMSlot>('bom_slots');
  const options = readLocalTable<BOMOption>('bom_options');
  const headers = readLocalTable<BOMHeader>('bom_headers');
  const materials = readLocalTable<Material>('materials');
  const uomConversions = readLocalTable<UOMConversion>('uom_conversions');
  const out: ReturnType<typeof getBomAlternates> = [];

  const perUnit = (o: BOMOption) => {
    const mat = materials.find(m => m.id === o.material_id);
    const optUom = o.uom || (mat ? mat.uom : 'PCS');
    const matUom = mat ? mat.uom : optUom;
    const norm = normalizeQuantity(o.qty_per_unit, optUom, matUom, uomConversions, mat?.sku);
    return norm.normalizedQty * (1 + o.scrap_percent / 100);
  };

  slots.forEach(slot => {
    const inSlot = options.filter(o => o.slot_id === slot.id);
    const primary = inSlot.find(o => o.priority === 1);
    if (!primary || primary.material_id !== materialId) return;

    inSlot
      .filter(o => o.priority > 1)
      .sort((a, b) => a.priority - b.priority)
      .forEach(alt => {
        const p = perUnit(primary);
        const a = perUnit(alt);
        if (p <= 0) return;
        out.push({
          slot_id: slot.id,
          slot_name: slot.slot_name,
          product_id: headers.find(h => h.id === slot.bom_id)?.product_id ?? '',
          alternate_material_id: alt.material_id,
          conversion: a / p,
          primary_per_unit: p,
          alternate_per_unit: a,
        });
      });
  });

  return out;
}

export async function runMRP(
  startDate: string,
  horizon: number,
  grain: 'day' | 'week' | 'month' = 'week'
): Promise<{ run_id: string; results: MRPResult[]; substitutions: SubstitutionProposal[] }> {
  const cacheKey = `mrp_${startDate}_${horizon}_${grain}`;
  if (isSupabaseConnected() && supabase) {
    try {
      // In Supabase, the RPC name is 'run_mrp'
      const { data, error } = await supabase.rpc('run_mrp', {
        p_start_date: startDate,
        p_weeks: horizon,
        p_grain: grain, // passes optional grain
      });
      if (!error && data) {
        // Fetch MRP results from table
        const runId = typeof data === 'object' ? (data as any).run_id || data : String(data);
        const { data: resData, error: resError } = await supabase.from('mrp_results').select('*').eq('run_id', runId);
        if (!resError && resData) {
          // Substitution proposals are a local-planning aid; the SQL path has
          // no equivalent view, so it returns none rather than inventing them.
          const res = { run_id: runId, results: resData as MRPResult[], substitutions: [] };
          setCachedPlanResult(cacheKey, res);
          setCachedPlanResult('mrp_latest', res);
          return res;
        }
      }
    } catch (e) {
      console.warn("Supabase run_mrp failed, falling back to local simulation", e);
    }
  }

  // --- LOCAL MRP SIMULATION ---
  const runId = 'RUN_' + Date.now().toString(36).toUpperCase();
  const materials = readLocalTable<Material>('materials');
  const prodPlan = readLocalTable<ProductionPlan>('production_plan');
  const inventory = readLocalTable<InventorySnapshot>('inventory_snapshots');
  const shipments = readLocalTable<Shipment>('shipments');
  const pos = readLocalTable<PurchaseOrder>('purchase_orders');

  // Generate start dates depending on grain
  const periodStartDates = getCurrentPeriods(startDate, horizon, grain);

  // Safety stock is a level, so it is sized off the average monthly
  // requirement across the run rather than whatever lands in one bucket.
  const monthsInRun = [...new Set(periodStartDates.map(p => p.slice(0, 7)))];
  const avgMonthlyReq: Record<string, number> = {};
  materials.forEach(m => { avgMonthlyReq[m.id] = 0; });
  monthsInRun.forEach(month => {
    Object.entries(explodeBOM(plannedQtyByProductForMonth(prodPlan, month))).forEach(([id, qty]) => {
      if (avgMonthlyReq[id] !== undefined) avgMonthlyReq[id] += qty;
    });
  });
  if (monthsInRun.length > 0) {
    materials.forEach(m => { avgMonthlyReq[m.id] /= monthsInRun.length; });
  }

  const mrpResults: MRPResult[] = [];

  // Track stock for each material. matStock is mutated as the run walks
  // forward, so the opening position is kept separately - a substitution
  // proposal needs to know what the alternate actually has on hand today.
  const matStock: Record<string, number> = {};
  const matStockOpening: Record<string, number> = {};
  materials.forEach(m => {
    const snap = inventory.find(i => i.item_type === 'material' && i.item_id === m.id);
    matStock[m.id] = snap ? snap.quantity : 0;
    matStockOpening[m.id] = matStock[m.id];
  });

  // Period boundaries, precomputed so the netting pass and the lead-time
  // offset both work off the same calendar.
  const periods = periodStartDates.map(periodStart => {
    const current = new Date(periodStart);
    const end = grain === 'month'
      ? new Date(current.getFullYear(), current.getMonth() + 1, 1)
      : grain === 'week'
        ? new Date(current.getTime() + 7 * MS_PER_DAY)
        : new Date(current.getTime() + MS_PER_DAY);
    return {
      start: periodStart,
      startMs: current.getTime(),
      end: toDateStr(end),
      days: Math.max(1, Math.round((end.getTime() - current.getTime()) / MS_PER_DAY))
    };
  });

  // Planned order receipts and releases, indexed [materialId][periodIndex].
  // A receipt is when stock must land; a release is when the order has to be
  // placed to make that happen. They differ by the material's lead time.
  const plannedReceipts: Record<string, number[]> = {};
  const plannedReleases: Record<string, number[]> = {};
  const pastDueReleases: Record<string, number> = {};
  // Kept per bucket as well as in total: whether a substitute can rescue a
  // shortfall depends on *when* the stock was needed, not just how much.
  const pastDueByPeriod: Record<string, number[]> = {};
  materials.forEach(m => {
    plannedReceipts[m.id] = new Array(periods.length).fill(0);
    plannedReleases[m.id] = new Array(periods.length).fill(0);
    pastDueReleases[m.id] = 0;
    pastDueByPeriod[m.id] = new Array(periods.length).fill(0);
  });

  // Run MRP period-by-period
  periods.forEach((period, pIdx) => {
    const periodStart = period.start;
    const periodEndStr = period.end;

    // 1. Calculate Gross Requirements for this period.
    const plannedThisPeriod = plannedQtyByProductForMonth(prodPlan, periodStart.slice(0, 7));
    if (grain === 'week') {
      const daysInMonth = daysInMonthOf(periodStart);
      const share = period.days / daysInMonth;
      Object.keys(plannedThisPeriod).forEach(id => { plannedThisPeriod[id] *= share; });
    } else if (grain === 'day') {
      // Check for exact daily production plan entries
      const dailyPlan = prodPlan.filter(p => p.period_type === 'day' && p.period_start === periodStart);
      if (dailyPlan.length > 0) {
        const byProd: Record<string, number> = {};
        dailyPlan.forEach(r => { byProd[r.product_id] = (byProd[r.product_id] || 0) + r.quantity; });
        Object.assign(plannedThisPeriod, byProd);
      } else {
        const daysInMonth = daysInMonthOf(periodStart);
        const share = 1 / daysInMonth;
        Object.keys(plannedThisPeriod).forEach(id => { plannedThisPeriod[id] *= share; });
      }
    }

    const grossReq: Record<string, number> = {};
    materials.forEach(m => { grossReq[m.id] = 0; });
    Object.entries(explodeBOM(plannedThisPeriod)).forEach(([materialId, qty]) => {
      if (grossReq[materialId] !== undefined) grossReq[materialId] += qty;
    });

    // 2. Process Receipts and Net requirements for each material
    materials.forEach(m => {
      const req = grossReq[m.id] || 0;
      
      // Shipments arriving this period
      const arrivingShipments = shipments.filter(s => {
        if (s.material_id !== m.id || !s.factory_arrival_date) return false;
        return s.factory_arrival_date >= periodStart && s.factory_arrival_date < periodEndStr;
      });
      const transitReceipts = arrivingShipments.reduce((sum, s) => sum + s.qty, 0);

      // Pending POs due this period — skip any PO that is already covered by
      // a linked shipment (identified via po_id), which is counted in
      // transitReceipts above. Counting both would double-count the quantity.
      const linkedPoIds = new Set(arrivingShipments.map(s => s.po_id).filter(Boolean));
      const duePOs = pos.filter(po => {
        if (po.material_id !== m.id || po.status !== 'pending') return false;
        if (linkedPoIds.has(po.id)) return false; // already counted via shipment
        return po.required_date >= periodStart && po.required_date < periodEndStr;
      });
      const poReceipts = duePOs.reduce((sum, po) => sum + po.remaining_qty, 0);

      const totalReceipts = transitReceipts + poReceipts;

      const safetyStockQty = getSafetyStockQty(m, avgMonthlyReq[m.id]);

      const startingStock = matStock[m.id];
      const projectedAvailableBeforeSafety = startingStock + totalReceipts - req;

      let netRequirements = 0;
      let plannedOrders = 0;

      if (projectedAvailableBeforeSafety < safetyStockQty) {
        netRequirements = safetyStockQty - projectedAvailableBeforeSafety;
        // Planned orders must respect MOQ
        plannedOrders = Math.max(m.moq, Math.ceil(netRequirements));
      }

      const projectedEndingStock = projectedAvailableBeforeSafety + plannedOrders;
      matStock[m.id] = projectedEndingStock; // updates rolling inventory

      // The order has to land in this period, so it must be placed a lead
      // time earlier. Anything whose release date falls before the run starts
      // is already late - it is collected separately rather than silently
      // pulled forward into period 0's release line.
      if (plannedOrders > 0) {
        plannedReceipts[m.id][pIdx] += plannedOrders;
        const leadDays = m.total_lead_time_days > 0 ? m.total_lead_time_days : 30;
        const releaseMs = period.startMs - leadDays * MS_PER_DAY;
        const releaseIdx = periodIndexForMs(periods, releaseMs);
        if (releaseIdx === -1) {
          pastDueReleases[m.id] += plannedOrders;
          pastDueByPeriod[m.id][pIdx] += plannedOrders;
        } else {
          plannedReleases[m.id][releaseIdx] += plannedOrders;
        }
      }

      mrpResults.push({
        id: `M_RES_${runId}_${m.id}_P${pIdx}`,
        run_id: runId,
        run_date: new Date().toISOString(),
        material_id: m.id,
        week_start_date: periodStart, // store periodStart in week_start_date column to reuse existing structure
        projected_available: Math.round(projectedEndingStock),
        safety_stock: Math.round(safetyStockQty),
        net_requirements: Math.round(netRequirements),
        planned_order_releases: 0, // filled in by the lead-time offset pass below
        planned_order_receipts: Math.round(plannedOrders),
        gross_requirements: Math.round(req),
        scheduled_receipts: Math.round(totalReceipts)
      });
    });
  });

  // Lead-time offset pass: a receipt needed in period N is released in the
  // period containing (N's start - lead time). Only now can the release line
  // be filled, because it depends on requirements discovered later in the run.
  const resultIndex = new Map<string, MRPResult>();
  mrpResults.forEach(r => resultIndex.set(`${r.material_id}|${r.week_start_date}`, r));
  materials.forEach(m => {
    periods.forEach((period, pIdx) => {
      const row = resultIndex.get(`${m.id}|${period.start}`);
      if (!row) return;
      row.planned_order_releases = Math.round(plannedReleases[m.id][pIdx]);
      if (pIdx === 0 && pastDueReleases[m.id] > 0) {
        row.past_due_releases = Math.round(pastDueReleases[m.id]);
      }
    });
  });

  // Write results to database local storage
  const currentResults = readLocalTable<MRPResult>('mrp_results');
  const combined = [...mrpResults, ...currentResults];
  writeLocalTable<MRPResult>('mrp_results', combined);

  // Slot attribution is measured over the same months the run covers, so a
  // shortfall is divided the way the plan actually consumes the material.
  const slotConsumption: Record<string, Record<string, number>> = {};
  monthsInRun.forEach(month => {
    Object.entries(primaryConsumptionBySlot(plannedQtyByProductForMonth(prodPlan, month)))
      .forEach(([matId, bySlot]) => {
        slotConsumption[matId] = slotConsumption[matId] || {};
        Object.entries(bySlot).forEach(([slotId, qty]) => {
          slotConsumption[matId][slotId] = (slotConsumption[matId][slotId] || 0) + qty;
        });
      });
  });

  const substitutions = buildSubstitutionProposals(
    materials, periods, pastDueByPeriod, matStockOpening,
    new Date(periodStartDates[0]).getTime(), slotConsumption
  );

  const res = { run_id: runId, results: mrpResults, substitutions };
  setCachedPlanResult(cacheKey, res);
  setCachedPlanResult('mrp_latest', res);
  return res;
}

/**
 * Turns un-orderable shortfalls into substitution proposals.
 *
 * A primary is past due when its own lead time has already run out. The
 * question this answers is narrower and more useful: is there an approved
 * alternate whose lead time has *not* run out, and how much of the gap can it
 * actually close? An alternate that is also too slow is reported rather than
 * hidden, because "nothing can fix this" is itself the answer a planner needs.
 */
function buildSubstitutionProposals(
  materials: Material[],
  periods: Array<{ start: string; startMs: number }>,
  pastDueByPeriod: Record<string, number[]>,
  openingStock: Record<string, number>,
  runStartMs: number,
  slotConsumption: Record<string, Record<string, number>>
): SubstitutionProposal[] {
  const byId = new Map(materials.map(m => [m.id, m]));
  const products = readLocalTable<Product>('products');
  const proposals: SubstitutionProposal[] = [];

  materials.forEach(primary => {
    const buckets = pastDueByPeriod[primary.id] || [];
    const totalShortfall = buckets.reduce((sum, q) => sum + q, 0);
    if (totalShortfall <= 0) return;

    const bySlot = slotConsumption[primary.id] || {};
    const totalConsumed = Object.values(bySlot).reduce((sum, q) => sum + q, 0);

    getBomAlternates(primary.id).forEach(alt => {
      const altMat = byId.get(alt.alternate_material_id);
      if (!altMat || altMat.status === 'obsolete') return;

      // This slot's share of the material's consumption is the share of the
      // shortfall it is answerable for. With one slot the share is 1.
      const share = totalConsumed > 0
        ? (bySlot[alt.slot_id] || 0) / totalConsumed
        : 1 / Math.max(1, getBomAlternates(primary.id).length);
      const shortfall = totalShortfall * share;
      if (shortfall <= 0) return;

      const altLead = altMat.total_lead_time_days > 0 ? altMat.total_lead_time_days : 30;
      const arrivalMs = runStartMs + altLead * MS_PER_DAY;

      // Only the buckets that begin on or after the alternate could land are
      // rescuable; the rest are past saving by any route.
      let coverable = 0;
      let coversFrom: string | null = null;
      buckets.forEach((qty, i) => {
        if (qty <= 0) return;
        if (periods[i].startMs >= arrivalMs) {
          coverable += qty * share;
          if (coversFrom === null) coversFrom = periods[i].start;
        }
      });

      proposals.push({
        id: `SUB_${primary.id}_${alt.alternate_material_id}_${alt.slot_id}`,
        material_id: primary.id,
        material_name: primary.name,
        alternate_material_id: altMat.id,
        alternate_material_name: altMat.name,
        slot_id: alt.slot_id,
        slot_name: alt.slot_name,
        product_id: alt.product_id,
        product_name: products.find(pr => pr.id === alt.product_id)?.name ?? alt.product_id,
        shortfall_qty: Math.round(shortfall),
        coverable_qty: Math.round(coverable),
        alternate_qty: Math.round(coverable * alt.conversion),
        uncoverable_qty: Math.round(shortfall - coverable),
        primary_lead_time_days: primary.total_lead_time_days,
        alternate_lead_time_days: altLead,
        earliest_arrival: toDateStr(new Date(arrivalMs)),
        covers_from_period: coversFrom,
        alternate_on_hand: Math.round(openingStock[altMat.id] || 0),
        unit_cost_delta:
          alt.alternate_per_unit * altMat.standard_cost -
          alt.primary_per_unit * primary.standard_cost,
      });
    });
  });

  // Most useful first: the ones that rescue the most.
  return proposals.sort((a, b) => b.coverable_qty - a.coverable_qty);
}

// ---------------------------------------------------------------------------
// UOM (Unit of Measure) Conversion & Management Helpers
// ---------------------------------------------------------------------------

export function getUOMConversions(): UOMConversion[] {
  return readLocalTable<UOMConversion>('uom_conversions');
}

export function convertUOMQty(
  qty: number,
  fromUom: string,
  toUom: string,
  itemId?: string,
  conversionsList?: UOMConversion[]
): { convertedQty: number; factor: number; ruleFound: boolean } {
  if (!fromUom || !toUom || fromUom.trim().toLowerCase() === toUom.trim().toLowerCase()) {
    return { convertedQty: qty, factor: 1, ruleFound: true };
  }
  const convs = conversionsList || getUOMConversions();
  const fUom = fromUom.trim().toLowerCase();
  const tUom = toUom.trim().toLowerCase();

  // 1. Try item-specific match first
  let match = itemId
    ? convs.find(c => c.item_id === itemId && c.from_uom.trim().toLowerCase() === fUom && c.to_uom.trim().toLowerCase() === tUom)
    : undefined;

  let factor = 1;
  let ruleFound = false;

  if (match) {
    factor = match.conversion_factor;
    ruleFound = true;
  } else {
    // 2. Try item-specific inverse match
    let inverseMatch = itemId
      ? convs.find(c => c.item_id === itemId && c.from_uom.trim().toLowerCase() === tUom && c.to_uom.trim().toLowerCase() === fUom)
      : undefined;
    if (inverseMatch && inverseMatch.conversion_factor > 0) {
      factor = 1 / inverseMatch.conversion_factor;
      ruleFound = true;
    } else {
      // 3. Try global match
      let globalMatch = convs.find(c => (!c.item_type || c.item_type === 'global' || !c.item_id) && c.from_uom.trim().toLowerCase() === fUom && c.to_uom.trim().toLowerCase() === tUom);
      if (globalMatch) {
        factor = globalMatch.conversion_factor;
        ruleFound = true;
      } else {
        // 4. Try global inverse match
        let globalInverse = convs.find(c => (!c.item_type || c.item_type === 'global' || !c.item_id) && c.from_uom.trim().toLowerCase() === tUom && c.to_uom.trim().toLowerCase() === fUom);
        if (globalInverse && globalInverse.conversion_factor > 0) {
          factor = 1 / globalInverse.conversion_factor;
          ruleFound = true;
        }
      }
    }
  }

  return { convertedQty: qty * factor, factor, ruleFound };
}

/**
 * Creates a new Product SKU and initializes its corresponding BOM Header in one action.
 */
export async function createProductAndBOM(
  productData: Omit<Product, 'id'>,
  bomDescription?: string
): Promise<{ product: Product; bomHeader: BOMHeader }> {
  const newProductId = 'P_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4).toUpperCase();
  const newProduct: Product = {
    ...productData,
    id: newProductId,
    uom: productData.uom || 'PCS',
    status: productData.status || 'running'
  };

  const savedProduct = await saveRecord<Product>('products', newProduct);

  // Initialize active BOM Header for this SKU
  const newBOMHeader: BOMHeader = {
    id: 'BH_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4).toUpperCase(),
    product_id: savedProduct.id,
    description: bomDescription || `BOM for ${savedProduct.sku} - ${savedProduct.name}`,
    is_active: true
  };

  const savedBOMHeader = await saveRecord<BOMHeader>('bom_headers', newBOMHeader);

  return { product: savedProduct, bomHeader: savedBOMHeader };
}

// ---------------------------------------------------------------------------
// Closed Periods / Archived MRP Runs Management
// ---------------------------------------------------------------------------

export async function fetchClosedPeriods(): Promise<ClosedPeriod[]> {
  return fetchTableData<ClosedPeriod>('closed_periods');
}

export async function closePlanningPeriod(
  periodData: Omit<ClosedPeriod, 'id' | 'closed_at'>
): Promise<ClosedPeriod> {
  const newClosed: ClosedPeriod = {
    ...periodData,
    id: `CP_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
    closed_at: new Date().toISOString()
  };
  return saveRecord<ClosedPeriod>('closed_periods', newClosed);
}

// ---------------------------------------------------------------------------
// Variance reasons (Phase 4)
// ---------------------------------------------------------------------------

export type VarianceReasonCode =
  | 'supplier_moq'
  | 'price_break'
  | 'late_demand_change'
  | 'stock_correction'
  | 'substitution'
  | 'procurement_deferral'
  | 'other';

export const VARIANCE_REASON_LABELS: Record<VarianceReasonCode, string> = {
  supplier_moq:          'Supplier MOQ',
  price_break:           'Price break / volume discount',
  late_demand_change:    'Late demand change',
  stock_correction:      'Stock count correction',
  substitution:          'Material substitution',
  procurement_deferral:  'Procurement deferral',
  other:                 'Other',
};

export interface VarianceReason {
  id: string;
  period: string;
  material_id: string;
  recorded_at: string;
  recorded_by: string | null;
  reason_code: VarianceReasonCode;
  notes: string;
  baseline_qty: number;
  actual_qty: number;
  variance_qty: number;
}

const LOCAL_VARIANCE_REASONS = 'variance_reasons';

export async function fetchVarianceReasons(period: string): Promise<VarianceReason[]> {
  const local = readLocalTable<VarianceReason>(LOCAL_VARIANCE_REASONS)
    .filter(r => r.period?.slice(0, 7) === period.slice(0, 7));

  if (!isSupabaseConnected() || !supabase) return local;

  const { data, error } = await supabase
    .from('variance_reasons')
    .select('*')
    .eq('period', period.slice(0, 7) + '-01')
    .order('recorded_at', { ascending: false });

  if (error) {
    console.error('fetchVarianceReasons:', error.message);
    return local;
  }
  return (data as VarianceReason[]) ?? local;
}

export async function saveVarianceReason(
  reason: Omit<VarianceReason, 'id' | 'recorded_at'>,
): Promise<VarianceReason> {
  const newReason: VarianceReason = {
    ...reason,
    id: `VR_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
    recorded_at: new Date().toISOString(),
    period: reason.period.slice(0, 7) + '-01',
  };

  const existing = readLocalTable<VarianceReason>(LOCAL_VARIANCE_REASONS);
  writeLocalTable(LOCAL_VARIANCE_REASONS, [...existing, newReason]);

  if (isSupabaseConnected() && supabase) {
    const { error } = await supabase.from('variance_reasons').insert(newReason);
    if (error) throw new Error(`Reason saved locally but failed to sync: ${error.message}`);
  }

  return newReason;
}

export async function deleteVarianceReason(id: string): Promise<void> {
  const existing = readLocalTable<VarianceReason>(LOCAL_VARIANCE_REASONS);
  writeLocalTable(LOCAL_VARIANCE_REASONS, existing.filter(r => r.id !== id));

  if (isSupabaseConnected() && supabase) {
    const { error } = await supabase.from('variance_reasons').delete().eq('id', id);
    if (error) throw new Error(`Failed to delete reason: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// MRP run log (Phase 2)
// ---------------------------------------------------------------------------
// Lightweight: just a label on each run so the variance screen can tell
// "this week's baseline" from "a one-off ad-hoc run" without guessing.
// Stored locally only -- no schema change needed for this to be useful.

export type MRPRunType = 'weekly_refresh' | 'month_close_baseline' | 'ad_hoc';

export interface MRPRunLogEntry {
  run_id: string;
  run_type: MRPRunType;
  period: string;
  logged_at: string;
  notes?: string;
}

const LOCAL_MRP_RUN_LOG = 'mrp_run_log';

export function logMRPRun(
  runId: string,
  period: string,
  runType: MRPRunType,
  notes?: string,
): void {
  const entry: MRPRunLogEntry = {
    run_id: runId,
    run_type: runType,
    period: period.slice(0, 7) + '-01',
    logged_at: new Date().toISOString(),
    notes,
  };
  const existing = readLocalTable<MRPRunLogEntry>(LOCAL_MRP_RUN_LOG);
  // Keep at most 200 entries -- one per run, every week for ~4 years.
  writeLocalTable(LOCAL_MRP_RUN_LOG, [entry, ...existing].slice(0, 200));
}

export function getMRPRunLog(period?: string): MRPRunLogEntry[] {
  const all = readLocalTable<MRPRunLogEntry>(LOCAL_MRP_RUN_LOG);
  if (!period) return all;
  return all.filter(e => e.period?.slice(0, 7) === period.slice(0, 7));
}
