import * as chrono from 'chrono-node';
import { llmConfig, llmJson } from './llm';
import { FACTS } from '@/engine/policy/facts';
import { KNOWN_ROUTES, type PolicyDefinition, type PolicyRule } from '@/engine/policy/schema';
import { validatePolicy } from '@/engine/policy/validate';
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

const SYSTEM = `You convert procurement policy amendments into an updated machine-readable policy for Corvo Engineering's PR-to-PO decision engine.
You receive the CURRENT policy definition (JSON), the FACTS that rule conditions may use, and an AMENDMENT (a document, or a change described in chat by Procurement).

Return ONLY a JSON object:
{
  "version": "new version label, e.g. \\"5.1\\" (use the number in the amendment if it states one, else bump the minor number)",
  "effectiveFrom": "YYYY-MM-DD from the amendment, or null if it does not say",
  "summary": ["one plain-language sentence per change, in the amendment's own terms"],
  "definition": { the COMPLETE updated policy definition, same shape as CURRENT },
  "unrepresentable": ["parts of the amendment that cannot be expressed with this schema and facts; empty if none"],
  "assumptions": ["interpretations you had to make; empty if none"]
}

How the engine uses the definition:
- scope.plants: lines for other plants are NOT_PROCESSED. intake.*: line validation.
- clubbing (2.2): creationWindowDays, needByWindowDays, sameFields. valuation (3.1): priceSources order, lastPoLookbackDays.
- contracts (4.x): requireEligibleSupplier, enforceCeiling, minHeadroomPctAfter (0-100), excludeIfEndsWithinDays, selection.
- eligibility (4.1/5.7/6.x): allowedStatuses, minOnTimePct, minQualityRating, excludedSupplierIds, statusOverrides {"S013":"Blocked"}.
- rules (section 5): evaluated top to bottom for each requirement; the FIRST enabled rule whose "when" holds decides. ORDER MATTERS.
  Condition grammar: {"all":[...]}, {"any":[...]}, {"not":{...}}, {"always":true}, {"fact":"<name>","op":"<op>","value":<v>}.
  ops: eq, neq, lt, lte, gt, gte, in, not_in, contains, is_true, is_false, exists, not_exists. is_true/is_false/exists take no value.
  outcome: {"decision":"PO"|"SOURCING_REQUEST"|"NOT_PROCESSED","route":one of ${KNOWN_ROUTES.join(', ')},"supplier":"contract"|"preferred_1"|"none","suggestCount":n,"approvals":[...]}
  supplier "contract" = supplier of the usable contract at contract rate (only meaningful with contract_usable); "preferred_1" = 1st preferred supplier at its reference price; sourcing uses "none".
- preferredSuppliers (6.x): lookbackDays, includeContractHolders, recencyBands, weights, referencePriceLookbackDays. suggestions (6.4). consolidation (7.1): windowHours, sameFields, maxRequirementsPerPo.

Rules for editing:
- Money is plain INR numbers: Rs 2,00,000 = 200000; 1 lakh = 100000; 10 lakh = 1000000; 1 crore = 10000000.
- "bought from an Active supplier in the last N days" = {"fact":"days_since_last_eligible_purchase","op":"lte","value":N}.
- A plant-, category-, item-type- or department-specific exception is a NEW rule placed BEFORE the general rule it overrides (or an added condition on that rule) so the general rule still applies everywhere else. Make sure the exception cannot be "caught" by an earlier rule unintentionally and that the general rule no longer catches the excepted cases when it should not.
- When a threshold changes, update every condition that uses it consistently (e.g. the RFQ/RFP boundary is "value lt X" in 5.5 and "value gte X" in 5.6).
- Change nothing the amendment does not mention. Keep ids of existing rules. New rules get a new unique id (e.g. "R5.3A") and a clause label from the amendment's numbering if it has one.
- Use only facts from the FACTS list. If something cannot be expressed, put it in "unrepresentable" instead of inventing fields.`;

function factsList(): string {
  return FACTS.map((f) => `- ${f.name} (${f.type}): ${f.label}. ${f.description}`).join('\n');
}

export async function proposeWithAi(current: { version: string; effectiveFrom: string; definition: PolicyDefinition }, amendment: string, mode: 'document' | 'chat'): Promise<DraftProposal> {
  const user = `TODAY: ${todayIST()}
CURRENT POLICY: version ${current.version}, effective ${current.effectiveFrom}
${JSON.stringify(current.definition)}

FACTS:
${factsList()}

AMENDMENT (${mode === 'document' ? 'uploaded document' : 'described in chat by Procurement'}):
"""
${amendment.slice(0, 30000)}
"""`;
  let last: Record<string, unknown> | null = null;
  let errors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0 ? user : `${user}\n\nYour previous answer failed validation:\n${errors.join('\n')}\nReturn the corrected full JSON object.`;
    last = await llmJson<Record<string, unknown>>(SYSTEM, prompt, { timeoutMs: 55000 });
    const v = validatePolicy(last.definition);
    errors = v.errors;
    if (v.ok && v.definition) {
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
  throw new Error(`The AI could not produce a valid policy: ${errors.join('; ')}`);
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

// ---------- deterministic reader (used when no AI is configured, or as a fallback) ----------

const PLANT_WORDS: [RegExp, string][] = [
  [/\b(chk1|chakan)\b/i, 'CHK1'],
  [/\b(pun1|bhosari)\b/i, 'PUN1'],
];

function amount(s: string): number | null {
  const m = s.match(/(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)\s*(lakhs?|lacs?|l\b|crores?|cr\b|k\b|thousand)?/i);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ''));
  const unit = (m[2] ?? '').toLowerCase();
  if (unit.startsWith('l')) n *= 100000;
  else if (unit.startsWith('cr')) n *= 10000000;
  else if (unit === 'k' || unit === 'thousand') n *= 1000;
  return Number.isFinite(n) ? n : null;
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
export function proposeWithRules(current: { version: string; definition: PolicyDefinition }, text: string): DraftProposal {
  const def = JSON.parse(JSON.stringify(current.definition)) as PolicyDefinition;
  const summary: string[] = [];
  const unrepresentable: string[] = [];
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

    if (/spot/.test(lower) && val) {
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
    assumptions: ['Read by the built-in rule reader (no AI configured). Check every change below, and use the editor for anything listed as not understood.'],
    reader: 'rules',
    validationErrors: v.errors,
    validationWarnings: v.warnings,
  };
}

export async function proposePolicyChange(current: { version: string; effectiveFrom: string; definition: PolicyDefinition }, text: string, mode: 'document' | 'chat'): Promise<DraftProposal> {
  if (llmConfig()) {
    try {
      return await proposeWithAi(current, text, mode);
    } catch (e) {
      const fallback = proposeWithRules(current, text);
      fallback.assumptions.unshift(`AI reader failed (${(e as Error).message.slice(0, 200)}); used the built-in rule reader instead.`);
      return fallback;
    }
  }
  return proposeWithRules(current, text);
}
