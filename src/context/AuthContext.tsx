/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { fetchTableData } from '../supabaseClient';
import { AppUser, UserRole } from '../types';

const STORAGE_CURRENT_USER_KEY = 'sc_planner_current_user_id';

// Role hierarchy for this offline-first demo app:
//   viewer  - read-only everywhere.
//   planner - can create/edit plans, master data, purchase orders. No deletes.
//   admin   - full access, including deletes and the Supabase connection dialog.
// This mirrors the same seed/localStorage-first pattern already used for every
// other table in supabaseClient.ts - when a live Supabase project is connected,
// `users` becomes a real table you can manage the same way (see MasterDataScreen
// pattern), and this context keeps working unchanged.
const ROLE_RANK: Record<UserRole, number> = { viewer: 0, planner: 1, admin: 2 };

interface AuthContextType {
  users: AppUser[];
  currentUser: AppUser | null;
  loading: boolean;
  login: (userId: string) => void;
  logout: () => void;
  /** True if the current user's role is at least `minRole` in the viewer < planner < admin hierarchy. */
  hasRole: (minRole: UserRole) => boolean;
  /** True for viewer (or logged-out) - convenience for gating write actions. */
  isReadOnly: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(
    () => localStorage.getItem(STORAGE_CURRENT_USER_KEY)
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadUsers() {
      setLoading(true);
      try {
        const data = await fetchTableData<AppUser>('users');
        if (!cancelled) setUsers(data);
      } catch (e) {
        console.error('Failed to load users', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadUsers();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback((userId: string) => {
    localStorage.setItem(STORAGE_CURRENT_USER_KEY, userId);
    setCurrentUserId(userId);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_CURRENT_USER_KEY);
    setCurrentUserId(null);
  }, []);

  const currentUser = users.find(u => u.id === currentUserId) || null;

  const hasRole = useCallback((minRole: UserRole) => {
    if (!currentUser) return false;
    return ROLE_RANK[currentUser.role] >= ROLE_RANK[minRole];
  }, [currentUser]);

  const isReadOnly = !currentUser || currentUser.role === 'viewer';

  return (
    <AuthContext.Provider value={{ users, currentUser, loading, login, logout, hasRole, isReadOnly }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
