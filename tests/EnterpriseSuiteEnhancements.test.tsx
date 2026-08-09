import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import WhatIfSimulator from '../src/components/WhatIfSimulator';
import CustomsClearanceScreen from '../src/components/CustomsClearanceScreen';
import ProductionPlanScreen from '../src/components/ProductionPlanScreen';
import DashboardScreen from '../src/components/DashboardScreen';
import { ToastConfirmProvider } from '../src/context/ToastConfirmContext';
import { AuthProvider } from '../src/context/AuthContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>
    <ToastConfirmProvider>{children}</ToastConfirmProvider>
  </AuthProvider>
);

describe('Enterprise Supply Chain Suite Enhancements', () => {
  it('renders What-If Simulator with stress scenario sliders and toggle', () => {
    render(<WhatIfSimulator />, { wrapper });
    expect(screen.getByText(/What-If Production & Stress Scenario Simulator/i)).toBeInTheDocument();
    expect(screen.getByText(/Supplier Transit Delay/i)).toBeInTheDocument();
    expect(screen.getByText(/Market Demand Surge/i)).toBeInTheDocument();
    expect(screen.getByText(/Auto-Route Deficits to Approved Priority 2 Alternate Materials/i)).toBeInTheDocument();
  });

  it('renders Customs Clearance Screen without Demurrage Risk Predictor banner', async () => {
    render(<CustomsClearanceScreen />, { wrapper });
    const avgCycleText = await screen.findByText(/Avg Cycle Time/i);
    expect(avgCycleText).toBeInTheDocument();
    expect(screen.queryByText(/Port Demurrage Financial Risk Alert/i)).not.toBeInTheDocument();
  });

  it('renders Machine Load Balancer button on Production Plan Screen', async () => {
    render(<ProductionPlanScreen />, { wrapper });
    const btn = await screen.findByTitle(/Open Machine Line Load Balancer/i);
    expect(btn).toBeInTheDocument();
  });

  it('renders clean Dashboard without Copilot banner', async () => {
    render(<DashboardScreen onNavigate={vi.fn()} />, { wrapper });
    expect(await screen.findByText(/Total RM Stock Coverage/i)).toBeInTheDocument();
    expect(screen.queryByText(/Executive AI Supply Chain Copilot/i)).not.toBeInTheDocument();
  });
});
