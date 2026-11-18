'use client';

import Link from 'next/link';
import { Suspense, use, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import { Check, Play, Plus, Save, X } from 'lucide-react';
import { api, getUser } from '@/lib/api';
import { ErrorBox, InfoBox, PageHeader, RouteChip, Spinner, StatusChip } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import { validatePolicy } from '@/engine/policy/validate';
import { diffPolicies, type PolicyChange } from '@/engine/policy/diff';
import { parsePolicyDefinition } from '@/engine/policy/schema';
import type { FactDef } from '@/engine/policy/facts';

interface VersionView {
  id: string;
  version: string;
  effectiveFrom: string;
  status: string;
  definition: unknown;
  changeSummary: PolicyChange[] | null;
  sourceType: string;
  sourceName: string | null;
  sourceText: string | null;
  aiNotes: { reader?: string; unrepresentable?: string[]; assumptions?: string[]; statedSummary?: string[]; warnings?: string[]; errors?: string[]; effectiveFromMissing?: boolean } | null;
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  reviewComment: string | null;
  parent: { id: string; version: string; effectiveFrom: string } | null;
  validation: { ok: boolean; errors: string[]; warnings: string[] };
  rulesText: { id: string; text: string; enabled: boolean }[];
  impact: Impact | null;
}
interface Impact {
  batch: { id: string; name: string } | null;
  total: number;
  changed: { key: string; item: string; before: Record<string, string>; after: Record<string, string> }[];
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<Spinner />}>
      <PolicyVersion id={id} />
    </Suspense>
  );
}

const RULE_TEMPLATE = {
  id: 'R-NEW',
  clause: '5.x',
  title: 'New rule',
  description: '',
  enabled: true,
  when: { all: [{ fact: 'plant', op: 'eq', value: 'CHK1' }, { fact: 'value', op: 'lt', value: 100000 }] },
  outcome: { decision: 'SOURCING_REQUEST', route: 'RFQ', supplier: 'none', suggestCount: 3, approvals: [] },
};

function PolicyVersion({ id }: { id: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const [v, setV] = useState<VersionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [meta, setMeta] = useState({ version: '', effectiveFrom: '' });
  const [editing, setEditing] = useState(search.get('edit') === '1');
  const [jsonText, setJsonText] = useState('');
  const [facts, setFacts] = useState<FactDef[]>([]);
  const [impact, setImpact] = useState<Impact | null>(null);

  const load = async () => {
    const r = await api<VersionView>(`/api/policy/${id}`);
    setV(r);
    setMeta({ version: r.status === 'DRAFT' ? r.version : bump(r.version), effectiveFrom: r.effectiveFrom });
    setJsonText(JSON.stringify(r.definition, null, 2));
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
    api<{ facts: FactDef[] }>('/api/policy/facts')
      .then((r) => setFacts(r.facts))
      .catch(() => setFacts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // live validation and diff of the JSON being edited
  const live = useMemo(() => {
    if (!editing || !v) return null;
    try {
      const parsed = JSON.parse(jsonText);
      const val = validatePolicy(parsed);
      const changes = val.definition ? diffPolicies(parsePolicyDefinition(v.definition), val.definition) : [];
      return { ...val, changes, parsed };
    } catch (e) {
      return { ok: false, errors: [`JSON: ${(e as Error).message}`], warnings: [], changes: [] as PolicyChange[], parsed: null };
    }
  }, [jsonText, editing, v]);

  if (!v) return error ? <ErrorBox error={error} /> : <Spinner />;
  const isDraft = v.status === 'DRAFT';
  const role = getUser().role;

  async function call(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const saveMeta = () => call('meta', async () => {
    await api(`/api/policy/${id}`, { method: 'PATCH', body: JSON.stringify(meta) });
    await load();
  });
  const saveJson = () => call('json', async () => {
    if (!live?.parsed) return;
    if (isDraft) {
      await api(`/api/policy/${id}`, { method: 'PATCH', body: JSON.stringify({ definition: live.parsed }) });
      setEditing(false);
      await load();
    } else {
      const d = await api<{ id: string }>('/api/policy', { method: 'POST', body: JSON.stringify({ sourceType: 'EDITOR', definition: live.parsed, version: meta.version, effectiveFrom: meta.effectiveFrom, sourceName: `edited from v${v.version}` }) });
      router.push(`/policy/${d.id}`);
    }
  });
  const discard = () => call('discard', async () => {
    if (!window.confirm(`Delete v${v.version} (${v.status.toLowerCase()})? This cannot be undone.`)) return;
    await api(`/api/policy/${id}`, { method: 'DELETE' });
    router.push('/policy');
  });
  const decide = (action: 'APPROVE' | 'REJECT') => call(action, async () => {
    await api(`/api/policy/${id}`, { method: 'POST', body: JSON.stringify({ action, comment }) });
    await load();
  });
  const runImpact = () => call('impact', async () => {
    const r = await api<VersionView>(`/api/policy/${id}?impact=1`);
    setImpact(r.impact);
  });

  const changes = v.changeSummary ?? [];
  const notes = v.aiNotes ?? {};
  return (
    <div>
      <PageHeader
        title={`Policy v${v.version}`}
        subtitle={
          <>
            Effective from <b>{v.effectiveFrom}</b> · {v.sourceType.toLowerCase()}
            {v.sourceName ? ` (${v.sourceName})` : ''} · created by {v.createdBy} on {fmtDateTime(v.createdAt)}
            {v.parent ? ` · based on v${v.parent.version}` : ''}
          </>
        }
        action={
          <div className="flex items-center gap-2">
            <StatusChip status={v.status} />
            <Link className="btn-secondary" href="/policy">
              All versions
            </Link>
          </div>
        }
      />
      <ErrorBox error={error} />
      {v.status === 'APPROVED' && (
        <InfoBox tone="ok">
          Approved by {v.approvedBy} on {fmtDateTime(v.approvedAt)}. Applies to requirements dated on or after {v.effectiveFrom} (until a later version takes effect).
          {v.reviewComment ? ` Comment: “${v.reviewComment}”` : ''}
        </InfoBox>
      )}
      {v.status === 'REJECTED' && (
        <InfoBox tone="warn">
          <div className="flex items-center justify-between gap-3">
            <span>
              Rejected by {v.rejectedBy}: “{v.reviewComment}”
            </span>
            <button className="btn-danger" disabled={!!busy} onClick={discard}>
              Delete this version
            </button>
          </div>
        </InfoBox>
      )}

      {isDraft && (
        <div className="card mb-6 p-5">
          <div className="mb-3 text-lg font-semibold">Review before approval</div>
          {notes.effectiveFromMissing && <InfoBox tone="warn">The source did not state an effective date. Set it below before approving (currently {v.effectiveFrom}).</InfoBox>}
          <div className="mb-4 grid gap-3 md:grid-cols-[160px_200px_auto]">
            <div>
              <label className="label">Version</label>
              <input className="input" value={meta.version} onChange={(e) => setMeta({ ...meta, version: e.target.value })} />
            </div>
            <div>
              <label className="label">Effective from</label>
              <input className="input" type="date" value={meta.effectiveFrom} onChange={(e) => setMeta({ ...meta, effectiveFrom: e.target.value })} />
            </div>
            <div className="flex items-end">
              <button className="btn-secondary" disabled={busy === 'meta' || (meta.version === v.version && meta.effectiveFrom === v.effectiveFrom)} onClick={saveMeta}>
                <Save size={16} /> Save
              </button>
            </div>
          </div>

          <div className="label">What will change ({changes.length})</div>
          {changes.length ? (
            <ul className="mb-4 space-y-1.5">
              {changes.map((c, i) => (
                <li key={i} className="flex gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <span className={clsx('chip h-fit shrink-0', c.kind === 'rule_added' ? 'bg-emerald-100 text-emerald-800' : c.kind === 'rule_removed' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800')}>{c.kind.replace('_', ' ')}</span>
                  <span>{c.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <InfoBox tone="warn">No differences from v{v.parent?.version}. Approving would create an identical version.</InfoBox>
          )}

          {(notes.statedSummary?.length ?? 0) > 0 && (
            <details className="mb-3 text-sm">
              <summary className="cursor-pointer font-medium text-slate-700">How the {notes.reader === 'ai' ? 'AI' : 'reader'} summarised the amendment</summary>
              <ul className="ml-5 mt-2 list-disc text-slate-600">
                {notes.statedSummary!.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </details>
          )}
          {(notes.unrepresentable?.length ?? 0) > 0 && (
            <InfoBox tone="warn">
              <div className="font-medium">Not applied: the reader could not express these parts. Edit the draft if they matter.</div>
              <ul className="ml-5 list-disc">
                {notes.unrepresentable!.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </InfoBox>
          )}
          {(notes.assumptions?.length ?? 0) > 0 && (
            <InfoBox>
              <div className="font-medium">Assumptions</div>
              <ul className="ml-5 list-disc">
                {notes.assumptions!.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </InfoBox>
          )}
          {!v.validation.ok && <ErrorBox error={`Invalid: ${v.validation.errors.join('; ')}`} />}
          {v.validation.warnings.length > 0 && <InfoBox tone="warn">{v.validation.warnings.join(' ')}</InfoBox>}

          <div className="mb-4 rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <b>Impact preview:</b> re-decide the latest uploaded batch with and without this draft.
              </div>
              <button className="btn-secondary" disabled={busy === 'impact'} onClick={runImpact}>
                {busy === 'impact' ? <Spinner /> : <Play size={16} />} Preview impact
              </button>
            </div>
            {impact && (
              <div className="mt-3">
                {!impact.batch ? (
                  <div className="muted">No uploaded batch to compare against.</div>
                ) : (
                  <>
                    <div className="muted mb-2">
                      {impact.changed.length} of {impact.total} lines in “{impact.batch.name}” change.
                    </div>
                    <div className="max-h-72 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50">
                          <tr>
                            {['PR line', 'Item', 'Before', 'After'].map((h) => (
                              <th key={h} className="th">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {impact.changed.map((c) => (
                            <tr key={c.key} className="border-t border-slate-100">
                              <td className="td">{c.key}</td>
                              <td className="td">{c.item}</td>
                              <td className="td">
                                <RouteChip route={c.before.route} /> {c.before.supplier} v{c.before.version} {c.before.group}
                              </td>
                              <td className="td">
                                <RouteChip route={c.after.route} /> {c.after.supplier} v{c.after.version} {c.after.group}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <label className="label">Approval comment</label>
          <textarea className="input mb-3" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional for approval, required for rejection" />
          {role !== 'Procurement Head' && <div className="muted mb-2 text-xs">Approval is normally done by the Procurement Head (switch role in the sidebar). You are acting as {role}.</div>}
          <div className="flex gap-2">
            <button className="btn-success" disabled={!!busy || !v.validation.ok} onClick={() => decide('APPROVE')}>
              {busy === 'APPROVE' ? <Spinner /> : <Check size={16} />} Approve v{v.version} from {v.effectiveFrom}
            </button>
            <button className="btn-danger" disabled={!!busy || !comment.trim()} onClick={() => decide('REJECT')}>
              <X size={16} /> Reject
            </button>
            <button className="btn-secondary ml-auto" disabled={!!busy} onClick={discard}>
              Discard draft
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="border-b border-slate-200 px-4 py-3 font-semibold">Decision rules, in order (first match decides)</div>
          <ol className="divide-y divide-slate-100">
            {v.rulesText.map((r, i) => (
              <li key={r.id} className={clsx('px-4 py-2.5 text-sm', !r.enabled && 'opacity-50')}>
                <span className="mr-2 text-xs font-semibold text-slate-400">{i + 1}.</span>
                {r.text}
              </li>
            ))}
          </ol>
        </div>
        <ParamsCard def={v.definition as Record<string, unknown>} />
      </div>

      <div className="card mt-6">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="font-semibold">Policy definition (data)</div>
          {!editing ? (
            <button className="btn-secondary" onClick={() => setEditing(true)}>
              {isDraft ? 'Edit draft' : 'Edit as new draft'}
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                className="btn-secondary"
                onClick={() => {
                  try {
                    const p = JSON.parse(jsonText);
                    p.rules.splice(Math.max(0, p.rules.length - 4), 0, { ...RULE_TEMPLATE, id: `R-NEW-${Date.now().toString().slice(-4)}` });
                    setJsonText(JSON.stringify(p, null, 2));
                  } catch {}
                }}
              >
                <Plus size={16} /> Insert rule template
              </button>
              <button className="btn-secondary" onClick={() => { setEditing(false); setJsonText(JSON.stringify(v.definition, null, 2)); }}>
                Cancel
              </button>
            </div>
          )}
        </div>
        {editing ? (
          <div className="grid gap-4 p-4 lg:grid-cols-[1fr_340px]">
            <div>
              {!isDraft && (
                <div className="mb-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">New version</label>
                    <input className="input" value={meta.version} onChange={(e) => setMeta({ ...meta, version: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Effective from</label>
                    <input className="input" type="date" value={meta.effectiveFrom} onChange={(e) => setMeta({ ...meta, effectiveFrom: e.target.value })} />
                  </div>
                </div>
              )}
              <textarea className="input h-[560px] font-mono text-xs" spellCheck={false} value={jsonText} onChange={(e) => setJsonText(e.target.value)} />
              <div className="mt-3 space-y-2">
                {live && !live.ok && <ErrorBox error={live.errors.join('; ')} />}
                {live && live.warnings.length > 0 && <InfoBox tone="warn">{live.warnings.join(' ')}</InfoBox>}
                {live && live.ok && (
                  <InfoBox tone="ok">
                    Valid. {live.changes.length} change(s) vs v{v.version}:
                    <ul className="ml-5 mt-1 list-disc">
                      {live.changes.map((c, i) => (
                        <li key={i}>{c.text}</li>
                      ))}
                    </ul>
                  </InfoBox>
                )}
                <button className="btn-primary" disabled={!live?.ok || busy === 'json' || (!isDraft && live.changes.length === 0)} onClick={saveJson}>
                  <Save size={16} /> {isDraft ? 'Save draft' : 'Save as new draft for review'}
                </button>
              </div>
            </div>
            <div className="max-h-[700px] overflow-y-auto text-xs">
              <div className="label">Facts a condition can use</div>
              {facts.map((f) => (
                <div key={f.name} className="border-b border-slate-100 py-1.5">
                  <code className="font-semibold text-brand-700">{f.name}</code> <span className="text-slate-400">{f.type}</span>
                  <div className="text-slate-600">{f.description}</div>
                </div>
              ))}
              <div className="label mt-3">Operators</div>
              <div className="text-slate-600">eq, neq, lt, lte, gt, gte, in, not_in, contains, is_true, is_false, exists, not_exists. Combine with {'{"all":[…]}'}, {'{"any":[…]}'}, {'{"not":…}'}.</div>
            </div>
          </div>
        ) : (
          <pre className="max-h-[420px] overflow-auto p-4 text-xs">{JSON.stringify(v.definition, null, 2)}</pre>
        )}
      </div>

      {v.sourceText && (
        <details className="card mt-6 p-4">
          <summary className="cursor-pointer font-semibold">Source document text</summary>
          <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs text-slate-600">{v.sourceText}</pre>
        </details>
      )}
    </div>
  );
}

function bump(v: string) {
  const [a, b] = v.split('.').map(Number);
  return `${a}.${(b || 0) + 1}`;
}

function ParamsCard({ def }: { def: Record<string, unknown> }) {
  const d = def as {
    scope: { plants: string[] };
    clubbing: { creationWindowDays: number; needByWindowDays: number; sameFields: string[] };
    valuation: { priceSources: string[]; lastPoLookbackDays: number };
    contracts: { enforceCeiling: boolean; minHeadroomPctAfter: number; excludeIfEndsWithinDays: number };
    eligibility: { allowedStatuses: string[]; minOnTimePct: number | null; minQualityRating: number | null; excludedSupplierIds: string[] };
    preferredSuppliers: { lookbackDays: number; weights: Record<string, number>; recencyBands: { maxDays: number; score: number }[] };
    consolidation: { windowHours: number; sameFields: string[] };
  };
  const rows: [string, string][] = [
    ['Plants in scope', d.scope.plants.join(', ')],
    ['Clubbing (2.2)', `same ${d.clubbing.sameFields.join(' + ')}, created within ${d.clubbing.creationWindowDays} days, need-by within ±${d.clubbing.needByWindowDays} days`],
    ['Valuation (3.1)', `${d.valuation.priceSources.join(' → ')}; last PO within ${d.valuation.lastPoLookbackDays} days`],
    ['Contracts (4.x)', `ceiling ${d.contracts.enforceCeiling ? 'enforced' : 'not enforced'}${d.contracts.minHeadroomPctAfter ? `, keep ${d.contracts.minHeadroomPctAfter}% headroom` : ''}${d.contracts.excludeIfEndsWithinDays ? `, skip if ending within ${d.contracts.excludeIfEndsWithinDays} days` : ''}`],
    ['Eligible suppliers (5.7)', `${d.eligibility.allowedStatuses.join(', ')}${d.eligibility.minOnTimePct ? `, on-time ≥ ${d.eligibility.minOnTimePct}%` : ''}${d.eligibility.minQualityRating ? `, quality ≥ ${d.eligibility.minQualityRating}` : ''}${d.eligibility.excludedSupplierIds.length ? `, excluded ${d.eligibility.excludedSupplierIds.join(', ')}` : ''}`],
    ['Preferred list (6.1)', `POs in last ${d.preferredSuppliers.lookbackDays} days or contract holders`],
    ['Ranking weights (6.2)', Object.entries(d.preferredSuppliers.weights).map(([k, w]) => `${k} ${w}`).join(', ')],
    ['Recency bands', d.preferredSuppliers.recencyBands.map((b) => `≤${b.maxDays}d → ${b.score}`).join(', ')],
    ['Consolidation (7.1)', `same ${d.consolidation.sameFields.join(' + ')} within ${d.consolidation.windowHours} hours`],
  ];
  return (
    <div className="card">
      <div className="border-b border-slate-200 px-4 py-3 font-semibold">Parameters</div>
      <table className="w-full">
        <tbody>
          {rows.map(([k, val]) => (
            <tr key={k} className="border-t border-slate-100 first:border-0">
              <td className="td w-48 font-medium">{k}</td>
              <td className="td">{val}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
