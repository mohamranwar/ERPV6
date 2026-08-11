/**
 * CustomsClearanceScreen — tracks the end-to-end customs lifecycle for each
 * shipment: port arrival → exam → release → factory delivery.
 *
 * Features:
 * - Job list with status badge + cycle-time KPIs
 * - Expandable container detail panel (partial-release aware)
 * - Per-container demurrage / detention tracker
 * - Document checklist per job
 * - Landed-cost charge lines (report only — does not affect BOM costs, decision 2)
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useFirstLoad } from '../hooks/useFirstLoad';
import {
  fetchTableData, saveRecord
} from '../supabaseClient';
import type {
  ClearanceCompany, ClearanceJob, ClearanceContainer,
  ClearanceDocument, ClearanceCharge, Shipment, Material, Supplier
} from '../types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastConfirmContext';
import ContentHeader from './ContentHeader';
import { Card, StatusBadge, Modal, FormField, inputCls, selectCls } from './ui';
import type { StatusIntent } from './ui';
import DataStateWrapper from './DataStateWrapper';
import ScrollableTable from './ScrollableTable';
import {
  Container, FileText, DollarSign, Clock, AlertTriangle,
  ChevronDown, ChevronRight, Plus, RefreshCw, Truck
} from 'lucide-react';

// ── helpers ───────────────────────────────────────────────────────────────

function daysBetween(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null;
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
}

const JOB_STATUS_INTENT: Record<ClearanceJob['status'], StatusIntent> = {
  pending:        'neutral',
  in_progress:    'transit',
  partial_release:'warning',
  cleared:        'cleared',
  held:           'danger',
};

const CONTAINER_STATUS_INTENT: Record<ClearanceContainer['status'], StatusIntent> = {
  pending:     'neutral',
  under_exam:  'warning',
  released:    'info',
  delivered:   'healthy',
};

const DOC_STATUS_INTENT: Record<ClearanceDocument['status'], StatusIntent> = {
  pending:   'danger',
  received:  'neutral',
  submitted: 'transit',
  approved:  'healthy',
  rejected:  'oos',
};

function fmtDocType(t: ClearanceDocument['doc_type']): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function fmtChargeType(t: ClearanceCharge['charge_type']): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── component ─────────────────────────────────────────────────────────────

export default function CustomsClearanceScreen() {
  const { hasRole } = useAuth();
  const { showToast } = useToast();

  const [companies, setCompanies]     = useState<ClearanceCompany[]>([]);
  const [jobs, setJobs]               = useState<ClearanceJob[]>([]);
  const [containers, setContainers]   = useState<ClearanceContainer[]>([]);
  const [documents, setDocuments]     = useState<ClearanceDocument[]>([]);
  const [charges, setCharges]         = useState<ClearanceCharge[]>([]);
  const [shipments, setShipments]     = useState<Shipment[]>([]);
  const [materials, setMaterials]     = useState<Material[]>([]);
  const [suppliers, setSuppliers]     = useState<Supplier[]>([]);
  const [loading, setLoading]         = useState(true);
  const { isFirstLoad, markLoaded } = useFirstLoad('customs');
  const [error, setError]             = useState<string | null>(null);

  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // Job edit modal
  const [showJobModal, setShowJobModal]   = useState(false);
  const [editJob, setEditJob]             = useState<ClearanceJob | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [co, jo, cn, dc, ch, sh, mt, su] = await Promise.all([
        fetchTableData<ClearanceCompany>('clearance_companies'),
        fetchTableData<ClearanceJob>('clearance_jobs'),
        fetchTableData<ClearanceContainer>('clearance_containers'),
        fetchTableData<ClearanceDocument>('clearance_documents'),
        fetchTableData<ClearanceCharge>('clearance_charges'),
        fetchTableData<Shipment>('shipments'),
        fetchTableData<Material>('materials'),
        fetchTableData<Supplier>('suppliers'),
      ]);
      setCompanies(co); setJobs(jo); setContainers(cn);
      setDocuments(dc); setCharges(ch); setShipments(sh);
      setMaterials(mt); setSuppliers(su);
    } catch (e) {
      setError('Failed to load clearance data.');
    } finally {
      setLoading(false);
      markLoaded();
    }
  }

  useEffect(() => { loadData(); }, []);

  // ── derived data ──────────────────────────────────────────────────────
  const filteredJobs = useMemo(() =>
    filterStatus === 'all' ? jobs : jobs.filter(j => j.status === filterStatus),
    [jobs, filterStatus]
  );

  /** KPI: average port-to-factory cycle time across cleared jobs */
  const avgCycleTime = useMemo(() => {
    const cleared = jobs.filter(j => j.actual_factory_date && j.port_arrival_date);
    if (!cleared.length) return null;
    const total = cleared.reduce((s, j) => s + (daysBetween(j.port_arrival_date, j.actual_factory_date) ?? 0), 0);
    return Math.round(total / cleared.length);
  }, [jobs]);

  /** KPI: total demurrage days across all containers */
  const totalDemurrageDays = useMemo(() =>
    containers.reduce((s, c) => s + (c.demurrage_days ?? 0), 0), [containers]);

  /** KPI: containers in partial-release state */
  const releasedNotDelivered = containers.filter(c => c.status === 'released').length;

  // ── save job ──────────────────────────────────────────────────────────
  const handleSaveJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editJob) return;
    if (!hasRole('planner')) {
      showToast('Planner or Admin access required.', 'error'); return;
    }
    try {
      const saved = await saveRecord<ClearanceJob>('clearance_jobs', editJob);
      setJobs(prev => editJob.id
        ? prev.map(j => j.id === saved.id ? saved : j)
        : [...prev, saved]);
      setShowJobModal(false);
      setEditJob(null);
      showToast('Clearance job saved.', 'success');
    } catch {
      showToast('Error saving clearance job.', 'error');
    }
  };

  const openNewJob = () => {
    if (!hasRole('planner')) {
      showToast('Planner or Admin access required.', 'error'); return;
    }
    const today = new Date().toISOString().slice(0, 10);
    setEditJob({
      id: '',
      shipment_id: shipments[0]?.id ?? '',
      company_id: companies[0]?.id ?? '',
      port_arrival_date: today,
      planned_factory_date: '',
      actual_factory_date: undefined as unknown as string,
      status: 'pending',
    });
    setShowJobModal(true);
  };

  // ── render ────────────────────────────────────────────────────────────
  return (
    <DataStateWrapper loading={loading && isFirstLoad} error={error} isEmpty={!loading && jobs.length === 0}
      emptyMessage="No clearance jobs yet — create one to start tracking a shipment through customs."
      onRetry={loadData}
    >
      <ContentHeader
        title="Customs Clearance & Demurrage Control"
        actions={
          <div className="flex items-center gap-2.5">
            <button onClick={loadData} className="btn-base btn-sky gap-1.5 shadow-sm">
              <RefreshCw className="w-3.5 h-3.5 text-white" /> Refresh
            </button>
            {hasRole('planner') && (
              <button onClick={openNewJob} className="btn-base btn-purple gap-1.5 shadow-sm">
                <Plus className="w-3.5 h-3.5 text-white" /> New Job
              </button>
            )}
          </div>
        }
      />
      {/* ── KPI row ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Card padding="sm">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-brand-500" />
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Avg Cycle Time</span>
          </div>
          <p className="text-2xl font-extrabold text-slate-800">
            {avgCycleTime != null ? `${avgCycleTime}d` : '—'}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">port → factory</p>
        </Card>

        <Card padding="sm">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total Demurrage</span>
          </div>
          <p className={`text-2xl font-extrabold ${totalDemurrageDays > 10 ? 'text-red-700' : 'text-slate-800'}`}>
            {totalDemurrageDays}d
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">across all containers</p>
        </Card>

        <Card padding="sm">
          <div className="flex items-center gap-2 mb-1">
            <Container className="w-4 h-4 text-sky-500" />
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Released / Pending Delivery</span>
          </div>
          <p className="text-2xl font-extrabold text-slate-800">{releasedNotDelivered}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">containers</p>
        </Card>

        <Card padding="sm">
          <div className="flex items-center gap-2 mb-1">
            <Truck className="w-4 h-4 text-emerald-500" />
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Active Jobs</span>
          </div>
          <p className="text-2xl font-extrabold text-slate-800">
            {jobs.filter(j => j.status === 'in_progress' || j.status === 'partial_release').length}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">in-progress</p>
        </Card>
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <select aria-label="Filter by status"
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[12.5px] font-medium text-slate-700 shadow-sm focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="partial_release">Partial Release</option>
            <option value="cleared">Cleared</option>
            <option value="held">Held</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} className="btn-base btn-secondary gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          {hasRole('planner') && (
            <button onClick={openNewJob} className="btn-base btn-primary gap-1.5">
              <Plus className="w-3.5 h-3.5" /> New Job
            </button>
          )}
        </div>
      </div>

      {/* ── Jobs list ───────────────────────────────────────────────── */}
      <div className="space-y-3">
        {filteredJobs.map(job => {
          const shipment  = shipments.find(s => s.id === job.shipment_id);
          const material  = materials.find(m => m.id === shipment?.material_id);
          const supplier  = suppliers.find(s => s.id === shipment?.supplier_id);
          const company   = companies.find(c => c.id === job.company_id);
          const jobCtrs   = containers.filter(c => c.job_id === job.id);
          const jobDocs   = documents.filter(d => d.job_id === job.id);
          const jobChgs   = charges.filter(c => c.job_id === job.id);
          const isOpen    = expandedJob === job.id;
          const cycleTime = daysBetween(job.port_arrival_date, job.actual_factory_date ?? job.planned_factory_date);
          const pendingDocs = jobDocs.filter(d => d.status === 'pending').length;
          const totalChargesEGP = jobChgs
            .filter(c => c.currency === 'EGP')
            .reduce((s, c) => s + c.amount, 0);

          return (
            <Card key={job.id} padding="none">
              {/* Job header */}
              <button
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-50 transition-colors rounded-xl"
                onClick={() => setExpandedJob(isOpen ? null : job.id)}
                aria-expanded={isOpen}
              >
                <span className={`transition-transform ${isOpen ? 'rotate-90' : ''}`}>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </span>

                {/* Material + shipment */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-slate-800 truncate">
                      {material?.name ?? shipment?.id ?? job.shipment_id}
                    </span>
                    <StatusBadge intent={JOB_STATUS_INTENT[job.status]} dot>
                      {job.status.replace(/_/g, ' ')}
                    </StatusBadge>
                    {pendingDocs > 0 && (
                      <StatusBadge intent="danger">
                        {pendingDocs} doc{pendingDocs > 1 ? 's' : ''} missing
                      </StatusBadge>
                    )}
                  </div>
                  <p className="text-[11.5px] text-slate-500 mt-0.5">
                    {supplier?.name ?? '—'} · {shipment?.invoice_no ?? '—'} · via {company?.name ?? '—'}
                  </p>
                </div>

                {/* Date summary */}
                <div className="hidden sm:flex items-center gap-6 text-[11.5px] text-slate-500 shrink-0">
                  <span>Port <b className="text-slate-700">{fmtDate(job.port_arrival_date)}</b></span>
                  <span>→</span>
                  <span>
                    {job.actual_factory_date
                      ? <><b className="text-emerald-700">{fmtDate(job.actual_factory_date)}</b> <span className="text-slate-400">(actual)</span></>
                      : <><b className="text-slate-700">{fmtDate(job.planned_factory_date)}</b> <span className="text-slate-400">(planned)</span></>
                    }
                  </span>
                  {cycleTime != null && (
                    <span className="pill pill-muted">{cycleTime}d</span>
                  )}
                </div>

                {/* Charge total */}
                {totalChargesEGP > 0 && (
                  <div className="hidden lg:block shrink-0 text-right">
                    <span className="text-[11px] text-slate-400 block">EGP charges</span>
                    <span className="text-[13px] font-bold text-slate-700 tabular-nums">
                      {totalChargesEGP.toLocaleString()}
                    </span>
                  </div>
                )}

                {/* Container count */}
                <div className="shrink-0 flex items-center gap-1 text-[11.5px] text-slate-500">
                  <Container className="w-3.5 h-3.5" />
                  {jobCtrs.length}
                </div>
              </button>

              {/* Expanded detail */}
              {isOpen && (
                <div className="border-t border-slate-100 divide-y divide-slate-100">

                  {/* Container table */}
                  {jobCtrs.length > 0 && (
                    <div className="p-4">
                      <h4 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <Container className="w-3.5 h-3.5" /> Containers ({jobCtrs.length})
                      </h4>
                      <ScrollableTable>
                        <table className="w-full text-[12px]">
                          <thead>
                            <tr>
                              {['Container #', 'Size', 'Weight', 'Port Arrival', 'Customs Exam', 'Release', 'Factory', 'Demurrage', 'Detention', 'Status'].map(h => (
                                <th key={h} className="text-left px-2 py-1.5">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {jobCtrs.map(c => (
                              <tr key={c.id}>
                                <td className="px-2 py-2 font-mono text-[11px]">{c.container_no}</td>
                                <td className="px-2 py-2 text-center">{c.size_ft ? `${c.size_ft}'` : '—'}</td>
                                <td className="px-2 py-2 text-right tabular-nums">{c.gross_weight_kg ? c.gross_weight_kg.toLocaleString() : '—'}</td>
                                <td className="px-2 py-2 text-center font-mono">{fmtDate(c.port_arrival_date)}</td>
                                <td className="px-2 py-2 text-center font-mono">{fmtDate(c.customs_exam_date)}</td>
                                <td className="px-2 py-2 text-center font-mono">{fmtDate(c.release_date)}</td>
                                <td className="px-2 py-2 text-center font-mono">{fmtDate(c.factory_arrival_date)}</td>
                                <td className={`px-2 py-2 text-center tabular-nums font-semibold ${(c.demurrage_days ?? 0) > 3 ? 'text-red-600' : 'text-slate-600'}`}>
                                  {(c.demurrage_days ?? 0) > 0 ? `${c.demurrage_days}d` : '—'}
                                </td>
                                <td className={`px-2 py-2 text-center tabular-nums font-semibold ${(c.detention_days ?? 0) > 0 ? 'text-amber-700' : 'text-slate-400'}`}>
                                  {(c.detention_days ?? 0) > 0 ? `${c.detention_days}d` : '—'}
                                </td>
                                <td className="px-2 py-2">
                                  <StatusBadge intent={CONTAINER_STATUS_INTENT[c.status]} dot>
                                    {c.status.replace(/_/g, ' ')}
                                  </StatusBadge>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </ScrollableTable>
                    </div>
                  )}

                  {/* Documents + Charges side-by-side on lg */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-100">
                    {/* Documents */}
                    <div className="p-4">
                      <h4 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5" /> Documents
                      </h4>
                      {jobDocs.length === 0
                        ? <p className="text-[12px] text-slate-400">No documents recorded.</p>
                        : (
                          <ul className="space-y-1.5">
                            {jobDocs.map(doc => (
                              <li key={doc.id} className="flex items-center justify-between gap-2 text-[12px]">
                                <span className="text-slate-700">{fmtDocType(doc.doc_type)}</span>
                                <div className="flex items-center gap-2">
                                  {doc.doc_ref && <span className="text-slate-400 font-mono text-[10.5px]">{doc.doc_ref}</span>}
                                  <StatusBadge intent={DOC_STATUS_INTENT[doc.status]}>
                                    {doc.status}
                                  </StatusBadge>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )
                      }
                    </div>

                    {/* Charges */}
                    <div className="p-4">
                      <h4 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <DollarSign className="w-3.5 h-3.5" /> Charges
                        <span className="text-[10px] text-slate-400 normal-case font-normal ml-1">(landed cost report — does not affect BOM)</span>
                      </h4>
                      {jobChgs.length === 0
                        ? <p className="text-[12px] text-slate-400">No charges recorded.</p>
                        : (
                          <table className="w-full text-[12px]">
                            <thead>
                              <tr className="text-[10.5px] text-slate-400 uppercase">
                                <th className="text-left pb-1">Type</th>
                                <th className="text-right pb-1">Currency</th>
                                <th className="text-right pb-1">Amount</th>
                                <th className="text-center pb-1">Paid</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {jobChgs.map(ch => (
                                <tr key={ch.id}>
                                  <td className="py-1 text-slate-700">{fmtChargeType(ch.charge_type)}</td>
                                  <td className="py-1 text-right font-mono text-slate-500">{ch.currency}</td>
                                  <td className="py-1 text-right font-mono font-semibold text-slate-800">
                                    {ch.amount.toLocaleString(undefined, { minimumFractionDigits: 0 })}
                                  </td>
                                  <td className="py-1 text-center">
                                    {ch.paid_date
                                      ? <StatusBadge intent="healthy">paid</StatusBadge>
                                      : <StatusBadge intent="neutral">pending</StatusBadge>
                                    }
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )
                      }
                    </div>
                  </div>

                  {/* Job notes + edit button */}
                  <div className="px-4 py-3 flex items-center justify-between gap-2 bg-slate-50/60">
                    <p className="text-[11.5px] text-slate-500 italic">
                      {job.notes || 'No notes.'}
                    </p>
                    {hasRole('planner') && (
                      <button
                        className="btn-base btn-secondary text-xs"
                        onClick={() => { setEditJob(job); setShowJobModal(true); }}
                      >
                        Edit Job
                      </button>
                    )}
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* ── Edit / New Job Modal ─────────────────────────────────────── */}
      <Modal
        open={showJobModal}
        onClose={() => { setShowJobModal(false); setEditJob(null); }}
        title={editJob?.id ? 'Edit Clearance Job' : 'New Clearance Job'}
        footer={
          <>
            <button className="btn-base btn-secondary" onClick={() => setShowJobModal(false)}>Cancel</button>
            <button className="btn-base btn-primary" form="clearance-job-form" type="submit">Save</button>
          </>
        }
      >
        {editJob && (
          <form id="clearance-job-form" onSubmit={handleSaveJob} className="space-y-4">
            <FormField label="Shipment" htmlFor="cj-shipment" required>
              <select
                id="cj-shipment"
                className={selectCls}
                value={editJob.shipment_id}
                onChange={e => setEditJob({ ...editJob, shipment_id: e.target.value })}
              >
                {shipments.map(s => (
                  <option key={s.id} value={s.id}>
                    {materials.find(m => m.id === s.material_id)?.name ?? s.id} — {s.invoice_no ?? s.id}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Clearance Company" htmlFor="cj-company" required>
              <select
                id="cj-company"
                className={selectCls}
                value={editJob.company_id}
                onChange={e => setEditJob({ ...editJob, company_id: e.target.value })}
              >
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Port Arrival" htmlFor="cj-port">
                <input id="cj-port" type="date" className={inputCls}
                  value={editJob.port_arrival_date ?? ''}
                  onChange={e => setEditJob({ ...editJob, port_arrival_date: e.target.value })}
                />
              </FormField>
              <FormField label="Planned Factory Date" htmlFor="cj-planned">
                <input id="cj-planned" type="date" className={inputCls}
                  value={editJob.planned_factory_date ?? ''}
                  onChange={e => setEditJob({ ...editJob, planned_factory_date: e.target.value })}
                />
              </FormField>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Actual Factory Date" htmlFor="cj-actual">
                <input id="cj-actual" type="date" className={inputCls}
                  value={editJob.actual_factory_date ?? ''}
                  onChange={e => setEditJob({ ...editJob, actual_factory_date: e.target.value || (null as unknown as string) })}
                />
              </FormField>
              <FormField label="Status" htmlFor="cj-status" required>
                <select id="cj-status" className={selectCls}
                  value={editJob.status}
                  onChange={e => setEditJob({ ...editJob, status: e.target.value as ClearanceJob['status'] })}
                >
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="partial_release">Partial Release</option>
                  <option value="cleared">Cleared</option>
                  <option value="held">Held</option>
                </select>
              </FormField>
            </div>

            <FormField label="Notes" htmlFor="cj-notes">
              <textarea id="cj-notes" rows={2} className={inputCls}
                value={editJob.notes ?? ''}
                onChange={e => setEditJob({ ...editJob, notes: e.target.value })}
              />
            </FormField>
          </form>
        )}
      </Modal>
    </DataStateWrapper>
  );
}
