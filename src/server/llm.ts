/**
 * Minimal client for any OpenAI-compatible chat completions API (Google Gemini, Groq, OpenAI,
 * OpenRouter...). The AI is only used to read text (chat messages, amendment documents); it never
 * makes procurement decisions. Everything it returns is validated before use.
 */

interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: string;
}

export function llmConfig(): LlmConfig | null {
  const env = process.env;
  if (env.LLM_API_KEY && env.LLM_BASE_URL) {
    return { baseUrl: env.LLM_BASE_URL.replace(/\/$/, ''), apiKey: env.LLM_API_KEY, model: env.LLM_MODEL || 'gpt-4o-mini', provider: 'custom' };
  }
  if (env.GEMINI_API_KEY) {
    // alias that Google keeps pointing at the current stable Flash model
    return { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: env.GEMINI_API_KEY, model: env.LLM_MODEL || 'gemini-flash-latest', provider: 'gemini' };
  }
  if (env.GROQ_API_KEY) {
    return { baseUrl: 'https://api.groq.com/openai/v1', apiKey: env.GROQ_API_KEY, model: env.LLM_MODEL || 'llama-3.3-70b-versatile', provider: 'groq' };
  }
  if (env.OPENAI_API_KEY) {
    return { baseUrl: 'https://api.openai.com/v1', apiKey: env.OPENAI_API_KEY, model: env.LLM_MODEL || 'gpt-4o-mini', provider: 'openai' };
  }
  return null;
}

export function llmInfo() {
  const c = llmConfig();
  return c ? { enabled: true, provider: c.provider, model: resolvedModel ?? c.model } : { enabled: false, provider: null, model: null };
}

/** Model actually used, after any fallback; shared by warm server instances. */
let resolvedModel: string | null = null;

/** When the configured model is retired or unknown, pick an available text model from the provider's list. */
async function pickAvailableModel(cfg: LlmConfig, exclude: Set<string> = new Set()): Promise<string | null> {
  try {
    const res = await fetch(`${cfg.baseUrl}/models`, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { id: string }[] };
    const ids = (data.data ?? []).map((m) => m.id.replace(/^models\//, ''));
    const usable = ids.filter((id) => !exclude.has(id) && !/(image|tts|audio|embed|vision|live|veo|imagen|aqa|learnlm|robotics|computer|gemma)/i.test(id));
    const score = (id: string) =>
      (/flash/i.test(id) ? 4 : /mini|small|instant/i.test(id) ? 3 : 1) - (/lite|nano/i.test(id) ? 1 : 0) - (/preview|exp/i.test(id) ? 2 : 0) + (/latest/i.test(id) ? 1 : 0);
    usable.sort((a, b) => score(b) - score(a) || b.localeCompare(a, undefined, { numeric: true }));
    return usable[0] ?? null;
  } catch {
    return null;
  }
}

export async function llmJson<T = unknown>(system: string, user: string, opts: { temperature?: number; timeoutMs?: number } = {}): Promise<T> {
  const cfg = llmConfig();
  if (!cfg) throw new Error('No AI provider is configured (set GEMINI_API_KEY, GROQ_API_KEY or OPENAI_API_KEY).');
  const started = Date.now();
  const budget = opts.timeoutMs ?? 50000;
  const tried = new Set<string>();
  let model = resolvedModel ?? cfg.model;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const left = budget - (Date.now() - started);
    if (left < 4000) break;
    try {
      return await callModel<T>(cfg, model, system, user, { ...opts, timeoutMs: left });
    } catch (e) {
      lastError = e as Error;
      tried.add(model);
      if (e instanceof ModelUnavailableError) {
        // retired or unknown model: switch for good
        const alt = await pickAvailableModel(cfg, tried);
        if (!alt) break;
        resolvedModel = model = alt;
      } else if (e instanceof TransientError) {
        // overloaded or rate limited: wait briefly, then retry; from the second failure try another model
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        if (attempt >= 1) {
          const alt = await pickAvailableModel(cfg, tried);
          if (alt) model = alt;
        }
      } else throw e;
    }
  }
  throw lastError ?? new Error('The AI provider did not answer in time.');
}

class ModelUnavailableError extends Error {}
class TransientError extends Error {}

async function callModel<T>(cfg: LlmConfig, model: string, system: string, user: string, opts: { temperature?: number; timeoutMs?: number }): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 55000);
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model,
        temperature: opts.temperature ?? 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 404 || /not (found|available|supported)|no longer available|does not exist/i.test(body)) {
        throw new ModelUnavailableError(`${res.status}: ${body.slice(0, 200)}`);
      }
      if (res.status === 429 || res.status >= 500) throw new TransientError(`AI provider busy (${res.status}): ${body.slice(0, 160)}`);
      throw new Error(`AI provider returned ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? '';
    return parseJsonLoose(content) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Accept plain JSON or JSON wrapped in a markdown fence. */
export function parseJsonLoose(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return JSON.parse(fenced[1]);
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw new Error('The AI response was not valid JSON.');
  }
}
