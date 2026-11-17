'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorBox, PageHeader } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';

interface Log {
  id: string;
  at: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  details: unknown;
}

export default function AuditPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Log[]>('/api/audit').then(setLogs).catch((e) => setError(e.message));
  }, []);
  const shown = logs.filter((l) => !q || JSON.stringify(l).toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <PageHeader title="Audit trail" subtitle="Every action is kept with who and when: PRs raised, batches processed, decisions approved or overridden, policy drafts and approvals, contracts and data loads." />
      <ErrorBox error={error} />
      <input className="input mb-4 max-w-md" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              {['When', 'Who', 'Action', 'Entity', 'Details'].map((h) => (
                <th key={h} className="th">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="td whitespace-nowrap text-xs">{fmtDateTime(l.at)}</td>
                <td className="td text-xs">{l.actor}</td>
                <td className="td text-xs font-medium">{l.action.replace(/_/g, ' ').toLowerCase()}</td>
                <td className="td text-xs">
                  {l.entityType} <span className="text-slate-400">{l.entityId}</span>
                </td>
                <td className="td max-w-xl truncate text-xs text-slate-500" title={JSON.stringify(l.details)}>
                  {JSON.stringify(l.details)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
