'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { api, getUser } from '@/lib/api';
import { ErrorBox, PageHeader, RouteChip, Spinner } from '@/components/ui';
import { formatINR } from '@/lib/format';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  options?: { label: string; value: string }[];
  card?: Record<string, unknown>;
}

const EXAMPLES = ['need 200 nitrile gloves for Chakan by next Friday', 'brg 6205 2rs 300 nos for Bhosari', 'emergency: 20 ltr hydraulic oil hlp 68 for chk1 tomorrow', 'need 1 ultrasonic thickness gauge'];

const WELCOME: Msg = {
  role: 'assistant',
  content: 'Hi! Tell me what you need to buy, for which plant and by when. I will match it to the item master, ask for anything missing and raise the purchase request.',
};

export default function ChatPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [department, setDepartment] = useState('Maintenance');
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('corvo-chat');
    if (saved) {
      api<{ messages: Msg[] }>(`/api/chat?sessionId=${saved}`)
        .then((r) => {
          setSessionId(saved);
          if (r.messages.length) setMessages([WELCOME, ...r.messages]);
        })
        .catch(() => localStorage.removeItem('corvo-chat'));
    }
  }, []);
  // braces matter: newer browsers return a Promise from scrollIntoView, which React would treat as a cleanup
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setError(null);
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setInput('');
    setBusy(true);
    try {
      const r = await api<{ sessionId: string; replies: Msg[] }>('/api/chat', { method: 'POST', body: JSON.stringify({ sessionId, message: text, department }) });
      setSessionId(r.sessionId);
      localStorage.setItem('corvo-chat', r.sessionId);
      setMessages((m) => [...m, ...r.replies]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function newChat() {
    localStorage.removeItem('corvo-chat');
    setSessionId(null);
    setMessages([WELCOME]);
  }

  const last = messages[messages.length - 1];
  return (
    <div>
      <PageHeader
        title="Raise a purchase request"
        subtitle={`Chatting as ${getUser().name}. The assistant never invents items: if it cannot find yours in the item master it asks, or raises it as a new item for sourcing.`}
        action={
          <div className="flex items-center gap-2">
            <select className="input !w-40" value={department} onChange={(e) => setDepartment(e.target.value)} title="Your department">
              {['Maintenance', 'Production', 'Stores', 'Quality', 'Tool Room', 'IT', 'Admin'].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
            <button className="btn-secondary" onClick={newChat}>
              New chat
            </button>
          </div>
        }
      />
      <ErrorBox error={error} />
      <div className="card flex h-[calc(100vh-220px)] min-h-[480px] flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div className={m.role === 'user' ? 'max-w-[75%] rounded-2xl rounded-br-sm bg-brand-600 px-4 py-2.5 text-sm text-white' : 'max-w-[80%] space-y-3'}>
                {m.role === 'user' ? (
                  m.content
                ) : (
                  <>
                    <div className="whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-2.5 text-sm text-slate-800">{m.content}</div>
                    {m.card?.type === 'pr_summary' && <SummaryCard card={m.card} />}
                    {m.card?.type === 'pr_created' && <CreatedCard card={m.card} />}
                    {m.options && i === messages.length - 1 && (
                      <div className="flex flex-wrap gap-2">
                        {m.options.map((o) => (
                          <button key={o.value} className="btn-secondary !py-1.5 text-xs" onClick={() => send(o.value)} disabled={busy}>
                            {o.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div className="muted flex items-center gap-2">
              <Spinner /> thinking…
            </div>
          )}
          <div ref={end} />
        </div>
        {messages.length <= 1 && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 px-5 py-3">
            <span className="muted text-xs">Try:</span>
            {EXAMPLES.map((e) => (
              <button key={e} className="chip bg-slate-100 text-slate-700 hover:bg-slate-200" onClick={() => send(e)}>
                {e}
              </button>
            ))}
          </div>
        )}
        <form
          className="flex gap-2 border-t border-slate-200 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <input className="input" autoFocus value={input} onChange={(e) => setInput(e.target.value)} placeholder={last?.options ? 'Pick an option above or type your answer' : 'e.g. need 200 nitrile gloves for Chakan by next Friday'} />
          <button className="btn-primary" disabled={busy || !input.trim()}>
            <Send size={16} /> Send
          </button>
        </form>
      </div>
    </div>
  );
}

function SummaryCard({ card }: { card: Record<string, unknown> }) {
  const rows: [string, unknown][] = [
    ['Item', card.item],
    ['Quantity', card.quantity],
    ['Plant', card.plant],
    ['Need by', card.needBy],
    ['Urgency', card.urgency],
    ['Department', card.department],
    ['Estimated unit price', card.estimate],
  ];
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <tbody>
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <tr key={k} className="border-b border-slate-100 last:border-0">
                <td className="w-40 bg-slate-50 px-3 py-1.5 text-xs font-medium uppercase text-slate-500">{k}</td>
                <td className="px-3 py-1.5">{String(v)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

function CreatedCard({ card }: { card: Record<string, unknown> }) {
  return (
    <div className="card flex flex-wrap items-center gap-3 p-3 text-sm">
      <span className="font-semibold">{String(card.prNo)}</span>
      {typeof card.route === 'string' && <RouteChip route={card.route} />}
      {typeof card.value === 'number' && <span>{formatINR(card.value)}</span>}
      {typeof card.version === 'string' && <span className="muted">policy v{card.version} §{String(card.clause)}</span>}
      <Link href="/workspace?live=1" className="ml-auto text-brand-600 hover:underline">
        Open in buyer workspace →
      </Link>
    </div>
  );
}
