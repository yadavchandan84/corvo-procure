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
    return { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: env.GEMINI_API_KEY, model: env.LLM_MODEL || 'gemini-2.5-flash', provider: 'gemini' };
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
  return c ? { enabled: true, provider: c.provider, model: c.model } : { enabled: false, provider: null, model: null };
}

export async function llmJson<T = unknown>(system: string, user: string, opts: { temperature?: number; timeoutMs?: number } = {}): Promise<T> {
  const cfg = llmConfig();
  if (!cfg) throw new Error('No AI provider is configured (set GEMINI_API_KEY, GROQ_API_KEY or OPENAI_API_KEY).');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 55000);
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
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
