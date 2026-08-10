# ERP_F — code review

Reviewed against `main` as cloned on 10 Aug 2026: 24k lines of TypeScript, 21
test files, 218 tests. Everything below was verified by running the code, not
by reading it alone.

**Short version.** This is a better-engineered codebase than most internal ERP
work I have seen. Row level security is complete, the CSV exporter defends
against formula injection, and several tricky helpers carry comments explaining
*why* rather than *what*. The problems are not sloppiness — they are a small
number of specific defects, two of which cause the application to display
confident, wrong numbers to management.

---

## What is already good

Worth stating, because it shapes the recommendations.

**Row level security is complete.** All 26 data tables go through one loop that
applies the same four policies, so a table added later cannot silently ship
without RLS. `users` is deliberately excluded and given narrower rules — a
planner editing their own row to grant themselves admin was clearly thought
about. `current_app_role()` is `SECURITY DEFINER` with a pinned `search_path`,
and the comment explains the recursion it avoids.

**The CSV exporter neutralises formula injection.** `escapeCsvValue` prefixes
`=`, `+`, `-`, `@`, tab and CR with a quote. Supplier and material names are
free text that reach exports unmodified and are importable from CSV, so this is
a real attack path, and it is closed. Most codebases this size have not thought
about it. The UTF-8 BOM for Arabic supplier names in Excel is a nice touch.

**`uom.ts` refuses to guess.** `pcsPerCarton()` returns `null` for an
unconfigured product rather than falling back to an invented pack size, and the
comment records the earlier `(pcs_per_bag || 10) * (bags_per_carton || 4)` that
prompted it. This is the right instinct, and it is why I deleted my own
duplicate of that function during the build.

**No swallowed errors.** Zero empty `catch` blocks across `src/`. Almost no
stray `console.log`.

**`isInPeriod` and `monthsOfCover`** both document the bug that motivated them.
That kind of comment is worth more than the code.

The findings below are exceptions to a generally careful codebase.

---

## Finding 1 — The executive dashboard fabricates data

**Severity: high. Fixed in this engagement** (`src/utils/executiveCharts.ts`).

`computeExecutiveChartData` mapped over a hardcoded seed and overwrote entries
where it could find a match. There were four independent paths to displaying
invented numbers, none of which raised an error.

**1a.** `MONTH_MAP` covered `2025-06` to `2026-05`. Later months found no key,
hit `if (!datePrefix) return item`, and returned the seed row.

**1b.** Within range, the guard was:

```ts
const BC = actualQty > 0 ? parseFloat(...) : item.BC;
```

A month with genuinely zero sales is indistinguishable from a lookup miss, so a
true zero was replaced with a demo figure. This has been happening since the
file shipped, inside the valid range.

**1c.** RM coverage divided by `const avgDemand = 250000` — a constant matching
no material's consumption, and disagreeing with both the coverage screen and
the month-close scorecard.

**1d.** Two charts were never computed at all:

```ts
const fgStockCoverage = [...EXECUTIVE_CHART_DATA.fgStockCoverage];
const fgStkVsSales    = [...EXECUTIVE_CHART_DATA.fgStkVsSales];
```

No branch, no data access. **"FG Stock Coverage" and "FG STK vs Sales" have
never reflected the database in any state, on any date.**

All six charts remain captioned "Jul-25 to May-26".

**Scope check:** I grepped for this pattern elsewhere. It is confined to
`ExecutiveCharts.tsx` — no other screen falls back to seed data. That is
genuinely reassuring, and it means the fix is contained.

---

## Finding 2 — Achievement reports 100% when there is no plan

**Severity: high. Not yet fixed.**

`src/components/PlanVsActualScreen.tsx:271`, inside the headline
"Variance & Achievement Rate" card:

```ts
const ach = plan > 0 ? (act / plan) * 100 : 100;
```

When no plan exists, the screen reports **100% achievement** — the most
reassuring number available — on a card a manager reads first. Filter to a
channel or period with no plan loaded and the dashboard says target was met
exactly.

The same file already knows better. Line 152, computing the same concept:

```ts
volume_achievement: plannedPcs > 0
  ? parseFloat(((actualPcs / plannedPcs) * 100).toFixed(1))
  : null,
```

`null` is correct: there is no ratio against nothing. The file disagrees with
itself 120 lines apart, and the wrong version is the one on the summary card.

**Fix:**

```ts
const ach = plan > 0 ? (act / plan) * 100 : null;
…
<h4 className="text-xl font-bold text-slate-900 font-mono">
  {ach === null ? '—' : `${ach.toFixed(1)}%`}
</h4>
```

Render a dash, and consider a "no plan loaded for this selection" caption.
An empty state that admits it beats a green number that lies.

**Worth auditing the same question elsewhere.** Other divide-then-compare sites
(`ExportForecastScreen.tsx:262,278,366`, `ProductionPlanScreen.tsx:356,388`,
`MRPScreen.tsx:502`) all default to `0` rather than `100`, which is less
dangerous but still conflates "nothing planned" with "achieved nothing". Zero
at least fails safe; 100 fails loud and wrong.

---

## Finding 3 — No async cancellation on any data screen

**Severity: medium-high. Systemic. Not yet fixed.**

All eleven data screens load with an unguarded async effect:

```ts
useEffect(() => { loadData(); }, [refreshKey]);

async function loadData() {
  const [a, b, c, …] = await Promise.all([…9 queries…]);
  setSalesCompare(a);
  setProductionCompare(b);
  …
}
```

No `cancelled` flag, no `AbortController`, no mounted check — across
`BOMEditorScreen`, `CoverageScreen`, `CustomsClearanceScreen`,
`DashboardScreen`, `ExportForecastScreen`, `LogisticsScreen`, `MRPScreen`,
`MasterDataScreen`, `PlanVsActualScreen`, `ProductionPlanScreen`,
`SalesPlanScreen`.

**This is reachable through normal use.** `handlePeriodChange` bumps
`refreshKey`, so every period switch re-fires the effect. A planner clicking
month to month through the period dropdown — an entirely ordinary action —
starts overlapping loads of nine parallel queries each. If an earlier load
resolves last, its results land in state and the screen shows one month's
numbers under another month's heading, with no error and no visual cue.

Navigating away mid-load also sets state on an unmounted component.

**Fix, per screen:**

```ts
useEffect(() => {
  let cancelled = false;

  (async () => {
    setLoading(true);
    try {
      const [a, b, …] = await Promise.all([…]);
      if (cancelled) return;          // late response is discarded
      setSalesCompare(a);
      setProductionCompare(b);
    } catch (e) {
      if (!cancelled) setError(String(e));
    } finally {
      if (!cancelled) setLoading(false);
    }
  })();

  return () => { cancelled = true; };
}, [refreshKey]);
```

Eleven near-identical edits. Better still, extract a `useAsyncData` hook so the
guard cannot be forgotten on the twelfth screen — but the inline fix is
mechanical and can ship today.

---

## Finding 4 — Widget titles were defined twice

**Severity: medium. Fixed in this engagement** (`patches/dashboard-titles.patch`).

Every dashboard widget title existed in two places: `DEFAULT_WIDGET_CONFIGS`
and a hardcoded `<h3>` in `DashboardScreen.renderWidget`. All three
"Detailed Analytics" panels had drifted:

| Customiser showed | Panel rendered |
|---|---|
| Raw Material Coverage by Category | Raw Material **Stock** Coverage by Category |
| Monthly POs & Procurement Status | Monthly **Purchase Orders (PO) &** Status **Breakdown** |
| Finished Goods Coverage Matrix by Category | Finished Goods **Stock** Coverage Matrix by Category |

Users toggled one name and saw another. This is what the long-failing
`DashboardScreen` test was pointing at; it read as a stale test, so it sat red
long enough that the whole suite stopped being a signal.

Titles now come from the registry in both places. Suite is green: **218/218**.

---

## Finding 5 — Float comparison at threshold boundaries

**Severity: medium. Fixed in `periods.ts`; pattern may exist elsewhere.**

`220 / 200 * 100` evaluates to `110.00000000000001`. By the same mechanism, a
row that hit plan exactly can compute to `99.99999999999999`, which against a
threshold of `100` classifies as "watch" rather than "on target". A badge
changes colour because of representation error, not performance.

I found this because a test I wrote failed on it. `attainmentSeries()` now
rounds to six decimal places — far finer than any threshold anyone will set.

**Worth grepping for**: any site that divides to produce a ratio and then
compares it against a boundary. `PlanVsActualScreen`, `CoverageScreen` and
`MRPScreen` all do this.

---

## Finding 6 — Component size

**Severity: medium. Structural, not urgent.**

```
ExportForecastScreen.tsx   1,989
DashboardScreen.tsx        1,735
MRPScreen.tsx              1,603
MaterialDrillDown.tsx      1,482
MasterDataScreen.tsx       1,444
```

18,628 lines across `src/components`. `DashboardScreen.renderWidget` is a
single `switch` over 17 widgets, each with inline JSX — which is exactly the
structure that let three headings drift without anyone noticing.

This is not causing bugs today beyond Finding 4, and I would not stop feature
work to fix it. But the next time you touch a widget, lift it into
`src/components/dashboard/widgets/<id>.tsx`. Incremental extraction beats a
rewrite, and it makes each widget individually testable.

`ExportForecastScreen` at 1,989 lines with 8 `any` annotations is the one I
would look at first if numbers there are ever disputed.

---

## Finding 7 — `any` in data paths

**Severity: low.**

`ExecutiveCharts.tsx` (10 — being replaced), `ExportForecastScreen.tsx` (8),
`MasterDataScreen.tsx` (7), `ProductionPlanScreen.tsx` (6). Mostly on data
arrays that do have types available.

`PlanVsActualScreen` declares `productionPlans`, `productionActuals` and
`machineCompare` as `any[]` while importing `Product`, `Machine` and `Channel`
properly — so the types exist and are simply not applied. Typing those three
would likely have surfaced Finding 2 at compile time.

---

## Suggested order

1. **Finding 2** — one line, high impact, wrong number on a headline card
2. **Finding 1** — apply `executiveCharts.ts`; delete `EXECUTIVE_CHART_DATA`
3. **Finding 4** — apply the patch; get the suite green so regressions show
4. **Finding 3** — eleven mechanical edits, or one `useAsyncData` hook
5. **Finding 5** — grep the ratio-then-compare sites
6. **Findings 6, 7** — opportunistically, as you touch each file

Items 1–3 are a day's work and remove every case where the application
currently shows a confident wrong number.

---

## One process note

The `DashboardScreen` test had been failing long enough to be treated as
background noise. While it was red, the suite could not tell you whether
anything else had broken — and it was pointing at a real defect the whole time.

Two habits worth adopting: keep the suite green so a failure means something,
and after writing a test, deliberately break the thing it guards to confirm it
goes red. I caught my own tautological test that way during this build — it
compared a constant against itself and would have passed forever.
