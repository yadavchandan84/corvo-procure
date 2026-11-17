import type { Condition, Operator } from './schema';
import { FACT_MAP } from './facts';
import { formatINR } from '../format';

export type Facts = Record<string, unknown>;

export interface ConditionTrace {
  text: string;
  result: boolean;
  actual: unknown;
}

function norm(v: unknown): unknown {
  return typeof v === 'string' ? v.trim().toLowerCase() : v;
}

function isNil(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

function compare(actual: unknown, op: Operator, expected: unknown): boolean {
  switch (op) {
    case 'exists':
      return !isNil(actual) && !(Array.isArray(actual) && actual.length === 0);
    case 'not_exists':
      return isNil(actual) || (Array.isArray(actual) && actual.length === 0);
    case 'is_true':
      return actual === true;
    case 'is_false':
      return actual !== true;
  }
  if (Array.isArray(actual)) {
    const list = actual.map(norm);
    switch (op) {
      case 'contains':
      case 'eq':
        return list.includes(norm(expected));
      case 'neq':
        return !list.includes(norm(expected));
      case 'in':
        return Array.isArray(expected) && expected.some((e) => list.includes(norm(e)));
      case 'not_in':
        return !(Array.isArray(expected) && expected.some((e) => list.includes(norm(e))));
      default:
        return false;
    }
  }
  switch (op) {
    case 'eq':
      return norm(actual) === norm(expected);
    case 'neq':
      return norm(actual) !== norm(expected);
    case 'in':
      return Array.isArray(expected) && expected.map(norm).includes(norm(actual));
    case 'not_in':
      return !(Array.isArray(expected) && expected.map(norm).includes(norm(actual)));
    case 'contains':
      return typeof actual === 'string' && typeof expected === 'string' && actual.toLowerCase().includes(expected.toLowerCase());
  }
  // numeric / date comparisons: missing values never satisfy them
  if (isNil(actual) || isNil(expected)) return false;
  let a: number | string = actual as number;
  let b: number | string = expected as number;
  if (typeof actual === 'string' && typeof expected === 'string') {
    a = actual;
    b = expected;
  } else {
    a = Number(actual);
    b = Number(expected);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
  }
  switch (op) {
    case 'lt':
      return a < b;
    case 'lte':
      return a <= b;
    case 'gt':
      return a > b;
    case 'gte':
      return a >= b;
  }
  return false;
}

export function evaluateCondition(cond: Condition, facts: Facts, trace?: ConditionTrace[]): boolean {
  if ('always' in cond) return true;
  if ('all' in cond) {
    let ok = true;
    for (const c of cond.all) {
      const r = evaluateCondition(c, facts, trace);
      if (!r) ok = false;
    }
    return ok;
  }
  if ('any' in cond) {
    let ok = false;
    for (const c of cond.any) {
      const r = evaluateCondition(c, facts, trace);
      if (r) ok = true;
    }
    return ok;
  }
  if ('not' in cond) return !evaluateCondition(cond.not, facts, trace);
  const actual = facts[cond.fact];
  const result = compare(actual, cond.op, cond.value);
  trace?.push({ text: describeCondition(cond), result, actual });
  return result;
}

const OP_TEXT: Record<Operator, string> = {
  eq: 'is',
  neq: 'is not',
  lt: 'is below',
  lte: 'is at or below',
  gt: 'is above',
  gte: 'is at or above',
  in: 'is one of',
  not_in: 'is not one of',
  contains: 'includes',
  is_true: '',
  is_false: '',
  exists: 'is known',
  not_exists: 'is not known',
};

export function describeValue(fact: string, value: unknown): string {
  const def = FACT_MAP[fact];
  if (Array.isArray(value)) return value.map((v) => describeValue(fact, v)).join(', ');
  if (def?.type === 'money' && typeof value === 'number') return formatINR(value);
  if (def?.type === 'days' && typeof value === 'number') return `${value} days`;
  if (typeof value === 'string') return `"${value}"`;
  return String(value);
}

export function describeCondition(cond: Condition): string {
  if ('always' in cond) return 'always';
  if ('all' in cond) {
    if (cond.all.length === 0) return 'always';
    return cond.all.map((c) => wrap(c)).join(' AND ');
  }
  if ('any' in cond) {
    if (cond.any.length === 0) return 'never';
    return cond.any.map((c) => wrap(c)).join(' OR ');
  }
  if ('not' in cond) return `NOT (${describeCondition(cond.not)})`;
  const label = FACT_MAP[cond.fact]?.label ?? cond.fact;
  if (cond.op === 'is_true') return label;
  if (cond.op === 'is_false') return `not: ${label}`;
  if (cond.op === 'exists' || cond.op === 'not_exists') return `${label} ${OP_TEXT[cond.op]}`;
  return `${label} ${OP_TEXT[cond.op]} ${describeValue(cond.fact, cond.value)}`;
}

function wrap(c: Condition): string {
  const s = describeCondition(c);
  return 'all' in c || 'any' in c ? `(${s})` : s;
}

/** Collect fact names referenced by a condition (for validation). */
export function referencedFacts(cond: Condition, out: Set<string> = new Set()): Set<string> {
  if ('all' in cond) cond.all.forEach((c) => referencedFacts(c, out));
  else if ('any' in cond) cond.any.forEach((c) => referencedFacts(c, out));
  else if ('not' in cond) referencedFacts(cond.not, out);
  else if ('fact' in cond) out.add(cond.fact);
  return out;
}
