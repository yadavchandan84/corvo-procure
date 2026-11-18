import type { Condition, PolicyDefinition, PolicyRule } from './schema';

/**
 * A small, explicit list of changes to a policy. The AI (or the built-in reader) proposes edits
 * instead of rewriting the whole policy: the answer is short, and every change is visible.
 */
export type PolicyEdit =
  /** Change a parameter, e.g. { path: "clubbing.creationWindowDays", value: 21 }. */
  | { op: 'set'; path: string; value: unknown }
  /** Change the value of every condition on `fact` inside one rule, e.g. a value limit. */
  | { op: 'set_condition_value'; ruleId: string; fact: string; value: unknown; whereOp?: string }
  /** Add a rule; placed before or after an existing rule (default: before the last rule). */
  | { op: 'add_rule'; rule: PolicyRule; before?: string; after?: string }
  /** Change fields of a rule (title, clause, when, outcome, enabled). */
  | { op: 'update_rule'; ruleId: string; changes: Partial<PolicyRule> }
  | { op: 'remove_rule'; ruleId: string }
  | { op: 'move_rule'; ruleId: string; before?: string; after?: string };

const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.');
  if (!parts.length || parts.some((p) => !p || FORBIDDEN.has(p)) || parts[0] === 'rules') throw new Error(`Cannot set "${path}".`);
  let cur: Record<string, unknown> = obj;
  for (const p of parts.slice(0, -1)) {
    if (typeof cur[p] !== 'object' || cur[p] === null) throw new Error(`Unknown policy setting "${path}".`);
    cur = cur[p] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  if (!(last in cur)) throw new Error(`Unknown policy setting "${path}".`);
  cur[last] = value;
}

function setConditionValue(cond: Condition, fact: string, value: unknown, whereOp?: string): number {
  if ('all' in cond) return cond.all.reduce((n, c) => n + setConditionValue(c, fact, value, whereOp), 0);
  if ('any' in cond) return cond.any.reduce((n, c) => n + setConditionValue(c, fact, value, whereOp), 0);
  if ('not' in cond) return setConditionValue(cond.not, fact, value, whereOp);
  if ('fact' in cond && cond.fact === fact && (!whereOp || cond.op === whereOp)) {
    cond.value = value;
    return 1;
  }
  return 0;
}

function place(rules: PolicyRule[], rule: PolicyRule, before?: string, after?: string) {
  let at = rules.length > 0 ? rules.length - 1 : 0;
  if (before) {
    const i = rules.findIndex((r) => r.id === before);
    if (i < 0) throw new Error(`Rule ${before} not found.`);
    at = i;
  } else if (after) {
    const i = rules.findIndex((r) => r.id === after);
    if (i < 0) throw new Error(`Rule ${after} not found.`);
    at = i + 1;
  }
  rules.splice(at, 0, rule);
}

/** Apply edits to a copy of the definition. Returns the result and a note per edit that failed. */
export function applyEdits(def: PolicyDefinition, edits: PolicyEdit[]): { definition: PolicyDefinition; problems: string[] } {
  const out = JSON.parse(JSON.stringify(def)) as PolicyDefinition;
  const problems: string[] = [];
  for (const e of edits) {
    try {
      switch (e.op) {
        case 'set':
          setPath(out as unknown as Record<string, unknown>, e.path, e.value);
          break;
        case 'set_condition_value': {
          const r = out.rules.find((x) => x.id === e.ruleId);
          if (!r) throw new Error(`Rule ${e.ruleId} not found.`);
          if (!setConditionValue(r.when, e.fact, e.value, e.whereOp)) throw new Error(`Rule ${e.ruleId} has no condition on ${e.fact}.`);
          break;
        }
        case 'add_rule': {
          if (out.rules.some((x) => x.id === e.rule.id)) throw new Error(`Rule id ${e.rule.id} already exists.`);
          place(out.rules, { ...e.rule, enabled: e.rule.enabled ?? true }, e.before, e.after);
          break;
        }
        case 'update_rule': {
          const r = out.rules.find((x) => x.id === e.ruleId);
          if (!r) throw new Error(`Rule ${e.ruleId} not found.`);
          const { id: _ignored, ...changes } = e.changes ?? {};
          void _ignored;
          Object.assign(r, changes, changes.outcome ? { outcome: { ...r.outcome, ...changes.outcome } } : {});
          break;
        }
        case 'remove_rule': {
          const i = out.rules.findIndex((x) => x.id === e.ruleId);
          if (i < 0) throw new Error(`Rule ${e.ruleId} not found.`);
          out.rules.splice(i, 1);
          break;
        }
        case 'move_rule': {
          const i = out.rules.findIndex((x) => x.id === e.ruleId);
          if (i < 0) throw new Error(`Rule ${e.ruleId} not found.`);
          const [r] = out.rules.splice(i, 1);
          place(out.rules, r, e.before, e.after);
          break;
        }
        default:
          throw new Error(`Unknown edit "${(e as { op?: string }).op}".`);
      }
    } catch (err) {
      problems.push(`${JSON.stringify(e).slice(0, 160)}: ${(err as Error).message}`);
    }
  }
  return { definition: out, problems };
}
