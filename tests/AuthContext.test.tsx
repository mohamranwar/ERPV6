/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthProvider, useAuth } from '../src/context/AuthContext';

describe('AuthContext (offline/local roles)', () => {
  beforeEach(() => {
    localStorage.removeItem('sc_planner_current_user_id');
  });

  it('loads the three seeded demo accounts (admin, planner, viewer)', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.users.map(u => u.role).sort()).toEqual(['admin', 'planner', 'viewer']);
  });

  it('starts logged out when no session is stored', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.currentUser).toBeNull();
    expect(result.current.isReadOnly).toBe(true);
  });

  it('logs in as the admin account and grants every role level', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const admin = result.current.users.find(u => u.role === 'admin')!;
    act(() => result.current.login(admin.id));

    expect(result.current.currentUser?.role).toBe('admin');
    expect(result.current.hasRole('viewer')).toBe(true);
    expect(result.current.hasRole('planner')).toBe(true);
    expect(result.current.hasRole('admin')).toBe(true);
    expect(result.current.isReadOnly).toBe(false);
  });

  it('logs in as the viewer account and only grants viewer-level access', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const viewer = result.current.users.find(u => u.role === 'viewer')!;
    act(() => result.current.login(viewer.id));

    expect(result.current.hasRole('viewer')).toBe(true);
    expect(result.current.hasRole('planner')).toBe(false);
    expect(result.current.hasRole('admin')).toBe(false);
    expect(result.current.isReadOnly).toBe(true);
  });

  it('persists the session across a fresh provider mount (localStorage), and logout clears it', async () => {
    const first = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    const planner = first.result.current.users.find(u => u.role === 'planner')!;
    act(() => first.result.current.login(planner.id));
    expect(localStorage.getItem('sc_planner_current_user_id')).toBe(planner.id);

    // Simulate a reload: mount a brand new provider instance.
    const second = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.currentUser?.id).toBe(planner.id);

    act(() => second.result.current.logout());
    expect(second.result.current.currentUser).toBeNull();
    expect(localStorage.getItem('sc_planner_current_user_id')).toBeNull();
  });
});
