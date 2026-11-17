'use client';

import clsx from 'clsx';
import { formatPrice } from '@/lib/format';
import type { PreferredSupplierEntry } from '@/engine/types';

export function PreferredTable({ entries, highlight }: { entries: PreferredSupplierEntry[]; highlight?: string | string[] | null }) {
  const hl = Array.isArray(highlight) ? highlight : highlight ? [highlight] : [];
  return (
    <table className="w-full">
      <thead className="bg-slate-50">
        <tr>
          {['Rank', 'Supplier', 'Score', 'POs (window)', 'Last PO', 'Recency', 'Contract', 'On-time', 'Quality', 'Reference price'].map((h) => (
            <th key={h} className="th">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.supplierId} className={clsx('border-t border-slate-100', hl.includes(e.supplierId) && 'bg-emerald-50')}>
            <td className="td font-semibold">{e.rank}</td>
            <td className="td">
              {e.supplierId} {e.supplierName}
            </td>
            <td className="td" title={`frequency ${e.components.frequency.toFixed(2)}, recency ${e.components.recency}, contract ${e.components.contract}, on-time ${e.components.onTime.toFixed(2)}, quality ${e.components.quality.toFixed(2)}`}>
              {e.score.toFixed(3)}
            </td>
            <td className="td">{e.poCount}</td>
            <td className="td whitespace-nowrap text-xs">{e.lastPoDate ? `${e.lastPoDate} (${e.daysSinceLastPo}d)` : '-'}</td>
            <td className="td">{e.recency}</td>
            <td className="td">{e.hasContract ? 'yes' : 'no'}</td>
            <td className="td">{e.onTimePct}%</td>
            <td className="td">{e.qualityRating}</td>
            <td className="td whitespace-nowrap">
              {formatPrice(e.referencePrice)}
              <div className="text-xs text-slate-400">{e.referenceSource}</div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

