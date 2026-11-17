'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ClipboardList, Gavel, MessageSquare, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { InfoBox, PageHeader, Stat } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';

interface PolicyList {
  today: string;
  inForceId: string | null;
  ai: { enabled: boolean; provider: string | null; model: string | null };
  versions: { id: string; version: string; effectiveFrom: string; status: string }[];
}
interface RunItem {
  id: string;
  label: string;
  createdAt: string;
  versionsUsed: string[];
  summary: { lines: number; requirements: number; purchaseOrders: number; notProcessed: number };
}

export default function Home() {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [policy, setPolicy] = useState<PolicyList | null>(null);
  const [runs, setRuns] = useState<RunItem[]>([]);
  useEffect(() => {
    api<{ counts: Record<string, number> }>('/api/master').then((r) => setCounts(r.counts)).catch(() => {});
    api<PolicyList>('/api/policy').then(setPolicy).catch(() => {});
    api<RunItem[]>('/api/runs').then(setRuns).catch(() => {});
  }, []);
  const inForce = policy?.versions.find((v) => v.id === policy.inForceId);
  const drafts = policy?.versions.filter((v) => v.status === 'DRAFT') ?? [];
  const upcoming = policy?.versions.filter((v) => v.status === 'APPROVED' && v.effectiveFrom > policy.today) ?? [];

  const actions = [
    { href: '/chat', icon: MessageSquare, title: 'Raise a purchase request', text: 'Tell the assistant what you need. It matches the item, asks for anything missing and raises the PR.', who: 'Requesters' },
    { href: '/workspace', icon: ClipboardList, title: 'Review decisions', text: 'See each requirement, the decision and why. Approve to create the PO or RFQ, or override with a reason.', who: 'Buyers' },
    { href: '/batches', icon: Upload, title: 'Process a PR batch', text: 'Upload a PR batch CSV, get the decisions and export them in the scoring format.', who: 'Buyers' },
    { href: '/policy', icon: Gavel, title: 'Update the policy', text: 'Upload an amendment or describe a change. Review the plain-language diff, then approve it from its effective date.', who: 'Procurement' },
  ];

  return (
    <div>
      <PageHeader title="Corvo Procure" subtitle="Purchase requests are raised by chat and decided by the procurement policy in force on each requirement date. The policy is data: a new version changes decisions without code changes." />
      {counts && counts.items === 0 && (
        <InfoBox tone="warn">
          No master data is loaded yet. Go to <Link className="font-medium underline" href="/data">Master data</Link> and upload the item master, supplier master, PO history, plants and contract register.
        </InfoBox>
      )}
      {drafts.length > 0 && (
        <InfoBox tone="warn">
          {drafts.length} policy draft{drafts.length > 1 ? 's' : ''} waiting for review:{' '}
          {drafts.map((d) => (
            <Link key={d.id} className="mr-2 font-medium underline" href={`/policy/${d.id}`}>
              v{d.version}
            </Link>
          ))}
        </InfoBox>
      )}
      <div className="mb-8 grid gap-4 md:grid-cols-2">
        {actions.map((a) => (
          <Link key={a.href} href={a.href} className="card group flex gap-4 p-5 transition hover:border-brand-500 hover:shadow">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 group-hover:bg-brand-600 group-hover:text-white">
              <a.icon size={20} />
            </div>
            <div>
              <div className="font-semibold text-slate-900">{a.title}</div>
              <div className="muted mt-1">{a.text}</div>
              <div className="mt-2 text-xs font-medium text-brand-600">{a.who} →</div>
            </div>
          </Link>
        ))}
      </div>
      <div className="mb-8 grid gap-4 md:grid-cols-4">
        <Stat label="Policy in force today" value={inForce ? `v${inForce.version}` : '-'} hint={inForce ? `effective ${inForce.effectiveFrom}${upcoming.length ? `; v${upcoming.map((u) => u.version).join(', v')} scheduled` : ''}` : ''} />
        <Stat label="Items / suppliers" value={counts ? `${counts.items} / ${counts.suppliers}` : '-'} hint={counts ? `${counts.poHistory} history POs` : ''} />
        <Stat label="Rate contracts" value={counts?.contracts ?? '-'} hint={counts ? `${counts.pdfContracts} added from PDFs` : ''} />
        <Stat label="AI assistant" value={policy?.ai.enabled ? 'On' : 'Off'} hint={policy?.ai.enabled ? `${policy.ai.provider} ${policy.ai.model}` : 'Built-in parser; decisions never use AI'} />
      </div>
      <div className="card">
        <div className="border-b border-slate-200 px-4 py-3 font-semibold">Recent decision runs</div>
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Run</th>
              <th className="th">When</th>
              <th className="th">Policy versions</th>
              <th className="th">Lines</th>
              <th className="th">Requirements</th>
              <th className="th">POs</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {runs.slice(0, 8).map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="td font-medium">{r.label}</td>
                <td className="td">{fmtDateTime(r.createdAt)}</td>
                <td className="td">{r.versionsUsed.map((v) => `v${v}`).join(', ')}</td>
                <td className="td">{r.summary.lines}</td>
                <td className="td">{r.summary.requirements}</td>
                <td className="td">{r.summary.purchaseOrders}</td>
                <td className="td text-right">
                  <Link href={`/workspace?run=${r.id}`} className="text-brand-600 hover:underline">
                    Open →
                  </Link>
                </td>
              </tr>
            ))}
            {!runs.length && (
              <tr>
                <td className="td muted" colSpan={7}>
                  No runs yet. Upload a PR batch or raise a PR by chat.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
