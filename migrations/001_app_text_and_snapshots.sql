-- ============================================================================
-- Migration 001 — App text + period snapshots
-- ----------------------------------------------------------------------------
-- Adds the two tables the Settings screen and Month Close screen need.
-- Follows the conventions already in schema.sql: text primary keys, the
-- current_app_role() / has_app_role() helpers, and the same four-policy shape.
--
-- Safe to run more than once.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. app_text
--    Every user-visible string in the app, addressed by a stable dotted key.
--
--    The key is what the code references and never changes. `value_en` and
--    `value_ar` are what people read and can be edited freely from Settings.
--    This split is the whole point: renaming "MPS Production" to "Production
--    Plan" must not touch a ScreenID, a column name, or an export header.
--
--    `default_en` holds the shipped wording so Settings can offer a reset and
--    show which strings have been customised. It is written by the seed below
--    and by future migrations, never by the app.
-- ----------------------------------------------------------------------------
create table if not exists public.app_text (
  key         text primary key,
  group_name  text not null,
  description text not null,
  value_en    text not null,
  value_ar    text,
  default_en  text not null,
  sort_order  integer default 0,
  updated_at  timestamptz default now(),
  updated_by  text
);

create index if not exists app_text_group_idx on public.app_text (group_name, sort_order);


-- ----------------------------------------------------------------------------
-- 2. period_snapshots
--    One row per closed month. This is the historical table every chart reads
--    from, and the reason a closed month can never drift.
--
--    Two decisions worth stating, because both are easy to get wrong later:
--
--    a) Quantities are stored in PIECES, with pack counts kept in
--       `category_breakdown`. Cartons are derived on read. Storing both
--       invites the two to disagree, and once they do nobody trusts either.
--       Keeping the pack count means last year's carton figures stay correct
--       even if a pack size changes.
--
--    b) `thresholds_applied` freezes the attainment and coverage bands that
--       were in force at close. Without it, editing a band in Settings next
--       year silently repaints the colour of every historical month.
-- ----------------------------------------------------------------------------
create table if not exists public.period_snapshots (
  id                    text primary key,
  period                text not null unique,          -- 'YYYY-MM-01'
  status                text not null default 'closed'
                          check (status in ('closed','locked')),
  closed_at             timestamptz default now(),
  closed_by             text,
  reopened_at           timestamptz,
  reopened_by           text,
  reopen_count          integer default 0,
  notes                 text,

  -- Raw material coverage = value on hand / monthly consumption value
  rm_inventory_value    numeric default 0,
  rm_consumption_value  numeric default 0,
  rm_in_transit_value   numeric default 0,
  rm_coverage_months    numeric default 0,             -- stock only
  rm_coverage_total     numeric default 0,             -- incl. in transit

  -- Finished goods. Pieces are authoritative; cartons derive from pack count.
  fg_stock_pcs          numeric default 0,
  fg_sales_pcs          numeric default 0,
  fg_coverage_months    numeric default 0,

  -- Purchase orders
  po_total              integer default 0,
  po_delayed            integer default 0,
  po_raised             integer default 0,
  po_closed             integer default 0,
  po_open_value         numeric default 0,

  -- Logistics
  containers_total      integer default 0,
  containers_sea        integer default 0,
  containers_air        integer default 0,
  containers_land       integer default 0,
  containers_cleared    integer default 0,
  containers_at_port    integer default 0,
  avg_clearance_days    numeric default 0,

  -- Totals in pieces
  sales_plan_pcs        numeric default 0,
  sales_actual_pcs      numeric default 0,
  prod_plan_pcs         numeric default 0,
  prod_actual_pcs       numeric default 0,

  -- Per-category detail. Array of objects, each carrying its own pack count:
  --   { category_id, category_name, pcs_per_carton,
  --     sales_plan_pcs, sales_actual_pcs,
  --     prod_plan_pcs,  prod_actual_pcs,
  --     fg_stock_pcs }
  category_breakdown    jsonb   not null default '[]'::jsonb,

  -- Bands in force at the moment of close.
  thresholds_applied    jsonb   not null default '{}'::jsonb,

  -- Readiness result at close, so a later reviewer can see what was waived.
  readiness             jsonb   not null default '[]'::jsonb,

  mrp_run_id            text,
  row_counts            jsonb   not null default '{}'::jsonb
);

create index if not exists period_snapshots_period_idx
  on public.period_snapshots (period desc);


-- ----------------------------------------------------------------------------
-- 3. app_settings
--    Single-row key/value store for thresholds, calendar and format options.
--    Kept separate from app_text so a wording change and a threshold change
--    are never the same write.
-- ----------------------------------------------------------------------------
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz default now(),
  updated_by  text
);


-- ----------------------------------------------------------------------------
-- 4. settings_audit
--    Append-only. Answers "why did this chart change colour" six weeks later.
--    No update or delete policy is granted, by design.
-- ----------------------------------------------------------------------------
create table if not exists public.settings_audit (
  id          bigserial primary key,
  changed_at  timestamptz default now(),
  changed_by  text,
  scope       text not null,          -- 'app_text' | 'app_settings' | 'period'
  target_key  text not null,
  old_value   text,
  new_value   text
);

create index if not exists settings_audit_time_idx
  on public.settings_audit (changed_at desc);


-- ============================================================================
-- 5. Row level security
--    Same shape as the data tables in schema.sql, with two deliberate changes:
--      - period_snapshots delete is admin only (it is history)
--      - settings_audit is insert + select only, never updated or deleted
-- ============================================================================

do $$
declare
  t text;
  tbls text[] := array['app_text','period_snapshots','app_settings'];
begin
  foreach t in array tbls loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);

    execute format($p$
      create policy %I on public.%I for select to authenticated
        using (public.has_app_role('viewer'))
    $p$, t || '_sel', t);

    execute format($p$
      create policy %I on public.%I for insert to authenticated
        with check (public.has_app_role('planner'))
    $p$, t || '_ins', t);

    execute format($p$
      create policy %I on public.%I for update to authenticated
        using (public.has_app_role('planner'))
        with check (public.has_app_role('planner'))
    $p$, t || '_upd', t);

    execute format($p$
      create policy %I on public.%I for delete to authenticated
        using (public.has_app_role('admin'))
    $p$, t || '_del', t);
  end loop;
end $$;

-- Audit log: anyone active may read it, planners may append, nobody edits it.
alter table public.settings_audit enable row level security;
alter table public.settings_audit force row level security;

drop policy if exists settings_audit_sel on public.settings_audit;
drop policy if exists settings_audit_ins on public.settings_audit;

create policy settings_audit_sel on public.settings_audit
  for select to authenticated using (public.has_app_role('viewer'));

create policy settings_audit_ins on public.settings_audit
  for insert to authenticated with check (public.has_app_role('planner'));


-- ============================================================================
-- 6. Seed the shipped wording
--    on conflict updates default_en only, so a migration can correct the
--    shipped copy without overwriting a rename someone made in Settings.
-- ============================================================================

insert into public.app_text (key, group_name, description, value_en, default_en, sort_order) values
  -- Header & footer
  ('app.name',              'header_footer', 'App name',              'Sanita Supply Chain Planner',        'Sanita Supply Chain Planner',        10),
  ('app.tagline',           'header_footer', 'Header tagline',        'Planning & logistics control tower', 'Planning & logistics control tower', 20),
  ('app.header.period',     'header_footer', 'Header period caption', 'Rolling 12 months',                  'Rolling 12 months',                  30),
  ('app.footer.left',       'header_footer', 'Footer left',           'Sanita Egypt · Planning Department', 'Sanita Egypt · Planning Department', 40),
  ('app.footer.center',     'header_footer', 'Footer centre',         'Data refreshed every 15 minutes',    'Data refreshed every 15 minutes',    50),
  ('app.footer.right',      'header_footer', 'Footer right',          'Support: planning@sanita.example',   'Support: planning@sanita.example',   60),
  ('app.footer.version',    'header_footer', 'Footer version',        'v2.4',                               'v2.4',                               70),

  -- Menu groups
  ('nav.group.planning',    'nav_groups',    'Group 1',               'Planning Desk',                      'Planning Desk',                      10),
  ('nav.group.supply',      'nav_groups',    'Group 2',               'Supply & Logistics',                 'Supply & Logistics',                 20),
  ('nav.group.controls',    'nav_groups',    'Group 3',               'Controls',                           'Controls',                           30),

  -- Menu items
  ('nav.dashboard',         'nav_items',     'Dashboard',             'Dashboard',                          'Dashboard',                          10),
  ('nav.bom',               'nav_items',     'BOM',                   'BOM',                                'BOM',                                20),
  ('nav.sales_plan',        'nav_items',     'Sales demand',          'Sales Demand',                       'Sales Demand',                       30),
  ('nav.export_forecast',   'nav_items',     'Export order',          'Export Order',                       'Export Order',                       40),
  ('nav.production_plan',   'nav_items',     'MPS production',        'MPS Production',                     'MPS Production',                     50),
  ('nav.mrp',               'nav_items',     'MRP engine',            'MRP Engine',                         'MRP Engine',                         60),
  ('nav.coverage',          'nav_items',     'Stock coverage',        'Stock Coverage',                     'Stock Coverage',                     70),
  ('nav.logistics',         'nav_items',     'Purchase orders',       'Purchase Orders (PO)',               'Purchase Orders (PO)',               80),
  ('nav.customs_clearance', 'nav_items',     'Customs clearance',     'Customs Clearance',                  'Customs Clearance',                  90),
  ('nav.plan_vs_actual',    'nav_items',     'Plan vs actuals',       'Plan vs Actuals',                    'Plan vs Actuals',                   100),
  ('nav.master_data',       'nav_items',     'Master data',           'Master Data',                        'Master Data',                       110),
  ('nav.csv_importer',      'nav_items',     'Import hub',            'Import Hub',                         'Import Hub',                        120),
  ('nav.settings',          'nav_items',     'Settings',              'Settings',                           'Settings',                          130),
  ('nav.month_close',       'nav_items',     'Month close',           'Month Close',                        'Month Close',                       140),

  -- Page titles
  ('page.dashboard.title',  'page_titles',   'Dashboard title',       'Supply chain dashboard',             'Supply chain dashboard',             10),
  ('page.dashboard.sub',    'page_titles',   'Dashboard subtitle',    'Live position across demand, supply and logistics', 'Live position across demand, supply and logistics', 20),
  ('page.mrp.title',        'page_titles',   'MRP title',             'Material Requirements Planning',     'Material Requirements Planning',     30),
  ('page.coverage.title',   'page_titles',   'Coverage title',        'Stock Coverage',                     'Stock Coverage',                     40),
  ('page.logistics.title',  'page_titles',   'PO title',              'Purchase Order Follow-up',           'Purchase Order Follow-up',           50),
  ('page.close.title',      'page_titles',   'Month close title',     'Month Close',                        'Month Close',                        60),
  ('page.close.sub',        'page_titles',   'Month close subtitle',  'Freeze a period so history stops moving', 'Freeze a period so history stops moving', 70),

  -- Columns
  ('col.sku',               'columns',       'SKU column',            'SKU',                                'SKU',                                10),
  ('col.material',          'columns',       'Material column',       'Material',                           'Material',                           20),
  ('col.supplier',          'columns',       'Supplier column',       'Supplier',                           'Supplier',                           30),
  ('col.onhand',            'columns',       'On hand column',        'On hand',                            'On hand',                            40),
  ('col.intransit',         'columns',       'In transit column',     'In transit',                         'In transit',                         50),
  ('col.coverage',          'columns',       'Coverage column',       'Coverage',                           'Coverage',                           60),
  ('col.plan',              'columns',       'Plan column',           'Plan',                               'Plan',                               70),
  ('col.actual',            'columns',       'Actual column',         'Actual',                             'Actual',                             80),
  ('col.variance',          'columns',       'Variance column',       'Variance',                           'Variance',                           90),
  ('col.attainment',        'columns',       'Attainment column',     'Attainment',                         'Attainment',                        100),
  ('col.required_date',     'columns',       'Required date column',  'Required date',                      'Required date',                     110),

  -- Buttons
  ('btn.save',              'buttons',       'Save',                  'Save changes',                       'Save changes',                       10),
  ('btn.discard',           'buttons',       'Discard',               'Discard',                            'Discard',                            20),
  ('btn.export',            'buttons',       'Export',                'Export',                             'Export',                             30),
  ('btn.import',            'buttons',       'Import',                'Import data',                        'Import data',                        40),
  ('btn.run_mrp',           'buttons',       'Run MRP',               'Run MRP',                            'Run MRP',                            50),
  ('btn.close_month',       'buttons',       'Close month',           'Close month',                        'Close month',                        60),
  ('btn.reopen',            'buttons',       'Reopen',                'Reopen',                             'Reopen',                             70),

  -- Statuses
  ('status.ok',             'statuses',      'On target',             'On target',                          'On target',                          10),
  ('status.watch',          'statuses',      'Watch',                 'Watch',                              'Watch',                              20),
  ('status.risk',           'statuses',      'Short',                 'Short',                              'Short',                              30),
  ('status.oos',            'statuses',      'Stockout risk',         'Stockout risk',                      'Stockout risk',                      40),
  ('status.transit',        'statuses',      'In transit',            'In transit',                         'In transit',                         50),
  ('status.pending',        'statuses',      'Pending',               'Pending',                            'Pending',                            60),
  ('status.cleared',        'statuses',      'Cleared',               'Cleared',                            'Cleared',                            70),
  ('status.delayed',        'statuses',      'Delayed',               'Delayed',                            'Delayed',                            80),

  -- Messages
  ('empty.no_data',         'messages',      'No data',               'Nothing to show yet',                'Nothing to show yet',                10),
  ('empty.no_data.sub',     'messages',      'No data detail',        'Import a plan or adjust your filters to see rows here.', 'Import a plan or adjust your filters to see rows here.', 20),
  ('empty.no_results',      'messages',      'No search results',     'No matches',                         'No matches',                         30),
  ('msg.saved',             'messages',      'Saved toast',           'Changes saved',                      'Changes saved',                      40),
  ('msg.readonly',          'messages',      'Read-only notice',      'This view is read-only while All Channels is selected', 'This view is read-only while All Channels is selected', 50),
  ('msg.close_warn',        'messages',      'Close warning',         'Closing writes a permanent snapshot. An admin can reopen it.', 'Closing writes a permanent snapshot. An admin can reopen it.', 60)
on conflict (key) do update
  set default_en  = excluded.default_en,
      group_name  = excluded.group_name,
      description = excluded.description,
      sort_order  = excluded.sort_order;


-- Default thresholds. Mirrors what the code currently hardcodes, so applying
-- this migration changes no behaviour on day one.
insert into public.app_settings (key, value) values
  ('thresholds', '{
     "attainment_ok": 100,
     "attainment_watch": 95,
     "rm_coverage_ok_months": 3.0,
     "fg_coverage_ok_months": 1.5,
     "capacity_warning_pct": 95,
     "po_on_time_target_pct": 95
   }'::jsonb),
  ('calendar', '{
     "fiscal_year_start_month": 7,
     "week_starts_on": 0,
     "planning_horizon_months": 12,
     "history_retention_months": 36
   }'::jsonb),
  ('formats', '{
     "thousands_separator": ",",
     "decimal_places": 1,
     "large_number_scale": 1000000,
     "date_format": "DD-MMM-YY",
     "currency": "EGP",
     "default_quantity_unit": "pcs"
   }'::jsonb)
on conflict (key) do nothing;
