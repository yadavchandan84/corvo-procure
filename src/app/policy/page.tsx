'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { FileUp, MessageSquare, PencilRuler } from 'lucide-react';
import { api } from '@/lib/api';
import { ErrorBox, InfoBox, PageHeader, Spinner, StatusChip } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';

interface Version {
  id: string;
  version: string;
  effectiveFrom: string;
  status: string;
  sourceType: string;
  sourceName: string | null;
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  reviewComment: string | null;
  changeSummary: { text: string }[] | null;
}
interface PolicyList {
  today: string;
  inForceId: string | null;
  ai: { enabled: boolean; provider: string | null; model: string | null };
  versions: Version[];
}

export default function PolicyPage() {
  const router = useRouter();
  const [data, setData] = useState<PolicyList | null>(null);
  const [tab, setTab] = useState<'document' | 'chat' | 'editor'>('document');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [chat, setChat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<PolicyList>('/api/policy').then(setData).catch((e) => setError(e.message));
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      let draft: { id: string };
      if (tab === 'document') {
        const fd = new FormData();
        if (file) fd.append('file', file);
        if (text) fd.append('text', text);
        draft = await api('/api/policy', { method: 'POST', body: fd });
      } else {
        draft = await api('/api/policy', { method: 'POST', body: JSON.stringify({ sourceType: 'CHAT', text: chat, sourceName: 'Chat with Procurement' }) });
      }
      router.push(`/policy/${draft.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const today = data?.today ?? '';
  return (
    <div>
      <PageHeader
        title="Procurement policy"
        subtitle="Every limit, window, rule order, condition and outcome the engine applies is stored here as a versioned policy with an effective date. Propose a change, review what will change in plain language, and approve it."
      />
      <ErrorBox error={error} />
      <div className="card mb-6">
        <div className="flex border-b border-slate-200">
          {(
            [
              ['document', FileUp, 'Upload a policy or amendment'],
              ['chat', MessageSquare, 'Describe a change'],
              ['editor', PencilRuler, 'Edit rules directly'],
            ] as const
          ).map(([k, Icon, label]) => (
            <button key={k} onClick={() => setTab(k)} className={clsx('flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium', tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>
        <div className="p-5">
          <InfoBox>
            {data?.ai.enabled ? (
              <>
                The amendment is read by the AI ({data.ai.provider} {data.ai.model}) into a draft version. Nothing changes until a Procurement Head approves it. What you approve is the computed difference, not the AI&apos;s summary.
              </>
            ) : (
              <>No AI is configured, so the built-in reader handles common changes (limits, windows, lookbacks, plant-only limits) and lists anything it did not understand. Use “Edit rules directly” for anything else.</>
            )}
          </InfoBox>
          {tab === 'document' && (
            <div className="space-y-3">
              <div>
                <label className="label">Amendment or new policy (PDF, TXT or MD)</label>
                <input type="file" accept=".pdf,.txt,.md,.text" className="input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>
              <div>
                <label className="label">…or paste its text</label>
                <textarea className="input font-mono text-xs" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Amendment 1 to CORVO-PROC-POL-04, version 5.1, effective 1 December 2026: …" />
              </div>
              <button className="btn-primary" disabled={busy || (!file && text.trim().length < 10)} onClick={submit}>
                {busy ? <Spinner /> : <FileUp size={16} />} Read and create draft
              </button>
            </div>
          )}
          {tab === 'chat' && (
            <div className="space-y-3">
              <label className="label">What should change?</label>
              <textarea className="input" rows={4} value={chat} onChange={(e) => setChat(e.target.value)} placeholder="e.g. From 1 December 2026 the spot PO limit at Chakan is ₹1,00,000; Bhosari stays at ₹2,00,000." />
              <div className="flex flex-wrap gap-2">
                {['Raise the spot PO limit to ₹2,50,000 from 1 Dec 2026', 'Club PR lines raised within 21 days', 'At CHK1, Safety & PPE items always need an RFQ', 'Emergency PO limit becomes ₹3 lakh'].map((s) => (
                  <button key={s} className="chip bg-slate-100 text-slate-700 hover:bg-slate-200" onClick={() => setChat(s)}>
                    {s}
                  </button>
                ))}
              </div>
              <button className="btn-primary" disabled={busy || chat.trim().length < 10} onClick={submit}>
                {busy ? <Spinner /> : <MessageSquare size={16} />} Create draft
              </button>
            </div>
          )}
          {tab === 'editor' && (
            <div className="space-y-3">
              <p className="muted">Open the version you want to start from, then choose “Edit as new draft”. You can change parameters, rule order, conditions and outcomes, or add rules (e.g. for one plant), and see the plain-language diff before saving.</p>
              {data?.inForceId && (
                <Link className="btn-primary" href={`/policy/${data.inForceId}?edit=1`}>
                  <PencilRuler size={16} /> Edit the version in force
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="border-b border-slate-200 px-4 py-3 font-semibold">Versions</div>
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              {['Version', 'Effective from', 'Status', 'Source', 'Created', 'Approved', 'Changes', ''].map((h) => (
                <th key={h} className="th">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.versions.map((v) => (
              <tr key={v.id} className="border-t border-slate-100">
                <td className="td font-semibold">
                  v{v.version}
                  {v.id === data.inForceId && <span className="chip ml-2 bg-emerald-600 text-white">in force</span>}
                  {v.status === 'APPROVED' && v.effectiveFrom > today && <span className="chip ml-2 bg-sky-100 text-sky-800">scheduled</span>}
                </td>
                <td className="td">{v.effectiveFrom}</td>
                <td className="td">
                  <StatusChip status={v.status} />
                </td>
                <td className="td text-xs">
                  {v.sourceType.toLowerCase()}
                  {v.sourceName ? `: ${v.sourceName}` : ''}
                </td>
                <td className="td text-xs">
                  {v.createdBy}
                  <div className="text-slate-400">{fmtDateTime(v.createdAt)}</div>
                </td>
                <td className="td text-xs">
                  {v.approvedBy ?? '-'}
                  <div className="text-slate-400">{v.approvedAt ? fmtDateTime(v.approvedAt) : ''}</div>
                </td>
                <td className="td max-w-sm text-xs">
                  {(v.changeSummary ?? []).slice(0, 2).map((c, i) => (
                    <div key={i} className="truncate">
                      {c.text}
                    </div>
                  ))}
                  {(v.changeSummary?.length ?? 0) > 2 && <div className="text-slate-400">+{v.changeSummary!.length - 2} more</div>}
                </td>
                <td className="td text-right">
                  <Link className="text-brand-600 hover:underline" href={`/policy/${v.id}`}>
                    {v.status === 'DRAFT' ? 'Review →' : 'View →'}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
