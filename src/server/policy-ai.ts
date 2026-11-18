import * as chrono from 'chrono-node';
import { llmConfig, llmJson } from './llm';
import { FACTS } from '@/engine/policy/facts';
import { KNOWN_ROUTES, type Condition, type PolicyDefinition, type PolicyRule } from '@/engine/policy/schema';
import { validatePolicy } from '@/engine/policy/validate';
import { applyEdits, type PolicyEdit } from '@/engine/policy/edits';
import { parseDate, todayIST } from '@/engine/dates';

export interface DraftProposal {
  version: string | null;
  effectiveFrom: string | null;
  summary: string[];
  definition: PolicyDefinition;
  unrepresentable: string[];
  assumptions: string[];
  reader: 'ai' | 'rules';
  validationErrors: string[];
  validationWarnings: string[];
}


const SYSTEM = `You turn procurement policy amendments into a short list of EDITS to Corvo Engineering's machine-readable policy.
You receive the CURRENT policy (JSON), the FACTS rule conditions may use, and an AMENDMENT (a document, or a change Procurement described in chat).

Return ONLY a JSON object:
{
  "version": "new version label (use the amendment's number if stated, else bump the minor number, e.g. 5.0 -> 5.1)",
  "effectiveFrom": "YYYY-MM-DD from the amendment, or null if it does not say",
  "summary": ["one plain sentence per change, in the amendment's terms"],
  "edits": [ ...edits, see below ],
  "unrepresentable": ["parts that cannot be expressed with these edits and facts; [] if none"],
  "assumptions": ["interpretations you had to make; [] if none"]
}

EDITS (apply only what the amendment changes):
- {"op":"set","path":"clubbing.creationWindowDays","value":21}   parameter change; path is a dotted path that exists in CURRENT (never "rules")
- {"op":"set_condition_value","ruleId":"R5.4","fact":"value","value":250000}   change a limit inside a rule (optional "whereOp":"lt" to pick one condition)
- {"op":"add_rule","rule":{RULE},"after":"R5.2"}   or "before":"R5.3"; ORDER MATTERS, the first matching rule decides
- {"op":"update_rule","ruleId":"R5.5","changes":{"when":{...}}}   may change title, clause, when, outcome, enabled
- {"op":"remove_rule","ruleId":"..."}   {"op":"move_rule","ruleId":"...","before":"..."}

RULE = {"id":"R5.2A","clause":"5.2A","title":"short title","when":CONDITION,"outcome":OUTCOME}
CONDITION = {"all":[...]} | {"any":[...]} | {"not":{...}} | {"fact":"<fact name>","op":"<op>","value":<v>}
  ops: eq, neq, lt, lte, gt, gte, in, not_in, contains, is_true, is_false, exists, not_exists (is_true/is_false/exists/not_exists take no value)
OUTCOME = {"decision":"PO"|"SOURCING_REQUEST","route":one of ${KNOWN_ROUTES.join(', ')},"supplier":"contract"|"preferred_1"|"none","suggestCount":n,"approvals":[]}
  PO routes need supplier "contract" (only with contract_usable) or "preferred_1" (1st preferred supplier); sourcing uses "none" with suggestCount 3 (RFQ) or 5 (RFP/Capex).

Current rule order (ids): R1.2 new item, R5.1 capex, R5.2 contract, R5.3 emergency, R5.4 spot, R5.5 RFQ (value lt 1000000), R5.6 RFP (value gte 1000000).

Guidance:
- Money is plain INR: Rs 2,00,000 = 200000; 1 lakh = 100000; 10 lakh = 1000000; 1 crore = 10000000.
- "bought from an Active supplier in the last N days" = {"fact":"days_since_last_eligible_purchase","op":"lte","value":N}.
- A plant/category/item-type/department exception is a NEW rule placed before the general rule it overrides. "Unless a contract can be used" means place it after R5.2.
- When a threshold moves, change every condition that uses it (the RFQ/RFP boundary is in both R5.5 and R5.6).
- Plant codes: PUN1 (Bhosari, Pune), CHK1 (Chakan). Category names must match the item master exactly, e.g. "Safety & PPE".
- Use only the listed facts. Put anything you cannot express in "unrepresentable" instead of guessing.`;

function factsList(): string {
  return FACTS.map((f) => `- ${f.name} (${f.type}): ${f.description}${f.options ? ` Values: ${f.options.join(', ')}.` : ''}`).join('\n');
}

export async function proposeWithAi(
  current: { version: string; effectiveFrom: string; definition: PolicyDefinition },
  amendment: string,
  mode: 'document' | 'chat',
  categories: string[] = [],
): Promise<DraftProposal> {
  const user = `TODAY: ${todayIST()}
CURRENT POLICY: version ${current.version}, effective ${current.effectiveFrom}
${JSON.stringify(current.definition)}

FACTS:
${factsList()}
${categories.length ? `\nITEM CATEGORIES: ${categories.join('; ')}\n` : ''}
AMENDMENT (${mode === 'document' ? 'uploaded document' : 'described in chat by Procurement'}):
"""
${amendment.slice(0, 30000)}
"""`;
  let problems: string[] = [];
  const started = Date.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    // stay inside the function time limit, leaving time for the built-in reader fallback
    const left = 90000 - (Date.now() - started);
    if (attempt > 0 && left < 25000) break;
    const prompt = attempt === 0 ? user : `${user}\n\nYour previous edits had problems:\n${problems.join('\n')}\nReturn the corrected JSON object.`;
    const last = await llmJson<Record<string, unknown>>(SYSTEM, prompt, { timeoutMs: left });
    const edits = Array.isArray(last.edits) ? (last.edits as PolicyEdit[]) : [];
    const applied = applyEdits(current.definition, edits);
    const v = validatePolicy(applied.definition);
    problems = [...applied.problems, ...v.errors];
    if (v.ok && v.definition && !applied.problems.length) {
      return {
        version: typeof last.version === 'string' ? last.version : null,
        effectiveFrom: parseDate(typeof last.effectiveFrom === 'string' ? last.effectiveFrom : null),
        summary: arr(last.summary),
        definition: v.definition,
        unrepresentable: arr(last.unrepresentable),
        assumptions: arr(last.assumptions),
        reader: 'ai',
        validationErrors: [],
        validationWarnings: v.warnings,
      };
    }
  }
  throw new Error(`The AI could not produce valid edits: ${problems.join('; ').slice(0, 600)}`);
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

// ---------- deterministic reader (used when no AI is configured, or as a fallback) ----------

const PLANT_WORDS: [RegExp, string][] = [
  [/\b(chk1|chakan)\b/i, 'CHK1'],
  [/\b(pun1|bhosari)\b/i, 'PUN1'],
];

/**
 * The new money amount in a sentence. Only real amounts count (with ₹/Rs/INR, lakh/crore/k, or
 * comma grouping), so clause numbers like "5.4" are never read as a limit. The last amount wins,
 * which is the new value in "raised from X to Y" and "X becomes Y".
 */
export function amount(s: string): number | null {
  const re = /(₹|\brs\.?|\binr\b)?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(lakhs?\b|lacs?\b|l\b|crores?\b|cr\b|k\b|thousand\b)?/gi;
  const found: { value: number; index: number }[] = [];
  for (const m of s.matchAll(re)) {
    const currency = !!m[1];
    const unit = (m[3] ?? '').toLowerCase();
    const grouped = m[2].includes(',');
    if (!currency && !unit && !grouped) continue;
    let n = Number(m[2].replace(/,/g, ''));
    if (unit.startsWith('l')) n *= 100000;
    else if (unit.startsWith('cr')) n *= 10000000;
    else if (unit === 'k' || unit === 'thousand') n *= 1000;
    if (Number.isFinite(n) && n > 0) found.push({ value: n, index: m.index ?? 0 });
  }
  if (!found.length) return null;
  // "raised from X to Y" / "X becomes Y": the new value comes last
  return found[found.length - 1].value;
}

function findValueCond(rule: PolicyRule | undefined, op?: string) {
  if (!rule) return null;
  const list = 'all' in rule.when ? rule.when.all : [rule.when];
  return (list.find((c) => 'fact' in c && c.fact === 'value' && (!op || c.op === op)) as { fact: string; op: string; value?: unknown } | undefined) ?? null;
}

/**
 * Handles the common, well-phrased changes: limits, windows, lookbacks, suggestion counts and
 * plant-only limits. Anything it does not understand is reported, never guessed.
 */
export function proposeWithRules(current: { version: string; definition: PolicyDefinition }, text: string, categories: string[] = []): DraftProposal {
  const def = JSON.parse(JSON.stringify(current.definition)) as PolicyDefinition;
  const summary: string[] = [];
  const unrepresentable: string[] = [];
  const assumptions: string[] = [];
  let lastAdded: PolicyRule | null = null;
  const ruleByClause = (c: string) => def.rules.find((r) => r.clause === c || r.id === `R${c}`);
  const sentences = text
    .split(/(?<=[.;\n])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
  const rule = (id: string) => def.rules.find((r) => r.id === id);
  let effectiveFrom: string | null = null;
  let version: string | null = text.match(/version\s*([0-9]+\.[0-9]+)/i)?.[1] ?? null;

  for (const s of sentences) {
    const lower = s.toLowerCase();
    let handled = false;
    const eff = s.match(/(?:effective|from|w\.e\.f\.?|starting)\s+(?:on\s+|from\s+)?(.{4,30})/i);
    if (eff) {
      const parsed = parseDate(eff[1]) ?? chrono.parseDate(eff[1], new Date(), { forwardDate: false });
      if (parsed) {
        effectiveFrom = typeof parsed === 'string' ? parsed : new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
        handled = true;
      }
    }
    const plant = PLANT_WORDS.find(([re]) => re.test(s))?.[1] ?? null;
    const days = s.match(/(\d+)\s*(?:calendar\s+)?days?/i)?.[1];
    const hours = s.match(/(\d+)\s*hours?/i)?.[1];
    const val = /limit|threshold|below|above|up to|upto|ceiling|₹|rs|lakh|inr/i.test(s) ? amount(s.replace(/\d+\s*(days?|hours?)/gi, '')) : null;

    const category = [...categories].sort((a, b) => b.length - a.length).find((c) => lower.includes(c.toLowerCase())) ?? null;
    const itemType = s.match(/\b(capex|service|material)\b\s+items?/i)?.[1] ?? null;
    const route = /\brfp\b|formal tender/i.test(s) ? 'RFP' : /\brfq\b|quotes?|quotation/i.test(s) ? 'RFQ' : null;
    const placement = /\b(after|before)\b[^.;]*?\d+\.\d+/i.test(s);

    if (placement && lastAdded && /\b(apply|place|check|put|insert)\b|\bit\b/i.test(s)) {
      // "Apply it after rule 5.2 and before rule 5.3": place the rule added just before this sentence
      const after = s.match(/\bafter\b[^.;]*?(\d+\.\d+[a-z]?)/i)?.[1];
      const before = s.match(/\bbefore\b[^.;]*?(\d+\.\d+[a-z]?)/i)?.[1];
      const target = after ? ruleByClause(after) : before ? ruleByClause(before) : null;
      if (target) {
        def.rules = def.rules.filter((r) => r !== lastAdded);
        const i = def.rules.indexOf(target);
        def.rules.splice(after ? i + 1 : i, 0, lastAdded);
        summary.push(`Rule ${lastAdded.clause} is checked ${after ? `after ${after}` : `before ${before}`}.`);
        handled = true;
      }
    } else if (route && (plant || category || itemType) && (val !== null || /\balways\b|\ball\b/i.test(s)) && !/spot|emergency/i.test(lower)) {
      // new kind of rule: "At CHK1, Safety & PPE items worth Rs 50,000 or more always go to RFQ"
      const conds: Condition[] = [];
      if (plant) conds.push({ fact: 'plant', op: 'eq', value: plant });
      if (category) conds.push({ fact: 'category', op: 'eq', value: category });
      if (itemType) conds.push({ fact: 'item_type', op: 'eq', value: itemType[0].toUpperCase() + itemType.slice(1).toLowerCase() });
      if (val !== null) {
        const op = /\b(below|under|less than|up to|upto|not more than)\b/i.test(s) ? (/up to|upto|not more than/i.test(s) ? 'lte' : 'lt') : /\b(above|more than|exceed\w*)\b/i.test(s) && !/or more/i.test(s) ? 'gt' : 'gte';
        conds.push({ fact: 'value', op, value: val });
      }
      conds.push({ fact: 'is_new_item', op: 'is_false' });
      const count = Number(s.match(/(\d+)\s+(?:suggested\s+)?suppliers?/i)?.[1] ?? (route === 'RFP' ? 5 : 3));
      const n = def.rules.filter((r) => r.id.startsWith('R-A')).length + 1;
      const label = s.match(/^\s*([A-Z]\d+(?:\.\d+)?)[.):]/)?.[1];
      const newRule: PolicyRule = {
        id: `R-A${n}`,
        clause: label ?? `5.2${String.fromCharCode(64 + n)}`,
        title: [plant, category ?? (itemType ? `${itemType} items` : null), route].filter(Boolean).join(' ') || 'Amendment rule',
        description: s,
        enabled: true,
        when: { all: conds },
        outcome: { decision: 'SOURCING_REQUEST', route, supplier: 'none', suggestCount: count, approvals: [] },
      };
      // default position: after the contract rule (a usable contract still wins) unless the sentence says otherwise
      const contractWins = !/\beven if\b.*contract|\bincluding\b.*contract/i.test(s);
      const anchor = rule(contractWins ? 'R5.2' : 'R5.1') ?? def.rules[0];
      def.rules.splice(def.rules.indexOf(anchor) + 1, 0, newRule);
      lastAdded = newRule;
      if (!/unless .*contract/i.test(s) && contractWins) assumptions.push(`New rule ${newRule.clause} is placed after the contract rule 5.2, so a usable rate contract still applies first.`);
      const valueOp = (conds.find((x) => 'fact' in x && x.fact === 'value') as { op?: string } | undefined)?.op;
      const opText: Record<string, string> = { gte: 'of', gt: 'above', lt: 'below', lte: 'up to' };
      summary.push(`New rule ${newRule.clause}: ${newRule.title}${val !== null ? ` for requirements ${opText[valueOp ?? 'gte']} ₹${val.toLocaleString('en-IN')}${valueOp === 'gte' ? ' or more' : ''}` : ''} go to ${route} with ${count} suggested suppliers.`);
      handled = true;
    } else if (/spot/.test(lower) && val) {
      const r5 = rule('R5.4');
      const c = findValueCond(r5);
      if (r5 && c) {
        if (plant) {
          const id = `R5.4-${plant}`;
          def.rules = def.rules.filter((r) => r.id !== id);
          const copy: PolicyRule = JSON.parse(JSON.stringify(r5));
          copy.id = id;
          copy.clause = `5.4 (${plant})`;
          copy.title = `Spot PO at ${plant}`;
          copy.description = s;
          const list = 'all' in copy.when ? copy.when.all : [copy.when];
          const vc = list.find((x) => 'fact' in x && x.fact === 'value') as { value?: unknown } | undefined;
          if (vc) vc.value = val;
          copy.when = { all: [{ fact: 'plant', op: 'eq', value: plant }, ...list] };
          const general = def.rules.indexOf(r5);
          if ('all' in r5.when && !r5.when.all.some((x) => 'fact' in x && x.fact === 'plant')) r5.when.all.unshift({ fact: 'plant', op: 'neq', value: plant });
          def.rules.splice(general, 0, copy);
          summary.push(`Spot PO limit at ${plant} becomes ₹${val.toLocaleString('en-IN')} (other plants unchanged).`);
        } else {
          c.value = val;
          summary.push(`Spot PO limit becomes ₹${val.toLocaleString('en-IN')}.`);
        }
        handled = true;
      }
    } else if (/emergency/.test(lower) && val) {
      const c = findValueCond(rule('R5.3'));
      if (c && !plant) {
        c.value = val;
        summary.push(`Emergency PO limit becomes ₹${val.toLocaleString('en-IN')}.`);
        handled = true;
      }
    } else if (/\brfp\b|formal tender/.test(lower) && val) {
      const a = findValueCond(rule('R5.5'), 'lt');
      const b = findValueCond(rule('R5.6'), 'gte');
      if (a && b && !plant) {
        a.value = val;
        b.value = val;
        summary.push(`RFP threshold becomes ₹${val.toLocaleString('en-IN')} (RFQ below it).`);
        handled = true;
      }
    } else if (/club/.test(lower) && /need.?by/.test(lower) && days) {
      def.clubbing.needByWindowDays = Number(days);
      summary.push(`Clubbing need-by window becomes ${days} days either side.`);
      handled = true;
    } else if (/club/.test(lower) && days) {
      def.clubbing.creationWindowDays = Number(days);
      summary.push(`Clubbing window becomes ${days} calendar days from the first line.`);
      handled = true;
    } else if (/consolidat|one po|same po/.test(lower) && hours) {
      def.consolidation.windowHours = Number(hours);
      summary.push(`PO consolidation window becomes ${hours} hours.`);
      handled = true;
    } else if (/preferred/.test(lower) && days) {
      def.preferredSuppliers.lookbackDays = Number(days);
      def.preferredSuppliers.referencePriceLookbackDays = Number(days);
      summary.push(`Preferred supplier list looks back ${days} days.`);
      handled = true;
    } else if (/(bought|purchase history|purchased)/.test(lower) && days) {
      for (const id of ['R5.3', 'R5.4']) {
        const r = rule(id);
        const list = r && 'all' in r.when ? r.when.all : [];
        const c = list.find((x) => 'fact' in x && x.fact === 'days_since_last_eligible_purchase') as { value?: unknown } | undefined;
        if (c) c.value = Number(days);
      }
      summary.push(`"Bought from an Active supplier" now means within the last ${days} days (5.3, 5.4).`);
      handled = true;
    }
    if (!handled && !/^(amendment|corvo|subject|dear|regards|this amendment|policy)/i.test(s) && /\d|must|shall|will|should|limit|rule/i.test(s)) {
      unrepresentable.push(s);
    }
  }
  if (!version) {
    const [maj, min] = current.version.split('.').map(Number);
    version = `${maj}.${(min || 0) + 1}`;
  }
  const v = validatePolicy(def);
  return {
    version,
    effectiveFrom,
    summary,
    definition: v.definition ?? def,
    unrepresentable,
    assumptions: ['Read by the built-in rule reader. Check every change below, and use the editor for anything listed as not understood.', ...assumptions],
    reader: 'rules',
    validationErrors: v.errors,
    validationWarnings: v.warnings,
  };
}

export async function proposePolicyChange(
  current: { version: string; effectiveFrom: string; definition: PolicyDefinition },
  text: string,
  mode: 'document' | 'chat',
  categories: string[] = [],
): Promise<DraftProposal> {
  if (llmConfig()) {
    try {
      return await proposeWithAi(current, text, mode, categories);
    } catch (e) {
      const fallback = proposeWithRules(current, text, categories);
      fallback.assumptions = [
        `The AI reader was not available (${(e as Error).message.slice(0, 300)}), so the built-in rule reader was used. Check every change below, and use the editor for anything listed as not understood.`,
        ...fallback.assumptions.slice(1),
      ];
      return fallback;
    }
  }
  return proposeWithRules(current, text, categories);
}
