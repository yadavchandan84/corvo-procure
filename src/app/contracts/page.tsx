'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { FileUp, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { ErrorBox, InfoBox, PageHeader, Spinner } from '@/components/ui';
import { formatINR, formatPrice } from '@/lib/format';

interface ContractRow {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierStatus: string;
  startDate: string;
  endDate: string;
  valueCap: number;
  consumedValue: number;
  source: string;
  addedBy: string | null;
  lines: { itemCode: string; description: string; uom: string; rate: number }[];
}
interface Form {
  id: string;
  supplierId: string;
  supplierName: string;
  startDate: string;
  endDate: string;
  valueCap: number;
  consumedValue: number;
  lines: { itemCode: string; description: string; uom: string; rate: number }[];
  source: 'PDF' | 'MANUAL';
  fileName?: string;
  extractedText?: string;
}
const EMPTY: Form = { id: '', supplierId: '', supplierName: '', startDate: '', endDate: '', valueCap: 0, consumedValue: 0, lines: [{ itemCode: '', description: '', uom: '', rate: 0 }], source: 'MANUAL' };

export default function ContractsPage() {
  const [rows, setRows] = useState<ContractRow[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [extractInfo, setExtractInfo] = useState<{ missing: string[]; confidence: string; differences: string[]; existing: { id: string } | null; supplier: { status: string } | null; unknownItems: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const load = () => api<ContractRow[]>('/api/contracts').then(setRows).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function extract(file: File) {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api<{ contract: Partial<Form>; missing: string[]; confidence: string; text: string; fileName: string; differences: string[]; existing: { id: string } | null; supplier: { status: string; name: string } | null; unknownItems: string[] }>('/api/contracts/extract', { method: 'POST', body: fd });
      setForm({ ...EMPTY, ...r.contract, supplierName: r.contract.supplierName ?? r.supplier?.name ?? '', consumedValue: 0, lines: r.contract.lines?.length ? r.contract.lines : EMPTY.lines, source: 'PDF', fileName: r.fileName, extractedText: r.text } as Form);
      setExtractInfo(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/contracts', { method: 'POST', body: JSON.stringify(form) });
      setSaved(form.id);
      setForm(null);
      setExtractInfo(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Rate contracts"
        subtitle="The register as at its last update, plus contracts signed later that exist only as signed PDFs (policy 4.4). PDF-only contracts start with zero consumed value (4.2) and are binding from their start date."
        action={
          <div className="flex gap-2">
            <label className="btn-primary cursor-pointer">
              {busy ? <Spinner /> : <FileUp size={16} />} Add from signed PDF
              <input type="file" accept=".pdf" className="hidden" onChange={(e) => e.target.files?.[0] && extract(e.target.files[0])} />
            </label>
            <button className="btn-secondary" onClick={() => { setForm({ ...EMPTY }); setExtractInfo(null); }}>
              <Plus size={16} /> Enter manually
            </button>
          </div>
        }
      />
      <ErrorBox error={error} />
      {saved && <InfoBox tone="ok">Contract {saved} saved. New decision runs will use it from its start date.</InfoBox>}

      {form && (
        <div className="card mb-6 p-5">
          <div className="mb-3 text-lg font-semibold">{form.source === 'PDF' ? `Check the extracted contract (${form.fileName})` : 'New contract'}</div>
          {extractInfo && (
            <>
              {extractInfo.missing.length ? <InfoBox tone="warn">Could not read: {extractInfo.missing.join(', ')}. Fill them in below.</InfoBox> : <InfoBox tone="ok">All fields were read from the PDF. Check them against the document before saving.</InfoBox>}
              {extractInfo.existing && <InfoBox tone="warn">Contract {extractInfo.existing.id} is already loaded{extractInfo.differences.length ? `; the PDF differs: ${extractInfo.differences.join('; ')}` : ' and matches this PDF'}.</InfoBox>}
              {extractInfo.supplier && extractInfo.supplier.status !== 'Active' && <InfoBox tone="warn">The supplier is {extractInfo.supplier.status}: the contract will not be applied (policy 4.1).</InfoBox>}
              {extractInfo.unknownItems.length > 0 && <InfoBox tone="warn">Items not in the item master: {extractInfo.unknownItems.join(', ')}.</InfoBox>}
            </>
          )}
          <div className="grid gap-3 md:grid-cols-4">
            {(
              [
                ['id', 'Contract id', 'text'],
                ['supplierId', 'Supplier id', 'text'],
                ['supplierName', 'Supplier name', 'text'],
                ['valueCap', 'Value ceiling ₹', 'number'],
                ['startDate', 'Start date', 'date'],
                ['endDate', 'End date', 'date'],
                ['consumedValue', 'Consumed so far ₹', 'number'],
              ] as [keyof Form, string, string][]
            ).map(([k, label, type]) => (
              <div key={k}>
                <label className="label">{label}</label>
                <input className="input" type={type} value={String(form[k] ?? '')} onChange={(e) => setForm({ ...form, [k]: type === 'number' ? Number(e.target.value) : e.target.value })} />
              </div>
            ))}
          </div>
          <div className="label mt-4">Schedule A: items and rates</div>
          <table className="w-full">
            <tbody>
              {form.lines.map((l, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2">
                    <input className="input" placeholder="ITM-1036" value={l.itemCode} onChange={(e) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, itemCode: e.target.value.toUpperCase() } : x)) })} />
                  </td>
                  <td className="py-1 pr-2">
                    <input className="input" placeholder="Description" value={l.description} onChange={(e) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} />
                  </td>
                  <td className="w-24 py-1 pr-2">
                    <input className="input" placeholder="UoM" value={l.uom} onChange={(e) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, uom: e.target.value } : x)) })} />
                  </td>
                  <td className="w-36 py-1 pr-2">
                    <input className="input" type="number" step="0.01" placeholder="Rate" value={l.rate} onChange={(e) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, rate: Number(e.target.value) } : x)) })} />
                  </td>
                  <td className="w-10">
                    <button className="text-slate-400 hover:text-rose-600" onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn-secondary mt-2" onClick={() => setForm({ ...form, lines: [...form.lines, { itemCode: '', description: '', uom: '', rate: 0 }] })}>
            <Plus size={14} /> Add line
          </button>
          <div className="mt-4 flex gap-2">
            <button className="btn-primary" disabled={busy || !!extractInfo?.existing} onClick={save}>
              <Save size={16} /> Save contract
            </button>
            <button className="btn-secondary" onClick={() => { setForm(null); setExtractInfo(null); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              {['Contract', 'Supplier', 'Valid', 'Ceiling', 'Consumed', 'Left', 'Items and rates', 'Source'].map((h) => (
                <th key={h} className="th">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const active = c.startDate <= today && today <= c.endDate;
              const left = c.valueCap - c.consumedValue;
              return (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="td font-semibold">{c.id}</td>
                  <td className="td">
                    {c.supplierId} {c.supplierName}
                    <div className={clsx('text-xs', c.supplierStatus === 'Active' ? 'text-slate-400' : 'font-medium text-rose-600')}>{c.supplierStatus}</div>
                  </td>
                  <td className="td whitespace-nowrap text-xs">
                    {c.startDate} → {c.endDate}
                    <div className={active ? 'text-emerald-600' : 'text-slate-400'}>{active ? 'valid today' : c.endDate < today ? 'expired' : 'not started'}</div>
                  </td>
                  <td className="td">{formatINR(c.valueCap)}</td>
                  <td className="td">{formatINR(c.consumedValue)}</td>
                  <td className={clsx('td', left / c.valueCap < 0.1 && 'font-medium text-rose-600')}>{formatINR(left)}</td>
                  <td className="td text-xs">
                    {c.lines.map((l) => (
                      <div key={l.itemCode}>
                        {l.itemCode} {l.description}: {formatPrice(l.rate)}/{l.uom}
                      </div>
                    ))}
                  </td>
                  <td className="td text-xs">
                    <span className={clsx('chip', c.source === 'REGISTER' ? 'bg-slate-100 text-slate-700' : 'bg-violet-100 text-violet-800')}>{c.source === 'REGISTER' ? 'register' : c.source === 'PDF' ? 'PDF only' : 'manual'}</span>
                    {c.addedBy && c.source !== 'REGISTER' && <div className="mt-1 text-slate-400">by {c.addedBy}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
