'use client';

export interface CurrentUser {
  name: string;
  role: 'Requester' | 'Buyer' | 'Procurement Head';
}

export function getUser(): CurrentUser {
  if (typeof window === 'undefined') return { name: 'Guest', role: 'Buyer' };
  try {
    const u = JSON.parse(localStorage.getItem('corvo-user') ?? '');
    if (u?.name) return u;
  } catch {}
  return { name: 'Guest', role: 'Buyer' };
}

export function setUser(u: CurrentUser) {
  localStorage.setItem('corvo-user', JSON.stringify(u));
  window.dispatchEvent(new Event('corvo-user'));
}

function headers(extra?: HeadersInit): HeadersInit {
  const u = getUser();
  return { 'x-user-name': encodeURIComponent(u.name), 'x-user-role': encodeURIComponent(u.role), ...(extra ?? {}) };
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const res = await fetch(path, {
    ...init,
    headers: headers(isForm || !init.body ? init.headers : { 'Content-Type': 'application/json', ...(init.headers ?? {}) }),
  });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? `Request failed (${res.status})`);
  return data as T;
}
