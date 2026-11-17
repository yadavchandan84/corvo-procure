'use client';

import clsx from 'clsx';
import { ROUTE_STYLE, STATUS_STYLE } from '@/lib/format';
import type { ReactNode } from 'react';

export function RouteChip({ route }: { route: string }) {
  return <span className={clsx('chip', ROUTE_STYLE[route] ?? 'bg-slate-100 text-slate-700')}>{route.replace(/_/g, ' ')}</span>;
}

export function StatusChip({ status }: { status: string }) {
  return <span className={clsx('chip', STATUS_STYLE[status] ?? 'bg-slate-100 text-slate-700')}>{status.toLowerCase()}</span>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="h1">{title}</h1>
        {subtitle && <p className="muted mt-1 max-w-3xl">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorBox({ error }: { error?: string | null }) {
  if (!error) return null;
  return <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>;
}

export function InfoBox({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'ok' }) {
  const cls = tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-900' : tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-brand-100 bg-brand-50 text-brand-900';
  return <div className={clsx('mb-4 rounded-lg border px-4 py-3 text-sm', cls)}>{children}</div>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className="text-xl font-semibold text-slate-900">{value}</div>
      {hint && <div className="muted mt-1 text-xs">{hint}</div>}
    </div>
  );
}

export function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent align-[-2px]" />;
}
