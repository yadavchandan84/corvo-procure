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

export interface LlmOptions {
  temperature?: number;
  timeoutMs?: number;
  reasoning?: 'none' | 'low' | 'medium' | 'high';
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
    const usable = ids.filter((id) => !exclude.has(id) && !/(image|tts|audio|embed|vision|live|veo|imagen|aqa|learnlm|robotics|computer|gemma|omni|pro)/i.test(id));
    // prefer the "latest" aliases, then stable flash models; newest version first within a group
    const score = (id: string) =>
      (/^gemini-flash-latest$/.test(id) ? 10 : /^gemini-flash-lite-latest$/.test(id) ? 9 : 0) +
      (/flash/i.test(id) ? 4 : /mini|small|instant/i.test(id) ? 3 : 1) -
      (/preview|exp/i.test(id) ? 3 : 0);
    usable.sort((a, b) => score(b) - score(a) || b.localeCompare(a, undefined, { numeric: true }));
    return usable[0] ?? null;
  } catch {
    return null;
  }
}

export async function llmJson<T = unknown>(system: string, user: string, opts: LlmOptions = {}): Promise<T> {
  const cfg = llmConfig();
  if (!cfg) throw new Error('No AI provider is configured (set GEMINI_API_KEY, GROQ_API_KEY or OPENAI_API_KEY).');
  const started = Date.now();
  const budget = opts.timeoutMs ?? 50000;
  const unusable = new Set<string>();
  const busy = new Set<string>();
  let model = resolvedModel ?? cfg.model;
  const errors: string[] = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    const left = budget - (Date.now() - started);
    if (left < 4000) break;
    try {
      const out = await callModel<T>(cfg, model, system, user, { ...opts, timeoutMs: left });
      resolvedModel = model; // remember only a model that actually answered
      return out;
    } catch (e) {
      errors.push(`${model}: ${(e as Error).message.slice(0, 300)}`);
      if (e instanceof ModelUnavailableError) {
        // retired, unknown, or not included in this plan (quota limit 0): never retry it
        unusable.add(model);
        const alt = await pickAvailableModel(cfg, unusable);
        if (!alt) break;
        model = alt;
      } else if (e instanceof TransientError) {
        // overloaded or rate limited: move on to another model (busy models are only skipped for this call)
        busy.add(model);
        const alt = await pickAvailableModel(cfg, new Set([...unusable, ...busy]));
        if (alt) model = alt;
        else await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      } else if ((e as Error).name === 'AbortError') {
        break; // out of time
      } else throw e;
    }
  }
  throw new Error(errors.length ? errors.join(' | ') : 'The AI provider did not answer in time.');
}

/** Self-check for the deploy: which models the key can list, and whether a tiny request works. */
export async function llmSelfCheck() {
  const cfg = llmConfig();
  if (!cfg) return { enabled: false };
  let models: string[] = [];
  try {
    const res = await fetch(`${cfg.baseUrl}/models`, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
    const data = (await res.json()) as { data?: { id: string }[] };
    models = (data.data ?? []).map((m) => m.id.replace(/^models\//, ''));
  } catch {}
  const t0 = Date.now();
  try {
    const r = await llmJson<{ ok?: boolean }>('Reply with the JSON object {"ok": true}.', 'ping', { timeoutMs: 30000, reasoning: 'none' });
    return { enabled: true, provider: cfg.provider, configured: cfg.model, used: resolvedModel, ok: r?.ok === true, ms: Date.now() - t0, models };
  } catch (e) {
    return { enabled: true, provider: cfg.provider, configured: cfg.model, ok: false, error: (e as Error).message.slice(0, 1500), models };
  }
}

class ModelUnavailableError extends Error {}
class TransientError extends Error {}

async function callModel<T>(cfg: LlmConfig, model: string, system: string, user: string, opts: LlmOptions): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 55000);
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model,
        // reading text into JSON needs little reasoning; long "thinking" only adds latency
        ...(cfg.provider === 'gemini' ? { reasoning_effort: opts.reasoning ?? 'low' } : {}),
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
      if (res.status === 429 && /limit: 0\b/.test(body)) throw new ModelUnavailableError(`model ${model} is not included in this plan: ${body.replace(/\s+/g, ' ').slice(0, 200)}`);
      if (res.status === 429 || res.status >= 500) throw new TransientError(`AI provider busy (${res.status}, model ${model}): ${body.replace(/\s+/g, ' ').slice(0, 700)}`);
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
