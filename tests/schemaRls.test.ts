/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// PGlite loads its WASM bundle through fetch/Response APIs that jsdom only
// partially implements (jsdom's Response has no arrayBuffer()), so this file
// needs the real Node environment rather than the project-wide jsdom default.
// @vitest-environment node

/**
 * Executes schema.sql against a real Postgres (PGlite = Postgres compiled to
 * WASM) and asserts that Row Level Security actually enforces the role model.
 *
 * Why this exists
 * ---------------
 * The React app's hasRole() checks are a UX affordance: they run in the
 * browser and anyone can bypass them from devtools. The RLS policies in
 * schema.sql are the real authorization boundary. A boundary nobody tests is
 * a boundary you are guessing about, so this runs the actual DDL and probes
 * it as each role.
 *
 * A subtlety worth knowing: RLS blocks UPDATE and DELETE by filtering rows
 * out of the statement's scope, NOT by raising an error. A forbidden delete
 * therefore "succeeds" with zero rows affected. Every assertion below counts
 * an operation as allowed only if it raised no error AND changed >= 1 row.
 * (That same subtlety is why deleteRecord() in supabaseClient.ts selects the
 * deleted rows back instead of trusting the absence of an error.)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const UID = {
  admin:   '11111111-1111-1111-1111-111111111111',
  planner: '22222222-2222-2222-2222-222222222222',
  viewer:  '33333333-3333-3333-3333-333333333333',
};

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.waitReady;

  // PGlite is stock Postgres, so the Supabase-provided pieces schema.sql
  // depends on have to be recreated: the auth schema, auth.uid(), and the
  // authenticated/anon roles that policies are granted TO.
  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
    create or replace function auth.uid() returns uuid
      language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
    do $$ begin
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
    end $$;
  `);

  await db.exec(readFileSync(resolve(__dirname, '../schema.sql'), 'utf8'));

  await db.exec(`
    insert into auth.users(id) values ('${UID.admin}'),('${UID.planner}'),('${UID.viewer}');
    insert into public.users(id,name,email,role,status,auth_user_id) values
      ('U1','Admin','a@example.com','admin','active','${UID.admin}'),
      ('U2','Planner','p@example.com','planner','active','${UID.planner}'),
      ('U3','Viewer','v@example.com','viewer','active','${UID.viewer}');
    grant usage on schema public to authenticated;
    grant all on all tables in schema public to authenticated;
  `);
}, 60_000);

afterAll(async () => { await db?.close(); });

/** Runs `sql` as `uid` inside a rolled-back transaction. */
async function asRole<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.exec('begin');
  await db.exec(`insert into public.suppliers(id,name) values ('S_SEED','seed');`);
  await db.exec(`set local role authenticated; set local request.jwt.claim.sub = '${uid}';`);
  try {
    return await fn();
  } finally {
    await db.exec('rollback');
  }
}

/** Allowed == no error AND at least one row actually changed. */
async function changed(sql: string): Promise<boolean> {
  try {
    const r = await db.query(sql);
    return ((r as any).affectedRows ?? 0) > 0;
  } catch {
    return false;
  }
}

describe('schema.sql — structural integrity', () => {
  it('executes against a real Postgres with no errors', async () => {
    const t = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_class c
         join pg_namespace ns on ns.oid = c.relnamespace
        where ns.nspname='public' and c.relkind='r'`
    );
    expect(t.rows[0].n).toBeGreaterThan(20);
  });

  it('enables RLS with a full policy set on every public table', async () => {
    const res = await db.query<{ t: string; rls: boolean; policies: number }>(`
      select c.relname as t, c.relrowsecurity as rls, count(p.polname)::int as policies
        from pg_class c
        join pg_namespace ns on ns.oid = c.relnamespace
        left join pg_policy p on p.polrelid = c.oid
       where ns.nspname='public' and c.relkind='r'
       group by c.relname, c.relrowsecurity
    `);
    // A table shipped without RLS is a silent hole, so assert on all of them.
    const unprotected = res.rows.filter(r => !r.rls || r.policies < 4);
    expect(unprotected).toEqual([]);
  });

  it('ranks roles viewer < planner < admin, unknown lowest', async () => {
    const r = await db.query<any>(`
      select public.app_role_rank('admin') admin, public.app_role_rank('planner') planner,
             public.app_role_rank('viewer') viewer, public.app_role_rank('nobody') unknown`);
    const { admin, planner, viewer, unknown } = r.rows[0];
    expect(admin).toBeGreaterThan(planner);
    expect(planner).toBeGreaterThan(viewer);
    expect(viewer).toBeGreaterThan(unknown);
  });

  it('resolves an unauthenticated caller to "none" and denies every gate', async () => {
    const r = await db.query<any>(`
      select public.current_app_role() role, public.has_app_role('viewer') can_read,
             public.has_app_role('planner') can_write, public.has_app_role('admin') can_delete`);
    expect(r.rows[0].role).toBe('none');
    expect(r.rows[0].can_read).toBe(false);
    expect(r.rows[0].can_write).toBe(false);
    expect(r.rows[0].can_delete).toBe(false);
  });
});

describe('schema.sql — RLS enforces the role model', () => {
  it('viewer can read but cannot write, delete or self-promote', async () => {
    await asRole(UID.viewer, async () => {
      const read = await db.query(`select * from public.suppliers`);
      expect(read.rows.length).toBeGreaterThan(0);

      expect(await changed(`insert into public.suppliers(id,name) values ('S_V','x')`)).toBe(false);
      expect(await changed(`update public.suppliers set name='y' where id='S_SEED'`)).toBe(false);
      expect(await changed(`delete from public.suppliers where id='S_SEED'`)).toBe(false);
      // The escalation path: a viewer must not be able to grant itself a role.
      expect(await changed(
        `update public.users set role='admin' where auth_user_id='${UID.viewer}'`)).toBe(false);
    });
  });

  it('planner can read and write but cannot delete or self-promote', async () => {
    await asRole(UID.planner, async () => {
      expect((await db.query(`select * from public.suppliers`)).rows.length).toBeGreaterThan(0);
      expect(await changed(`insert into public.suppliers(id,name) values ('S_P','x')`)).toBe(true);
      expect(await changed(`update public.suppliers set name='y' where id='S_SEED'`)).toBe(true);
      // Delete is admin-only, matching the client's handleDelete gates.
      expect(await changed(`delete from public.suppliers where id='S_SEED'`)).toBe(false);
      expect(await changed(
        `update public.users set role='admin' where auth_user_id='${UID.planner}'`)).toBe(false);
    });
  });

  it('admin can do everything including managing users', async () => {
    await asRole(UID.admin, async () => {
      expect((await db.query(`select * from public.suppliers`)).rows.length).toBeGreaterThan(0);
      expect(await changed(`insert into public.suppliers(id,name) values ('S_A','x')`)).toBe(true);
      expect(await changed(`update public.suppliers set name='y' where id='S_SEED'`)).toBe(true);
      expect(await changed(`delete from public.suppliers where id='S_SEED'`)).toBe(true);
      expect(await changed(
        `update public.users set role='planner' where auth_user_id='${UID.viewer}'`)).toBe(true);
    });
  });

  it('denies an inactive user even when the auth identity is valid', async () => {
    await db.exec('begin');
    try {
      await db.exec(`update public.users set status='inactive' where auth_user_id='${UID.admin}';`);
      await db.exec(`set local role authenticated; set local request.jwt.claim.sub='${UID.admin}';`);
      const r = await db.query<any>(`select public.current_app_role() role`);
      // Deactivating an account must revoke access immediately, not just hide
      // it in the UI - current_app_role() filters on status='active'.
      expect(r.rows[0].role).toBe('none');
    } finally {
      await db.exec('rollback');
    }
  });
});
