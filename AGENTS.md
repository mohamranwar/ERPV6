# Supply Chain Planner — AI Agent Instructions & Prompt Specifications

This file serves as the core specifications, architecture patterns, and persistent system guidelines for the **Supply Chain Planner** application. All AI agents modifying this codebase must adhere strictly to the rules, scopes, and structures detailed here.

---

## 1. Project Vision & Aesthetic

The **Supply Chain Planner** is an enterprise-grade, high-performance, and visually polished planning and logistics control tower for hygiene-product manufacturing. 

### Design & Typography Principles
*   **Theme**: Clean, high-contrast Enterprise Canvas featuring neutral off-whites, crisp slate grays, and precise color-coded badges for status indicators.
*   **Typography**: Clean `sans-serif` (Inter) for structural UI and menus, paired with `font-mono` (JetBrains Mono / Fira Code) for numbers, SKUs, and tabular data matrices to guarantee alignment.
*   **Aesthetic Honesty**: Avoid unrequested debug logs, system terminal outputs, or simulated infrastructure banners in the margins. Keep layout clean and functional.
*   **Interactive Components**: Rely on micro-animations via `motion/react` for card entrances, list expansions, and drawer slide-ins.

---

## 2. Core Functional Requirements & Behavioral Rules

### A. The "Search Field Overrides Dropdowns" Rule
To prevent filtering deadlocks where a user searches for an item that is excluded by current category or status dropdowns, the following rule is enforced across all tables and list displays (e.g., *Master Data*, *MRP*, *Logistics*, *Finished Goods Analysis*, etc.):
*   **When `searchQuery` is NOT empty**: All categorical dropdown filters (such as `filterCategory`, `filterStatus`, `filterController`, `filterSupplier`, or `filterDelay`) are **bypassed**. The lists/tables must search across all items matching the query globally.
*   **When `searchQuery` IS empty**: The active categorical and status filters apply normally.

### B. Consolidated "All Options" Selection
All user filters must feature an "All" or "All-Inclusive" option to enable complete, aggregated overviews:
*   **Sales Demand Plan**: Features an **"All Channels (Read-Only)"** option in the Channel select dropdown. Selecting "All Channels" summarizes and aggregates the sales plan quantity across all active distribution channels for each product and timeframe.
*   **Master Data**: Standardized Category, Status, and Supplier dropdowns must include an "All Categories" / "All Suppliers" default option.
*   **MRP Engine / Logistics**: Includes options to view all controllers, late/on-time shipments, or supplier allocations in a single consolidated screen.

### C. UX & Notification Framework
*   **Interactive Notifications**: Do NOT use native browser `alert()` or `confirm()` dialogs. Instead, integrate the custom toast and confirm modal via the `useToast` hook from `../context/ToastConfirmContext` to provide polished, matching overlays:
    ```tsx
    const { showToast, confirm: askConfirm } = useToast();
    
    // Usage:
    showToast("Record saved successfully!", "success");
    const isConfirmed = await askConfirm("Are you sure you want to delete this?", "Delete Record");
    ```

---

## 3. Core Modules & Screen Manifest

### 1. Interactive BOM Editor (`src/components/BOMEditorScreen.tsx`)
*   Provides structured slotting of bill-of-materials components (e.g. raw sheets, SAP, elastic cuffs, polybags).
*   Allows priority management where slots have primary (Priority 1) and alternative material options.
*   Features inline scrap factor and unit quantity adjustments.
*   Shows live product cost computations based on material pricing.

### 2. Sales Demand Plan (`src/components/SalesPlanScreen.tsx`)
*   Renders a planning grid with configurable time buckets (Daily, Weekly, Monthly).
*   Enables selection of individual channels or an **aggregated, read-only "All Channels"** overview.
*   Integrates smart suggestions to pre-fill forecasts using historic baselines.

### 3. MPS Production Plan (`src/components/ProductionPlanScreen.tsx`)
*   Manages Master Production Schedules (MPS) mapped against machinery lines (e.g., SOFY, VOXY, Atlas).
*   Features dynamic capacity visualizers to flag when schedules exceed machine capacity.

### 4. MRP Engine (`src/components/MRPScreen.tsx`)
*   Executes material requirements explosion using the Bill of Materials.
*   Projects inventory levels by month or week, auto-generating **Planned Order Releases** when safety stock is breached.
*   Overridden by text search to instantly isolate sub-component dependencies.

### 5. Stock Coverage & Drill-Down (`src/components/CoverageScreen.tsx`, `src/components/MaterialDrillDown.tsx`)
*   Computes exact coverage durations in months/days with or without incoming shipments.
*   Displays stockout risk flags and comprehensive material trace lines.

### 6. Logistics & Customs Control Tower (`src/components/LogisticsScreen.tsx`)
*   Tracks sea/air/land shipments, customs clearances, and transit durations.
*   Calculates delay parameters and factory arrival dates dynamically.

### 7. Plan vs Actual Analysis (`src/components/PlanVsActualScreen.tsx`)
*   Visualizes target schedules against actual performance to output variance and achievement percentages.

### 8. Master Data Hub & Import Hub (`src/components/MasterDataScreen.tsx`, `src/components/GlobalCsvImporter.tsx`)
*   Unified panel for entities (Materials, Products, Machines, Suppliers, Channels).
*   Includes a central bulk uploader that maps headers, validates records, and imports directly into the data layer.

---

## 4. Key Data Schema Reference (`src/types.ts`)

Refer to the interfaces in `src/types.ts` for full details, focusing on:
*   `Product`: Includes `id`, `sku`, `name`, `group_id`, `category_id`, `product_line` (machine), and `selling_price`.
*   `Material`: Includes `id`, `sku`, `name`, `supplier_id`, `standard_cost`, `total_lead_time_days`.
*   `BOMSlot` & `BOMOption`: Linking product components with materials and their priority tags.
*   `SalesPlan` & `ProductionPlan`: Tracking time-series quantities of demand and supply.
*   `Shipment`: Tracking logistics, quantities, delays, and vessel details.
*   `PurchaseOrder`: Tracking procurement status (`pending`, `in_transit`, `completed`).

---

## 5. Implementation Rules for Future AI Agents
1.  **Strict File Separation**: Avoid bloating `App.tsx`. Extract large business flows, analytical tables, and interactive panels into modular subcomponents under `src/components/`.
2.  **Verify Types**: Always check types in `src/types.ts` before writing database operations.
3.  **Linter Conformity**: Run `npm run lint` regularly to ensure type safety and check for unused variables or imports.
