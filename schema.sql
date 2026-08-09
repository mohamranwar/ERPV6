-- ============================================================================
--  Sanita Supply Chain Planner — Postgres / Supabase schema
--  Run this in the Supabase SQL editor BEFORE connecting the app
--  (Settings dialog → Database Integration).
--
--  Contents
--    1. Master data tables
--    2. BOM structure
--    3. Planning & actuals
--    4. Inventory, purchasing, logistics
--    5. Customs clearance
--    6. MRP output
--    7. Application users (linked to Supabase Auth)
--    8. Indexes
--    9. Row Level Security — the real authorization boundary
--   10. Bootstrapping your first admin
--
--  IMPORTANT — why section 9 matters
--  The React app performs role checks (hasRole('planner') etc.) before every
--  write. Those checks are a UX affordance ONLY: they run in the browser and
--  anyone can bypass them from devtools. The policies in section 9 are what
--  actually enforce authorization, because they run inside Postgres where the
--  user cannot reach. Do not skip them.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Master data
-- ----------------------------------------------------------------------------

create table if not exists public.suppliers (
  id                             text primary key,
  name                           text not null,
  default_lead_time_days         integer not null default 0,
  default_transit_days           integer not null default 0,
  default_customs_clearance_days integer not null default 0,
  status                         text not null default 'active'
                                   check (status in ('active','inactive'))
);

create table if not exists public.channels (
  id     text primary key,
  name   text not null,
  status text not null default 'active' check (status in ('active','inactive'))
);

create table if not exists public.machines (
  id               text primary key,
  name             text not null,
  description      text default '',
  monthly_capacity numeric
);

create table if not exists public.product_categories (
  id   text primary key,
  name text not null
);

create table if not exists public.product_groups (
  id          text primary key,
  name        text not null,
  category_id text references public.product_categories(id) on delete set null
);

create table if not exists public.products (
  id              text primary key,
  name            text not null,
  sku             text not null,
  description     text default '',
  group_id        text references public.product_groups(id)     on delete set null,
  category_id     text references public.product_categories(id) on delete set null,
  brand           text default '',
  variant         text default '',
  product_line    text default '',
  pack_type       text default '',
  size            text default '',
  status          text not null default 'running'
                    check (status in ('running','obsolete')),
  pcs_per_bag     numeric default 0,
  bags_per_carton numeric default 0,
  selling_price   numeric not null default 0,
  standard_cost   numeric not null default 0,
  uom             text default 'PCS'
);

create table if not exists public.material_categories (
  id             text primary key,
  name           text not null,
  material_group text not null check (material_group in ('RM','PK','CON'))
);

create table if not exists public.materials (
  id                      text primary key,
  name                    text not null,
  sku                     text not null,
  description             text default '',
  category_id             text references public.material_categories(id) on delete set null,
  supplier_id             text references public.suppliers(id)           on delete set null,
  origin_type             text check (origin_type in ('local','foreign')),
  supplier_lead_time_days integer not null default 0,
  transit_days            integer not null default 0,
  customs_clearance_days  integer not null default 0,
  -- Maintained by the app as supplier + transit + customs.
  total_lead_time_days    integer not null default 0,
  reorder_point_days      integer not null default 0,
  -- 0 means "size the buffer from lead time"; > 0 is a planner override.
  safety_stock_months     numeric not null default 0,
  moq                     numeric not null default 0,
  max_usage               numeric not null default 0,
  controller              text default '',
  status                  text not null default 'running'
                            check (status in ('running','obsolete')),
  standard_cost           numeric not null default 0,
  cost_basis              text not null default 'standard'
                            check (cost_basis in ('standard','weighted_avg')),
  uom                     text default 'PCS'
);

create table if not exists public.material_alternatives (
  id                      text primary key,
  material_id             text references public.materials(id) on delete cascade,
  alternative_material_id text references public.materials(id) on delete cascade
);

-- Unit-of-measure conversion rules. conversion_factor feeds the BOM explosion,
-- so a wrong row here moves every cost, coverage and MRP figure in the app.
-- A row {from_uom:'KG', to_uom:'Grams', conversion_factor:1000} means
-- 1 KG = 1000 Grams; converting Grams -> KG applies 1/1000.
create table if not exists public.uom_conversions (
  id                text primary key,
  item_type         text default 'global'
                      check (item_type in ('global','material','product')),
  item_id           text,
  from_uom          text not null,
  to_uom            text not null,
  conversion_factor numeric not null check (conversion_factor > 0),
  description       text
);

-- ----------------------------------------------------------------------------
-- 2. BOM structure  (header -> slot -> option)
--    A slot is a function ("top sheet"); its options are the materials that
--    can fill it, ranked by priority. priority = 1 is the primary; anything
--    higher is an approved alternate used only for substitution proposals.
-- ----------------------------------------------------------------------------

create table if not exists public.bom_headers (
  id          text primary key,
  product_id  text references public.products(id) on delete cascade,
  description text default '',
  is_active   boolean not null default true
);

create table if not exists public.bom_slots (
  id        text primary key,
  bom_id    text references public.bom_headers(id) on delete cascade,
  slot_name text not null
);

create table if not exists public.bom_options (
  id            text primary key,
  slot_id       text references public.bom_slots(id) on delete cascade,
  material_id   text references public.materials(id) on delete restrict,
  qty_per_unit  numeric not null default 0,
  scrap_percent numeric not null default 0,
  priority      integer not null default 1,
  -- Consumption UOM. When it differs from materials.uom the engine converts
  -- through uom_conversions (e.g. BOM in Grams, material stocked in KG).
  uom           text
);

-- ----------------------------------------------------------------------------
-- 3. Planning & actuals
-- ----------------------------------------------------------------------------

create table if not exists public.sales_plan (
  id           text primary key,
  product_id   text references public.products(id) on delete cascade,
  channel_id   text references public.channels(id) on delete set null,
  period_type  text not null default 'month'
                 check (period_type in ('day','week','month')),
  period_start date not null,
  quantity     numeric not null default 0
);

create table if not exists public.production_plan (
  id           text primary key,
  product_id   text references public.products(id) on delete cascade,
  machine_id   text references public.machines(id) on delete set null,
  period_type  text not null default 'month'
                 check (period_type in ('day','week','month')),
  period_start date not null,
  quantity     numeric not null default 0
);

create table if not exists public.sales_actual (
  id           text primary key,
  product_id   text references public.products(id) on delete cascade,
  channel_id   text references public.channels(id) on delete set null,
  period_start date not null,
  quantity     numeric not null default 0
);

create table if not exists public.production_actual (
  id           text primary key,
  product_id   text references public.products(id) on delete cascade,
  machine_id   text references public.machines(id) on delete set null,
  period_start date not null,
  quantity     numeric not null default 0
);

-- Export orders. items is JSONB because the app edits the whole order and its
-- line items as one document (ExportOrderLineItem[]).
create table if not exists public.export_forecasts (
  id                    text primary key,
  order_number          text not null,
  country_code          text,
  country_name          text,
  customer_name         text,
  period_start          date,
  target_ship_date      date,
  order_status          text not null default 'draft'
                          check (order_status in ('draft','confirmed','in_production',
                                                  'ready_to_ship','shipped','delivered','on_hold')),
  shipping_port         text,
  container_count       integer,
  payment_term          text,
  lc_reference          text,
  export_license_status text check (export_license_status in ('approved','pending','not_required')),
  merged_to_sales_plan  boolean not null default false,
  notes                 text,
  created_at            timestamptz default now(),
  items                 jsonb not null default '[]'::jsonb
);

-- ----------------------------------------------------------------------------
-- 4. Inventory, purchasing, logistics
-- ----------------------------------------------------------------------------

-- Quantities are in each item's BASE uom (materials.uom / products.uom).
-- Storing a gram-scale number against a material stocked in KG will break
-- coverage, projection and MRP simultaneously.
create table if not exists public.inventory_snapshots (
  id            text primary key,
  item_type     text not null check (item_type in ('product','material')),
  item_id       text not null,
  snapshot_date date not null,
  quantity      numeric not null default 0
);

create table if not exists public.purchase_orders (
  id                     text primary key,
  material_id            text references public.materials(id) on delete restrict,
  supplier_id            text references public.suppliers(id) on delete set null,
  order_no               text not null,
  qty                    numeric not null default 0,
  remaining_qty          numeric not null default 0,
  required_date          date,
  original_delivery_date date,
  revised_delivery_date  date,
  origin_type            text check (origin_type in ('local','foreign')),
  status                 text not null default 'pending'
                           check (status in ('pending','in_transit','completed')),
  timing                 text default 'Normal'
                           check (timing in ('Normal','Need to be Closed','Check with Proc.')),
  po_date                date,
  unit_price             numeric
);

-- factory_arrival_date IS NULL means the shipment is still in transit.
-- A non-null value means it has landed and must no longer count as incoming.
create table if not exists public.shipments (
  id                     text primary key,
  material_id            text references public.materials(id)       on delete restrict,
  supplier_id            text references public.suppliers(id)       on delete set null,
  po_id                  text references public.purchase_orders(id) on delete set null,
  qty                    numeric not null default 0,
  invoice_no             text,
  bl_no                  text,
  container_count        integer,
  ship_method            text check (ship_method in ('sea','air','land')),
  origin_type            text check (origin_type in ('local','foreign')),
  etd                    date,
  port_eta               date,
  port_name              text,
  customs_clearance_days integer default 0,
  original_delivery_date date,
  revised_delivery_date  date,
  factory_arrival_date   date,
  delay                  integer not null default 0
);

-- ----------------------------------------------------------------------------
-- 5. Customs clearance
-- ----------------------------------------------------------------------------

create table if not exists public.clearance_companies (
  id            text primary key,
  name          text not null,
  contact_name  text,
  contact_email text,
  contact_phone text,
  country       text
);

create table if not exists public.clearance_jobs (
  id                   text primary key,
  shipment_id          text references public.shipments(id)           on delete cascade,
  company_id           text references public.clearance_companies(id) on delete set null,
  port_arrival_date    date,
  planned_factory_date date,
  actual_factory_date  date,
  status               text not null default 'pending'
                         check (status in ('pending','in_progress','partial_release','cleared','held')),
  notes                text
);

-- One row per physical container. Modelled separately from the job so a
-- shipment can be partially released: containers move through exam/release/
-- delivery on their own timelines and accrue demurrage individually.
create table if not exists public.clearance_containers (
  id                   text primary key,
  job_id               text references public.clearance_jobs(id) on delete cascade,
  container_no         text not null,
  seal_no              text,
  size_ft              integer check (size_ft in (20,40,45)),
  gross_weight_kg      numeric,
  port_arrival_date    date,
  customs_exam_date    date,
  release_date         date,
  factory_arrival_date date,
  status               text not null default 'pending'
                         check (status in ('pending','under_exam','released','delivered')),
  demurrage_days       integer default 0,
  detention_days       integer default 0
);

create table if not exists public.clearance_documents (
  id             text primary key,
  job_id         text references public.clearance_jobs(id) on delete cascade,
  doc_type       text not null check (doc_type in (
                   'bill_of_lading','commercial_invoice','packing_list',
                   'certificate_of_origin','import_license','phyto_certificate',
                   'customs_declaration','other')),
  doc_ref        text,
  received_date  date,
  submitted_date date,
  approved_date  date,
  status         text not null default 'pending'
                   check (status in ('pending','received','submitted','approved','rejected')),
  notes          text
);

-- Landed-cost reporting only. These charges deliberately do NOT feed BOM cost
-- or margin (decision 2) — no cost or margin figure moves because of them.
create table if not exists public.clearance_charges (
  id           text primary key,
  job_id       text references public.clearance_jobs(id)       on delete cascade,
  container_id text references public.clearance_containers(id) on delete set null,
  charge_type  text not null check (charge_type in (
                 'customs_duty','vat','port_handling','demurrage',
                 'detention','inspection','agency_fee','other')),
  currency     text not null default 'EGP',
  amount       numeric not null default 0,
  paid_date    date,
  notes        text
);

-- ----------------------------------------------------------------------------
-- 6. MRP output & period close
-- ----------------------------------------------------------------------------

create table if not exists public.mrp_results (
  id                     text primary key,
  run_id                 text not null,
  run_date               timestamptz default now(),
  material_id            text references public.materials(id) on delete cascade,
  week_start_date        date not null,
  projected_available    numeric default 0,
  safety_stock           numeric default 0,
  net_requirements       numeric default 0,
  planned_order_releases numeric default 0,
  planned_order_receipts numeric default 0,
  past_due_releases      numeric default 0,
  gross_requirements     numeric default 0,
  scheduled_receipts     numeric default 0
);

create table if not exists public.closed_periods (
  id              text primary key,
  period          text not null,
  run_id          text,
  closed_at       timestamptz default now(),
  closed_by       text,
  grain           text check (grain in ('day','week','month')),
  horizon         integer,
  notes           text,
  total_materials integer default 0,
  at_risk_count   integer default 0,
  planned_value   numeric default 0
);

-- ----------------------------------------------------------------------------
-- 7. Application users
--    auth_user_id links an app user to a Supabase Auth identity. The RLS
--    helper functions below resolve the caller's role through this column,
--    which is why it must be populated for anyone who needs access.
-- ----------------------------------------------------------------------------

create table if not exists public.users (
  id           text primary key,
  name         text not null,
  email        text not null unique,
  role         text not null default 'viewer'
                 check (role in ('admin','planner','viewer')),
  status       text not null default 'active'
                 check (status in ('active','inactive')),
  auth_user_id uuid unique references auth.users(id) on delete cascade
);

-- ----------------------------------------------------------------------------
-- 8. Indexes — every column the planning screens filter or join on
-- ----------------------------------------------------------------------------

create index if not exists idx_materials_supplier    on public.materials(supplier_id);
create index if not exists idx_materials_category    on public.materials(category_id);
create index if not exists idx_products_group        on public.products(group_id);
create index if not exists idx_bom_headers_product   on public.bom_headers(product_id, is_active);
create index if not exists idx_bom_slots_bom         on public.bom_slots(bom_id);
create index if not exists idx_bom_options_slot      on public.bom_options(slot_id, priority);
create index if not exists idx_bom_options_material  on public.bom_options(material_id);
create index if not exists idx_sales_plan_period     on public.sales_plan(period_start, product_id);
create index if not exists idx_prod_plan_period      on public.production_plan(period_start, product_id);
create index if not exists idx_sales_actual_period   on public.sales_actual(period_start, product_id);
create index if not exists idx_prod_actual_period    on public.production_actual(period_start, product_id);
create index if not exists idx_inventory_item        on public.inventory_snapshots(item_type, item_id, snapshot_date desc);
create index if not exists idx_po_material_status    on public.purchase_orders(material_id, status);
create index if not exists idx_shipments_material    on public.shipments(material_id);
-- Partial index: the in-transit lookup only ever asks for un-arrived rows.
create index if not exists idx_shipments_in_transit  on public.shipments(material_id)
  where factory_arrival_date is null;
create index if not exists idx_clearance_jobs_ship   on public.clearance_jobs(shipment_id);
create index if not exists idx_clearance_ctr_job     on public.clearance_containers(job_id);
create index if not exists idx_clearance_doc_job     on public.clearance_documents(job_id);
create index if not exists idx_clearance_chg_job     on public.clearance_charges(job_id);
create index if not exists idx_mrp_run               on public.mrp_results(run_id, material_id);
create index if not exists idx_uom_conv_lookup       on public.uom_conversions(from_uom, to_uom);
create index if not exists idx_users_auth            on public.users(auth_user_id);

-- ============================================================================
-- 9. ROW LEVEL SECURITY
--
--    Role model, mirroring the client exactly:
--      viewer  (rank 1) - read everything, write nothing
--      planner (rank 2) - read + insert/update
--      admin   (rank 3) - read + insert/update + delete
--
--    current_app_role() is SECURITY DEFINER on purpose: the policy on
--    public.users needs to read public.users to resolve the caller's role,
--    which would recurse infinitely under RLS. SECURITY DEFINER runs the
--    lookup as the function owner, bypassing RLS for that one query only.
--    search_path is pinned to prevent search-path hijacking.
-- ============================================================================

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select u.role
       from public.users u
      where u.auth_user_id = auth.uid()
        and u.status = 'active'
      limit 1),
    'none'
  );
$$;

create or replace function public.app_role_rank(r text)
returns integer
language sql
immutable
as $$
  select case r
    when 'admin'   then 3
    when 'planner' then 2
    when 'viewer'  then 1
    else 0
  end;
$$;

-- True when the caller's role is at least min_role.
create or replace function public.has_app_role(min_role text)
returns boolean
language sql
stable
as $$
  select public.app_role_rank(public.current_app_role())
       >= public.app_role_rank(min_role);
$$;

revoke execute on function public.current_app_role()      from anon;
revoke execute on function public.has_app_role(text)      from anon;

-- Apply the standard four policies to every data table in one pass, so a
-- table added later cannot silently ship without RLS.
do $$
declare
  t text;
  data_tables text[] := array[
    'suppliers','channels','machines','product_categories','product_groups',
    'products','material_categories','materials','material_alternatives',
    'uom_conversions','bom_headers','bom_slots','bom_options',
    'sales_plan','production_plan','sales_actual','production_actual',
    'export_forecasts','inventory_snapshots','purchase_orders','shipments',
    'clearance_companies','clearance_jobs','clearance_containers',
    'clearance_documents','clearance_charges','mrp_results','closed_periods'
  ];
begin
  foreach t in array data_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);

    -- Read: any active app user.
    execute format($p$
      create policy %I on public.%I for select to authenticated
        using (public.has_app_role('viewer'))
    $p$, t || '_sel', t);

    -- Create / edit: planner and above.
    execute format($p$
      create policy %I on public.%I for insert to authenticated
        with check (public.has_app_role('planner'))
    $p$, t || '_ins', t);

    execute format($p$
      create policy %I on public.%I for update to authenticated
        using (public.has_app_role('planner'))
        with check (public.has_app_role('planner'))
    $p$, t || '_upd', t);

    -- Delete: admin only, matching the client's handleDelete gates.
    execute format($p$
      create policy %I on public.%I for delete to authenticated
        using (public.has_app_role('admin'))
    $p$, t || '_del', t);
  end loop;
end $$;

-- public.users needs narrower rules than the data tables: everyone may read
-- the roster (the app renders names/roles), but only an admin may change it.
-- Without this, a planner could edit their own row and grant themselves admin.
alter table public.users enable row level security;
alter table public.users force row level security;

drop policy if exists users_sel on public.users;
drop policy if exists users_ins on public.users;
drop policy if exists users_upd on public.users;
drop policy if exists users_del on public.users;

create policy users_sel on public.users for select to authenticated
  using (public.has_app_role('viewer'));

create policy users_ins on public.users for insert to authenticated
  with check (public.has_app_role('admin'));

create policy users_upd on public.users for update to authenticated
  using (public.has_app_role('admin'))
  with check (public.has_app_role('admin'));

create policy users_del on public.users for delete to authenticated
  using (public.has_app_role('admin'));

-- The anon key must not reach application data. The app only ever queries
-- these tables as an authenticated user.
revoke all on all tables in schema public from anon;

-- ============================================================================
-- 10. Bootstrapping your first admin
--
--   RLS is now live, which means nobody can write anything until at least one
--   row in public.users has role='admin' AND a matching auth_user_id. That
--   first row cannot be created through the app (the insert policy requires an
--   admin that does not exist yet), so create it here.
--
--   Steps:
--     1. Supabase dashboard → Authentication → Users → "Add user".
--        Create the account with the email you want to sign in as.
--     2. Copy that user's UUID.
--     3. Run the statement below with your own email and UUID substituted.
--
--   Repeat step 3 for each colleague, choosing 'planner' or 'viewer' as the
--   role; after the first admin exists you can also manage them in the app's
--   Master Data screen.
-- ============================================================================

-- insert into public.users (id, name, email, role, status, auth_user_id)
-- values (
--   'U1',
--   'Mohamed Amr',
--   'mohammed.amr@live.com',
--   'admin',
--   'active',
--   '00000000-0000-0000-0000-000000000000'   -- <- replace with the real UUID
-- )
-- on conflict (id) do update
--   set auth_user_id = excluded.auth_user_id,
--       role         = excluded.role,
--       status       = excluded.status;

-- ---------------------------------------------------------------------------
-- Verification — run after seeding your admin row. Every table should report
-- rowsecurity = true and 4 policies (public.users likewise).
-- ---------------------------------------------------------------------------
-- select c.relname            as table_name,
--        c.relrowsecurity     as rls_enabled,
--        count(p.polname)     as policy_count
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--   left join pg_policy p on p.polrelid = c.oid
--  where n.nspname = 'public' and c.relkind = 'r'
--  group by c.relname, c.relrowsecurity
--  order by rls_enabled, c.relname;
