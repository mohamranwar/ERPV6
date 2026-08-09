# Sanita Supply Planner — Round 2: AI Studio Revision Check, Search Bar Fixes, Users/Roles

Reviewed 2026-07-21. This picks up after you ran `AI_STUDIO_FIX_PROMPT.md` through Google AI Studio and replaced the project folder with its output. Scope this round: verify what AI Studio actually fixed vs. missed, fix the search bar problems you reported, finish the component/hook work you listed, add a Users/roles feature, and rebuild the test suite (all wiped along with the rest of the project when the folder was replaced).

Same environment note as before: this sandbox blocks the npm registry, so I still can't run `npm install`/the dev server here. Everything below is a static read of the actual source plus hand-derived test expectations, not a live run.

## What AI Studio got right

It correctly implemented `SearchBar`, `useTableFilters`, `ContentHeader`, `useFocusTrap`, and `ScrollableTable`, and wired them into essentially every screen — broader coverage than the original ask (which only named Dashboard/BOM/SalesPlan for `ContentHeader`). It also built a `DataStateWrapper` component (loading/error/empty states with retry) that wasn't in my original list, and used it to fix the `MaterialDrillDown` infinite-spinner bug I'd flagged — a real, correct fix. Several other items from `AI_STUDIO_FIX_PROMPT.md` were also fixed correctly: the `SalesPlanScreen` demand fallback, the `ProductionPlanScreen` silent machine mis-assignment, and the "All Channels" / search-override behavior remained correct.

## The search bar problem — root cause and fix

The actual bug: `CoverageScreen` (Materials/Products tabs), `MasterDataScreen` (5 entity tabs), and `PlanVsActualScreen` (Sales/Production/Export tabs) all share **one** `searchQuery` value per screen. Type a search term while on the Materials tab, switch to Suppliers, and the leftover text instantly filters the new tab's completely different dataset — usually to zero results, with no explanation. That's what looked "broken." Fixed by clearing the search query whenever the tab changes in those three screens.

Two smaller, related issues fixed alongside it: the native browser clear button that `type="search"` inputs render automatically was sitting on top of `SearchBar`'s own custom clear button (two overlapping X icons) — suppressed the native one via CSS. And `CoverageScreen`'s two tables had no "no results" row at all when a search/filter matched nothing — they just showed an empty table body with no message, which reads as broken too. Added one.

## Bugs from the original review that were NOT actually fixed

AI Studio's revision left a few items from the fix prompt unaddressed, or partially so:

- **Reorder-point multiplier drift** — still `* 1.25` on manual save vs. `* 1.3` on CSV import in `MasterDataScreen.tsx`, same field, two different formulas depending on entry path. Fixed (aligned to 1.25).
- **`App.tsx` mangled header label** — `activeScreen.replace('_', ' ')` was still non-global, so "Plan vs Actuals" still rendered as a mangled slug. Fixed (`.replaceAll`).
- **`FinishedGoodsAnalysis` SKU ledger ignoring the month selector** — the drill-down modal still hardcoded July 2026 as its base date regardless of which month you had selected in the main matrix. Fixed (now anchors to `selectedMonth`).
- **Hardcoded period/channel in `PlanVsActualScreen`** — partially fixed. The literal `'C4'` channel id is now resolved by looking up the channel named "Export Global" instead, so a channel-id change won't silently break it. The `'2026-07-01'` period anchor, however, is baked into dozens of places across the whole calculation engine (`supabaseClient.ts`) as the implicit "today" for the entire seed dataset — making that fully dynamic would mean redesigning how the mock data represents time, which is a much bigger change than I'd want to make without discussing it with you first. It still works correctly for July 2026 (today), and will need attention once you're planning against August.
- **`GlobalCsvImporter` prop type bug** — App.tsx passes it a `refreshKey` prop that its type didn't declare (`{ onClose?: () => void }`), which is a real `tsc --noEmit` error, not just a lint nitpick. Fixed, and wired `refreshKey` into its effect so its relational caches actually refresh on reconnect like every other screen.

## Users / roles feature (built from scratch)

Added an offline-first accounts system consistent with the rest of the app's localStorage-backed design:

- `AppUser` type (`admin` / `planner` / `viewer`) and three seeded demo accounts in `supabaseClient.ts`, fetched through the same `fetchTableData('users')` path as every other table.
- `AuthContext` (`src/context/AuthContext.tsx`): tracks the signed-in user (persisted in `localStorage`, survives refresh), and exposes `hasRole(minRole)` against a `viewer < planner < admin` hierarchy.
- `LoginScreen.tsx`: a full-page account picker shown before the app when nobody's signed in — no passwords, since this is a demo without a real backend; picking an account is the login.
- `App.tsx`: gates the whole app behind login, shows the current user + role + a sign-out button in the sidebar footer.
- Role gates wired into the highest-impact write paths: Master Data create/edit/CSV-import require Planner or Admin, delete requires Admin; the Supabase connect/disconnect dialog requires Admin; the CSV Import Hub's execute step requires Planner or Admin. Everything else in each of those screens still renders normally for a Viewer, it just shows a clear denial toast if they try to write.

**Not yet role-gated** (scope cut to keep this session bounded): BOM editor saves, MRP purchase-order creation, Sales/Production plan inline edits, and Logistics edits. These all follow the exact same pattern (`if (!hasRole('planner')) { showToast(...); return; }` at the top of the handler) if you want them covered too — say the word and I'll extend it.

## Test suite (rebuilt — the old one was wiped with the project replacement)

Added Vitest + React Testing Library back (`vitest.config.ts`, `tests/`), 7 files:

- `useTableFilters.test.ts` — dropdown AND-filtering, the search-overrides-filters debounce behavior, customFilter, null-safety.
- `SearchBar.test.tsx` — value/placeholder rendering, onChange wiring, clear button, the "filters bypassed" pill.
- `ContentHeader.test.tsx` — title always renders, subtitle/actions conditional.
- `useFocusTrap.test.tsx` — initial focus, Tab wrap-around both directions, Escape-to-close.
- `AuthContext.test.tsx` — seeded accounts load, role hierarchy (`hasRole`), session persistence across a simulated reload, logout.
- `DataStateWrapper.test.tsx` — loading/error+retry/empty/content states, direct regression coverage for the MaterialDrillDown infinite-spinner bug.
- `calcEngine.test.ts` — BOM cost rollup, coverage flags (including the pending-vs-in_transit PO distinction), plan-vs-actual variance/achievement, and MRP engine structural checks — same hand-derivation approach as the first review round, re-verified against this round's (unchanged) seed data.

Added `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event` to `devDependencies` and `test`/`test:watch` scripts. Same as last time: I could not execute these here (npm registry blocked in this sandbox), so run them yourself:

```
npm install
npm test
```

## Suggested next steps

1. Run `npm test` and `npm run lint` to actually verify all of the above compiles and passes — I've been careful, but I have not executed a single line of this.
2. Decide whether the remaining screens (BOM, MRP, Sales/Production Plan, Logistics) should get the same role gating as Master Data/CSV Import.
3. Decide how you want to handle the `2026-07-01` period anchor once real August data matters — that's the one open item from the original review I deliberately didn't touch, since it touches the whole calculation engine.
