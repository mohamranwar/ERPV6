# Sanita Supply Chain Planner — Improvement Plan

Written 2026-08-07. Covers the five workstreams you asked for: design/mobile, flow &
calculation review, PO delivery, a dedicated logistics/customs screen, and dashboards
for presentation and follow-up.

Everything below is grounded in a read of the actual source plus a live run of
`tsc --noEmit` and `vitest` in a Linux sandbox against your `node_modules`.

---

## 0. Baseline — what I actually verified

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **Clean.** No type errors. |
| `npx vitest run` | **17 of 113 tests failing**, all in `tests/calcEngine.test.ts`. 6 of 7 test files pass. |
| Source size | 17,471 lines across 36 files; 23 components |
| Largest files | `supabaseClient.ts` 2,074 · `ExportForecastScreen` 1,613 · `MRPScreen` 1,575 · `MaterialDrillDown` 1,434 · `MasterDataScreen` 1,417 |
| Version control | **No git repository.** `git log` fails — the folder is not initialised. |
| Charting | No chart library. All visuals are hand-rolled divs (`DashboardScreen` bar chart is 20 absolutely-sized `<div>`s). |

> **Do this before anything else:** `git init && git add -A && git commit -m "baseline"`.
> This plan touches every screen. Without version control there is no way to bisect a
> regression or revert a bad refactor, and you have already lost the project once to a
> folder replacement (see `REVIEW_ROUND2_REPORT.md`).

---

## 1. Findings — flow, calculations and methods

Ordered by severity. Line numbers are current as of this writing.

### 1.1 Critical — UOM normalisation is applied inconsistently in the BOM engine

Two functions in `supabaseClient.ts` compute primary BOM consumption. One converts
units, the other does not:

- `getPrimaryBomConsumption()` **line 1204** calls `normalizeQuantity(...)`, converting
  a BOM line expressed in Grams to the material's base UOM of KG (÷1000).
- `primaryConsumptionBySlot()` **line 1241** uses raw `opt.qty_per_unit` with **no
  conversion at all**.

`explodeBOM` feeds the first; substitution proposals feed the second. For MT1
(fluff pulp, BOM in Grams, stock in KG) the two disagree by a factor of 1,000.
`buildSubstitutionProposals` then compares a gram-scale slot consumption against a
KG-scale shortfall, so `shortfall_qty`, `coverable_qty` and `alternate_qty` on every
substitution proposal involving a gram- or ton-based material are wrong by three
orders of magnitude.

**Fix:** extract one `bomLineQty(option, material, conversions)` helper and call it
from both. Add a test asserting the two functions agree for every seeded product.

### 1.2 Critical — coverage counts *arrived* shipments as incoming supply

`getVMaterialCoverage`, **lines 759–761**:

```ts
const transitQty = shipments
  .filter(s => s.material_id === m.id && s.factory_arrival_date !== null)
  .reduce((sum, s) => sum + s.qty, 0);
```

`factory_arrival_date !== null` means the shipment **already landed at the factory**.
That stock is (or should be) inside the inventory snapshot already, so it is counted
twice. Meanwhile genuinely in-transit shipments — the ones where
`factory_arrival_date === null` — are excluded entirely. The filter is inverted.

There is also no date bound: a shipment that arrived in February 2026 still inflates
the coverage number for the August 2026 planning period, forever.

**Fix:** in-transit = `factory_arrival_date === null && port_eta` within the horizon.
Arrived = already in stock, exclude. Bound both by the selected planning period.
This directly moves the dashboard "OOS Risk" and "Overstock Items" KPIs.

### 1.3 High — pending-PO supply in coverage ignores dates and drops `in_transit`

Same function, **lines 764–766**: sums `remaining_qty` for POs with
`status === 'pending'` regardless of `required_date`. A PO due in December counts in
full against August coverage. POs with `status === 'in_transit'` are dropped
altogether, even though their quantity is genuinely inbound.

**Fix:** include `pending` and `in_transit`; filter on `required_date` falling inside
the coverage horizon.

### 1.4 High — MRP double-counts a PO and its shipment

`runMRP`, **lines 1772–1785**: `totalReceipts = transitReceipts + poReceipts`.
`Shipment` carries an optional `po_id` (`types.ts:229`, populated on all three seeded
shipments — SH1→PO3, SH2→PO1, SH3→PO2), but nothing deduplicates. A pending PO whose
shipment already has a factory arrival date in the same bucket contributes its
quantity twice, understating net requirements and suppressing planned orders.

**Fix:** when a shipment carries `po_id`, net its quantity off that PO's
`remaining_qty` rather than adding both.

### 1.5 High — PO auto-completion specified but never implemented

`project.md` §3.4 states: *"Marking an inbound shipment as arrived in the Factory
triggers automatic PO status change to `completed` and sets remaining PO quantities
to `0`."*

`LogisticsScreen.handleSaveShipment` (**lines 217–229**) does no such thing. It saves
the shipment and stops. `remaining_qty` exists on the type and is read by the coverage
and MRP engines, but **no code path in the entire UI ever decrements it**. Every write
in the codebase sets it *equal to* `qty` — `LogisticsScreen.tsx:247`, `:624` and
`MRPScreen.tsx:441`. So the number the planning engine trusts most is the one the app
can never update.

This is also the root of your "no receipt / partial delivery" complaint.

### 1.6 Medium — arbitrary magic fallbacks in demand

- `getVProductCoverage` **line 832**: `demandMap[p.id] || 45000`. Any product with no
  forecast silently gets 45,000 units/month of demand, which drives `below_safety_flag`
  and the dashboard's "FG Under 1 Mo. Cover" KPI. Unexplained and undocumented.
- `getVMaterialCoverage` **line 756**: falls back to `m.max_usage * DAYS_PER_MONTH`.
  For MT1 that is 1,200 × 30 = 36,000 **KG**/month, against an exploded plan demand of
  ~464 KG for 100k units. Two numbers ~78× apart share one column, and which one you
  get depends on whether a plan row happens to exist.

**Fix (decision 6):** return `null` and render a dash labelled "no forecast". Both
fallbacks are deleted. Expect the dashboard's "OOS risk" and "FG under 1 mo." counts to
move when this lands — the new numbers are the correct ones.

### 1.7 Medium — inventory snapshot silently falls back to an arbitrary row

**Lines 747 and 830**: `mSnapshots.find(i => i.snapshot_date === period) || mSnapshots[0]`.
If no snapshot exists for the selected period, it takes whichever snapshot happens to
be first in insertion order and reports it as current stock, with no indication in the
UI. Change the planning period, get a stock figure from an unrelated month.

Same pattern in `runMRP` **line 1698**: opening stock is `inventory.find(...)` with no
date condition at all, so every MRP run starts from an arbitrary-dated position.

### 1.8 Medium — the `2026-07-01` anchor has now expired

`PLANNING_ANCHOR = '2026-07-01'` (**line 1067**) plus **30 further literal occurrences**
in `supabaseClient.ts` and 5 in `ExportForecastScreen`/`GlobalCsvImporter`.
`REVIEW_ROUND2_REPORT.md` flagged this on 2026-07-21 as *"will need attention once
you're planning against August."* Today is 7 August 2026 — that day has arrived.

### 1.9 Medium — the test suite is 15% red and nobody knows which side is right

All 17 failures are in `calcEngine.test.ts`, and they were **hand-derived and never
executed** (stated explicitly in `REVIEW_ROUND2_REPORT.md`). Spot-checking:
`explodeBOM({P1: 100000}).MT1` returns 463.5, the test expects 463,500 — exactly 1000×.
The *code* is right here (4.5 g × 1.03 × 100,000 = 463,500 g = 463.5 KG) and the *test*
predates UOM normalisation. But some failures may be genuine. Until this is resolved
the suite gives you no signal at all, and it will hide the regressions this plan's
refactoring will otherwise introduce.

**This is the single highest-leverage item in the whole plan.** Fix it first.

### 1.10 Lower — screen-level defects

| Issue | Location |
|---|---|
| `activeTab` state declared, never rendered or set — dead tab UI | `LogisticsScreen.tsx:40` |
| `deleteRecord` and `askConfirm` imported, never used — no delete for POs/shipments | `LogisticsScreen.tsx:7,54` |
| Save handlers have **no role gate**; edit buttons render for viewers, so a viewer can open the modal and save | `LogisticsScreen.tsx:202,217` |
| Two different delay semantics in one table: PO rows *compute* delay from revised−original (line 116), shipment rows read a *stored* `delay` field (line 146) that can drift | `LogisticsScreen.tsx` |
| Neither delay measures against **actual arrival** — only commitment vs. revised commitment. A supplier who revises the date is "on time" forever. | `LogisticsScreen.tsx:111–117` |
| Role gates still missing on BOM saves, MRP PO creation, Sales/Production inline edits (known, from Round 2) | multiple |

---

## 2. Workstream A — Design system, layout and mobile

You confirmed three personas: **desk planners** (dense grids, keyboard), **procurement
and logistics on phones** (status checks and date updates in the field), and
**managers reviewing only** (dashboard, risk, plan vs actual — tablet/phone).

Those three cannot share one layout. Today they do, and the phone experience is a
horizontally-scrolling 10-column table.

### A0. Remove the dead Arabic/RTL wiring *(decision 7 — do before the token audit)*

`App.tsx` carries `lang` state, a `dir` switch, `text-start`/`text-end` swapping and
`rtl:` class variants across components, but `t()` (`App.tsx:157`) returns its input
unchanged — there are no translations, and neither bundled font carries Arabic. Strip
it now, while the files are about to be touched anyway. Re-add deliberately if Arabic
becomes real.

### A1. Harden the token layer *(foundation — do first)*

`index.css` already has a good start (brand ramp, surface ramp, elevation shadows,
`pointer: coarse` tap targets, `scroll-x-touch`). What is missing is *enforcement* —
components hardcode `bg-white rounded-xl border border-slate-200 p-4 shadow-sm`
inline dozens of times instead of using `card-elevated`.

- Audit every literal colour/radius/shadow in `src/components/` and replace with the
  token classes that already exist.
- Add missing semantic tokens: `--color-status-risk`, `--color-status-transit`,
  `--color-status-cleared`, `--color-status-delayed`. Status colour is currently
  re-derived by hand in every screen (`LogisticsScreen` lines 448–501 alone has four).
- Use the `design:design-system` skill for the audit and the
  `design:accessibility-review` skill for a WCAG AA contrast pass — several of your
  `text-[9.5px]` and `text-[10px]` labels on tinted backgrounds will fail.

### A2. Extract a shared component kit

Currently duplicated across 15+ files: KPI card, filter bar, modal shell, status badge,
form field. Extract to `src/components/ui/`:

`Card` · `KpiCard` (lift the good one out of `DashboardScreen:364`) · `StatusBadge` ·
`Modal` (with `useFocusTrap` already wired — the Logistics modals at lines 552 and 690
have **no focus trap and no Escape handler**, unlike the App config modal) ·
`FilterBar` · `FormField` · `DataTable`.

This is what makes every later workstream cheap. Do not skip it.

### A3. Mobile — the table problem

`ScrollableTable` is a reasonable stopgap (it detects overflow and shows a swipe hint)
but it is not a mobile experience. On a phone, a 10-column PO table means horizontal
scrolling past 6 columns to reach the one you care about.

- **Responsive `DataTable`**: above `lg`, render the table as today. Below `lg`, render
  each row as a card with a primary line, 2–3 secondary facts and the status badge —
  driven by a per-column `priority: 'primary' | 'secondary' | 'detail'` config so each
  screen declares its own hierarchy once.
- **Sticky first column** on the desktop tables (material/SKU) so horizontal scroll
  keeps context.
- **Bottom tab bar** below `lg` with the 4–5 screens procurement actually uses on a
  phone (Logistics, PO Delivery, Coverage, Dashboard) — the current hamburger drawer
  requires two taps to reach anything.
- **Full-screen sheets instead of centred modals** below `sm`. The Logistics PO modal is
  `max-w-lg` centred with a 2-column form grid; on a 390px screen the two columns
  collapse into unusable slivers.
- **Persona-aware defaults**: `viewer` role lands on the dashboard with `compact`
  density off; planners keep the dense grid. The `tableDensity` state already exists in
  `App.tsx:141` — wire it to role and viewport.

### A4. Navigation

14 screens in a flat 3-group sidebar is already at the limit, and this plan adds 2–3
more. Consider collapsing `drill_down` + `material_inspection` (both render
`MaterialDrillDown` with a different `initialMode` — `App.tsx:242–244`) into one screen
with a mode toggle, and grouping the logistics screens under one parent.

---

## 3. Workstream B — Correctness (the findings in §1)

Sequenced so each step is verifiable before the next:

1. **Reconcile the test suite** (§1.9). For each of the 17 failures decide: stale
   expectation or real bug. Re-derive by hand against the current seed data. Green
   suite is the gate for everything below.
2. **Unify BOM quantity** (§1.1) — one `bomLineQty` helper, both call sites, agreement
   test.
3. **Fix coverage supply** (§1.2, §1.3) — invert the in-transit filter, bound by period,
   include `in_transit` POs.
4. **Deduplicate MRP receipts** by `po_id` (§1.4).
5. **Implement receipt posting** (§1.5) — the shared engine behind Workstream C.
6. **Remove magic fallbacks** (§1.6) and make missing-snapshot explicit (§1.7).
7. **De-anchor the calendar** (§1.8, decision 5) — replace `PLANNING_ANCHOR` with a
   `today`-relative computation and regenerate all seed dates as offsets from it, so
   the demo never expires again. Still demo data, so this is safe to do aggressively.
8. **Close the role-gate holes** (§1.10) and make offline writes fail loudly with a
   clear toast rather than appearing to succeed (decision 8).

Use the `engineering:code-review` skill on each step's diff and
`engineering:testing-strategy` to design the regression tests around the calc engine
before touching it.

---

## 4. Workstream C — PO delivery screen

You named four pains; all four are real and confirmed in the code.

### C1. Inline and bulk editing
Today: edit = open modal, change one date, save (`LogisticsScreen:507–518`).
- Inline-editable revised delivery date directly in the row.
- Multi-select rows → "shift all revised dates by N days" / "set revised date to X" /
  "assign timing flag" in one action. This is the single biggest time saver for a
  procurement user chasing a supplier who slipped a whole container's worth of POs.

### C2. A "what's late" view that prioritises
Today delay is a per-row number with no aggregation.
- Buckets across the top: **Overdue** · **Due this week** · **Due next week** ·
  **Later** · **Received**, with counts. Clicking one filters.
- Sort by *impact*, not date: a 3-day slip on a material with 0.4 months of coverage
  outranks a 30-day slip on one with 6 months. Join to `getVMaterialCoverage`.
- Flag POs whose `revised_delivery_date` has passed with no receipt — the "silently
  late" cases that no current view surfaces.

### C3. Receipt posting and partial delivery *(depends on §1.5)*
New `GoodsReceipt` record: `po_id`, `shipment_id?`, `received_date`, `received_qty`,
`received_by`, `notes`.
- Posting a receipt decrements `PurchaseOrder.remaining_qty`, sets `status` to
  `completed` when it hits zero (satisfying the `project.md` §3.4 spec), and appends to
  the inventory snapshot.
- Receipt history per PO, so "150k ordered, 60k received across 2 deliveries, 90k open"
  is visible rather than inferred.
- Gated on `hasRole('planner')` per decision 1 — procurement posts receipts, there is
  no separate warehouse role. Because the data arrives second-hand, keep
  `received_date` (when it physically landed) distinct from `posted_date` (when it was
  entered), so the reporting lag is visible instead of silently backdating stock.
- Mobile-first anyway: procurement posts these from a phone. Big tap targets, quantity
  stepper, "receive full quantity" one-tap default.

### C4. Link a PO to the shortage it covers
- Join PO → material → current MRP `net_requirements` and coverage months.
- Each PO row shows "covers MT1 shortfall in Sep-2026" or "no current requirement".
- Reverse link from the MRP screen: planned order release → existing open PO, so
  planners stop raising duplicates.

---

## 5. Workstream D — Logistics & customs clearance

You want all four: **agent performance, container-level detail, clearance cost, and
document status**. None of it is modellable today — there is no clearance-agent entity
anywhere in the codebase (`grep` for `clearance_company|forwarder|broker|customs_agent`
returns nothing), and `Shipment` carries only `customs_clearance_days: number` and
`container_count: number`.

### D1. New entities (`src/types.ts`)

```ts
export interface ClearanceCompany {
  id: string; name: string; contact_person: string; phone: string; email: string;
  ports_served: string[];              // e.g. ['Alexandria','Sokhna']
  contracted_clearance_days: number;   // the SLA you hold them to
  status: 'active' | 'inactive';
}

export interface ClearanceJob {
  id: string;
  shipment_id: string;
  clearance_company_id: string;
  invoice_no: string;                  // the invoice being cleared
  bl_no: string;
  port_name: string;
  container_count: number;
  port_eta: string;                    // vessel arrival
  documents_submitted_date: string | null;
  customs_release_date: string | null; // released by customs
  gate_out_date: string | null;        // left the port
  factory_arrival_date: string | null; // landed at factory
  status: 'awaiting_arrival' | 'docs_pending' | 'under_clearance'
        | 'released' | 'in_delivery' | 'completed';
  notes?: string;
}

export interface ClearanceContainer {
  id: string; job_id: string;
  container_no: string;
  container_type: '20ft' | '40ft' | '40HC' | 'LCL';
  qty: number;
  released_date: string | null;        // partial release: 3 of 5 cleared
  demurrage_days: number;
  demurrage_cost: number;
}

export interface ClearanceDocument {
  id: string; job_id: string;
  doc_type: 'bill_of_lading' | 'commercial_invoice' | 'packing_list'
          | 'certificate_of_origin' | 'form_4' | 'inspection_certificate' | 'other';
  status: 'not_required' | 'pending' | 'received' | 'submitted' | 'rejected';
  received_date: string | null;
  notes?: string;
}

export interface ClearanceCharge {
  id: string; job_id: string;
  charge_type: 'customs_duty' | 'vat' | 'agent_fee' | 'port_charges'
             | 'demurrage' | 'inland_transport' | 'inspection' | 'other';
  amount: number; currency: string; invoice_ref?: string; paid: boolean;
}
```

### D2. The screen — four tabs

**Active clearance board.** One card/row per `ClearanceJob`, grouped by status.
Prominent per job: days since port ETA, days remaining against the agent's contracted
SLA, containers released vs. total, and a red flag on any missing document — because
missing documents are what actually stalls clearance, and today nothing tracks them.

**Cycle-time analysis.** This is the number you asked for — *time between ETA and
arrival at factory*, decomposed:

```
port_eta → documents_submitted → customs_release → gate_out → factory_arrival
```

Four measurable stages instead of one opaque `customs_clearance_days` field. Median and
p90 per agent, per port, per month, with a trend line. Now you can say *which* stage is
slow, not just that clearance is slow.

**Agent scorecard.** Per `ClearanceCompany`: jobs handled, containers handled, average
and p90 ETA→factory days, SLA breach rate against `contracted_clearance_days`, total
demurrage incurred, cost per container. This is the renegotiation document.

**Landed cost.** `ClearanceCharge` rolled up per shipment and per material, giving
true landed cost = material cost + freight + duty + agent fee + demurrage.
Per decision 2 this is a **logistics report only** — it does not feed
`getVBOMCostDetail` and does not become a `cost_basis` option. No existing cost or
margin number in the app changes.

### D3. Supporting changes
- `MasterDataScreen`: new "Clearance Companies" tab (the tab pattern is already there
  for 5 entities).
- `GlobalCsvImporter`: import maps for jobs, containers, charges — the bulk-upload path
  is how this data will realistically arrive.
- `runLocalMigrations()` in `supabaseClient.ts:456`: seed the new tables so demo mode
  works, and a `schema.sql` addendum for the Supabase path.
- Keep the existing `LogisticsScreen` as the **PO/shipment follow-up** screen
  (Workstream C) and make customs a genuinely separate screen, as you asked.

---

## 6. Workstream E — Dashboards

You want both: a live operational board for the weekly ops meeting, and a polished
exportable summary for the monthly management review.

### E1. Live operational board *(in-app, weekly)*
A new `ExecutiveScreen` with a **presentation mode** — larger type, reduced chrome,
arrow keys to page between sections, projector-safe contrast.

Sections: coverage risk (materials under 1 month, with owner/controller) · late and
at-risk POs · clearance jobs breaching SLA · plan vs actual achievement · this month's
stockout forecast.

Every tile drills through to its source screen, because in a weekly ops meeting
someone will always ask "which material?" and the answer has to be one click away.

Use the `data:build-dashboard` skill for structure and the `data:create-viz` skill for
the charts.

### E2. Charting
Replace the hand-built bar chart (`DashboardScreen:296–345` — 20 hand-positioned divs
with rotated SKU labels) with a real library. **Recharts** is the right call: it is
React-native, tree-shakeable, and already familiar in this stack's ecosystem. The
current chart cannot do trend lines, dual axes, or stacked bars, all of which the
executive view needs. Note this is a **new dependency** — recharts is not currently in
`node_modules`.

### E3. Exportable monthly pack
A generator producing a branded `.pptx` from live data: title, KPI summary, coverage
risk table, PO/delivery performance, clearance agent scorecard, plan vs actual, and an
action list. Use the `pptx` skill.

Add a one-page printable PDF variant for the monthly review handout (`pdf` skill), and
a self-contained `.html` export for sharing with people who don't have app access.

### E4. Scheduled follow-up
Once the pack generator exists, schedule it — a Monday-morning "supply chain risk
brief" that runs automatically and lands the deck ready for the ops meeting.

---

## 7. Sequencing

| Phase | Contents | Why here |
|---|---|---|
| **0** | `git init` + baseline commit | No refactoring without an undo button |
| **1** | Reconcile test suite (§1.9); fix UOM (§1.1), coverage supply (§1.2–1.3), MRP dedup (§1.4) | Every screen and dashboard reads these numbers. Fixing the UI on top of wrong figures wastes the work. |
| **2** | Design tokens (A1) + component kit (A2) | Foundation that makes phases 3–6 cheap instead of expensive |
| **3** | Receipt posting engine (§1.5) + PO delivery screen (C1–C4) | Highest operational pain, and unblocks accurate `remaining_qty` for everything else |
| **4** | Responsive `DataTable`, bottom nav, sheets (A3–A4) | Now that there is one table component, mobile is one change not fifteen |
| **5** | Customs module (D1–D3) | Largest new build; benefits from the kit and the corrected engine |
| **6** | Dashboards (E1–E4) | Last, because it presents everything above. A dashboard built earlier would present wrong numbers beautifully. |
| **ongoing** | De-anchor calendar (§1.8), remaining role gates (§1.10) | Fold into whichever phase touches the file |

---

## 8. Risks

- **The 17 red tests are load-bearing.** Any refactor of `supabaseClient.ts` without a
  green suite is uninsured. Phase 1 is not optional.
- **`supabaseClient.ts` is 2,074 lines** holding seed data, storage, migrations, and the
  entire calculation engine. It should be split (`seed/`, `storage/`, `engine/`) — but
  split it *after* the tests are green, not before.
- **Dual data path.** Every calc has a Supabase branch and a local branch. New entities
  need both, plus `schema.sql`. Easy to implement one and forget the other.
- **Seed data expiry.** Fixing the July anchor to August only buys a month. Make the
  seed relative to `today` or this recurs.
- **Scope.** Workstreams D and E are each larger than they look — D adds four entities
  with master data, import, migration and schema work; E adds a chart library and three
  export formats. Treat them as separate deliveries.

---

## 9. Decisions — closed 2026-08-07

| # | Decision | Consequence |
|---|---|---|
| 1 | **Receipts are posted by procurement/planner.** No fourth role. | `hasRole('planner')` gates receipt posting. No `AuthContext` change. Receipt data is second-hand by design — add a `received_date` separate from `posted_date` so the lag is visible rather than hidden. |
| 2 | **Landed cost stays a logistics report.** Not a BOM cost basis. | `ClearanceCharge` rolls up in the customs screen only. `getVBOMCostDetail` and `cost_basis` are **untouched** — no existing cost number moves. |
| 3 | **Container numbers are available per shipment.** | Build `ClearanceContainer` in full: partial release (3 of 5 cleared), per-container demurrage days and cost. |
| 4 | **Correctness first**, then design, then screens. | Phase order in §7 stands as written. |
| 5 | **Demo seed, going live soon.** | Make the seed relative to `today` so it never expires. Keep the Supabase branch working but the local path is the one under test. |
| 6 | **No forecast → blank, labelled "no forecast".** | Delete the `45000` magic number (line 832) and the `max_usage * DAYS_PER_MONTH` fallback (line 756). Coverage returns `null`; the UI renders a dash with a label. Affects the dashboard "OOS risk" and "FG under 1 mo." KPIs — counts will change, and they will be *correct*. |
| 7 | **Remove the Arabic toggle.** | Drop `lang` state, the `t()` identity function (`App.tsx:157`), `dir` switching and the `rtl:` class variants. Simplifies every component before the design phase touches them. Re-addable deliberately later. |
| 8 | **Offline writes fail loudly.** No queue, no sync. | Clear error toast, nothing saved. No conflict-resolution design needed. |

### Consequent changes to the plan above

- **§4 C3** — receipt posting is gated on `planner`, not a new warehouse role.
- **§5 D2** — the landed-cost tab is a report; strike the sentence about feeding
  `getVBOMCostDetail` as a third cost basis.
- **§1.6** — resolved by decision 6: return `null`, don't invent a number.
- **§1.8** — resolved by decision 5: seed relative to `today`.
- **§2 (Workstream A)** — add "remove RTL/lang wiring" as the first token-audit task,
  since it touches the same files.
