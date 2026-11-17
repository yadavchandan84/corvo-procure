'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { ErrorBox, InfoBox, PageHeader, Spinner } from '@/components/ui';
import { PreferredTable } from '@/components/PreferredTable';
import type { PreferredSupplierEntry } from '@/engine/types';

interface Resp {
  date: string;
  policyVersion: string;
  weights: Record<string, number>;
  recencyBands: { maxDays: number; score: number }[];
  lookbackDays: number;
  exportTopN: number;
  lists: { itemCode: string; description: string; category: string; entries: PreferredSupplierEntry[] }[];
}

export default function SuppliersPage() {
  const [date, setDate] = useState(() => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10));
  const [data, setData] = useState<Resp | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api<Resp>(`/api/preferred?date=${date}`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [date]);

  const lists = useMemo(() => (data?.lists ?? []).filter((l) => !q || `${l.itemCode} ${l.description} ${l.category}`.toLowerCase().includes(q.toLowerCase())), [data, q]);

  return (
    <div>
      <PageHeader
        title="Preferred suppliers"
        subtitle="Built automatically from PO history and contracts (policy 6), recalculated as of the chosen date. Blocked and Inactive suppliers are never listed."
        action={
          <div className="flex items-end gap-2">
            <div>
              <label className="label">As of</label>
              <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <a className="btn-primary" href={`/api/preferred?date=${date}&format=csv`}>
              <Download size={16} /> Export top {data?.exportTopN ?? 3} CSV
            </a>
          </div>
        }
      />
      <ErrorBox error={error} />
      {data && (
        <InfoBox>
          <b>How the ranking works (policy v{data.policyVersion}):</b> every Active supplier with a PO for the item in the last {data.lookbackDays} days, or a contract for it that started by the date, is listed. Score ={' '}
          {Object.entries(data.weights)
            .map(([k, w]) => `${w} × ${k}`)
            .join(' + ')}
          , each part scaled 0 to 1: frequency = POs ÷ the most POs any listed supplier has; recency = {data.recencyBands.map((b) => `${b.score} if the last PO is within ${b.maxDays} days`).join(', ')}, else 0; contract = 1 if it has held a contract for the item; on-time = on-time % ÷ 100; quality = rating ÷ 5. Ties go to the lower supplier id. Hover a score to see its parts.
        </InfoBox>
      )}
      <input className="input mb-4 max-w-md" placeholder="Filter by item, description or category" value={q} onChange={(e) => setQ(e.target.value)} />
      {loading && <Spinner />}
      <div className="space-y-4">
        {lists.map((l) => (
          <div key={l.itemCode} className="card overflow-x-auto">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
              <div className="font-semibold">
                {l.itemCode} {l.description}
              </div>
              <div className="muted text-xs">{l.category}</div>
            </div>
            {l.entries.length ? <PreferredTable entries={l.entries} /> : <div className="muted px-4 py-3">No eligible supplier has bought or held a contract for this item: sourcing will use category suppliers (6.4).</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
