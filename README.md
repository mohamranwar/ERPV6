# Supply Chain Planner — Project Prompt & System Specification

Welcome to the **Supply Chain Planner** codebase! This document serves as the **Full Project Prompt & Specifications** detailing the entire platform scope, system architecture, UX specifications, and logical equations. It is designed to act as a comprehensive reference for developers, product managers, and AI assistants.

---

# THE SYSTEM PROMPT: Building the Supply Chain Planner

## 1. Executive Summary & Core Objective
The objective is to build a responsive, production-ready **Supply Chain Planner & Logistics Control Tower** designed specifically for high-volume consumer goods manufacturing (e.g., hygiene and packaging industries). The system integrates Sales Demand Planning, Master Production Scheduling (MPS), Bill of Materials (BOM) management, Material Requirements Planning (MRP), Stock Coverage analysis, Logistics tracking, and Plan-vs-Actual tracking into a unified, elegant cockpit.

---

## 2. Core Functional Modules & Logical Specs

### MODULE A: Master Data Hub
A master data registry is required to govern the foundational entities of the supply chain:
*   **Products**: Finished goods (FGs) with properties: SKU, Brand, Variant, Machine Line, Pack Type, Size, Status (`running` or `obsolete`), Pack Count, Selling Price, and Standard Cost.
*   **Materials**: Raw materials (RM), packaging (PK), and consumables (CON). Includes Supplier ID, Supplier Lead Time, Transit Days, Customs Days, Total Lead Time (sum of all three), Safety Stock targets, and Reorder Points.
*   **Suppliers & Channels**: Distribution channels (for demand mapping) and vendor registries.
*   **Machines**: Production lines with designated monthly capacities.
*   **Dynamic CSV Importer**: A CSV mapper that lets planners drag and drop Excel/CSV datasets, preview data, map spreadsheet headers to database columns, and perform high-volume bulk upserts.

### MODULE B: Interactive BOM Editor & Costing Engine
The system must support complex material recipes and live costing:
*   **BOM Slotting**: Products have component slots (e.g., "top sheet", "back sheet", "polybag").
*   **Priority Routing**: Each slot can have multiple material choices (e.g. standard vs local suppliers) mapped with Priority 1 (Primary) or Priority 2+ (Alternate).
*   **Dynamic Scaling**: Planners can adjust Unit Quantities and Scrap % inline.
*   **FG Cost Rollup**: Real-time aggregation of material costs:
    $$\text{Line Cost} = \text{Material Cost} \times \text{Unit Qty} \times \left(1 + \frac{\text{Scrap \%}}{100}\right)$$
    $$\text{Margin \%} = \frac{\text{Selling Price} - \sum \text{Line Costs}}{\text{Selling Price}} \times 100$$

### MODULE C: Sales Demand & MPS Production Planning
Planners must manage horizontal grids of time-series data:
*   **Time Grains**: Switchable views between Daily, Weekly, and Monthly planning grids.
*   **"All Channels" Consolidation**: Selecting the "All Channels" channel option displays an aggregated, read-only sum of demand across all channels. Selecting individual channels unlocks inline grid edits.
*   **Predictive Suggestions**: An algorithm that reads historical trends and baseline parameters to suggest future demand targets where values are blank.
*   **MPS Capacity Constraints**: Highlighting production cells in red/yellow when planned schedules exceed physical machine capacity thresholds.

### MODULE D: MRP Engine & Inventory Projections
A high-performance Material Requirements Planning calculator:
*   **BOM Explosion**: Explodes the Master Production Schedule (MPS) into gross material requirements by week or month using the primary BOM recipe.
*   **Inventory Projections**: Calculates projected available balances (PAB) over the planning horizon:
    $$\text{PAB}_{t} = \text{PAB}_{t-1} - \text{Gross Requirements}_{t} + \text{In-Transit Qty}_{t} + \text{Scheduled Receipts}_{t}$$
*   **Auto Planned Releases**: Triggers automated planned order releases when projected inventory falls below safety stock targets, incorporating supplier lead times.

### MODULE E: Stock Coverage & Material Drill-Down
Provides planners with visual indicators of runway and stockout risks:
*   **Coverage Duration**: Calculates stock duration in months/days under two distinct metrics:
    1.  *Stock Only Coverage*: Compares current physical stock against consumption rate.
    2.  *Total Coverage*: Factors in pending purchase orders and active in-transit shipments.
*   **Interactive Material Trace**: Drill-down lists to examine which products and finished goods consume a selected raw material.

### MODULE F: Logistics & Customs Control Tower
An active shipment and custom-clearance tracking dashboard:
*   **In-Transit Visibility**: Monitors vessel ETAs, container counts, shipment modes (Sea, Air, Land), and port status.
*   **Customs Lead Time Tracking**: Tracks customs clearance stages and delays.
*   **Dynamic Factory Arrival**: Auto-computes expected factory arrival:
    $$\text{Factory Arrival} = \text{ETA} + \text{Customs Clearance Days} + \text{Transit Days} + \text{Delay Days}$$

### MODULE G: Plan vs Actuals Analysis
Allows management to run performance reviews on both Sales and Production schedules:
*   **Key Performance Indicators**: Variance volumes, achievement percentages, and target status.
*   **Progress Indicators**: Highlight items underperforming against targets (e.g., achievement < 90%) using elegant warning alerts.

---

## 3. UI/UX Rules and Constraints

*   **Override Principle**: If a user types in a text Search Bar, the UI bypasses any active dropdown filters (such as Supplier, Category, Machine Line) and displays matches across the entire dataset.
*   **Consolidated Option**: Select dropdowns must support "All Categories", "All Channels", and "All Suppliers" settings.
*   **Modern Dialogs**: Never use native browser dialogs like `alert()` or `confirm()`. All feedback must utilize custom, styled toasts and confirmation overlays.
*   **Responsiveness**: Grids, menus, and side rails must adapt fluidly between desktop controls and mobile viewers. Touch targets should be $\ge 44\text{px}$.

---

## 4. Tech Stack

*   **Frontend Library**: React 18+ (Functional Hooks, Clean Context APIs)
*   **Bundler & Build Tool**: Vite (configured for port 3000)
*   **Styling**: Tailwind CSS
*   **Icons**: Lucide React
*   **Animations**: Framer Motion
*   **State Management**: Unified relational memory structures defined in `src/types.ts` synchronized with Supabase client wrappers.
