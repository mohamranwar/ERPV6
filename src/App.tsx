/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, lazy, Suspense, useRef, useMemo } from 'react';
import {
  isSupabaseConnected, getStoredCredentials,
  saveStoredCredentials, clearStoredCredentials,
  getPlanningPeriod, setPlanningPeriod, getPlannedPeriods, formatPlanningPeriod
} from './supabaseClient';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useFocusTrap } from './hooks/useFocusTrap';
import { useAuth } from './context/AuthContext';
import { useToast } from './context/ToastConfirmContext';
import LoginScreen from './components/LoginScreen';

// Core Screens split lazily
const DashboardScreen = lazy(() => import('./components/DashboardScreen'));
const BOMEditorScreen = lazy(() => import('./components/BOMEditorScreen'));
const SalesPlanScreen = lazy(() => import('./components/SalesPlanScreen'));
const ProductionPlanScreen = lazy(() => import('./components/ProductionPlanScreen'));
const MaterialDrillDown = lazy(() => import('./components/MaterialDrillDown'));
const CoverageScreen = lazy(() => import('./components/CoverageScreen'));
const FinishedGoodsAnalysis = lazy(() => import('./components/FinishedGoodsAnalysis'));
const LogisticsScreen = lazy(() => import('./components/LogisticsScreen'));
const PlanVsActualScreen = lazy(() => import('./components/PlanVsActualScreen'));
const MasterDataScreen = lazy(() => import('./components/MasterDataScreen'));
const GlobalCsvImporter = lazy(() => import('./components/GlobalCsvImporter'));
const WhatIfSimulator = lazy(() => import('./components/WhatIfSimulator'));
const ExportForecastScreen = lazy(() => import('./components/ExportForecastScreen'));
const MRPScreen = lazy(() => import('./components/MRPScreen'));
const RMForecastVarianceScreen = lazy(() => import('./components/RMForecastVarianceScreen'));
const CustomsClearanceScreen = lazy(() => import('./components/CustomsClearanceScreen'));
const SettingsScreen = lazy(() => import('./components/SettingsScreen'));
const MonthCloseContainer = lazy(() => import('./components/MonthCloseContainer'));

// Icons
import {
  LayoutDashboard, Layers, Calendar, Cpu, Play,
  Info, ShieldCheck, Database, Settings, LogOut,
  LineChart, FolderGit2, Truck, BarChart4, ClipboardList, Upload,
  ChevronLeft, ChevronRight, UserCircle2, CalendarRange, Menu, X,
  Download, Maximize2, Minimize2, Box, Sparkles, Globe, Search,
  Lock, TrendingDown,
} from 'lucide-react';

type ScreenID =
  | 'dashboard'
  | 'bom'
  | 'sales_plan'
  | 'export_forecast'
  | 'production_plan'
  | 'mrp'
  | 'drill_down'
  | 'material_inspection'
  | 'coverage'
  | 'psi'
  | 'logistics'
  | 'customs_clearance'
  | 'plan_vs_actual'
  | 'master_data'
  | 'csv_importer'
  | 'what_if'
  | 'settings'
  | 'month_close'
  | 'rm_forecast_variance';

const SCREEN_META: Record<ScreenID, { title: string; subtitle: string }> = {
  settings: { title: 'Settings', subtitle: 'Labels, thresholds, calendar and formats' },
  month_close: { title: 'Month Close', subtitle: 'Freeze a period so history stops moving' },
  rm_forecast_variance: { title: 'RM Forecast vs PO', subtitle: 'Compare planned orders against what was actually raised' },
  dashboard: { title: 'SC KPIs Dashboard', subtitle: 'Supply chain pulse at a glance' },
  bom: { title: 'BOM', subtitle: 'Bill of materials & cost engine' },
  sales_plan: { title: 'Sales Demand Plan', subtitle: 'Channel-aware forecasting' },
  export_forecast: { title: 'Export Forecast', subtitle: 'Global demand projection' },
  production_plan: { title: 'MPS Production', subtitle: 'Master production schedule by line' },
  mrp: { title: 'MRP Solver & Engine', subtitle: 'BOM explosion & planned order releases' },
  drill_down: { title: 'Material Check', subtitle: 'Interactive material trace' },
  material_inspection: { title: 'Material Inspection', subtitle: 'Detailed material analysis' },
  coverage: { title: 'Stock Coverage', subtitle: 'Runway under stock-only and total metrics' },
  psi: { title: 'PSI Analysis', subtitle: 'Production · Sales · Inventory matrix' },
  logistics: { title: 'Purchase Orders (PO)', subtitle: 'In-transit, customs, factory ETA' },
  customs_clearance: { title: 'Customs Clearance', subtitle: 'Port-to-factory cycle tracking' },
  plan_vs_actual: { title: 'Plan vs Actuals', subtitle: 'Variance and achievement analysis' },
  master_data: { title: 'Master Data', subtitle: 'Single source of truth for entities' },
  csv_importer: { title: 'Import Hub', subtitle: 'Bulk CSV upload & mapping' },
  what_if: { title: 'What-If Simulation', subtitle: 'Stress-test scenarios on the live model' },
};

const NAV_GROUPS: Array<{ label: string; items: Array<{ id: ScreenID; label: string; icon: any }> }> = [
  {
    label: 'Planning Desk',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'bom', label: 'BOM', icon: Layers },
      { id: 'sales_plan', label: 'Sales Demand', icon: Calendar },
      { id: 'export_forecast', label: 'Export Order', icon: Globe },
      { id: 'production_plan', label: 'MPS Production', icon: Cpu },
      { id: 'mrp', label: 'MRP Engine', icon: Play },
      { id: 'rm_forecast_variance', label: 'RM Forecast vs PO', icon: TrendingDown },
      { id: 'drill_down', label: 'Material Check', icon: Info },
      { id: 'material_inspection', label: 'Material Inspection', icon: ShieldCheck },
      { id: 'what_if', label: 'What-If Simulation', icon: Sparkles },
    ],
  },
  {
    label: 'Supply & Logistics',
    items: [
      { id: 'coverage', label: 'Stock Coverage', icon: ClipboardList },
      { id: 'psi', label: 'PSI Analysis', icon: BarChart4 },
      { id: 'logistics', label: 'Purchase Orders (PO)', icon: Truck },
      { id: 'customs_clearance', label: 'Customs Clearance', icon: ShieldCheck },
    ],
  },
  {
    label: 'Controls',
    items: [
      { id: 'plan_vs_actual', label: 'Plan vs Actuals', icon: LineChart },
      { id: 'master_data', label: 'Master Data', icon: FolderGit2 },
      { id: 'csv_importer', label: 'Import Hub', icon: Upload },
      { id: 'month_close', label: 'Month Close', icon: Lock },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

export default function App() {
  const { currentUser, loading: authLoading, logout, hasRole } = useAuth();
  const { showToast } = useToast();

  const [activeScreen, setActiveScreen] = useState<ScreenID>('dashboard');
  const [showConfig, setShowConfig] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Below lg the sidebar is an overlay rather than a column.
  const [navOpen, setNavOpen] = useState(false);

  // The month every analysis screen reports on.
  const [planningPeriod, setPeriod] = useState(getPlanningPeriod());
  const periodOptions = useMemo(
    () => [...new Set([...getPlannedPeriods(), planningPeriod])].sort(),
    [planningPeriod, refreshKey]
  );

  const handlePeriodChange = (period: string) => {
    setPlanningPeriod(period);
    setPeriod(period);
    setRefreshKey(prev => prev + 1);
  };

  // Persistence of search state keyed by ScreenID
  const [searchQueries, setSearchQueries] = useState<Record<string, string>>({});

  // Global Table Density (Comfortable vs Compact)
  const [tableDensity, setTableDensity] = useState<'comfortable' | 'compact'>('comfortable');

  const handleGlobalExportCsv = () => {
    window.dispatchEvent(new CustomEvent('app:export-csv'));
  };

  const activeSearchQuery = searchQueries[activeScreen] || '';
  const setActiveSearchQuery = (val: string) => {
    setSearchQueries(prev => ({ ...prev, [activeScreen]: val }));
  };

  // Supabase states
  const [dbConnected, setDbConnected] = useState(isSupabaseConnected());
  const [supUrl, setSupUrl] = useState(getStoredCredentials().url);
  const [supKey, setSupKey] = useState(getStoredCredentials().key);

  const handleSaveCredentials = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasRole('admin')) {
      showToast('Only Admin accounts can change the database connection.', 'error');
      return;
    }
    if (supUrl.trim() && supKey.trim()) {
      saveStoredCredentials(supUrl.trim(), supKey.trim());
      setDbConnected(true);
      setShowConfig(false);
      setRefreshKey(prev => prev + 1);
    }
  };

  const handleDisconnect = () => {
    if (!hasRole('admin')) {
      showToast('Only Admin accounts can disconnect the database.', 'error');
      return;
    }
    clearStoredCredentials();
    setDbConnected(false);
    setSupUrl('');
    setSupKey('');
    setRefreshKey(prev => prev + 1);
  };

  // Keyboard Shortcuts Setup
  useKeyboardShortcuts({
    onNavigate: (screen) => setActiveScreen(screen),
    onCloseModals: () => {
      setShowConfig(false);
    }
  });

  // Focus trap for config modal
  const configModalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(configModalRef, showConfig, () => setShowConfig(false));

  // Auth gate
  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-700 border-t-brand-500"></div>
      </div>
    );
  }
  if (!currentUser) {
    return <LoginScreen />;
  }

  const ScreenSkeleton = () => (
    <div className="space-y-6 animate-pulse">
      <div className="h-7 bg-slate-200 rounded-md w-1/4"></div>
      <div className="h-3 bg-slate-200 rounded-md w-1/2"></div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="h-28 card-elevated"></div>
        <div className="h-28 card-elevated"></div>
        <div className="h-28 card-elevated"></div>
      </div>
      <div className="h-72 card-elevated"></div>
    </div>
  );

  const renderActiveScreen = () => {
    return (
      <Suspense fallback={<ScreenSkeleton />}>
        {(() => {
          switch (activeScreen) {
            case 'dashboard':
              return <DashboardScreen searchQuery={activeSearchQuery} setSearchQuery={setActiveSearchQuery} onNavigate={setActiveScreen} refreshKey={refreshKey} />;
            case 'bom':
              return <BOMEditorScreen searchQuery={activeSearchQuery} setSearchQuery={setActiveSearchQuery} onNavigate={setActiveScreen} refreshKey={refreshKey} />;
            case 'sales_plan':
              return <SalesPlanScreen searchQuery={activeSearchQuery} setSearchQuery={setActiveSearchQuery} onNavigate={setActiveScreen} refreshKey={refreshKey} />;
            case 'export_forecast':
              return <ExportForecastScreen searchQuery={activeSearchQuery} setSearchQuery={setActiveSearchQuery} onNavigate={setActiveScreen} refreshKey={refreshKey} />;
            case 'production_plan':
              return <ProductionPlanScreen searchQuery={activeSearchQuery} setSearchQuery={setActiveSearchQuery} onNavigate={setActiveScreen} refreshKey={refreshKey} />;
            case 'mrp':
              return <MRPScreen searchQuery={activeSearchQuery} setSearchQuery={setActiveSearchQuery} onNavigate={setActiveScreen} refreshKey={refreshKey} />;
            case 'drill_down':
              return <MaterialDrillDown searchQuery={activeSearchQuery} setSearchQuery={setActiveSearchQuery} onNavigate={setActiveScreen} refreshKey={refreshKey} initialMode="selector" />;
            case 'material_inspection':
              return <MaterialDrillDown searchQuery={activeSearchQuery} setSearchQuery={setActiveSearchQuery} onNavigate={setActiveScreen} refreshKey={refreshKey} initialMode="detail" />;
            case 'coverage':
              return <CoverageScreen searchQuery={activeSearchQuery} setSearchQuery={setActiveSearchQuery} onNavigate={setActiveScreen} refreshKey={refreshKey} />;
            case 'psi':
              return <FinishedGoodsAnalysis searchQuery={activeSearchQuery} setSearchQuery={setActiveSearchQuery} onNavigate={setActiveScreen} refreshKey={refreshKey} />;
            case 'logistics':
              return <LogisticsScreen searchQuery={activeSearchQuery} setSearchQuery={setActiveSearchQuery} onNavigate={setActiveScreen} refreshKey={refreshKey} />;
            case 'customs_clearance':
              return <CustomsClearanceScreen />;
            case 'plan_vs_actual':
              return <PlanVsActualScreen searchQuery={activeSearchQuery} setSearchQuery={setActiveSearchQuery} onNavigate={setActiveScreen} refreshKey={refreshKey} />;
            case 'master_data':
              return <MasterDataScreen searchQuery={activeSearchQuery} setSearchQuery={setActiveSearchQuery} onNavigate={setActiveScreen} refreshKey={refreshKey} />;
            case 'csv_importer':
              return <GlobalCsvImporter onClose={() => setActiveScreen('dashboard')} refreshKey={refreshKey} />;
            case 'what_if':
              return <WhatIfSimulator searchQuery={activeSearchQuery} setSearchQuery={setActiveSearchQuery} onNavigate={setActiveScreen} refreshKey={refreshKey} />;
            case 'settings':
              return <SettingsScreen />;
            case 'month_close':
              return <MonthCloseContainer refreshKey={refreshKey} />;
            default:
              return <DashboardScreen searchQuery={activeSearchQuery} setSearchQuery={setActiveSearchQuery} onNavigate={setActiveScreen} refreshKey={refreshKey} />;
          }
        })()}
      </Suspense>
    );
  };

  const meta = SCREEN_META[activeScreen];

  return (
    <div
      className="flex h-screen font-sans text-slate-900 overflow-hidden text-start"
      id="main_app_workspace"
      dir="ltr"
      style={{ background: 'var(--color-surface-2)' }}
    >
      {/* Scrim behind the mobile drawer. */}
      {navOpen && (
        <div
          id="nav_backdrop"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-sm lg:hidden animate-fade-in"
          aria-hidden="true"
        />
      )}

      {/* 1. Sidebar */}
      <aside
        id="app_sidebar"
        className={`flex flex-col border-e border-slate-800/80 transition-[width,transform] duration-300 ease-out z-50 shrink-0
          max-lg:fixed max-lg:inset-y-0 max-lg:w-[18rem] max-lg:shadow-2xl
          ${navOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full'}
          lg:relative lg:translate-x-0
          ${sidebarPinned ? 'lg:w-64' : 'lg:w-[4.25rem]'}
          app-sidebar`}
      >
        {/* Brand header */}
        <div className="px-4 py-4 border-b border-white/5 flex items-center justify-between gap-2 min-h-[3.75rem]">
          <div className={`flex items-center gap-2.5 min-w-0 ${sidebarPinned ? 'opacity-100' : 'lg:opacity-0 max-lg:opacity-100'} transition-opacity`}>
            <div className="p-2 rounded-lg bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-lg shadow-brand-500/30 shrink-0">
              <Box className="w-4 h-4" />
            </div>
            {sidebarPinned && (
              <div className="min-w-0">
                <h2 className="text-[12px] font-extrabold text-white tracking-wider uppercase leading-none truncate">
                  {'Supply Chain'}
                </h2>
                <span className="text-[9.5px] font-mono text-brand-300/80 font-semibold block mt-1 tracking-wide">
                  v2.4 · MRP
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowConfig(true)}
              className={`p-1.5 rounded-md border transition-all shrink-0 ${
                dbConnected
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25'
                  : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
              }`}
              title={dbConnected ? 'Connected to Supabase' : 'Using offline local mock data'}
            >
              {dbConnected ? <Database className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={() => setSidebarPinned(!sidebarPinned)}
              className="p-1.5 rounded-md border border-white/10 bg-white/5 text-slate-300 hover:text-white hover:bg-white/10 transition-all shrink-0 cursor-pointer max-lg:hidden"
              title={sidebarPinned ? 'Collapse Sidebar' : 'Expand Sidebar'}
            >
              {sidebarPinned ? <ChevronLeft className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>

            <button
              id="btn_close_nav"
              onClick={() => setNavOpen(false)}
              aria-label="Close navigation"
              className="p-1.5 rounded-md border border-white/10 bg-white/5 text-slate-300 hover:text-white transition-all shrink-0 cursor-pointer lg:hidden"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2.5 py-4 space-y-5">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="space-y-1">
              {sidebarPinned && (
                <p className="px-2.5 mb-1.5 text-[9.5px] font-bold uppercase tracking-[0.16em] text-slate-400/80">
                  {group.label}
                </p>
              )}
              {group.items.map(({ id, label, icon: Icon }) => {
                const isActive = activeScreen === id;
                return (
                  <button
                    key={id}
                    id={`nav_btn_${id}`}
                    onClick={() => {
                      setActiveScreen(id);
                      setNavOpen(false);
                    }}
                    title={!sidebarPinned ? label : undefined}
                    aria-current={isActive ? 'page' : undefined}
                    className={`relative w-full flex items-center gap-3 px-2.5 py-2 text-[12.5px] font-semibold rounded-lg transition-all group ${
                      isActive
                        ? 'bg-gradient-to-r from-brand-500/30 to-violet-500/15 text-white shadow-inner shadow-black/20'
                        : 'text-slate-300 hover:text-white hover:bg-white/5'
                    } ${!sidebarPinned ? 'lg:justify-center' : ''}`}
                  >
                    {isActive && (
                      <span className="absolute inset-y-1.5 start-0 w-0.5 bg-gradient-to-b from-brand-400 to-violet-500 rounded-e-full" />
                    )}
                    <Icon
                      className={`w-4 h-4 shrink-0 transition-colors ${
                        isActive ? 'text-brand-300' : 'text-slate-400 group-hover:text-brand-300'
                      }`}
                    />
                    {sidebarPinned && <span className="truncate">{label}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Signed-in user + logout */}
        <div className="px-3 py-3 border-t border-white/5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative shrink-0">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-[11px] font-extrabold shadow-lg shadow-brand-500/30">
                {currentUser.name
                  .split(' ')
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase()}
              </div>
              <span className="absolute -bottom-0.5 -end-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full ring-2 ring-slate-900" />
            </div>
            {sidebarPinned && (
              <div className="min-w-0">
                <p className="text-[12px] font-bold text-white truncate">{currentUser.name}</p>
                <p className="text-[9.5px] font-mono uppercase text-brand-300/80 font-semibold tracking-wider">
                  {currentUser.role}
                </p>
              </div>
            )}
          </div>
          {sidebarPinned && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={logout}
                title="Sign out"
                className="p-1.5 rounded-md border border-white/10 bg-white/5 text-slate-300 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Database Engine trigger */}
        {sidebarPinned && (
          <button
            onClick={() => setShowConfig(true)}
            className="mx-2.5 mb-2.5 flex items-center justify-between gap-2 text-[10.5px] text-slate-300 hover:text-white font-semibold px-2.5 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-1.5 min-w-0">
              <Settings className="w-3.5 h-3.5 text-slate-300 shrink-0" />
              <span className="truncate">{'Database Engine'}</span>
            </span>
            <span
              className={`text-[8.5px] font-mono px-1.5 py-0.5 rounded border shrink-0 tracking-wider ${
                dbConnected
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
              }`}
            >
              {dbConnected ? 'LIVE' : 'DEMO'}
            </span>
          </button>
        )}
      </aside>

      {/* 2. Main Workbench */}
      <main className={`flex-1 flex flex-col min-w-0 overflow-hidden density-${tableDensity}`}>
        {/* Top header */}
        <header className="h-14 bg-white/85 backdrop-blur-md border-b border-slate-200/80 px-3 sm:px-5 flex items-center justify-between gap-3 shrink-0 sticky top-0 z-30">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <button
              id="btn_mobile_nav"
              onClick={() => setNavOpen(true)}
              aria-label="Open navigation"
              aria-expanded={navOpen}
              className="lg:hidden -ms-1 p-2 rounded-lg text-slate-600 hover:bg-slate-100 active:bg-slate-200 transition-colors shrink-0 cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="text-[14px] sm:text-[15px] font-extrabold text-slate-900 tracking-tight truncate">
                  {meta.title}
                </h1>
                <span className="hidden sm:inline-flex pill pill-brand shrink-0">
                  {dbConnected ? 'Live DB' : 'Demo Mode'}
                </span>
              </div>
              <p className="hidden sm:block text-[11.5px] text-slate-500 truncate leading-tight mt-0.5">
                {meta.subtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Density toggle */}
            <button
              onClick={() => setTableDensity((prev) => (prev === 'comfortable' ? 'compact' : 'comfortable'))}
              className="flex items-center gap-1.5 px-2.5 h-8 text-[11.5px] font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:text-brand-600 hover:border-brand-200 transition-all cursor-pointer"
              title={
                tableDensity === 'comfortable'
                  ? 'Switch to Compact View (fit more rows)'
                  : 'Switch to Comfortable View'
              }
            >
              {tableDensity === 'comfortable' ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5 text-slate-500" />
                  <span className="hidden sm:inline">Compact</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5 text-brand-600" />
                  <span className="hidden sm:inline">Comfortable</span>
                </>
              )}
            </button>

            <div className="h-5 w-px bg-slate-200 mx-0.5 hidden sm:block" />

            {/* Planning period picker */}
            <div
              className="flex items-center gap-1.5 h-8 px-2.5 bg-white border border-slate-200 rounded-lg hover:border-brand-200 transition-colors"
              id="planning_period_picker"
            >
              <CalendarRange className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <select
                value={planningPeriod}
                onChange={(e) => handlePeriodChange(e.target.value)}
                title="Planning period reported on by Coverage, PSI, Plan vs Actuals and the dashboard"
                className="bg-transparent text-[11.5px] font-bold text-slate-700 focus:outline-none cursor-pointer pr-1 max-w-[40vw] sm:max-w-none"
              >
                {periodOptions.map((p) => (
                  <option key={p} value={p}>
                    {formatPlanningPeriod(p)}
                  </option>
                ))}
              </select>
            </div>

            <div className="h-5 w-px bg-slate-200 mx-0.5 hidden md:block" />

            {/* Status */}
            <div
              className="hidden md:flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 shrink-0"
              title={dbConnected ? 'Active production DB' : 'Sandboxed local mode'}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  dbConnected ? 'bg-emerald-500 animate-pulse-soft' : 'bg-amber-500'
                }`}
              />
              <span className="text-slate-600 font-bold">
                {dbConnected ? 'Connected' : 'Local mode'}
              </span>
            </div>
          </div>
        </header>

        {/* Screen viewport — extra bottom padding on mobile for the tab bar */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8 pb-20 lg:pb-8">
            {renderActiveScreen()}
          </div>
        </div>
      </main>

      {/* 3. Mobile bottom tab bar (lg: hidden) */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-white border-t border-slate-200 flex"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Mobile navigation"
      >
        {([
          { id: 'dashboard',    label: 'Dashboard', icon: LayoutDashboard },
          { id: 'coverage',     label: 'Coverage',  icon: ClipboardList   },
          { id: 'logistics',    label: 'Logistics', icon: Truck           },
          { id: 'mrp',          label: 'MRP',       icon: Play            },
          { id: 'master_data',  label: 'Data',      icon: FolderGit2      },
        ] as Array<{ id: ScreenID; label: string; icon: any }>).map(({ id, label, icon: Icon }) => {
          const active = activeScreen === id;
          return (
            <button
              key={id}
              onClick={() => { setActiveScreen(id); setNavOpen(false); }}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-semibold transition-colors
                ${active ? 'text-brand-600' : 'text-slate-400 hover:text-slate-700'}`}
              aria-current={active ? 'page' : undefined}
            >
              <Icon className={`w-5 h-5 ${active ? 'text-brand-600' : ''}`} />
              {label}
            </button>
          );
        })}
      </nav>

      {/* 4. Supabase Credentials Dialog */}
      {showConfig && (
        <div
          className="fixed inset-0 z-[4500] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in"
          ref={configModalRef}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col border border-slate-200">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-brand-50 via-white to-violet-50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-white border border-brand-100 text-brand-600 shadow-sm">
                  <Database className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 tracking-tight">
                    Database Integration
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Connect your Supabase project
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowConfig(false)}
                className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 w-7 h-7 rounded-md flex items-center justify-center transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCredentials} className="p-6 space-y-4">
              <div className="bg-brand-50 border border-brand-100 p-3.5 rounded-xl text-[12px] text-brand-900 space-y-1.5 leading-relaxed">
                <p className="font-bold flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" /> Connect Your Supabase Instance
                </p>
                <p className="text-brand-800/80">
                  Run <code className="px-1 py-0.5 bg-white border border-brand-100 rounded text-[11px] font-mono">schema.sql</code> (repository root) in your Supabase SQL editor first. It creates the planning tables, indexes, and the Row Level Security policies that enforce access control.
                </p>
                <p className="text-brand-800/80">
                  Then follow section 10 of that file to link your Supabase Auth account to an <b>admin</b> row in <code className="px-1 py-0.5 bg-white border border-brand-100 rounded text-[11px] font-mono">public.users</code> — until you do, RLS will correctly refuse every write.
                </p>
              </div>

              {!hasRole('admin') && (
                <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg text-[11.5px] text-amber-800 font-semibold">
                  Only Admin accounts can change or disconnect the database connection. You can
                  view this dialog, but saving/disconnecting is disabled for your role.
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-[12px] font-semibold text-slate-700">
                  Supabase Project URL
                </label>
                <input
                  type="url"
                  value={supUrl}
                  onChange={(e) => setSupUrl(e.target.value)}
                  placeholder="https://your-project.supabase.co"
                  required
                  className="input-base font-mono text-[12px]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[12px] font-semibold text-slate-700">
                  Supabase Anon Key
                </label>
                <input
                  type="password"
                  value={supKey}
                  onChange={(e) => setSupKey(e.target.value)}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  required
                  className="input-base font-mono text-[12px]"
                />
              </div>

              <div className="flex justify-between items-center pt-4 border-t border-slate-100">
                {dbConnected ? (
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    className="flex items-center gap-1.5 btn-base btn-danger"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Disconnect (reset demo)
                  </button>
                ) : (
                  <div className="text-[10.5px] text-slate-400">Ready to bridge local planner to live DB.</div>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowConfig(false)}
                    className="btn-base btn-secondary"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-base btn-primary">
                    Connect database
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
