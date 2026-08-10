/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Management pack — the dashboard's presentation view.
 *
 * The dashboard serves two audiences. On screen it is a live weekly ops board
 * a planner scans for what needs action today. Once a month the same figures
 * are presented to management, projected in a room or handed over as a PDF,
 * and that is a different document: no controls, an explicit "as at" date, a
 * stated headline, and charts rather than dense tables — a room reads a shape
 * far faster than a column of numbers.
 *
 * It reads the same engine values the live board does — nothing is recomputed
 * here — so the pack can never disagree with the screen it was exported from.
 */
import React from 'react';
import {
  VMaterialCoverage, VProductCoverage, VFGPSIAnalysis, Shipment,
  ClearanceContainer, ExportForecast, Product, ProductionActual, SalesActual,
} from '../types';
import { formatPlanningPeriod, isInPeriod } from '../supabaseClient';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, Legend, PieChart, Pie, ReferenceLine,
} from 'recharts';
import { AlertOctagon, PackageCheck, Ship, Container as ContainerIcon } from 'lucide-react';
import { toCartons, formatQtyCompact } from '../utils/uom';
import {
  SalesByPcsChart,
  ProductionByPcsChart,
  RawMaterialCoverageChart,
  RawMaterialStockChart,
  FGStockCoverageChart,
  FGStockVsSalesChart,
} from './ExecutiveCharts';
import { chartCaption, type ExecutiveChartData } from '../utils/executiveCharts';

interface ManagementPackProps {
  period: string;
  /**
   * Executive chart series, computed from live rows.
   *
   * These six charts previously rendered with no data prop at all and fell
   * through to a hardcoded seed inside ExecutiveCharts.tsx -- so the
   * board-review pack showed demo figures in every state of the database,
   * under a note asserting a fixed date range. The prop is required so that
   * cannot silently regress.
   */
  executiveCharts: ExecutiveChartData;
  materialCoverages: VMaterialCoverage[];
  productCoverages: VProductCoverage[];
  fgPsi: VFGPSIAnalysis[];
  salesAchievement: number | null;
  hasSalesActuals: boolean;
  shipments: Shipment[];
  containers: ClearanceContainer[];
  exportOrders: ExportForecast[];
  products: Product[];
  prodActuals: ProductionActual[];
  salesActuals: SalesActual[];
}

const INK = '#334155';
const AXIS = { fontSize: 10, fill: '#64748b' };

/** Charts must survive print, where interactive tooltips do not exist. */
const chartProps = { isAnimationActive: false } as const;

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="print-block border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
        <h2 className="text-[12px] font-extrabold uppercase tracking-wider text-slate-700">{title}</h2>
        {note && <p className="text-[11px] text-slate-500 mt-0.5">{note}</p>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export default function ManagementPack({
  period, executiveCharts, materialCoverages, productCoverages, fgPsi,
  salesAchievement, hasSalesActuals,
  shipments, containers, exportOrders, products, prodActuals, salesActuals,
}: ManagementPackProps) {
  const productById = new Map(products.map(p => [p.id, p]));

  const atRisk = materialCoverages.filter(m => m.oos_risk_flag);
  const overstocked = materialCoverages.filter(m => m.overstock_flag);
  const fgBelowSafety = productCoverages.filter(p => p.below_safety_flag);
  const noForecast = materialCoverages.filter(m => m.monthly_demand === 0);

  const totalForecast = fgPsi.reduce((s, r) => s + r.sales_forecast, 0);
  const totalActual = fgPsi.reduce((s, r) => s + r.actual_sales, 0);

  const pendingShipments = shipments.filter(s => s.factory_arrival_date === null);
  const openOrders = exportOrders.filter(o => o.order_status !== 'shipped' && o.order_status !== 'delivered');
  const demurrageDays = containers.reduce((s, c) => s + (c.demurrage_days ?? 0), 0);

  // ── chart data ──────────────────────────────────────────────────────────

  /** Sales: plan against actual per SKU, the headline commercial chart. */
  const salesData = fgPsi.map(r => ({
    name: (r as unknown as { product_name?: string }).product_name ?? r.row_id,
    forecast: r.sales_forecast,
    actual: r.actual_sales,
    production: r.production_plan,
  }));

  /** Coverage distribution — how the material base is spread across risk bands. */
  const coverageBands = [
    { band: 'OOS risk', count: atRisk.length, fill: '#ef4444' },
    { band: 'Watchlist', count: materialCoverages.filter(m => !m.oos_risk_flag && m.coverage_months <= 2).length, fill: '#f59e0b' },
    { band: 'Healthy', count: materialCoverages.filter(m => m.coverage_months > 2 && !m.overstock_flag && m.monthly_demand > 0).length, fill: '#10b981' },
    { band: 'Overstock', count: overstocked.length, fill: '#0ea5e9' },
    { band: 'No forecast', count: noForecast.length, fill: '#94a3b8' },
  ].filter(b => b.count > 0);

  /** Containers by stage — the logistics funnel. */
  const containerStages = [
    { stage: 'At port', count: containers.filter(c => c.status === 'pending').length, fill: '#94a3b8' },
    { stage: 'Under exam', count: containers.filter(c => c.status === 'under_exam').length, fill: '#f59e0b' },
    { stage: 'Released', count: containers.filter(c => c.status === 'released').length, fill: '#0ea5e9' },
    { stage: 'Delivered', count: containers.filter(c => c.status === 'delivered').length, fill: '#10b981' },
  ];

  /** Export orders by status — the order book. */
  const orderStatuses = ['draft', 'confirmed', 'in_production', 'ready_to_ship', 'shipped', 'delivered', 'on_hold']
    .map(st => ({
      status: st.replace(/_/g, ' '),
      count: exportOrders.filter(o => o.order_status === st).length,
    }))
    .filter(s => s.count > 0);

  /** Production vs sales per line, month to date. */
  const byLine = (() => {
    const acc = new Map<string, { line: string; produced: number; sold: number }>();
    const bump = (pid: string, f: 'produced' | 'sold', q: number) => {
      const line = productById.get(pid)?.product_line || 'Unassigned';
      const row = acc.get(line) ?? { line, produced: 0, sold: 0 };
      row[f] += q;
      acc.set(line, row);
    };
    prodActuals.filter(r => isInPeriod(r.period_start, period)).forEach(r => bump(r.product_id, 'produced', r.quantity));
    salesActuals.filter(r => isInPeriod(r.period_start, period)).forEach(r => bump(r.product_id, 'sold', r.quantity));
    return [...acc.values()].sort((a, b) => b.produced - a.produced);
  })();

  const mtdProduced = byLine.reduce((s, l) => s + l.produced, 0);
  const mtdSold = byLine.reduce((s, l) => s + l.sold, 0);

  // The single sentence a reader should leave with, stated rather than implied.
  const headline =
    atRisk.length > 0
      ? `${atRisk.length} material${atRisk.length > 1 ? 's are' : ' is'} below one month of cover and at risk of stopping production.`
      : fgBelowSafety.length > 0
        ? `Materials are covered, but ${fgBelowSafety.length} finished-goods SKU${fgBelowSafety.length > 1 ? 's are' : ' is'} below safety stock.`
        : 'No material or finished-goods coverage risks in this period.';

  const generatedAt = new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="presentation-mode space-y-5 bg-white">
      {/* Cover line */}
      <header className="print-block border-b-2 border-slate-900 pb-4">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Supply Chain Review</p>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mt-1">
              {formatPlanningPeriod(period)}
            </h1>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Generated</p>
            <p className="text-[13px] font-mono text-slate-700">{generatedAt}</p>
          </div>
        </div>
        <p className="mt-3 text-[15px] font-semibold text-slate-800 leading-snug max-w-4xl">{headline}</p>
      </header>

      {/* Headline figures */}
      <section className="print-block grid grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'OOS risk', value: atRisk.length, icon: AlertOctagon, tone: atRisk.length ? 'text-red-700' : 'text-emerald-700', sub: 'materials < 1 mo' },
          { label: 'Overstock', value: overstocked.length, icon: PackageCheck, tone: 'text-sky-700', sub: 'materials > 3 mo' },
          { label: 'In transit', value: pendingShipments.length, icon: Ship, tone: 'text-slate-800', sub: 'shipments inbound' },
          { label: 'Containers', value: containers.filter(c => c.status !== 'delivered').length, icon: ContainerIcon, tone: demurrageDays > 10 ? 'text-red-700' : 'text-slate-800', sub: `${demurrageDays}d demurrage` },
          { label: 'Open orders', value: openOrders.length, icon: Ship, tone: 'text-slate-800', sub: 'export book' },
          { label: 'Sales ach.', value: hasSalesActuals && salesAchievement !== null ? `${salesAchievement.toFixed(0)}%` : '—', icon: PackageCheck, tone: 'text-slate-800', sub: hasSalesActuals ? 'actual vs plan' : 'not reported' },
        ].map(k => (
          <div key={k.label} className="border border-slate-200 rounded-xl p-3">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[9.5px] font-bold uppercase tracking-wider text-slate-500 leading-tight">{k.label}</span>
              <k.icon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </div>
            <p className={`pack-figure text-2xl font-extrabold mt-1 leading-none ${k.tone}`}>{k.value}</p>
            <p className="text-[10px] text-slate-500 mt-1">{k.sub}</p>
          </div>
        ))}
      </section>

      {/* Executive Strategic Horizon Trends (6 Core Management Charts) */}
      <Section
        title="Executive Strategic Horizon Trends — Sales, Production, Material & Finished Goods Coverage"
        note={chartCaption(executiveCharts, 'Planning horizon for C-suite and Board review')}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SalesByPcsChart data={executiveCharts.salesByPcs} height={220} />
          <ProductionByPcsChart data={executiveCharts.productionByPcs} height={220} />
          <RawMaterialCoverageChart data={executiveCharts.rmCoverageMonths} height={220} />
          <RawMaterialStockChart data={executiveCharts.rmStockUsagePo} height={220} />
          <FGStockCoverageChart data={executiveCharts.fgStockCoverage} height={220} />
          <FGStockVsSalesChart data={executiveCharts.fgStkVsSales} height={220} />
        </div>
      </Section>

      {/* Commercial: plan vs actual per SKU */}
      <Section
        title="Sales — plan against actual"
        note={hasSalesActuals
          ? 'Forecast, recorded sales and the production plan behind them.'
          : 'No sales actuals reported for this period yet — blank means not reported, not zero.'}
      >
        <ResponsiveContainer width="100%" height={210}>
          <BarChart data={salesData} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={formatQtyCompact} />
            <Tooltip formatter={(v: number, n: string) => [`${Math.round(v).toLocaleString()} PCS`, n]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar {...chartProps} dataKey="forecast" name="Forecast" fill="#1F707E" radius={[3, 3, 0, 0]} maxBarSize={26} />
            <Bar {...chartProps} dataKey="actual" name="Actual" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={26} />
            <Bar {...chartProps} dataKey="production" name="Production plan" fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={26} />
          </BarChart>
        </ResponsiveContainer>
        <p className="text-[11px] text-slate-500 mt-2">
          Forecast <b>{totalForecast.toLocaleString()} PCS</b> · Actual{' '}
          <b>{hasSalesActuals ? `${totalActual.toLocaleString()} PCS` : 'not reported'}</b>
        </p>
      </Section>

      {/* Operations: production vs sales by line */}
      <Section title="Production — month to date by line" note="Produced against sold, from recorded actuals.">
        {byLine.length === 0 ? (
          <p className="text-[12.5px] text-slate-500">No production or sales actuals recorded for this period.</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={byLine} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="line" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={formatQtyCompact} />
                <Tooltip formatter={(v: number, n: string) => [`${Math.round(v).toLocaleString()} PCS`, n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar {...chartProps} dataKey="produced" name="Produced" fill="#1F707E" radius={[3, 3, 0, 0]} maxBarSize={30} />
                <Bar {...chartProps} dataKey="sold" name="Sold" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={30} />
              </BarChart>
            </ResponsiveContainer>
            <p className="text-[11px] text-slate-500 mt-2">
              Produced <b>{mtdProduced.toLocaleString()} PCS</b> · Sold <b>{mtdSold.toLocaleString()} PCS</b>
            </p>
          </>
        )}
      </Section>

      {/* Logistics: containers and the order book, side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="Logistics — container flow" note="Each container sits in exactly one stage.">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={containerStages} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="stage" width={76} tick={{ fontSize: 10.5, fill: INK }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v: number) => [`${v} containers`, '']} />
              <Bar {...chartProps} dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={24}>
                {containerStages.map(s => <Cell key={s.stage} fill={s.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {demurrageDays > 0 && (
            <p className="text-[11px] text-amber-700 font-semibold mt-2">
              {demurrageDays} demurrage days accrued across all containers.
            </p>
          )}
        </Section>

        <Section title="Export — order book by status" note={`${exportOrders.length} orders, ${openOrders.length} still open.`}>
          {orderStatuses.length === 0 ? (
            <p className="text-[12.5px] text-slate-500">No export orders on the book.</p>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={orderStatuses} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="status" width={88} tick={{ fontSize: 10.5, fill: INK }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v: number) => [`${v} orders`, '']} />
                <Bar {...chartProps} dataKey="count" fill="#1F707E" radius={[0, 4, 4, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Section>
      </div>

      {/* Coverage: distribution then the exceptions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="Material coverage — distribution" note="How the material base sits across the risk bands.">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                {...chartProps}
                data={coverageBands}
                dataKey="count"
                nameKey="band"
                innerRadius={44}
                outerRadius={74}
                paddingAngle={2}
                label={(e: { band: string; count: number }) => `${e.band}: ${e.count}`}
                labelLine={false}
                style={{ fontSize: 10 }}
              >
                {coverageBands.map(b => <Cell key={b.band} fill={b.fill} />)}
              </Pie>
              <Tooltip formatter={(v: number, n: string) => [`${v} materials`, n]} />
            </PieChart>
          </ResponsiveContainer>
        </Section>

        <Section title="Materials requiring action" note="Lowest cover first.">
          {atRisk.length === 0 ? (
            <p className="text-[12.5px] text-slate-500">No materials below one month of cover.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={[...atRisk].sort((a, b) => a.coverage_months - b.coverage_months).slice(0, 8)
                  .map(m => ({ name: m.sku, cover: m.coverage_months, full: m.material_name }))}
                layout="vertical"
                margin={{ top: 4, right: 30, left: 8, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}mo`} />
                <YAxis type="category" dataKey="name" width={86} tick={{ fontSize: 9.5, fill: INK, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                <ReferenceLine x={1} stroke="#ef4444" strokeDasharray="4 2" />
                <Tooltip
                  formatter={(v: number, _n, p: { payload?: { full?: string } }) =>
                    [`${v} months cover`, p?.payload?.full ?? '']}
                />
                <Bar {...chartProps} dataKey="cover" fill="#ef4444" radius={[0, 4, 4, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Section>
      </div>

      {/* Caveats that exist to prevent misreading */}
      {(!hasSalesActuals || noForecast.length > 0) && (
        <section className="print-block border border-amber-200 bg-amber-50/60 rounded-xl px-4 py-3 space-y-1.5">
          {!hasSalesActuals && (
            <p className="text-[12px] text-amber-900">
              No sales actuals have been reported for this period yet. Blank figures mean
              &ldquo;not reported&rdquo;, not zero.
            </p>
          )}
          {noForecast.length > 0 && (
            <p className="text-[12px] text-amber-900">
              <b>{noForecast.length}</b> material{noForecast.length > 1 ? 's have' : ' has'} no forecast
              in this period, so no coverage figure is shown for
              {noForecast.length > 1 ? ' them' : ' it'}. This is not the same as being fully covered.
            </p>
          )}
        </section>
      )}

      <footer className="print-block pt-3 border-t border-slate-200 flex justify-between text-[10.5px] text-slate-500">
        <span>Sanita Supply Chain Planner — {formatPlanningPeriod(period)} management pack</span>
        <span>Figures as generated; refresh before circulating.</span>
      </footer>
    </div>
  );
}
