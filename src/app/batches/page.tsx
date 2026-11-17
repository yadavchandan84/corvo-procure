'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Download, Play, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { ErrorBox, InfoBox, PageHeader, RouteChip, Spinner } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';

interface Batch {
  id: string;
  name: string;
  source: string;
  uploadedBy: string;
  createdAt: string;
  _count: { lines: number };
  runs: { id: string; label: string; createdAt: string; createdBy: string; versionsUsed: string[]; policyMode: string; summary: { lines: number; requirements: number; purchaseOrders: number; byRoute: Record<string, number> } }[];
}
interface Version {
  id: string;
  version: string;
  effectiveFrom: string;
  status: string;
}

export default function BatchesPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [force, setForce] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = () => api<Batch[]>('/api/batches').then(setBatches).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    api<{ versions: Version[] }>('/api/policy').then((r) => setVersions(r.versions.filter((v) => v.status === 'APPROVED')));
  }, []);

  async function upload() {
    if (!file) return;
    setBusy('upload');
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api<{ runId: string }>(`/api/batches${force ? `?policyVersionId=${force}` : ''}`, { method: 'POST', body: fd });
      setDone(r.runId);
      setFile(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function rerun(batchId: string) {
    setBusy(batchId);
    setError(null);
    try {
      const r = await api<{ runId: string }>(`/api/batches/${batchId}/rerun`, { method: 'POST', body: JSON.stringify({ policyVersionId: force || null }) });
      setDone(r.runId);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader title="PR batches" subtitle="Upload a PR batch CSV in the sample format. The engine applies the policy version in force on each requirement date; re-run a batch after a new version is approved to see its effect." />
      <ErrorBox error={error} />
      {done && (
        <InfoBox tone="ok">
          Batch processed.{' '}
          <Link className="font-medium underline" href={`/workspace?run=${done}`}>
            Review the decisions
          </Link>{' '}
          or{' '}
          <a className="font-medium underline" href={`/api/runs/${done}/export`}>
            download the CSV
          </a>
          .
        </InfoBox>
      )}
      <div className="card mb-6 p-5">
        <div className="grid items-end gap-4 md:grid-cols-[1fr_260px_auto]">
          <div>
            <label className="label">PR batch CSV</label>
            <input type="file" accept=".csv,text/csv" className="input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <div className="muted mt-1 text-xs">Columns: pr_no, pr_line, created_at, requester, department, plant, item_code, description, quantity, uom, estimated_unit_price, need_by_date, urgency</div>
          </div>
          <div>
            <label className="label">Policy version</label>
            <select className="input" value={force} onChange={(e) => setForce(e.target.value)}>
              <option value="">In force on each requirement date (default)</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  Force v{v.version} (effective {v.effectiveFrom})
                </option>
              ))}
            </select>
          </div>
          <button className="btn-primary" disabled={!file || busy === 'upload'} onClick={upload}>
            {busy === 'upload' ? <Spinner /> : <Upload size={16} />} Process batch
          </button>
        </div>
        <div className="muted mt-3 text-xs">
          API: <code className="rounded bg-slate-100 px-1">curl -X POST --data-binary @batch.csv -H &quot;Content-Type: text/csv&quot; {typeof window !== 'undefined' ? window.location.origin : ''}/api/process-batch?format=csv</code>
        </div>
      </div>

      <div className="space-y-4">
        {batches.map((b) => (
          <div key={b.id} className="card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <div className="font-semibold">{b.name}</div>
                <div className="muted text-xs">
                  {b._count.lines} lines · {b.source === 'CHAT' ? 'live chat intake' : `uploaded by ${b.uploadedBy}`} · {fmtDateTime(b.createdAt)}
                </div>
              </div>
              <button className="btn-secondary" disabled={busy === b.id} onClick={() => rerun(b.id)}>
                {busy === b.id ? <Spinner /> : <Play size={16} />} Re-run with current policy
              </button>
            </div>
            <table className="w-full">
              <tbody>
                {b.runs.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 first:border-0">
                    <td className="td whitespace-nowrap">{fmtDateTime(r.createdAt)}</td>
                    <td className="td">
                      {r.versionsUsed.map((v) => `v${v}`).join(', ')} {r.policyMode === 'FORCED' && <span className="text-xs text-amber-700">(forced)</span>}
                    </td>
                    <td className="td">
                      {r.summary.requirements} req · {r.summary.purchaseOrders} POs
                    </td>
                    <td className="td">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(r.summary.byRoute).map(([k, v]) => (
                          <span key={k} className="flex items-center gap-0.5">
                            <RouteChip route={k} />
                            <span className="text-xs text-slate-500">{v}</span>
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="td whitespace-nowrap text-right">
                      <Link className="mr-3 text-brand-600 hover:underline" href={`/workspace?run=${r.id}`}>
                        Review
                      </Link>
                      <a className="inline-flex items-center gap-1 text-brand-600 hover:underline" href={`/api/runs/${r.id}/export`}>
                        <Download size={14} /> CSV
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {!batches.length && <div className="muted">No batches yet.</div>}
      </div>
    </div>
  );
}
