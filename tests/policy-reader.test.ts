import { describe, expect, it } from 'vitest';
import { amount, proposeWithRules } from '@/server/policy-ai';
import { POLICY_V5 } from '@/engine/policy/default-v5';
import { parsePolicyDefinition } from '@/engine/policy/schema';

const current = { version: '5.0', definition: parsePolicyDefinition(POLICY_V5) };
const valueLimit = (def: ReturnType<typeof parsePolicyDefinition>, id: string) => {
  const r = def.rules.find((x) => x.id === id)!;
  const list = 'all' in r.when ? r.when.all : [r.when];
  return (list.find((c) => 'fact' in c && c.fact === 'value') as { value: number }).value;
};

describe('built-in amendment reader', () => {
  it('reads money amounts, not clause numbers', () => {
    expect(amount('Rule 5.4 (Spot PO): the value limit is raised from Rs 2,00,000 to Rs 2,50,000.')).toBe(250000);
    expect(amount('The spot PO limit becomes ₹3 lakh')).toBe(300000);
    expect(amount('Rule 5.4 applies')).toBeNull();
    expect(amount('limit of INR 150000')).toBe(150000);
  });

  it('applies a limit change, a window change and the effective date', () => {
    const p = proposeWithRules(
      current,
      'Amendment 1, Version 5.1 - Effective 25 November 2026\nA1. Rule 5.4 (Spot PO): the value limit is raised from Rs 2,00,000 to Rs 2,50,000.\nA3. Clause 2.2: lines created within 21 calendar days may be clubbed (was 14 days).',
    );
    expect(p.version).toBe('5.1');
    expect(p.effectiveFrom).toBe('2026-11-25');
    expect(valueLimit(p.definition, 'R5.4')).toBe(250000);
    expect(p.definition.clubbing.creationWindowDays).toBe(21);
    expect(p.validationErrors).toEqual([]);
  });

  it('adds a plant-only spot limit before the general rule', () => {
    const p = proposeWithRules(current, 'The spot PO limit at Chakan is Rs 1,00,000.');
    const ids = p.definition.rules.map((r) => r.id);
    expect(ids.indexOf('R5.4-CHK1')).toBeLessThan(ids.indexOf('R5.4'));
    expect(valueLimit(p.definition, 'R5.4-CHK1')).toBe(100000);
    expect(valueLimit(p.definition, 'R5.4')).toBe(200000);
  });
});
