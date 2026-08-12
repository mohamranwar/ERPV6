-- =============================================================================
-- Migration 002: RM forecast variance freeze and reason tracking
-- =============================================================================
-- Phase 4 of the RM Forecast vs PO plan.
--
-- Two additions:
--
-- 1. Variance summary columns on period_snapshots. When a period is closed,
--    the variance figures at that moment are frozen alongside the coverage
--    and production numbers that were already there. Without this, editing
--    an old PO or re-running MRP changes the historical variance, which
--    makes a variance report worse than useless -- people act on numbers
--    that later silently change.
--
-- 2. variance_reasons table. Records WHY a variance happened, per material
--    per period. A report that tells you what diverged but never why gets
--    the same questions re-asked every month.
--
-- Both are additive and idempotent. Running this twice is safe.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Extend period_snapshots with variance summary
-- -----------------------------------------------------------------------------

alter table public.period_snapshots
  add column if not exists variance_baseline_value  numeric  default 0,
  add column if not exists variance_actual_value    numeric  default 0,
  add column if not exists variance_value           numeric  default 0,
  add column if not exists variance_pct             numeric,         -- null = no baseline
  add column if not exists variance_off_plan_count  integer  default 0,
  add column if not exists variance_not_ordered_count integer default 0,
  add column if not exists variance_unplanned_count integer  default 0,

  -- The full per-material detail, frozen as JSONB so it cannot be recomputed
  -- from live tables. Each element mirrors VarianceRow from the service:
  --   { materialId, materialSku, materialName, supplierId,
  --     baselineQty, currentForecastQty, actualQty,
  --     forecastDriftQty, orderVarianceQty, orderVariancePct,
  --     baselineValue, actualValue, orderVarianceValue,
  --     flag, band, matchedPoNumbers }
  add column if not exists variance_detail          jsonb    not null default '[]'::jsonb,

  -- Which MRP run was the baseline at the moment of close. Stored separately
  -- from mrp_run_id (which is the run used for production planning) because
  -- they may differ.
  add column if not exists variance_baseline_run_id text;


-- -----------------------------------------------------------------------------
-- 2. variance_reasons table
-- -----------------------------------------------------------------------------

create table if not exists public.variance_reasons (
  id            text        primary key default gen_random_uuid()::text,

  -- Period this reason covers. Always YYYY-MM-01 to match period_snapshots.
  period        text        not null,

  -- Which material the reason applies to.
  material_id   text        not null,

  -- Who recorded it and when.
  recorded_at   timestamptz not null default now(),
  recorded_by   text,

  -- A structured code for aggregating across months. Free text is searched;
  -- codes can be grouped, counted and trended.
  reason_code   text        not null check (reason_code in (
    'supplier_moq',        -- Supplier minimum order quantity forced a different qty
    'price_break',         -- Larger order taken to capture a volume discount
    'late_demand_change',  -- Sales plan changed after the MRP baseline was frozen
    'stock_correction',    -- Physical count corrected opening stock, changing net req
    'substitution',        -- Alternative material used; original not ordered
    'procurement_deferral',-- Order deliberately pushed to next period
    'other'
  )),

  -- Free text mandatory even for structured codes, because "supplier_moq"
  -- alone does not record WHICH supplier, HOW MUCH the gap was, or whether
  -- any action is needed next month.
  notes         text        not null check (length(trim(notes)) > 0),

  -- Snapshot of the variance figures at the time of recording, so a later
  -- edit to a PO cannot change what the reason was recorded against.
  baseline_qty  numeric     not null default 0,
  actual_qty    numeric     not null default 0,
  variance_qty  numeric     not null default 0
);

-- Fast lookups by period (monthly report) and by material (trend over time).
create index if not exists variance_reasons_period_idx
  on public.variance_reasons (period desc);

create index if not exists variance_reasons_material_idx
  on public.variance_reasons (material_id, period desc);


-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table public.variance_reasons enable row level security;

-- Mirrors the pattern from migration 001: planners can read and write;
-- viewers can only read; admin can do anything.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'variance_reasons' and policyname = 'planner_all'
  ) then
    create policy planner_all on public.variance_reasons
      for all
      using  (has_app_role(auth.uid(), array['admin','planner']))
      with check (has_app_role(auth.uid(), array['admin','planner']));
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'variance_reasons' and policyname = 'viewer_select'
  ) then
    create policy viewer_select on public.variance_reasons
      for select
      using (has_app_role(auth.uid(), array['admin','planner','viewer']));
  end if;
end $$;
