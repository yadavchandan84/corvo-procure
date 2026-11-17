'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import { Check, CornerUpLeft, Download, Pencil } from 'lucide-react';
import { api } from '@/lib/api';
import { ErrorBox, InfoBox, PageHeader, RouteChip, Spinner, StatusChip } from '@/components/ui';
import { fmtDateTime, formatINR, formatPrice } from '@/lib/format';
import type { LineResult, RequirementResult } from '@/engine/types';
import { PreferredTable } from '@/components/PreferredTable';

interface RunListItem {
  id: string;
  label: string;
  createdAt: string;
  versionsUsed: string[];
  batch: { source: string };
}
interface Status {
  status: 'PENDING' | 'APPROVED' | 'OVERRIDDEN' | 'RETURNED';
  document?: string;
  override?: { decision: string; route: string; supplierId?: string; unitPrice?: number; suggestedSupplierIds?: string[] };
  lastComment?: string;
  by?: string;
  at?: string;
}
interface RunView {
  id: string;
  label: string;
  createdAt: string;
  createdBy: string;
  versionsUsed: string[];
  batch: { id: string; name: string; source: string };
  summary: { lines: number; requirements: number; purchaseOrders: number; notProcessed: number; byRoute: Record<string, number> };
  requirements: RequirementResult[];
  lines: LineResult[];
  status: Record<string, Status>;
  actions: { id: string; groupId: string; action: string; actor: string; comment: string | null; createdAt: string }[];
  documents: { id: string; type: string; number: string; supplierId: string | null; groupIds: string[]; totalValue: number | null; createdBy: string; createdAt: string }[];
}

type Filter = 'action' | 'all' | 'PO' | 'SOURCING' | 'done' | 'not_processed';

export default function WorkspacePage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Workspace />
    </Suspense>
  );
}

function Workspace() {
  const params = useSearchParams();
  const router = useRouter();
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [runId, setRunId] = useState<string | null>(params.get('run'));
  const [view, setView] = useState<RunView | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('action');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<RunListItem[]>('/api/runs')
      .then(async (r) => {
        setRuns(r);
        if (params.get('live')) {
          const live = await api<{ runId: string | null }>('/api/live');
          if (live.runId) return setRunId(live.runId);
        }
        if (!runId && r[0]) setRunId(r[0].id);
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async (id: string, keepSelection = false) => {
    setLoading(true);
    try {
      const v = await api<RunView>(`/api/runs/${id}`);
      setView(v);
      if (!keepSelection) setSelected(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (runId) load(runId);
  }, [runId, load]);

  const notProcessedLines = useMemo(() => view?.lines.filter((l) => l.status === 'NOT_PROCESSED') ?? [], [view]);
  const reqs = useMemo(() => {
    if (!view) return [];
    const st = (g: string) => view.status[g]?.status ?? 'PENDING';
    return view.requirements.filter((r) => {
      if (q && !`${r.groupId} ${r.itemCode} ${r.itemDescription} ${r.lineKeys.join(' ')} ${r.supplierId} ${r.poId ?? ''}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (filter === 'action') return st(r.groupId) === 'PENDING' || st(r.groupId) === 'OVERRIDDEN';
      if (filter === 'PO') return r.decision === 'PO';
      if (filter === 'SOURCING') return r.decision === 'SOURCING_REQUEST';
      if (filter === 'done') return st(r.groupId) === 'APPROVED' || st(r.groupId) === 'RETURNED';
      return true;
    });
  }, [view, filter, q]);

  useEffect(() => {
    if (!selected && reqs[0]) setSelected(reqs[0].groupId);
  }, [reqs, selected]);

  const current = view?.requirements.find((r) => r.groupId === selected) ?? null;
  const pendingCount = view ? view.requirements.filter((r) => ['PENDING', 'OVERRIDDEN'].includes(view.status[r.groupId]?.status ?? 'PENDING')).length : 0;

  async function act(body: Record<string, unknown>) {
    if (!view || !current) return;
    setError(null);
    try {
      await api(`/api/runs/${view.id}/actions`, { method: 'POST', body: JSON.stringify({ groupId: current.groupId, ...body }) });
      await load(view.id, true);
      // move to the next requirement that needs action
      const idx = reqs.findIndex((r) => r.groupId === current.groupId);
      const next = reqs.slice(idx + 1).find((r) => (view.status[r.groupId]?.status ?? 'PENDING') === 'PENDING');
      if (next && body.action === 'APPROVE') setSelected(next.groupId);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Buyer workspace"
        subtitle="Each requirement shows its PR lines, the decision, value, supplier and price or suggested suppliers, and why. Approve creates the PO or sourcing request; an override needs a written reason."
        action={
          <div className="flex items-center gap-2">
            <select
              className="input !w-80"
              value={runId ?? ''}
              onChange={(e) => {
                setRunId(e.target.value);
                router.replace(`/workspace?run=${e.target.value}`);
              }}
            >
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.batch.source === 'CHAT' ? '💬 ' : ''}
                  {r.label} · {fmtDateTime(r.createdAt)}
                </option>
              ))}
            </select>
            {view && (
              <a className="btn-secondary" href={`/api/runs/${view.id}/export`}>
                <Download size={16} /> Export CSV
              </a>
            )}
          </div>
        }
      />
      <ErrorBox error={error} />
      {!runs.length && !loading && <InfoBox>No decision runs yet. Upload a PR batch on the PR batches page, or raise a PR by chat.</InfoBox>}
      {view && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="muted">
              {view.summary.lines} lines → {view.summary.requirements} requirements → {view.summary.purchaseOrders} POs · policy {view.versionsUsed.map((v) => `v${v}`).join(', ')} · run by {view.createdBy}
            </span>
            <span className="ml-auto" />
            {Object.entries(view.summary.byRoute).map(([k, v]) => (
              <span key={k} className="flex items-center gap-1">
                <RouteChip route={k} />
                <span className="text-xs text-slate-500">{v}</span>
              </span>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
            <div className="card flex max-h-[calc(100vh-230px)] flex-col">
              <div className="space-y-2 border-b border-slate-200 p-3">
                <div className="flex flex-wrap gap-1">
                  {(
                    [
                      ['action', `Needs action (${pendingCount})`],
                      ['PO', 'POs'],
                      ['SOURCING', 'Sourcing'],
                      ['done', 'Done'],
                      ['all', 'All'],
                      ['not_processed', `Not processed (${notProcessedLines.length})`],
                    ] as [Filter, string][]
                  ).map(([k, label]) => (
                    <button key={k} onClick={() => { setFilter(k); setSelected(null); }} className={clsx('chip cursor-pointer', filter === k ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')}>
                      {label}
                    </button>
                  ))}
                </div>
                <input className="input" placeholder="Search item, PR, supplier, PO…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div className="flex-1 overflow-y-auto">
                {filter === 'not_processed'
                  ? notProcessedLines.map((l) => (
                      <div key={l.key} className="border-b border-slate-100 p-3 text-sm">
                        <div className="font-medium">{l.key}</div>
                        <div className="muted">{l.input.description || l.input.itemCode}</div>
                        <div className="mt-1 text-xs text-rose-700">{l.notProcessedReason}</div>
                      </div>
                    ))
                  : reqs.map((r) => {
                      const st = view.status[r.groupId]?.status ?? 'PENDING';
                      return (
                        <button key={r.groupId} onClick={() => setSelected(r.groupId)} className={clsx('block w-full border-b border-slate-100 p-3 text-left hover:bg-slate-50', selected === r.groupId && 'bg-brand-50')}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-500">
                              {r.groupId}
                              {r.poId ? ` · ${r.poId}` : ''}
                            </span>
                            <StatusChip status={st} />
                          </div>
                          <div className="mt-0.5 truncate text-sm font-medium text-slate-900">
                            {r.itemCode ?? 'NEW'} · {r.itemDescription}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                            <RouteChip route={view.status[r.groupId]?.override?.route ?? r.route} />
                            <span>{r.plant}</span>
                            <span>{formatINR(r.value)}</span>
                            <span>{r.lineKeys.length} line{r.lineKeys.length > 1 ? 's' : ''}</span>
                            {r.isEmergency && <span className="text-rose-600">Emergency</span>}
                          </div>
                        </button>
                      );
                    })}
                {filter !== 'not_processed' && !reqs.length && <div className="muted p-4">Nothing here.</div>}
              </div>
            </div>
            <div>{current ? <Detail key={current.groupId + (view.status[current.groupId]?.status ?? '')} req={current} view={view} onAct={act} /> : <div className="card muted p-6">Select a requirement.</div>}</div>
          </div>
        </>
      )}
      {loading && !view && (
        <div className="muted flex items-center gap-2">
          <Spinner /> loading…
        </div>
      )}
    </div>
  );
}

function Detail({ req, view, onAct }: { req: RequirementResult; view: RunView; onAct: (b: Record<string, unknown>) => Promise<void> }) {
  const st = view.status[req.groupId] ?? { status: 'PENDING' };
  const [mode, setMode] = useState<'none' | 'override' | 'return'>('none');
  const [comment, setComment] = useState('');
  const [ov, setOv] = useState({ decision: req.decision || 'PO', route: req.route, supplierId: req.supplierId ?? '', unitPrice: req.unitPrice ?? req.unitPriceForValue ?? 0, suggested: req.suggestedSupplierIds.join(';') });
  const [busy, setBusy] = useState(false);
  const lines = view.lines.filter((l) => req.lineKeys.includes(l.key));
  const samePo = req.poId ? view.requirements.filter((r) => r.poId === req.poId) : [];
  const doc = view.documents.find((d) => d.groupIds.includes(req.groupId));
  const history = view.actions.filter((a) => a.groupId === req.groupId);
  const matched = req.ruleTrace.find((t) => t.matched);
  const eff = st.override ?? null;

  const run = async (b: Record<string, unknown>) => {
    setBusy(true);
    await onAct(b);
    setBusy(false);
  };

  const nextAction = (() => {
    if (st.status === 'APPROVED') return null;
    if (st.status === 'RETURNED') return null;
    if (!req.decision) return null;
    const label = eff
      ? `Approve override → create ${eff.decision === 'PO' ? 'PO' : eff.route.replace(/_/g, ' ')}`
      : req.decision === 'PO'
        ? `Approve → issue ${req.poId}${samePo.length > 1 ? ` (${samePo.length} requirements)` : ''}`
        : `Approve → raise ${req.route.replace(/_/g, ' ')}`;
    return label;
  })();

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500">
              {req.groupId} · {req.plant} · requirement date {req.requirementDate} · policy v{req.policyVersion}
            </div>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">
              {req.itemCode ?? 'NEW ITEM'} · {req.itemDescription}
            </h2>
            <div className="muted">
              {req.category ?? 'not in item master'} {req.itemType ? `· ${req.itemType}` : ''} · {req.totalQuantity} {req.uom}
              {req.isEmergency && <span className="ml-2 font-medium text-rose-600">Emergency</span>}
            </div>
          </div>
          <StatusChip status={st.status} />
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <Box label="Decision">
            <RouteChip route={req.route} />
            <div className="mt-1 text-xs text-slate-500">{req.decision === 'PO' ? 'Purchase order' : req.decision === 'SOURCING_REQUEST' ? 'Sourcing request' : 'Not processed'}</div>
          </Box>
          <Box label="Requirement value">
            <div className="font-semibold">{formatINR(req.value)}</div>
            <div className="text-xs text-slate-500">at {formatPrice(req.unitPriceForValue)} ({req.valuationSource.replace(/_/g, ' ')})</div>
          </Box>
          {req.decision === 'PO' ? (
            <Box label="Supplier and price">
              <div className="font-semibold">
                {req.supplierId} {req.supplierName}
              </div>
              <div className="text-xs text-slate-500">
                {formatPrice(req.unitPrice)} / {req.uom}
                {req.poId ? ` · ${req.poId}` : ''}
              </div>
            </Box>
          ) : (
            <Box label="Suggested suppliers">
              <div className="font-semibold">{req.suggestedSupplierIds.length ? req.suggestedSupplierIds.join(', ') : 'none'}</div>
              <div className="text-xs text-slate-500">{req.isNewItem ? 'new item: buyer finds suppliers' : 'ranked, see list below'}</div>
            </Box>
          )}
          <Box label="Why">
            <div className="font-semibold">
              Clause {req.clause} {matched?.title}
            </div>
            <div className="text-xs text-slate-500">relied on {req.reliedOn.join(', ') || '-'}</div>
          </Box>
        </div>

        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">{req.reason}</p>
        {req.approvals.length > 0 && <InfoBox tone="warn">Needs before it can proceed: {req.approvals.join(', ')}.</InfoBox>}
        {req.warnings.length > 0 && (
          <InfoBox tone="warn">
            {req.warnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </InfoBox>
        )}
        {eff && (
          <InfoBox tone="warn">
            Overridden by {st.by}: {eff.decision} / {eff.route}
            {eff.supplierId ? ` to ${eff.supplierId} at ${formatPrice(eff.unitPrice)}` : ''}
            {eff.suggestedSupplierIds?.length ? `, suggest ${eff.suggestedSupplierIds.join(', ')}` : ''}. Reason: “{st.lastComment}”. The original decision is kept above.
          </InfoBox>
        )}
        {st.status === 'APPROVED' && doc && (
          <InfoBox tone="ok">
            Approved by {st.by} on {fmtDateTime(st.at)}: created {doc.type.replace(/_/g, ' ')} <b>{doc.number}</b>
            {doc.totalValue ? ` for ${formatINR(doc.totalValue)}` : ''}
            {doc.groupIds.length > 1 ? ` covering ${doc.groupIds.join(', ')}` : ''}.
          </InfoBox>
        )}
        {st.status === 'RETURNED' && <InfoBox tone="warn">Returned to the requester by {st.by}: “{st.lastComment}”</InfoBox>}

        {nextAction && mode === 'none' && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-success" disabled={busy} onClick={() => run({ action: 'APPROVE' })}>
              {busy ? <Spinner /> : <Check size={16} />} {nextAction}
            </button>
            <button className="btn-secondary" onClick={() => setMode('override')}>
              <Pencil size={16} /> Override
            </button>
            <button className="btn-danger" onClick={() => setMode('return')}>
              <CornerUpLeft size={16} /> Return to requester
            </button>
          </div>
        )}
        {mode === 'override' && (
          <div className="mt-4 space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="font-medium text-amber-900">Override the decision</div>
            <div className="grid gap-3 md:grid-cols-4">
              <div>
                <label className="label">Decision</label>
                <select className="input" value={ov.decision} onChange={(e) => setOv({ ...ov, decision: e.target.value as 'PO', route: e.target.value === 'PO' ? 'SPOT_PO' : 'RFQ' })}>
                  <option value="PO">PO</option>
                  <option value="SOURCING_REQUEST">Sourcing request</option>
                </select>
              </div>
              <div>
                <label className="label">Route</label>
                <select className="input" value={ov.route} onChange={(e) => setOv({ ...ov, route: e.target.value })}>
                  {(ov.decision === 'PO' ? ['CONTRACT_PO', 'EMERGENCY_PO', 'SPOT_PO'] : ['RFQ', 'RFP', 'CAPEX_SOURCING', 'NEW_ITEM_SOURCING']).map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </div>
              {ov.decision === 'PO' ? (
                <>
                  <div>
                    <label className="label">Supplier id</label>
                    <input className="input" value={ov.supplierId} onChange={(e) => setOv({ ...ov, supplierId: e.target.value.toUpperCase() })} />
                  </div>
                  <div>
                    <label className="label">Unit price ₹</label>
                    <input className="input" type="number" step="0.01" value={ov.unitPrice} onChange={(e) => setOv({ ...ov, unitPrice: Number(e.target.value) })} />
                  </div>
                </>
              ) : (
                <div className="md:col-span-2">
                  <label className="label">Suggested suppliers (; separated)</label>
                  <input className="input" value={ov.suggested} onChange={(e) => setOv({ ...ov, suggested: e.target.value.toUpperCase() })} />
                </div>
              )}
            </div>
            <div>
              <label className="label">Reason (required, kept with the original decision)</label>
              <textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. Supplier S014 confirmed delivery in 2 days; contract supplier cannot deliver before the need-by date." />
            </div>
            <div className="flex gap-2">
              <button
                className="btn-primary"
                disabled={busy || comment.trim().length < 5}
                onClick={async () => {
                  await run({
                    action: 'OVERRIDE',
                    comment,
                    override: {
                      decision: ov.decision,
                      route: ov.route,
                      supplierId: ov.decision === 'PO' ? ov.supplierId : null,
                      unitPrice: ov.decision === 'PO' ? ov.unitPrice : null,
                      suggestedSupplierIds: ov.decision === 'PO' ? [] : ov.suggested.split(/[;,\s]+/).filter(Boolean),
                    },
                  });
                  setMode('none');
                }}
              >
                Save override
              </button>
              <button className="btn-secondary" onClick={() => setMode('none')}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {mode === 'return' && (
          <div className="mt-4 space-y-3 rounded-lg border border-rose-200 bg-rose-50 p-4">
            <label className="label">Why does it go back to the requester?</label>
            <textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
            <div className="flex gap-2">
              <button className="btn-danger" disabled={busy || comment.trim().length < 5} onClick={async () => { await run({ action: 'RETURN', comment }); setMode('none'); }}>
                Return
              </button>
              <button className="btn-secondary" onClick={() => setMode('none')}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <Section title={`PR lines (${lines.length})${lines.length > 1 ? ': clubbed into one requirement (2.2)' : ''}`}>
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              {['PR / line', 'Created', 'Requester', 'As typed', 'Qty', 'Need by', 'Urgency', 'Match'].map((h) => (
                <th key={h} className="th">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className="border-t border-slate-100">
                <td className="td font-medium">{l.key}</td>
                <td className="td whitespace-nowrap">{l.createdAt}</td>
                <td className="td">
                  {l.input.requester}
                  <div className="text-xs text-slate-400">{l.input.department}</div>
                </td>
                <td className="td">
                  {l.input.itemCode && <span className="mr-1 text-xs text-slate-400">{l.input.itemCode}</span>}
                  {l.input.description}
                </td>
                <td className="td whitespace-nowrap">
                  {l.quantity} {l.input.uom}
                </td>
                <td className="td whitespace-nowrap">{l.needBy}</td>
                <td className="td">{l.input.urgency}</td>
                <td className="td text-xs">{l.match ? `${l.match.method.replace(/_/g, ' ')}${l.match.method === 'description' ? ` (${Math.round(l.match.score * 100)}%)` : ''}` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {samePo.length > 1 && (
        <Section title={`${req.poId}: ${samePo.length} requirements on one PO (7.1)`}>
          <div className="p-3 text-sm">
            {samePo.map((r) => (
              <div key={r.groupId} className="flex justify-between border-b border-slate-100 py-1 last:border-0">
                <span>
                  {r.groupId} · {r.itemCode} {r.itemDescription}
                </span>
                <span>
                  {r.totalQuantity} {r.uom} × {formatPrice(r.unitPrice)} · first line {r.firstCreatedAt}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {req.contractChecks.length > 0 && (
        <Section title="Rate contracts checked (4.1 to 4.3)">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                {['Contract', 'Supplier', 'Rate', 'Valid', 'Ceiling', 'Consumed before', 'This requirement', 'Result'].map((h) => (
                  <th key={h} className="th">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {req.contractChecks.map((c) => (
                <tr key={c.contractId} className="border-t border-slate-100">
                  <td className="td font-medium">{c.contractId}</td>
                  <td className="td">
                    {c.supplierId} <span className="text-xs text-slate-400">{c.supplierStatus}</span>
                  </td>
                  <td className="td">{formatPrice(c.rate)}</td>
                  <td className="td whitespace-nowrap text-xs">
                    {c.startDate} → {c.endDate}
                  </td>
                  <td className="td">{formatINR(c.valueCap)}</td>
                  <td className="td">{formatINR(c.consumedBefore)}</td>
                  <td className="td">{formatINR(c.valueAtRate)}</td>
                  <td className={clsx('td text-xs', c.usable ? 'text-emerald-700' : 'text-rose-700')}>{c.usable ? 'usable' : c.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {req.preferred.length > 0 && (
        <Section title={`Preferred supplier list as of ${req.requirementDate} (section 6)`}>
          <PreferredTable entries={req.preferred} highlight={req.supplierId ?? req.suggestedSupplierIds} />
        </Section>
      )}

      <Section title="Rules checked, in policy order (first match decides)">
        <div className="divide-y divide-slate-100">
          {req.ruleTrace.map((t) => (
            <div key={t.ruleId} className="flex gap-3 px-4 py-2 text-sm">
              <span className={clsx('mt-0.5 h-5 w-5 shrink-0 rounded-full text-center text-xs leading-5', t.matched ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600')}>{t.matched ? '✓' : '–'}</span>
              <div>
                <div className="font-medium">
                  {t.clause} {t.title}
                </div>
                <div className="text-xs text-slate-500">
                  {t.conditions.map((c, i) => (
                    <span key={i} className={clsx('mr-3', c.result ? 'text-emerald-700' : 'text-rose-600')}>
                      {c.result ? '✓' : '✗'} {c.text}
                      {c.actual !== undefined && c.actual !== null && typeof c.actual !== 'boolean' ? ` (actual ${typeof c.actual === 'number' ? Math.round(c.actual * 100) / 100 : String(c.actual)})` : ''}
                    </span>
                  ))}
                  {t.skippedReason && <span className="text-amber-700">{t.skippedReason}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {history.length > 0 && (
        <Section title="History">
          <div className="divide-y divide-slate-100 text-sm">
            {history.map((h) => (
              <div key={h.id} className="px-4 py-2">
                <b>{h.action}</b> by {h.actor} on {fmtDateTime(h.createdAt)}
                {h.comment ? `: “${h.comment}”` : ''}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Box({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="label">{label}</div>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-slate-200 px-4 py-2.5 text-sm font-semibold">{title}</div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}
