'use client';

import { useEffect, useState } from 'react';
import { Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { ErrorBox, InfoBox, PageHeader, Spinner, Stat } from '@/components/ui';

const FILES = [
  ['item_master', 'item_master.csv'],
  ['supplier_master', 'supplier_master.csv'],
  ['po_history', 'po_history.csv'],
  ['plants', 'plants.csv'],
  ['contract_register', 'contract_register.csv'],
  ['contract_lines', 'contract_lines.csv'],
] as const;

export default function DataPage() {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const load = () => api<{ counts: Record<string, number> }>('/api/master').then((r) => setCounts(r.counts));
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function upload() {
    setBusy(true);
    setError(null);
    setOk(false);
    try {
      const fd = new FormData();
      for (const [k, f] of Object.entries(files)) if (f) fd.append(k, f);
      await api('/api/master', { method: 'POST', body: fd });
      setOk(true);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Master data" subtitle="Item master, supplier master (status and ratings), PO history, plants and the contract register. Uploading a file replaces that part; contracts added from PDFs are kept." />
      <ErrorBox error={error} />
      {ok && <InfoBox tone="ok">Master data updated. New decision runs use it.</InfoBox>}
      {counts && (
        <div className="mb-6 grid gap-4 md:grid-cols-6">
          <Stat label="Items" value={counts.items} />
          <Stat label="Suppliers" value={counts.suppliers} />
          <Stat label="History POs" value={counts.poHistory} />
          <Stat label="Plants" value={counts.plants} />
          <Stat label="Contracts" value={counts.contracts} />
          <Stat label="From PDFs" value={counts.pdfContracts} />
        </div>
      )}
      <div className="card p-5">
        <div className="grid gap-4 md:grid-cols-3">
          {FILES.map(([k, label]) => (
            <div key={k}>
              <label className="label">{label}</label>
              <input type="file" accept=".csv" className="input" onChange={(e) => setFiles({ ...files, [k]: e.target.files?.[0] ?? null })} />
            </div>
          ))}
        </div>
        <button className="btn-primary mt-4" disabled={busy || !Object.values(files).some(Boolean)} onClick={upload}>
          {busy ? <Spinner /> : <Upload size={16} />} Upload
        </button>
      </div>
    </div>
  );
}
