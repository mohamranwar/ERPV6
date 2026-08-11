# RM Forecast vs Actual PO — implementation plan

Track what MRP said you should order against what Procurement actually
ordered, refresh the forecast weekly, and freeze a comparable baseline every
month.

---

## The headline finding: most of this already exists

Before proposing new tables, I checked what the system already produces. Two
things change the shape of this work substantially:

**1. The forecast is already computed.** `MRPResult.planned_order_releases`
is, by definition, "quantity that must be *ordered* in this period to land a
lead time later." That is the raw material order forecast. It does not need to
be built — it needs to be *frozen* and *compared*.

**2. MRP runs are already immutable and versioned.** `mrp_results` rows carry
a `run_id`, and `closed_periods` already links a period to the `run_id` that
was current when it closed. The baseline anchor exists.

So the real work is not "build a forecast engine". It is: pick which run is the
baseline, compare it to POs, and present the variance. That is a much smaller
and safer piece of work than it first appears.

**What genuinely does not exist yet:** the comparison itself, a place to record
*why* a variance happened, and the screen.

---

## The one decision that determines whether this is trustworthy

**Variance must be measured against a frozen baseline, not a live forecast.**

If the comparison recalculates MRP each time you open the screen, then last
month's variance changes every time someone edits an old sales plan — and a
variance report that rewrites its own history is worse than no report, because
people will act on it. This is the same failure the executive charts had, and
it is worth being explicit about here so it is not reintroduced.

Concretely:

- **Baseline forecast** = `planned_order_releases` from the MRP run frozen at
  the last month close (`closed_periods.run_id`).
- **Current forecast** = the latest MRP run. Shown *alongside* the baseline, so
  you can see forecast drift separately from procurement variance. Never used
  as the variance denominator.
- **Actual** = POs raised in the period, matched by material and `po_date`.

This gives three numbers per material per month, and the two variances between
them answer different questions:

| Comparison | Question it answers | Who owns it |
|---|---|---|
| Current forecast − Baseline forecast | Did demand/BOM/stock assumptions move? | Planning |
| Actual PO − Baseline forecast | Did we buy what we planned to buy? | Procurement |

Collapsing these into one number is the main way this feature could mislead —
a material can look "on plan" because a demand drop and an under-order cancel
out. Keep them separate.

---

## Matching rule (the fiddly part, worth deciding now)

A PO is matched to a forecast bucket by **`material_id` + the month of
`po_date`** — when the order was *raised*, not when it is due. That aligns with
`planned_order_releases`, which is also a release-date concept. Matching on
`required_date` instead would compare a release plan against a receipt date and
produce variance that is pure calendar misalignment.

Three cases that need explicit handling, because silently dropping any of them
produces a confidently wrong total:

- **PO with no forecast** (unplanned buy) — shown as variance with no baseline,
  flagged `unplanned`. Not excluded.
- **Forecast with no PO** (planned but not bought) — full negative variance,
  flagged `not_ordered`. This is the one people most want to see.
- **Cancelled/closed POs** — `status = 'completed'` still counts as ordered;
  a cancelled PO does not. There is currently no `cancelled` status in the
  `PurchaseOrder` type, so **this needs a decision from you** (see open
  questions).

---

## Phases

### Phase 1 — Comparison engine (no UI)
`src/services/rmForecastVariance.ts`

- `buildVarianceRows(baselineRun, currentRun, purchaseOrders, materials, period)`
- Returns per material: baseline qty, current forecast qty, actual PO qty, both
  variances, variance %, and a status band.
- Value variance too (qty × `standard_cost`), because a 10% miss on fluff pulp
  and a 10% miss on polybags are not the same conversation.
- Pure functions, no React, no Supabase. Fully unit-testable.

**Tests:** matching rules, all three edge cases above, zero-baseline handling
(no ratio against nothing — returns `null`, not 0 or ∞, consistent with
`attainmentSeries`).

### Phase 2 — Weekly forecast refresh
- MRP already reruns on demand. Add a lightweight `mrp_run_log` entry marking a
  run as `weekly_refresh` vs `ad_hoc` vs `month_close_baseline`, so the screen
  can offer "compare against last week's run" without guessing which run that
  was.
- No scheduler is added. Nothing in this app runs server-side on a timer, and
  inventing one is a much larger change than it looks. The refresh is a button;
  the log makes it traceable.

### Phase 3 — Screen: RM Forecast vs PO
`src/components/RMForecastVarianceScreen.tsx`

- Period selector (defaults to open period).
- Summary KPIs: total baseline value, total ordered value, variance value,
  count of materials outside tolerance.
- Table: material, supplier, baseline, current forecast, actual PO, both
  variances, status.
- Drill-down per material: the POs that matched, so a number is always
  traceable to documents.
- `ChartCard` for variance by material (top N by absolute value variance) —
  reuses the existing customisable chart, no new chart code.

### Phase 4 — Monthly freeze + variance reasons
- Extend `period_snapshots` with the variance summary so a closed month's
  variance is permanently fixed.
- New `variance_reasons` table: per material per period, a reason code and free
  text. Without this the report tells you *what* diverged but never *why*, and
  the same questions get re-asked every month.
- Reason codes to start: `supplier_moq`, `price_break`, `late_demand_change`,
  `stock_correction`, `substitution`, `procurement_deferral`, `other`.

### Phase 5 — Thresholds + settings
- Tolerance bands in the existing `app_settings` thresholds (e.g. ±5% on plan,
  ±10% on watch), so "outside tolerance" is configurable rather than hardcoded
  — same pattern as the attainment bands already there.

---

## What I need decided before Phase 1

1. **Cancelled POs.** There is no `cancelled` status today. Should a cancelled
   PO count as ordered (procurement did act) or not ordered (nothing was
   bought)? My recommendation: add the status and exclude from actual, but flag
   it separately — a high cancellation rate is itself a finding.

2. **Baseline for the *current* month.** The month is not closed, so there is
   no frozen run yet. Options: (a) the run from the last month close, (b) the
   first run raised in the current month, pinned. My recommendation: (b),
   pinned automatically on the first run of the month, because comparing this
   month's POs against last month's plan measures the wrong thing.

3. **Weekly refresh cadence** — is "weekly" a fixed day (e.g. every Sunday) or
   just "whenever someone reruns"? This affects whether the log needs a
   scheduled-vs-manual distinction.

4. **Partial deliveries.** `remaining_qty` exists. Is the "actual" the ordered
   quantity or the received quantity? My recommendation: ordered, since this is
   a *procurement* variance — receipt performance is a separate report and
   conflating them hides which team owns a gap.

---

## Deliberately not in this plan

- **A scheduler.** Nothing runs server-side on a timer today.
- **Forecast accuracy scoring (MAPE/bias).** Valuable, but it needs several
  months of frozen baselines to mean anything. Worth revisiting once Phase 4
  has accumulated history.
- **Supplier-level variance.** The data supports it, but material-level is the
  actionable unit; supplier rollup is a filter on the same table, not separate
  work.

---

## Rough sequencing

Phases 1 and 3 deliver the visible value and depend only on data that already
exists. Phase 4 is what makes it trustworthy over time. Phase 2 and 5 are small.

I would build 1 → 3 → 4 → 5 → 2, and I would not start until questions 1, 2 and
4 above are answered, because each one changes what the engine computes rather
than just how it is displayed.
