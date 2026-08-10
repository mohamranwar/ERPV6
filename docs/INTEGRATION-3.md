# Build increment 3 — the executive chart fix, and configurable charts

Verified against the real repository: `npx tsc --noEmit` clean, **19 new tests
passing**, full suite 236 passed with only the known pre-existing failure.

| File | Goes to | What it does |
|---|---|---|
| `src/utils/executiveCharts.ts` | `src/utils/` | Replaces `computeExecutiveChartData`. All six series from live data. |
| `tests/executiveCharts.test.ts` | `tests/` | 19 tests, one guarding each way the old code invented numbers |
| `src/components/charts/ChartConfigPanel.tsx` | `src/components/charts/` | The Excel-style format pane |
| `src/components/charts/ChartCard.tsx` | `src/components/charts/` | Drop-in: chart + pane + CSV export, config persisted |

---

## Read this part first

I described the `MONTH_MAP` problem in increment 1 from a partial read. Having
now read `computeExecutiveChartData` in full, **it is worse than I reported**,
and in a way that changes how urgent this is. There were four separate paths to
displaying invented numbers, none of which raised an error:

**1. The date range.** `MONTH_MAP` covered `2025-06` to `2026-05`. Later months
found no key, hit `if (!datePrefix) return item`, and returned the seed row.
This is the one I already flagged.

**2. A real zero was overwritten.** The guard was:

```ts
const BC = actualQty > 0 ? parseFloat(...) : item.BC;
```

A month that genuinely sold nothing is indistinguishable from a lookup miss, so
a true zero was replaced with a demo figure. This affects months *inside* the
valid range, so it has been happening since the code shipped.

**3. RM coverage used a magic constant.** `const avgDemand = 250000`, then
`rmStock / avgDemand`. That number corresponds to no material's consumption and
does not agree with the coverage screen or the month-close scorecard.

**4. Two charts were never computed at all.**

```ts
const fgStockCoverage = [...EXECUTIVE_CHART_DATA.fgStockCoverage];
const fgStkVsSales    = [...EXECUTIVE_CHART_DATA.fgStkVsSales];
```

No branch, no lookup, no data access. "FG Stock Coverage" and "FG STK vs Sales"
have **never** reflected your database in any state, on any date, since the file
was written. They are the seed array, always.

So of six charts on the executive dashboard: two are entirely fictional, one
uses an unrelated constant, and three are fictional for any month past May 2026
or any month with a genuine zero. All six are captioned "Jul-25 to May-26".

I would fix this before anything else in the backlog.

---

## Applying the fix

`src/utils/executiveCharts.ts` is a drop-in replacement for the compute
function. The presentational chart components in `ExecutiveCharts.tsx` stay as
they are.

```tsx
import { computeExecutiveChartData, chartCaption } from '../utils/executiveCharts';
import { getPlanningPeriod } from '../supabaseClient';
import { useAppSettings } from '../hooks/useAppSettings';

const { settings } = useAppSettings();

const charts = useMemo(() => computeExecutiveChartData({
  anchor: getPlanningPeriod(),
  months: settings.calendar.planning_horizon_months,
  salesPlans, salesActuals,
  productionPlans, productionActuals,
  inventory: inventorySnapshots,
  purchaseOrders,
  materials,
  rmCoverageTarget: settings.thresholds.rm_coverage_ok_months,
  fgCoverageTarget: settings.thresholds.fg_coverage_ok_months,
}), [/* deps */]);

<SalesByPcsChart data={charts.salesByPcs} />
<p className="caption">{chartCaption(charts, 'Sales actuals')}</p>
```

Then, in `ExecutiveCharts.tsx`:

1. **Delete `EXECUTIVE_CHART_DATA`** and the old `computeExecutiveChartData`.
   Keeping the seed "as a fallback" is what caused all four bugs — a fallback
   that renders silently is indistinguishable from real data.

2. **Widen the prop types.** They currently read
   `data?: typeof EXECUTIVE_CHART_DATA.salesByPcs`, which disappears with the
   seed. Import the explicit types instead:

   ```ts
   import type { VolumePoint, CoveragePoint, StockFlowPoint, StockVsSalesPoint }
     from '../utils/executiveCharts';

   export function SalesByPcsChart({ data }: { data: VolumePoint[] }) { … }
   ```

3. **Make `data` required.** The `data || EXECUTIVE_CHART_DATA.x` default is
   how the seed reached the screen. A chart with no data should render an empty
   state; `charts.isEmpty` tells you when.

Recharts handles `null` correctly — with `connectNulls={false}` a gap renders
as a gap rather than a line drawn through months that never reported.

---

## Configurable charts

`ChartCard` is the drop-in. Give it a stable `chartId` and the cube:

```tsx
<ChartCard
  chartId="pva-sales-by-line"
  title="Sales — plan vs actual"
  subtitle={chartCaption(charts, 'Sales')}
  periods={periodLabels}
  seriesNames={lineNames}
  plan={planMatrix}      // [seriesIndex][periodIndex]
  actual={actualMatrix}
  unit="M pcs"
  seriesLabel="Lines"
/>
```

The Format button reveals the pane; settings persist to localStorage per user
per chart. **Keep `chartId` stable** — derive it from the chart's identity, not
from a filter, or preferences reset whenever someone changes a filter.

`PlanVsActualScreen.tsx` currently has no charts at all. That is where this
belongs first.

---

## Decisions worth knowing

**Null means absent; zero means zero.** `bucketSum` returns 0 both for "totalled
zero" and "no rows", so presence is tracked separately rather than inferred from
the sum. This is precisely the distinction the old code collapsed.

**Inventory carries forward.** A month with no new snapshot shows the last known
stock rather than a hole — stock does not vanish because nobody counted it.
Months *before* the first snapshot show null, because there genuinely is no
figure. Both behaviours are tested.

**RM coverage is value-based**, matching `monthClose.ts` exactly, so the
dashboard and the month-close scorecard now report the same number. They
previously could not agree, since one used a hardcoded 250000.

**Usage renders flat**, because `max_usage` is a static planning figure rather
than a time series. That is the honest rendering of the data you have. Real
month-by-month consumption needs a BOM explosion over production actuals, which
belongs in the MRP engine — worth doing, but it is a separate piece of work.

**Y scale defaults to "from zero"** and the panel warns when you switch to auto.
Auto clips the axis to the data range, which inflates a 3% miss into what looks
like a collapse.

---

## Where things stand

Built and verified across three increments: the migration, rolling periods, app
text, settings, month close with the full scorecard, the snapshot service, the
executive chart fix, and configurable charts. **68 new tests.**

Remaining:

- Wire `ChartCard` into `PlanVsActualScreen` and the dashboard — mechanical now
- Apply the `ExecutiveCharts.tsx` edits above
- The **code review**, which is phase three of your original plan. I have leads
  already: the float-comparison pattern from increment 1, the seed-as-fallback
  pattern that produced these four bugs (worth grepping for elsewhere), and the
  red `DashboardScreen` test.
