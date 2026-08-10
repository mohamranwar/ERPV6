# Build increment 2 — Settings, Month Close, snapshot service

Everything below is verified against the real repository: `npx tsc --noEmit`
clean, and the new tests pass **49/49** (30 periods + 19 month-close, one of
which became 20 after a mid-build improvement — see the shipment note).

Increment 1 (migration, `periods.ts`, `AppTextContext.tsx`, `ChartBuilder.tsx`)
is unchanged and still required. Apply it first.

| File | Goes to | What it does |
|---|---|---|
| `src/hooks/useAppSettings.ts` | `src/hooks/` | Thresholds / calendar / formats with per-field audit |
| `src/components/SettingsScreen.tsx` | `src/components/` | Full settings UI: app text editor, thresholds with effect preview, calendar, formats, audit |
| `src/components/MonthCloseScreen.tsx` | `src/components/` | Period scorecard, readiness gate, history table |
| `src/services/monthClose.ts` | `src/services/` (new dir) | Builds the scorecard from live tables, runs the gate, writes the snapshot, exports |
| `tests/monthClose.test.ts` | `tests/` | 20 tests over the service |
| `tests/periods.test.ts` | `tests/` | Updated: the duplicate `toCartons` was removed (see below) |

---

## Wiring it into App.tsx

Two new screens. Add the IDs, lazy imports and nav entries:

```tsx
// ScreenID union: add 'settings' and 'month_close'

const SettingsScreen  = lazy(() => import('./components/SettingsScreen'));
const MonthCloseScreen = lazy(() => import('./components/MonthCloseScreen'));

// In NAV_GROUPS, a "Controls" group:
{ label: t('nav.group.controls'), items: [
  { id: 'settings',    label: t('nav.settings'),    icon: Settings },
  { id: 'month_close', label: t('nav.month_close'), icon: Lock },
]}
```

`MonthCloseScreen` is presentational; the container wires it to the service:

```tsx
import {
  readScorecardInputs, buildScorecard, runReadiness,
  writeSnapshot, readSnapshotHistory, exportPeriodCsv, exportPlanningDataCsv,
} from '../services/monthClose';
import { getPlanningPeriod } from '../supabaseClient';
import { useAppSettings } from '../hooks/useAppSettings';

function MonthCloseContainer() {
  const { settings } = useAppSettings();
  const { user } = useAuth();

  const inputs    = useMemo(() => readScorecardInputs(getPlanningPeriod()), []);
  const scorecard = useMemo(() => buildScorecard(inputs), [inputs]);
  const readiness = useMemo(() => runReadiness(inputs, scorecard), [inputs, scorecard]);
  const [history, setHistory] = useState(readSnapshotHistory);

  return (
    <MonthCloseScreen
      scorecard={scorecard}
      readiness={readiness}
      history={history}
      canClose={user?.role !== 'viewer'}
      canReopen={user?.role === 'admin'}
      onClose={async () => {
        await writeSnapshot({
          scorecard, readiness,
          thresholds: settings.thresholds,
          userId: user?.id ?? 'unknown',
        });
        setHistory(readSnapshotHistory());
      }}
      onExportPeriod={exportPeriodCsv}
      onExportScorecard={() => exportPlanningDataCsv(scorecard.period)}
    />
  );
}
```

For `SettingsScreen`, pass the current month's category attainment as
`previewRows` so the threshold effect preview shows real consequences:

```tsx
<SettingsScreen previewRows={scorecard.categories.map(c => ({
  label: c.categoryName,
  attainment: c.salesPlanPcs > 0 ? c.salesActualPcs / c.salesPlanPcs * 100 : 0,
}))} />
```

---

## Decisions you should know about (and can overrule)

**The readiness gate has exactly three hard blockers**: no sales actuals, no
production actuals, open POs without a required date. Everything else — uncosted
materials, missing pack configs, containers at port — is a warning recorded
into the snapshot. This is deliberate: a long fussy checklist gets overridden
as a habit, and then it protects nothing. Warnings are stored so a reviewer can
see later what was accepted.

**Categories with mixed pack sizes refuse to show cartons.** If Wet Wipes
contains a 240-piece product and a 480-piece product, there is no single
divisor, and dividing the summed pieces by either one prints a confident but
wrong carton figure. The screen shows "no pack configuration" and the carton
*total* excludes the category (with a banner saying so) rather than counting it
as zero — a silent zero understates the total and nobody notices.

**RM consumption value uses `max_usage`.** Your `Material` type carries
`max_usage` (maximum monthly usage), which the coverage screens already plan
against, so value coverage uses the same conservative basis. If you'd rather
derive consumption from this month's actual production via BOM explosion,
that's a bigger computation and belongs in the MRP engine — say the word.

**`factory_arrival_date` is the landed signal.** A shipment with an arrival
date on or before month end has landed; one without is in transit, whatever its
ETA said. My first draft inferred clearance from ETA + clearance days; the
explicit field in your schema is strictly better and the service now uses it.

**Uncosted materials contribute zero to RM value, and the gate says so.** The
alternative — inventing a cost — produces a coverage figure nobody can audit.
The warning names the count so the valuation gap is visible in the snapshot.

---

## A duplication I removed from increment 1

`periods.ts` originally shipped its own `toCartons(pieces, pcsPerCarton)`. Your
`src/utils/uom.ts` already owns that conversion — and its contract is better:
`pcsPerCarton()` returns **null** for a product with missing pack config, where
mine silently returned pieces unchanged, which would have printed a piece
figure under a "cartons" heading. Two implementations of one conversion is
exactly how they come to disagree, so mine is gone and everything imports from
`uom.ts`. The updated `periods.ts` and `periods.test.ts` in this increment
reflect that — use these versions, not increment 1's.

---

## Test suite status

New tests: `tests/monthClose.test.ts` 20/20, `tests/periods.test.ts` 29/29.

Full suite: **264 passed, 1 failed** — the same pre-existing
`DashboardScreen.test.tsx` failure flagged in increment 1, unrelated to this
work. Still worth fixing so real regressions stand out.

---

## What remains

- **ChartConfigPanel** — the Excel-style format pane UI wrapping
  `ChartBuilder`'s config object, persisted per user per chart
- **Wiring charts into `PlanVsActualScreen`** (currently tables only) and the
  dashboard
- **The `MONTH_MAP` fix** in `ExecutiveCharts.tsx` — the code for it is in
  increment 1's guide; it is still the most urgent single change
- The **code review** you asked for as phase three
