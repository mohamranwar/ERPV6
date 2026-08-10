/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle, Check, Download, Lock, Package, Ship, TrendingUp, X,
} from 'lucide-react';
import { Card, KpiCard, StatusBadge } from './ui';
import ContentHeader from './ContentHeader';
import { monthLabel } from '../utils/periods';
import { pcsPerCarton } from '../utils/uom';
import {
  bandAttainment, formatQty, useAppSettings,
  type Thresholds, type AttainmentBand,
} from '../hooks/useAppSettings';
import type { Product } from '../types';

/**
 * Month close.
 *
 * ── What closing actually does ──────────────────────────────────────────────
 * It writes a snapshot row and points history at it. Before the snapshot,
 * every historical chart recalculates from live plan and actual tables — which
 * means editing a March plan today silently rewrites what March looked like.
 * After it, a closed month is a fact.
 *
 * ── Two things this screen refuses to do ────────────────────────────────────
 * 1. Close on incomplete data. Missing actuals and POs without a required date
 *    are hard blockers, not warnings. A gap baked into permanent history is
 *    inherited by every future chart and is far more expensive to unpick than
 *    a delayed close.
 *
 * 2. Store cartons. Pieces are authoritative; cartons derive from each
 *    product's pack configuration, which is captured in the snapshot so last
 *    year's carton figures stay correct if a pack size changes. Storing both
 *    invites the two to disagree, and once they do nobody trusts either.
 */

export type Unit = 'pcs' | 'ctn';

/** One category's position for the period, all quantities in PIECES. */
export interface CategoryScorecard {
  categoryId: string;
  categoryName: string;
  /** Pack configuration, needed to present cartons. Null when unconfigured. */
  pcsPerCarton: number | null;
  salesPlanPcs: number;
  salesActualPcs: number;
  prodPlanPcs: number;
  prodActualPcs: number;
  fgStockPcs: number;
}

export interface PeriodScorecard {
  period: string;                  // 'YYYY-MM-01'
  rmInventoryValue: number;
  rmConsumptionValue: number;
  rmInTransitValue: number;
  fgStockPcs: number;
  fgSalesPcs: number;
  poTotal: number;
  poDelayed: number;
  poRaised: number;
  poClosed: number;
  poOpenValue: number;
  containersTotal: number;
  containersSea: number;
  containersAir: number;
  containersLand: number;
  containersCleared: number;
  containersAtPort: number;
  avgClearanceDays: number;
  categories: CategoryScorecard[];
}

export interface ReadinessCheck {
  id: string;
  severity: 'pass' | 'warn' | 'fail';
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface ClosedPeriodRow {
  period: string;
  status: 'closed' | 'locked';
  salesActualPcs: number;
  prodActualPcs: number;
  rmCoverageMonths: number;
  fgCoverageMonths: number;
  poDelayed: number;
  containersTotal: number;
  attainmentPct: number;
  closedBy: string;
}

export interface MonthCloseScreenProps {
  scorecard: PeriodScorecard;
  readiness: ReadinessCheck[];
  history: ClosedPeriodRow[];
  canClose: boolean;
  canReopen: boolean;
  onClose: (unit: Unit) => Promise<void> | void;
  onReopen?: (period: string) => void;
  onExportPeriod?: (period: string) => void;
  onExportScorecard?: (unit: Unit) => void;
}

const BAND_INTENT: Record<AttainmentBand, 'success' | 'warning' | 'danger' | 'neutral'> = {
  ok: 'success', watch: 'warning', short: 'danger', none: 'neutral',
};
const BAND_LABEL: Record<AttainmentBand, string> = {
  ok: 'On target', watch: 'Watch', short: 'Short', none: '—',
};

/**
 * Coverage in months.
 *
 * Zero demand has no meaningful ratio, so it returns null rather than a large
 * sentinel. A sentinel makes an unused item look like the healthiest line on
 * the screen — the same trap `monthsOfCover` in supabaseClient.ts documents.
 */
function coverage(stock: number, monthlyDemand: number): number | null {
  if (!(monthlyDemand > 0)) return null;
  return stock / monthlyDemand;
}

const n0 = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 });

export default function MonthCloseScreen({
  scorecard, readiness, history, canClose, canReopen,
  onClose, onReopen, onExportPeriod, onExportScorecard,
}: MonthCloseScreenProps) {
  const { settings } = useAppSettings();
  const t: Thresholds = settings.thresholds;

  const [unit, setUnit] = useState<Unit>(settings.formats.default_quantity_unit);
  const [closing, setClosing] = useState(false);

  /**
   * Convert pieces to the display unit.
   *
   * Returns null when cartons are requested for a category with no pack
   * configuration, so the cell shows "not configured" instead of a number
   * derived from an invented pack size.
   */
  const conv = (pcs: number, per: number | null): number | null => {
    if (unit === 'pcs') return pcs;
    if (per === null || per <= 0) return null;
    return pcs / per;
  };

  const unitLabel = unit === 'pcs' ? 'pieces' : 'cartons';
  const unitShort = unit === 'pcs' ? 'pcs' : 'ctn';

  const unconfigured = useMemo(
    () => scorecard.categories.filter(c => c.pcsPerCarton === null).length,
    [scorecard.categories],
  );

  /** Totals in the display unit. Categories without a pack config are excluded
   *  from carton totals rather than counted as zero — a silent zero would
   *  understate the total and no one would know. */
  const totals = useMemo(() => {
    const acc = {
      salesPlan: 0, salesActual: 0, prodPlan: 0, prodActual: 0, fgStock: 0, excluded: 0,
    };
    for (const c of scorecard.categories) {
      const sp = conv(c.salesPlanPcs, c.pcsPerCarton);
      if (sp === null) { acc.excluded += 1; continue; }
      acc.salesPlan += sp;
      acc.salesActual += conv(c.salesActualPcs, c.pcsPerCarton) ?? 0;
      acc.prodPlan += conv(c.prodPlanPcs, c.pcsPerCarton) ?? 0;
      acc.prodActual += conv(c.prodActualPcs, c.pcsPerCarton) ?? 0;
      acc.fgStock += conv(c.fgStockPcs, c.pcsPerCarton) ?? 0;
    }
    return acc;
  }, [scorecard.categories, unit]);

  const rmCoverage = coverage(scorecard.rmInventoryValue, scorecard.rmConsumptionValue);
  const rmCoverageTotal = coverage(
    scorecard.rmInventoryValue + scorecard.rmInTransitValue, scorecard.rmConsumptionValue);
  const fgCoverage = coverage(totals.fgStock, totals.salesActual);

  const poOnTime = scorecard.poTotal > 0
    ? ((scorecard.poTotal - scorecard.poDelayed) / scorecard.poTotal) * 100
    : null;

  const salesAttainment = totals.salesPlan > 0
    ? (totals.salesActual / totals.salesPlan) * 100 : null;

  const blockers = readiness.filter(r => r.severity === 'fail');
  const blocked = blockers.length > 0;

  async function handleClose() {
    setClosing(true);
    try { await onClose(unit); } finally { setClosing(false); }
  }

  const th = 'text-start px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-400 whitespace-nowrap';
  const thR = th.replace('text-start', 'text-end');
  const td = 'px-3 py-2 border-t border-slate-100';
  const tdR = `${td} text-end font-mono`;

  function categoryTable(
    title: string,
    planKey: 'salesPlanPcs' | 'prodPlanPcs',
    actualKey: 'salesActualPcs' | 'prodActualPcs',
  ) {
    let tp = 0, ta = 0;
    const rows = scorecard.categories.map(c => {
      const p = conv(c[planKey], c.pcsPerCarton);
      const a = conv(c[actualKey], c.pcsPerCarton);
      if (p !== null && a !== null) { tp += p; ta += a; }
      const att = p !== null && a !== null && p > 0 ? (a / p) * 100 : null;
      const band = bandAttainment(att, t);
      return { c, p, a, att, band };
    });
    const totalAtt = tp > 0 ? (ta / tp) * 100 : null;
    const totalBand = bandAttainment(totalAtt, t);

    return (
      <Card
        title={title}
        actions={
          <span className="text-[10px] text-slate-400 font-semibold">{unitLabel}</span>
        }
      >
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>Category</th>
                <th className={thR}>Plan</th>
                <th className={thR}>Actual</th>
                <th className={thR}>Variance</th>
                <th className={thR}>Attainment</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, p, a, att, band }) => (
                <tr key={c.categoryId} className="hover:bg-brand-50/50">
                  <td className={`${td} font-semibold text-slate-700`}>{c.categoryName}</td>
                  {p === null || a === null ? (
                    <td className={`${td} text-slate-400 text-[11px]`} colSpan={4}>
                      No pack configuration — cannot show cartons
                    </td>
                  ) : (
                    <>
                      <td className={tdR}>{n0(p)}</td>
                      <td className={`${tdR} font-bold`}>{n0(a)}</td>
                      <td className={`${tdR} ${a - p >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                        {a - p >= 0 ? '+' : ''}{n0(a - p)}
                      </td>
                      <td className={`${tdR} font-bold`}>{att === null ? '—' : `${att.toFixed(1)}%`}</td>
                    </>
                  )}
                  <td className={td}>
                    <StatusBadge intent={BAND_INTENT[band]}>{BAND_LABEL[band]}</StatusBadge>
                  </td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-bold border-t-2 border-slate-200">
                <td className={`${td} border-t-0`}>Total</td>
                <td className={`${tdR} border-t-0`}>{n0(tp)}</td>
                <td className={`${tdR} border-t-0`}>{n0(ta)}</td>
                <td className={`${tdR} border-t-0 ${ta - tp >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {ta - tp >= 0 ? '+' : ''}{n0(ta - tp)}
                </td>
                <td className={`${tdR} border-t-0`}>{totalAtt === null ? '—' : `${totalAtt.toFixed(1)}%`}</td>
                <td className={`${td} border-t-0`}>
                  <StatusBadge intent={BAND_INTENT[totalBand]}>{BAND_LABEL[totalBand]}</StatusBadge>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    );
  }

  return (
    <div>
      <ContentHeader
        title="Month close"
        subtitle="Freeze a period so history stops moving."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5" role="group" aria-label="Display unit">
              {(['pcs', 'ctn'] as Unit[]).map(u => (
                <button
                  key={u}
                  onClick={() => setUnit(u)}
                  aria-pressed={unit === u}
                  className={`h-7 px-3 rounded-md text-[11px] font-bold transition ${
                    unit === u ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  {u === 'pcs' ? 'Pieces' : 'Cartons'}
                </button>
              ))}
            </div>
            <button
              onClick={() => onExportScorecard?.(unit)}
              className="h-8 px-3 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" /> Export scorecard
            </button>
          </div>
        }
      />

      {unit === 'ctn' && unconfigured > 0 && (
        <div className="flex gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200 mb-4">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-amber-800">
              {unconfigured} {unconfigured === 1 ? 'category has' : 'categories have'} no pack configuration
            </p>
            <p className="text-[11px] text-amber-700 leading-relaxed mt-0.5">
              They are excluded from carton totals rather than counted as zero, so the totals
              above are understated. Set pieces per bag and bags per carton in Master Data.
            </p>
          </div>
        </div>
      )}

      {/* ── KPI ROW ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        <KpiCard
          label="RM coverage"
          value={rmCoverage === null ? '—' : rmCoverage.toFixed(2)}
          unit="mo"
          icon={<Package className="w-4 h-4" />}
          intent={rmCoverage !== null && rmCoverage >= t.rm_coverage_ok_months ? 'success' : 'warning'}
          sub={`${formatQty(scorecard.rmInventoryValue, settings.formats)} ${settings.formats.currency} on hand`}
          progress={rmCoverage === null ? 0 : Math.min((rmCoverage / (t.rm_coverage_ok_months * 1.5)) * 100, 100)}
          badge={{
            label: rmCoverage !== null && rmCoverage >= t.rm_coverage_ok_months ? 'Healthy' : 'Below target',
            intent: rmCoverage !== null && rmCoverage >= t.rm_coverage_ok_months ? 'success' : 'warning',
          }}
        />
        <KpiCard
          label="FG coverage"
          value={fgCoverage === null ? '—' : fgCoverage.toFixed(2)}
          unit="mo"
          icon={<TrendingUp className="w-4 h-4" />}
          intent={fgCoverage !== null && fgCoverage >= t.fg_coverage_ok_months ? 'success' : 'warning'}
          sub={`${n0(totals.fgStock)} ${unitShort} closing stock`}
          progress={fgCoverage === null ? 0 : Math.min((fgCoverage / (t.fg_coverage_ok_months * 1.5)) * 100, 100)}
        />
        <KpiCard
          label="PO on time"
          value={`${scorecard.poTotal - scorecard.poDelayed}`}
          unit={`of ${scorecard.poTotal}`}
          intent={poOnTime !== null && poOnTime >= t.po_on_time_target_pct ? 'success' : 'danger'}
          sub={`${scorecard.poDelayed} delayed`}
          progress={poOnTime ?? 0}
          badge={{
            label: poOnTime === null ? '—'
              : poOnTime >= t.po_on_time_target_pct ? 'On target' : 'Below target',
            intent: poOnTime !== null && poOnTime >= t.po_on_time_target_pct ? 'success' : 'danger',
          }}
        />
        <KpiCard
          label="Containers"
          value={`${scorecard.containersTotal}`}
          unit="inbound"
          icon={<Ship className="w-4 h-4" />}
          intent={scorecard.containersAtPort > 0 ? 'warning' : 'success'}
          sub={`${scorecard.containersCleared} cleared · ${scorecard.containersAtPort} at port`}
          progress={scorecard.containersTotal > 0
            ? (scorecard.containersCleared / scorecard.containersTotal) * 100 : 0}
        />
      </div>

      {/* ── RM / FG ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
        <Card title="Raw material coverage">
          <p className="text-xs text-slate-500 mb-3">Inventory value ÷ monthly consumption value</p>
          <dl className="text-xs">
            {[
              ['Total RM inventory value', `${formatQty(scorecard.rmInventoryValue, settings.formats)} ${settings.formats.currency}`],
              ['Monthly consumption value', `${formatQty(scorecard.rmConsumptionValue, settings.formats)} ${settings.formats.currency}`],
              ['In transit (not yet received)', `${formatQty(scorecard.rmInTransitValue, settings.formats)} ${settings.formats.currency}`],
              ['Coverage — stock only', rmCoverage === null ? '—' : `${rmCoverage.toFixed(2)} months`],
              ['Coverage — incl. in transit', rmCoverageTotal === null ? '—' : `${rmCoverageTotal.toFixed(2)} months`],
            ].map(([k, v], i, arr) => (
              <div key={k} className={`flex justify-between gap-3 py-1.5 ${i < arr.length - 1 ? 'border-b border-slate-100' : ''}`}>
                <dt className="text-slate-500 font-medium">{k}</dt>
                <dd className={`font-mono font-bold ${i >= 3 ? 'text-brand-700 text-sm' : ''}`}>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[10px] text-slate-400 leading-relaxed mt-3">
            Value coverage answers a different question from the per-SKU weeks of cover on the
            coverage screen. A healthy figure here can still hide two materials at two weeks.
            Read both.
          </p>
        </Card>

        <Card title="Finished goods stock & coverage">
          <p className="text-xs text-slate-500 mb-3">Closing stock ÷ monthly sales, in {unitLabel}</p>
          <dl className="text-xs">
            {[
              ['Closing FG stock', `${n0(totals.fgStock)} ${unitShort}`],
              ['Monthly sales (actual)', `${n0(totals.salesActual)} ${unitShort}`],
              ['FG coverage', fgCoverage === null ? '—' : `${fgCoverage.toFixed(2)} months`],
            ].map(([k, v], i, arr) => (
              <div key={k} className={`flex justify-between gap-3 py-1.5 ${i < arr.length - 1 ? 'border-b border-slate-100' : ''}`}>
                <dt className="text-slate-500 font-medium">{k}</dt>
                <dd className={`font-mono font-bold ${i === 2 ? 'text-brand-700 text-sm' : ''}`}>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[10px] text-slate-400 leading-relaxed mt-3">
            Coverage in pieces and in cartons will not agree, because pack counts differ by
            category and weight the mix differently. Pieces is the production view; cartons is
            what the warehouse plans space against. Both belong in the snapshot.
          </p>
        </Card>
      </div>

      {/* ── PO / CONTAINERS ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
        <Card title="Purchase orders">
          <dl className="text-xs">
            {[
              ['Total open POs', n0(scorecard.poTotal)],
              ['Delayed against required date', `${scorecard.poDelayed} · ${scorecard.poTotal > 0 ? ((scorecard.poDelayed / scorecard.poTotal) * 100).toFixed(1) : '0.0'}%`],
              ['Raised this month', n0(scorecard.poRaised)],
              ['Closed this month', n0(scorecard.poClosed)],
              ['Total open value', `${formatQty(scorecard.poOpenValue, settings.formats)} ${settings.formats.currency}`],
            ].map(([k, v], i, arr) => (
              <div key={k} className={`flex justify-between gap-3 py-1.5 ${i < arr.length - 1 ? 'border-b border-slate-100' : ''}`}>
                <dt className="text-slate-500 font-medium">{k}</dt>
                <dd className={`font-mono font-bold ${i === 1 && scorecard.poDelayed > 0 ? 'text-red-700' : ''}`}>{v}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="Containers">
          <dl className="text-xs">
            {[
              ['Total containers', n0(scorecard.containersTotal)],
              ['Sea', n0(scorecard.containersSea)],
              ['Air', n0(scorecard.containersAir)],
              ['Land', n0(scorecard.containersLand)],
              ['Cleared customs', n0(scorecard.containersCleared)],
              ['Still at port', n0(scorecard.containersAtPort)],
              ['Average clearance days', scorecard.avgClearanceDays.toFixed(1)],
            ].map(([k, v], i, arr) => (
              <div key={k} className={`flex justify-between gap-3 py-1.5 ${i < arr.length - 1 ? 'border-b border-slate-100' : ''}`}>
                <dt className="text-slate-500 font-medium">{k}</dt>
                <dd className={`font-mono font-bold ${i === 5 && scorecard.containersAtPort > 0 ? 'text-amber-700' : ''}`}>{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      {/* ── CATEGORY TABLES ─────────────────────────────────────────── */}
      <div className="space-y-3 mb-4">
        {categoryTable('Production by category', 'prodPlanPcs', 'prodActualPcs')}
        {categoryTable('Sales by category', 'salesPlanPcs', 'salesActualPcs')}
      </div>

      {/* ── READINESS ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
        <Card title="Readiness">
          <p className="text-xs text-slate-500 mb-2">
            {blocked
              ? `${blockers.length} ${blockers.length === 1 ? 'blocker' : 'blockers'} must clear before ${monthLabel(scorecard.period)} can close`
              : 'All checks cleared'}
          </p>
          <ul className="divide-y divide-slate-100">
            {readiness.map(r => (
              <li key={r.id} className="flex gap-2.5 py-2.5 items-start">
                <span
                  aria-hidden
                  className={`w-4.5 h-4.5 rounded-full grid place-items-center text-[10px] font-black shrink-0 mt-0.5 border ${
                    r.severity === 'pass' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : r.severity === 'warn' ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-red-50 text-red-700 border-red-200'
                  }`}
                  style={{ width: 18, height: 18 }}
                >
                  {r.severity === 'pass' ? <Check className="w-2.5 h-2.5" />
                    : r.severity === 'warn' ? '!' : <X className="w-2.5 h-2.5" />}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-800">{r.title}</p>
                  <p className="text-[11px] text-slate-500 leading-relaxed">{r.detail}</p>
                </div>
                {r.actionLabel && (
                  <button
                    onClick={r.onAction}
                    className="h-6 px-2 rounded-md border border-slate-300 bg-white text-[10px] font-bold text-slate-700 hover:bg-slate-50 shrink-0"
                  >
                    {r.actionLabel}
                  </button>
                )}
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2 mt-4 flex-wrap">
            <button
              onClick={handleClose}
              disabled={blocked || !canClose || closing}
              className="h-8 px-3.5 rounded-lg bg-brand-600 text-white text-xs font-bold hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              <Lock className="w-3.5 h-3.5" />
              {closing ? 'Closing…' : `Close ${monthLabel(scorecard.period)}`}
            </button>
            {!canClose && (
              <span className="text-[11px] text-slate-400">
                Your role cannot close a period.
              </span>
            )}
          </div>
        </Card>

        <Card title="Snapshot contents">
          <p className="text-xs text-slate-500 mb-2">What gets frozen</p>
          <dl className="text-xs">
            {[
              ['Sales plan & actual by category', `${scorecard.categories.length} categories`],
              ['Production plan & actual by category', `${scorecard.categories.length} categories`],
              ['RM value & consumption', 'captured'],
              ['FG stock — pieces + pack counts', 'captured'],
              ['PO positions + delay flags', `${scorecard.poTotal} orders`],
              ['Containers & clearance', `${scorecard.containersTotal} records`],
              ['Applied thresholds', 'captured'],
            ].map(([k, v], i, arr) => (
              <div key={k} className={`flex justify-between gap-3 py-1.5 ${i < arr.length - 1 ? 'border-b border-slate-100' : ''}`}>
                <dt className="text-slate-500 font-medium">{k}</dt>
                <dd className="font-mono font-bold">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[10px] text-slate-400 leading-relaxed mt-3">
            Pack counts are stored with the snapshot, so last year's carton figures stay correct
            if a pack size changes. Thresholds are stored too — without them, editing a band in
            Settings next year would silently repaint the colour of every historical month.
          </p>
        </Card>
      </div>

      {/* ── HISTORY ─────────────────────────────────────────────────── */}
      <Card title="Closed months" actions={
        <span className="text-[10px] text-slate-400 font-semibold">
          The table every historical chart reads from
        </span>
      }>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>Month</th>
                <th className={th}>Status</th>
                <th className={thR}>Sales</th>
                <th className={thR}>Production</th>
                <th className={thR}>RM cover</th>
                <th className={thR}>FG cover</th>
                <th className={thR}>PO late</th>
                <th className={thR}>Containers</th>
                <th className={thR}>Attainment</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-400 text-[11px]">
                  No periods closed yet. The first close starts the history.
                </td></tr>
              )}
              {history.map(h => {
                const band = bandAttainment(h.attainmentPct, t);
                return (
                  <tr key={h.period} className="hover:bg-brand-50/50">
                    <td className={`${td} font-mono font-bold`}>{monthLabel(h.period)}</td>
                    <td className={td}>
                      <StatusBadge intent="neutral">
                        {h.status === 'closed' ? 'Closed' : 'Locked'}
                      </StatusBadge>
                    </td>
                    <td className={tdR}>{formatQty(h.salesActualPcs, settings.formats)}</td>
                    <td className={tdR}>{formatQty(h.prodActualPcs, settings.formats)}</td>
                    <td className={tdR}>{h.rmCoverageMonths.toFixed(2)}</td>
                    <td className={tdR}>{h.fgCoverageMonths.toFixed(2)}</td>
                    <td className={`${tdR} ${h.poDelayed >= 4 ? 'text-red-700 font-bold' : ''}`}>{h.poDelayed}</td>
                    <td className={tdR}>{h.containersTotal}</td>
                    <td className={`${tdR} font-bold ${
                      band === 'ok' ? 'text-emerald-700' : band === 'watch' ? 'text-amber-700' : 'text-red-700'
                    }`}>{h.attainmentPct.toFixed(1)}%</td>
                    <td className={`${td} text-end whitespace-nowrap`}>
                      <button
                        onClick={() => onExportPeriod?.(h.period)}
                        className="h-6 px-2 rounded-md border border-slate-300 bg-white text-[10px] font-bold text-slate-700 hover:bg-slate-50"
                      >
                        Export
                      </button>
                      {h.status === 'closed' && canReopen && (
                        <button
                          onClick={() => onReopen?.(h.period)}
                          className="h-6 px-2 ms-1 rounded-md border border-slate-300 bg-white text-[10px] font-bold text-slate-700 hover:bg-slate-50"
                        >
                          Reopen
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-slate-400 leading-relaxed mt-3">
          Locked periods sit outside the retention window and cannot be reopened. Export pulls
          MPS, production plan, MRP and the full scorecard for that month.
        </p>
      </Card>
    </div>
  );
}

/**
 * Build a category scorecard from live rows.
 *
 * Pack configuration comes from `pcsPerCarton` in utils/uom, which returns
 * null for an unconfigured product rather than inventing a pack size. When a
 * category mixes configured and unconfigured products, the category is treated
 * as unconfigured — a partial carton total is worse than an absent one,
 * because it looks complete.
 */
export function buildCategoryScorecards(
  products: readonly Product[],
  categories: readonly { id: string; name: string }[],
  salesPlanByProduct: Map<string, number>,
  salesActualByProduct: Map<string, number>,
  prodPlanByProduct: Map<string, number>,
  prodActualByProduct: Map<string, number>,
  fgStockByProduct: Map<string, number>,
): CategoryScorecard[] {
  return categories.map(cat => {
    const items = products.filter(p => p.category_id === cat.id);

    let per: number | null = null;
    let mixed = false;
    for (const p of items) {
      const v = pcsPerCarton(p);
      if (v === null) { mixed = true; break; }
      if (per === null) per = v;
      else if (per !== v) {
        // Different pack sizes inside one category cannot share a single
        // divisor. Summing pieces then dividing by one of them would be wrong.
        mixed = true;
        break;
      }
    }

    const sum = (m: Map<string, number>) =>
      items.reduce((acc, p) => acc + (m.get(p.id) ?? 0), 0);

    return {
      categoryId: cat.id,
      categoryName: cat.name,
      pcsPerCarton: mixed ? null : per,
      salesPlanPcs: sum(salesPlanByProduct),
      salesActualPcs: sum(salesActualByProduct),
      prodPlanPcs: sum(prodPlanByProduct),
      prodActualPcs: sum(prodActualByProduct),
      fgStockPcs: sum(fgStockByProduct),
    };
  });
}
