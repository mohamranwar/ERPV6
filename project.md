# Sanita Supply Chain Planner — Project Specification & Blueprint Prompt

This document provides a highly detailed engineering specification, visual architecture, and reference blueprint for recreating or extending the **Sanita Supply Chain Planner** application.

---

## 1. Project Vision & Architecture

The **Sanita Supply Chain Planner** is an enterprise-grade control tower and material requirements planning (MRP) system engineered for high-performance hygiene manufacturing. It manages the entire logistics loop: from interactive Bill of Materials (BOM) management, sales forecasting, master production scheduling (MPS), MRP explosion netting, inventory coverage calculations, down to customs clearance and active inbound vessel monitoring.

### Technical Stack
*   **Frontend Core**: React 18+ with TypeScript, styled with Tailwind CSS.
*   **Database/Storage Layer**: Full offline compatibility using client-side State wrapper synchronizing automatically to persistent storage (Firestore / local fallback).
*   **Motion and Interaction**: Custom UI transitions and drawer movements powered by `motion/react`.
*   **Visual Elements**: Icons exclusively from `lucide-react`.

---

## 2. Comprehensive Database Schemas (`src/types.ts`)

The planning engine relies on eight core master data tables and operational entities. Below is the precise TypeScript contract:

```typescript
export interface Product {
  id: string;               // UUID / Unique Identifier
  sku: string;              // e.g. "FG-ADULT-DIAP-01"
  name: string;             // e.g. "Premium Adult Diaper Large"
  group_id: string;         // Links to ProductGroup
  category_id: string;      // Links to MaterialCategory
  product_line: string;     // Primary Manufacturing Machine (SOFY, VOXY, Atlas)
  selling_price: number;    // Wholesale value per unit
}

export interface Material {
  id: string;
  sku: string;              // e.g. "RM-POLY-SHEET-02"
  name: string;             // e.g. "Breathable Polyethylene Backsheet"
  category_id: string;
  supplier_id: string;      // Primary Supplier
  standard_cost: number;    // Raw pricing
  supplier_lead_time_days: number;
  transit_days: number;
  customs_clearance_days: number;
  total_lead_time_days: number; // supplier + transit + customs
  safety_stock_months: number;  // Safety threshold
  reorder_point_days: number;   // Days of stock warning threshold
  moq: number;                  // Minimum Order Quantity
  max_usage: number;            // Peak production usage rate per day
  controller: string;           // MRP Material Controller assigned (e.g. Amr Anwar)
  status: 'active' | 'obsolete' | 'under_review';
}

export interface BOMSlot {
  id: string;
  product_id: string;
  slot_name: string;        // e.g. "Absorbent Core", "Elastic Ear"
  scrap_factor: number;     // e.g. 1.03 (3% scrap)
}

export interface BOMOption {
  id: string;
  slot_id: string;
  material_id: string;
  priority: number;         // 1 = Primary, 2 = Alternative
  unit_qty: number;         // Material units needed per 1 product unit
}

export interface SalesPlan {
  id: string;
  product_id: string;
  channel_id: string;
  period_type: 'day' | 'week' | 'month';
  period_start: string;     // ISO Date format: YYYY-MM-DD
  quantity: number;
}

export interface ProductionPlan {
  id: string;
  product_id: string;
  period_type: 'day' | 'week' | 'month';
  period_start: string;     // ISO Date format: YYYY-MM-DD
  quantity: number;
}

export interface PurchaseOrder {
  id: string;
  material_id: string;
  supplier_id: string;
  order_no: string;         // PO-XXXXXX format
  qty: number;
  remaining_qty: number;
  required_date: string;    // Expected at factory gate
  status: 'pending' | 'in_transit' | 'completed';
  timing: 'Normal' | 'Check with Proc.' | 'Need to be Closed';
  po_date: string;
  unit_price: number;
}

export interface Shipment {
  id: string;
  material_id: string;
  supplier_id: string;
  qty: number;
  invoice_no: string;       // Supplier Invoice
  bl_no: string;            // Bill of Lading
  container_count: number;
  ship_method: 'sea' | 'air' | 'land';
  etd: string;              // Estimated Departure
  port_eta: string;         // Estimated Port Arrival
  port_name: string;        // Discharge point (e.g., Alexandria)
  customs_clearance_days: number;
  factory_arrival_date: string | null; // Final factory receipt date
  delay: number;            // Logistics latency days
}
```

---

## 3. Core Functional Specs & Interaction Guidelines

### A. Search Overrides Filter Dropdowns
Across all tables and screens (*Master Data Hub, MRP Planner, Logistics Tower, Coverage Analysis*), if the global `searchQuery` field contains characters:
*   **Category, supplier, and controller filters are bypassed.**
*   The tables instantly display rows matching the search term across the entire dataset.
*   Once the search field is cleared, active dropdown filters apply normally.

### B. Consolidated "All" Selections
All status, category, and controller drop-downs must support a top-level **"All"** option:
*   In the **Sales Demand Grid**, selecting **"All Channels (Read-Only)"** aggregates the sales quantity across all channels for each product and bucket. Write actions (saving edited rows, CSV uploads) are disabled with a clean user-facing toast message during aggregated views.

### C. Advanced Planning & MRP Explosion Netting
1.  **Explosion Tree**: Netting translates Product Production Schedules into material gross requirements using the interactive BOM (scrap factor * unit qty).
2.  **Safety Stock Buffer**: Triggers a procurement alert whenever projected material balance falls below `safety_stock_months`.
3.  **Lead-Time Offset**: Calculates suggested PO release dates dynamically based on total cumulative lead days (supplier + transit + customs).
4.  **PO Auto-Completion**: Marking an inbound shipment as arrived in the Factory triggers automatic PO status change to `completed` and sets remaining PO quantities to `0`.

---

## 4. Design & Style Directives

*   **Color Palette**: Modern Light Enterprise Theme using cool gray backgrounds (`bg-slate-50`), slate card borders (`border-slate-200/80`), and vivid navy primary details (`bg-blue-600`).
*   **Typography**: Clean sans-serif headings for readability paired with monospace characters (`font-mono`) for values, quantities, dates, and SKUs to ensure perfect alignment in tabular displays.
*   **Status Indicators**: Highly visible visual badges:
    *   **In-Transit**: Emerald badge.
    *   **Planned PO / Pending**: Blue/Indigo badge.
    *   **Need PO / Stockout Risk**: Amber/Red hazard label.
*   **Dynamic Calculations**: Intersecting transit dates (ETD, Port ETA, Customs, Factory Arrival) must auto-compute on user edits inside logistics forms to match supplier metadata.
