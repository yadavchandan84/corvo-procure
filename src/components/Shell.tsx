'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { ClipboardList, FileText, Gavel, History, Home, MessageSquare, Database, Trophy, Upload } from 'lucide-react';
import { getUser, setUser, type CurrentUser } from '@/lib/api';

const NAV = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/chat', label: 'Raise a PR', icon: MessageSquare },
  { href: '/workspace', label: 'Buyer workspace', icon: ClipboardList },
  { href: '/batches', label: 'PR batches', icon: Upload },
  { href: '/policy', label: 'Policy', icon: Gavel },
  { href: '/contracts', label: 'Contracts', icon: FileText },
  { href: '/suppliers', label: 'Preferred suppliers', icon: Trophy },
  { href: '/audit', label: 'Audit trail', icon: History },
  { href: '/data', label: 'Master data', icon: Database },
];

function UserPicker() {
  const [user, setU] = useState<CurrentUser>({ name: 'Guest', role: 'Buyer' });
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setU(getUser());
    const f = () => setU(getUser());
    window.addEventListener('corvo-user', f);
    return () => window.removeEventListener('corvo-user', f);
  }, []);
  if (!editing)
    return (
      <button onClick={() => setEditing(true)} className="w-full rounded-lg border border-slate-700 px-3 py-2 text-left text-xs text-slate-300 hover:bg-slate-800">
        <div className="text-[10px] uppercase tracking-wide text-slate-500">Acting as</div>
        <div className="font-medium text-white">{user.name}</div>
        <div>{user.role}</div>
      </button>
    );
  return (
    <form
      className="space-y-2 rounded-lg border border-slate-700 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        setUser(user);
        setEditing(false);
      }}
    >
      <input className="input !bg-slate-900 !text-white" value={user.name} onChange={(e) => setU({ ...user, name: e.target.value })} placeholder="Your name" />
      <select className="input !bg-slate-900 !text-white" value={user.role} onChange={(e) => setU({ ...user, role: e.target.value as CurrentUser['role'] })}>
        <option>Requester</option>
        <option>Buyer</option>
        <option>Procurement Head</option>
      </select>
      <button className="btn-primary w-full">Save</button>
    </form>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-slate-900 p-4 md:flex">
        <Link href="/" className="mb-6 block">
          <div className="text-lg font-semibold text-white">Policy-Driven PR-to-PO</div>
          <div className="text-xs text-slate-400">PR to PO, policy driven</div>
        </Link>
        <nav className="flex-1 space-y-1">
          {NAV.map((n) => {
            const active = n.href === '/' ? path === '/' : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={clsx('flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm', active ? 'bg-brand-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white')}>
                <n.icon size={16} />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <UserPicker />
      </aside>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 md:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="whitespace-nowrap rounded px-2 py-1 text-xs text-slate-700">
              {n.label}
            </Link>
          ))}
        </div>
        <main className="mx-auto max-w-7xl p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
