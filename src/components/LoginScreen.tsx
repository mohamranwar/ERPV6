/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useAuth } from '../context/AuthContext';
import {
  ShieldCheck,
  Crown,
  ClipboardList,
  Eye,
  Boxes,
  Sparkles,
  ArrowRight,
  Activity,
  Layers,
  Globe2,
} from 'lucide-react';
import { motion } from 'motion/react';

const ROLE_META: Record<
  string,
  { icon: any; badgeClass: string; description: string; ringClass: string }
> = {
  admin: {
    icon: Crown,
    badgeClass: 'pill pill-warning',
    description: 'Full access — create, edit, delete, and manage the Supabase connection.',
    ringClass: 'ring-amber-300/50 group-hover:ring-amber-400/70',
  },
  planner: {
    icon: ClipboardList,
    badgeClass: 'pill pill-brand',
    description: 'Can create and edit plans, master data, and purchase orders.',
    ringClass: 'ring-indigo-300/50 group-hover:ring-indigo-400/70',
  },
  viewer: {
    icon: Eye,
    badgeClass: 'pill pill-muted',
    description: 'Read-only access across every screen.',
    ringClass: 'ring-slate-200 group-hover:ring-slate-300',
  },
};

const HIGHLIGHTS = [
  {
    icon: Layers,
    title: 'BOM & MRP',
    text: 'Recipe-driven material explosion, planned order releases, full traceability.',
  },
  {
    icon: Activity,
    title: 'Live coverage',
    text: 'Stock-only and total coverage in days, with stockout risk flags.',
  },
  {
    icon: Globe2,
    title: 'Logistics tower',
    text: 'Sea, air, and land shipments, customs tracking, factory ETA.',
  },
];

export default function LoginScreen() {
  const { users, loading, login } = useAuth();

  return (
    <div
      className="flex h-screen w-full overflow-hidden bg-surface-2"
      id="login_screen"
      style={{ background: 'linear-gradient(135deg, #f8fafc 0%, #ECF6F7 60%, #D2E9EC 100%)' }}
    >
      {/* Left — hero panel */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
        className="hidden lg:flex w-1/2 relative overflow-hidden bg-gradient-to-br from-indigo-950 via-indigo-900 to-slate-900 text-white p-12 flex-col justify-between"
      >
        {/* Decorative mesh */}
        <div className="pointer-events-none absolute inset-0 opacity-60">
          <div className="absolute -top-32 -right-24 w-[28rem] h-[28rem] rounded-full bg-indigo-500/30 blur-3xl" />
          <div className="absolute -bottom-40 -left-20 w-[26rem] h-[26rem] rounded-full bg-fuchsia-500/20 blur-3xl" />
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
              backgroundSize: '32px 32px',
              maskImage: 'radial-gradient(circle at center, black 30%, transparent 75%)',
              WebkitMaskImage: 'radial-gradient(circle at center, black 30%, transparent 75%)',
            }}
          />
        </div>

        <div className="relative z-10 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-white/10 backdrop-blur-sm border border-white/15 shadow-lg">
            <Boxes className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-extrabold uppercase tracking-[0.18em]">
              Supply Chain Planner
            </h1>
            <p className="text-[11px] text-indigo-200/80 mt-0.5 font-medium tracking-wide">
              Enterprise control tower · v2.4
            </p>
          </div>
        </div>

        <div className="relative z-10 max-w-lg space-y-7">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/10 border border-white/15 text-[11px] font-semibold text-indigo-100 backdrop-blur-sm">
            <Sparkles className="w-3 h-3" />
            Hygiene manufacturing, end to end
          </div>
          <h2 className="text-4xl font-extrabold leading-[1.1] tracking-tight text-balance">
            Plan, produce, and ship with one
            <span className="block bg-gradient-to-r from-indigo-200 via-white to-fuchsia-200 bg-clip-text text-transparent">
              unified cockpit.
            </span>
          </h2>
          <p className="text-[13px] text-indigo-100/80 leading-relaxed max-w-md">
            Sales forecasting, master production scheduling, MRP explosion, stock coverage
            analysis, and live logistics — wired into a single offline-first workspace.
          </p>

          <div className="grid grid-cols-1 gap-3 pt-2">
            {HIGHLIGHTS.map((h) => (
              <div
                key={h.title}
                className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/10 backdrop-blur-sm"
              >
                <div className="p-2 rounded-lg bg-white/10 border border-white/10 shrink-0">
                  <h.icon className="w-4 h-4 text-indigo-100" />
                </div>
                <div>
                  <p className="text-[12.5px] font-bold tracking-wide">{h.title}</p>
                  <p className="text-[11.5px] text-indigo-100/70 leading-relaxed">{h.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 flex items-center gap-2 text-[11px] text-indigo-200/60 font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-soft" />
          <span>Sandboxed local mode · ready to connect Supabase</span>
        </div>
      </motion.div>

      {/* Right — account picker */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 relative">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05, ease: [0.2, 0.8, 0.2, 1] }}
          className="w-full max-w-md card-elevated p-7 sm:p-8"
        >
          <div className="flex items-center gap-2.5 mb-1 lg:hidden">
            <div className="p-2 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600">
              <Boxes className="w-5 h-5" />
            </div>
            <h1 className="text-sm font-extrabold uppercase tracking-wider text-slate-900">
              Supply Chain Planner
            </h1>
          </div>

          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">Sign in</h2>
          <p className="text-[12.5px] text-slate-500 mt-1 leading-relaxed">
            Pick a demo account to continue. This offline build doesn't use passwords — roles
            gate what each account can edit.
          </p>

          <div className="mt-5 space-y-2.5">
            {loading && (
              <div className="flex justify-center py-10">
                <div className="animate-spin rounded-full h-6 w-6 border-2 border-slate-200 border-t-indigo-600" />
              </div>
            )}

            {!loading && users.length === 0 && (
              <div className="text-center py-8 text-xs text-slate-500">
                No accounts configured. Connect Supabase or reload the app to reseed demo
                accounts.
              </div>
            )}

            {!loading &&
              users.map((u, i) => {
                const meta = ROLE_META[u.role] || ROLE_META.viewer;
                const Icon = meta.icon;
                return (
                  <motion.button
                    key={u.id}
                    id={`login_user_${u.id}`}
                    onClick={() => login(u.id)}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: 0.1 + i * 0.05 }}
                    className={`w-full group flex items-center gap-3 p-3.5 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40 transition-all text-start cursor-pointer ring-0 hover:ring-4 ${meta.ringClass}`}
                  >
                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 group-hover:bg-white group-hover:border-indigo-200 transition-colors shrink-0">
                      <Icon className="w-4 h-4 text-slate-600 group-hover:text-indigo-600 transition-colors" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13.5px] font-bold text-slate-800 truncate">
                          {u.name}
                        </span>
                        <span className={meta.badgeClass}>{u.role}</span>
                      </div>
                      <p className="text-[11px] text-slate-500 truncate mt-0.5">{u.email}</p>
                      <p className="text-[10.5px] text-slate-400 mt-1 leading-relaxed">
                        {meta.description}
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all shrink-0" />
                  </motion.button>
                );
              })}
          </div>

          <div className="mt-6 pt-5 border-t border-slate-100 flex items-start gap-2 text-[10.5px] text-slate-400 leading-relaxed">
            <ShieldCheck className="w-3.5 h-3.5 mt-0.5 text-slate-400 shrink-0" />
            <p>
              After signing in, open the Database Engine panel in the sidebar to connect a
              Supabase project and swap the demo data for live accounts.
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
