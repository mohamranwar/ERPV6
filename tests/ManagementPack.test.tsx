/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The management pack is read by people who will not open the app to check a
 * number. Its job is to be unambiguous on its own, so these tests pin the
 * things that would otherwise be misread: a stated headline rather than an
 * implied one, "not reported" never looking like zero, and "no forecast"
 * never looking like "fully covered".
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ManagementPack from '../src/components/ManagementPack';
import { computeExecutiveChartData } from '../src/utils/executiveCharts';
import type { VMaterialCoverage, VProductCoverage, VFGPSIAnalysis } from '../src/types';

const material = (over: Partial<VMaterialCoverage>): VMaterialCoverage => ({
  material_id: 'MT1', material_name: 'Fluff Pulp', sku: 'RM-PLP-01',
  uom: 'KG',
  category_id: 'MC1', category_name: 'Raw', material_group: 'RM',
  opening_stock: 220, monthly_demand: 1826, coverage_months: 0.12,
  coverage_months_no_transit: 0.12, oos_risk_flag: true, overstock_flag: false,
  ...over,
});

const psi = (over: Partial<VFGPSIAnalysis>): VFGPSIAnalysis => ({
  row_id: 'P1', category_id: 'C1', category_name: 'Baby', group_id: 'G1',
  group_name: 'Diapers', brand: 'BabyJoy', product_line: 'SOFY',
  pack_type: 'Bag', size: 'S4', status: 'running',
  start_stock: 65000, sales_forecast: 275000, actual_sales: 191000,
  sales_achievement_percent: 69.5, production_plan: 305000,
  production_achievement_percent: null, expected_stock: 95000,
  coverage_months: 0.35, sales_actual_records: 2, production_actual_records: 1,
  ...over,
} as VFGPSIAnalysis);

const base = {
  period: '2026-08-01',
  productCoverages: [] as VProductCoverage[],
  salesAchievement: 69.5,
  hasSalesActuals: true,
  // Operational inputs added when the pack became graph-led. Empty by default
  // so each test states only the data its own assertion depends on.
  shipments: [],
  containers: [],
  exportOrders: [],
  products: [],
  prodActuals: [],
  salesActuals: [],
  // The six executive charts take real series now. Computing from empty
  // inputs yields an empty window, which is the point: the pack previously
  // fell through to a hardcoded seed and rendered demo figures whatever the
  // database held.
  executiveCharts: computeExecutiveChartData({ anchor: '2026-08', months: 12 }),
};

describe('<ManagementPack />', () => {
  it('names the period it reports on', () => {
    render(<ManagementPack {...base} materialCoverages={[]} fgPsi={[]} />);
    // Scoped to the heading: the period also appears in the footer strapline.
    expect(screen.getByRole('heading', { level: 1, name: /August 2026/ })).toBeInTheDocument();
  });

  it('states the conclusion rather than leaving it to be inferred', () => {
    render(<ManagementPack {...base} materialCoverages={[material({})]} fgPsi={[]} />);
    expect(
      screen.getByText(/below one month of cover and at risk of stopping production/i)
    ).toBeInTheDocument();
  });

  it('says so plainly when there is nothing at risk', () => {
    render(
      <ManagementPack {...base} fgPsi={[]}
        materialCoverages={[material({ oos_risk_flag: false, coverage_months: 2.4 })]} />
    );
    expect(screen.getByText(/No material or finished-goods coverage risks/i)).toBeInTheDocument();
  });

  it('gives at-risk materials their own section', () => {
    // Chart internals (axis ticks, bars) are not asserted: Recharts sizes
    // itself from its parent, and in jsdom that parent has zero dimensions, so
    // nothing inside a ResponsiveContainer is ever rendered. The section and
    // its empty-state branch are real DOM and are what these tests cover.
    render(<ManagementPack {...base} materialCoverages={[material({})]} fgPsi={[]} />);
    expect(screen.getByText('Materials requiring action')).toBeInTheDocument();
    expect(screen.queryByText(/No materials below one month of cover/i)).not.toBeInTheDocument();
  });

  it('says so explicitly when no material is at risk', () => {
    render(
      <ManagementPack {...base} fgPsi={[]}
        materialCoverages={[material({ oos_risk_flag: false, coverage_months: 2.4 })]} />
    );
    expect(screen.getByText(/No materials below one month of cover/i)).toBeInTheDocument();
  });

  it('warns that unreported actuals are not zero sales', () => {
    // The whole point: a blank actuals column must not be read as "we sold
    // nothing", which would turn a reporting gap into a fabricated crisis.
    render(
      <ManagementPack {...base} hasSalesActuals={false} salesAchievement={null}
        materialCoverages={[]} fgPsi={[psi({ sales_actual_records: 0, actual_sales: 0 })]} />
    );
    // Stated twice by design — once on the sales chart and once in the
    // caveats block — so a reader meets it wherever they enter the document.
    expect(screen.getAllByText(/not reported.*not zero/is).length).toBeGreaterThan(0);
  });

  it('flags materials with no forecast rather than implying they are covered', () => {
    render(
      <ManagementPack {...base} fgPsi={[]}
        materialCoverages={[material({ monthly_demand: 0, oos_risk_flag: false })]} />
    );
    expect(screen.getByText(/not the same as being\s+fully covered/i)).toBeInTheDocument();
  });

  it('reports sales forecast and actual totals', () => {
    render(<ManagementPack {...base} materialCoverages={[]} fgPsi={[psi({})]} />);
    expect(screen.getByText(/Sales — plan against actual/)).toBeInTheDocument();
    expect(screen.getByText(/275,000 PCS/)).toBeInTheDocument();
    expect(screen.getByText(/191,000 PCS/)).toBeInTheDocument();
  });
});
