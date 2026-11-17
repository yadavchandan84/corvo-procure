export { formatINR, formatPrice } from '@/engine/format';

export const ROUTE_STYLE: Record<string, string> = {
  CONTRACT_PO: 'bg-emerald-100 text-emerald-800',
  SPOT_PO: 'bg-sky-100 text-sky-800',
  EMERGENCY_PO: 'bg-rose-100 text-rose-800',
  RFQ: 'bg-amber-100 text-amber-800',
  RFP: 'bg-orange-100 text-orange-800',
  CAPEX_SOURCING: 'bg-violet-100 text-violet-800',
  NEW_ITEM_SOURCING: 'bg-fuchsia-100 text-fuchsia-800',
  NOT_PROCESSED: 'bg-slate-200 text-slate-700',
};

export const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-700',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  OVERRIDDEN: 'bg-amber-100 text-amber-800',
  RETURNED: 'bg-rose-100 text-rose-800',
  DRAFT: 'bg-amber-100 text-amber-800',
  REJECTED: 'bg-rose-100 text-rose-800',
};

export function fmtDateTime(s: string | Date | null | undefined): string {
  if (!s) return '-';
  const d = typeof s === 'string' ? new Date(s) : s;
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
}
