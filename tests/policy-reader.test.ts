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

  it('reads a new plant + category rule and its placement', () => {
    const text = `Corvo Engineering Pvt Ltd - Amendment 1 to Procurement Policy CORVO-PROC-POL-04
Version 5.1 - Effective 25 November 2026

A1. Rule 5.4 (Spot PO): the value limit is raised from Rs 2,00,000 to Rs 2,50,000.
A2. New rule for plant CHK1 (Chakan) only: Safety & PPE items worth Rs 50,000 or more always go to RFQ with 3 suggested suppliers, unless a rate contract can be used. Apply it after the contract rule 5.2 and before rule 5.3.
A3. Clause 2.2: lines created within 21 calendar days of the requirement's first line may be clubbed (was 14 days).
All other clauses are unchanged.`;
    const p = proposeWithRules(current, text, ['Safety & PPE', 'Fasteners', 'Packaging']);
    expect(p.unrepresentable).toEqual([]);
    expect(p.validationErrors).toEqual([]);
    const ids = p.definition.rules.map((r) => r.id);
    const added = p.definition.rules.find((r) => r.id === 'R-A1')!;
    expect(ids.indexOf('R-A1')).toBe(ids.indexOf('R5.2') + 1);
    expect(added.outcome).toMatchObject({ decision: 'SOURCING_REQUEST', route: 'RFQ', suggestCount: 3 });
    expect(JSON.stringify(added.when)).toContain('"CHK1"');
    expect(JSON.stringify(added.when)).toContain('"Safety & PPE"');
    expect(JSON.stringify(added.when)).toContain('{"fact":"value","op":"gte","value":50000}');
    expect(valueLimit(p.definition, 'R5.4')).toBe(250000);
    expect(p.definition.clubbing.creationWindowDays).toBe(21);
  });

  it('adds a plant-only spot limit before the general rule', () => {
    const p = proposeWithRules(current, 'The spot PO limit at Chakan is Rs 1,00,000.');
    const ids = p.definition.rules.map((r) => r.id);
    expect(ids.indexOf('R5.4-CHK1')).toBeLessThan(ids.indexOf('R5.4'));
    expect(valueLimit(p.definition, 'R5.4-CHK1')).toBe(100000);
    expect(valueLimit(p.definition, 'R5.4')).toBe(200000);
  });
});
