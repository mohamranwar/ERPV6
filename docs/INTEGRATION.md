# Build increment 1 — foundations

Four files, all verified against the real repository: `npx tsc --noEmit` is
clean and `tests/periods.test.ts` passes 30/30.

| File | Goes to | What it does |
|---|---|---|
| `migrations/001_app_text_and_snapshots.sql` | run in Supabase SQL editor | `app_text`, `period_snapshots`, `app_settings`, `settings_audit` + RLS + seed |
| `src/utils/periods.ts` | `src/utils/` | Rolling month windows. Replaces the hardcoded `MONTH_MAP`. |
| `src/context/AppTextContext.tsx` | `src/context/` | `useText()` — editable labels with offline fallback |
| `src/components/charts/ChartBuilder.tsx` | `src/components/charts/` | Recharts plan-vs-actual with labels, target, transpose |
| `tests/periods.test.ts` | `tests/` | 30 tests, including a regression guard for the month bug |

---

## Apply in this order

### 1. Run the migration

Paste `001_app_text_and_snapshots.sql` into the Supabase SQL editor. It is
idempotent — safe to re-run. It changes no behaviour on day one: the seeded
thresholds match what the code already hardcodes.

It follows the conventions already in `schema.sql` — text primary keys, the
`has_app_role()` helper, the same four-policy shape. Two deliberate departures:

- `period_snapshots` delete is admin-only. It is history.
- `settings_audit` has select and insert policies only. No update, no delete.
  An audit log you can edit is not an audit log.

### 2. Fix the live chart bug

This is the urgent one. `src/components/ExecutiveCharts.tsx` currently holds:

```ts
const MONTH_MAP: Record<string, string> = {
  '2025-06': 'Jun-25', ... '2026-05': 'MAY-26',
};
```

Every month after May 2026 misses this map, falls through to the hardcoded
`EXECUTIVE_CHART_DATA` seed, and renders demo figures with no error. The
captions still read `Source: Historical Sales DB (Jul-25 to May-26)`. It is
August 2026, so the last three months of every executive chart are fiction.

Replace the lookup:

```ts
import { trailingMonths, bucketSum, windowCaption } from '../utils/periods';
import { getPlanningPeriod } from '../supabaseClient';

const buckets = trailingMonths(getPlanningPeriod(), 12);

const salesActual = bucketSum(salesActuals, buckets, 'period_start', 'quantity');
const salesPlan   = bucketSum(salesPlans,   buckets, 'period_start', 'quantity');

const data = buckets.map((b, i) => ({
  month:  b.label,
  actual: salesActual[i] / 1_000_000,
  plan:   salesPlan[i]   / 1_000_000,
}));

const caption = `Source: sales actuals · ${windowCaption(buckets)}`;
```

Then delete `MONTH_MAP` and `EXECUTIVE_CHART_DATA`. Keeping the seed "just as a
fallback" is what caused this: a fallback that renders silently is
indistinguishable from real data. An empty chart that says so is better than a
full one that lies.

**Check `PLANNING_ANCHOR` too.** `supabaseClient.ts:1298` has
`'2026-07-01'`. Its comment says it is only a fallback, and
`resolveDefaultPlanningPeriod()` does prefer the real current month — so this
one is currently harmless. Worth a look while you are in there.

### 3. Mount the text provider

In `src/main.tsx`, wrap inside `AuthProvider`:

```tsx
<AuthProvider>
  <AppTextProvider>
    <ToastConfirmProvider>
      <App />
    </ToastConfirmProvider>
  </AppTextProvider>
</AuthProvider>
```

Then migrate `NAV_GROUPS` in `App.tsx` from literals to keys:

```tsx
const t = useText();

const NAV_GROUPS = [
  { labelKey: 'nav.group.planning', items: [
    { id: 'dashboard',       labelKey: 'nav.dashboard',       icon: LayoutDashboard },
    { id: 'production_plan', labelKey: 'nav.production_plan', icon: Cpu },
  ]},
];

// render: {t(item.labelKey)}
```

`ScreenID` values do not change. Neither do column names, export headers or
test selectors — only what people read.

Migrate incrementally. `useText()` falls back to `DEFAULT_TEXT` and then to the
key itself, so a screen you have not converted yet keeps working, and a typo
renders as `nav.dashbord` on screen rather than blanking a menu item.

### 4. Use ChartBuilder

```tsx
import ChartBuilder, { DEFAULT_CHART_CONFIG, transpose } from './charts/ChartBuilder';

const [config, setConfig] = useState(DEFAULT_CHART_CONFIG);

<ChartBuilder
  data={transpose(periodLabels, lineNames, planMatrix, actualMatrix, config.axis)}
  config={config}
  unit="M pcs"
/>
```

`PlanVsActualScreen.tsx` currently has no charts at all — it is tables only.
That is the first place this belongs.

---

## Two decisions worth knowing about

**Plan is drawn as a ghost, actual as substance.** Dashed violet outline with a
10% wash for plan; solid fill for actual. Not decoration — it means you stop
needing the legend after the first glance, and it survives greyscale printing
and red-green colour vision deficiency, which a two-colour solid scheme does
not. The component never inverts it, including in stacked and line modes.

**Default Y scale is `zero`, not `auto`.** Auto-scaling clips the axis to the
data range, which inflates a 3% miss into something that looks like a collapse.
That is how a healthy month gets escalated in a board meeting. Auto is still
available in the config; it is just not the default.

---

## One thing found while testing

Binary floating point makes `220 / 200 * 100` evaluate to `110.00000000000001`,
and by the same mechanism a row that hit plan exactly can land on
`99.99999999999999`. Against a threshold of 100 that row is classified "watch"
instead of "on target" — a badge flips colour because of representation error,
not performance.

`attainmentSeries()` rounds to six decimal places, far finer than any threshold
anyone will set. **The same bug exists anywhere else the codebase divides for a
ratio and compares against a boundary** — worth grepping for during the code
review.

---

## Test suite status

`npx vitest run` → **217 passed, 1 failed (21 files)**.

The failure is `tests/DashboardScreen.test.tsx:35`, looking for a
"Finished Goods Coverage Matrix by Category" heading. **It was already failing
before any of this work** — I verified by stashing the new files and re-running.
It is unrelated to this increment, but it means your suite is currently red, so
a real regression would not stand out. Worth fixing early.

---

## Not built yet

- `SettingsScreen.tsx` — the editor UI over `app_text` and `app_settings`
- `MonthCloseScreen.tsx` — scorecard, readiness gate, snapshot writer
- `ChartConfigPanel.tsx` — the Excel-style format pane
- Export of MPS / production plan / MRP from a closed snapshot

Those all sit on the four files here. The migration and the `MONTH_MAP` fix are
the two that should go in first — the second one is live and wrong right now.
