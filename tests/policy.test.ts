import { describe, expect, it } from 'vitest';
import { POLICY_V5 } from '@/engine/policy/default-v5';
import { parsePolicyDefinition } from '@/engine/policy/schema';
import { validatePolicy } from '@/engine/policy/validate';
import { diffPolicies } from '@/engine/policy/diff';
import { evaluateCondition } from '@/engine/policy/conditions';
import { resolvePolicyVersion } from '@/engine/engine';
import { extractContractFromText } from '@/engine/contract-text';

const base = parsePolicyDefinition(POLICY_V5);

describe('policy schema and validation', () => {
  it('v5.0 validates', () => {
    const v = validatePolicy(POLICY_V5);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it('rejects unknown facts and PO rules without a supplier', () => {
    const bad = JSON.parse(JSON.stringify(POLICY_V5));
    bad.rules[0].when = { fact: 'colour', op: 'eq', value: 'red' };
    bad.rules[1].outcome = { decision: 'PO', route: 'SPOT_PO', supplier: 'none' };
    const v = validatePolicy(bad);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/unknown fact "colour"/);
    expect(v.errors.join(' ')).toMatch(/does not say which supplier/);
  });
});

describe('policy diff', () => {
  it('describes parameter, rule and order changes in plain language', () => {
    const next = JSON.parse(JSON.stringify(base));
    next.clubbing.creationWindowDays = 21;
    next.rules.find((r: { id: string }) => r.id === 'R5.4').when.all[0].value = 300000;
    next.rules.splice(2, 0, {
      id: 'R-CHK1',
      clause: '5.1A',
      title: 'Chakan safety items',
      enabled: true,
      when: { all: [{ fact: 'plant', op: 'eq', value: 'CHK1' }, { fact: 'category', op: 'eq', value: 'Safety & PPE' }] },
      outcome: { decision: 'SOURCING_REQUEST', route: 'RFQ', supplier: 'none', suggestCount: 3, approvals: [] },
    });
    const changes = diffPolicies(base, parsePolicyDefinition(next));
    const text = changes.map((c) => c.text).join('\n');
    expect(text).toContain('14 days → 21 days');
    expect(text).toContain('₹2,00,000');
    expect(text).toContain('₹3,00,000');
    expect(text).toMatch(/New rule 5.1A "Chakan safety items"/);
    expect(text).toContain('plant is "CHK1"');
  });
});

describe('conditions', () => {
  it('evaluates nested logic and missing values safely', () => {
    const c = { all: [{ fact: 'value', op: 'lt' as const, value: 100 }, { any: [{ fact: 'plant', op: 'eq' as const, value: 'chk1' }, { fact: 'x', op: 'exists' as const }] }] };
    expect(evaluateCondition(c, { value: 50, plant: 'CHK1' })).toBe(true);
    expect(evaluateCondition(c, { value: 50, plant: 'PUN1' })).toBe(false);
    expect(evaluateCondition({ fact: 'days', op: 'lte', value: 365 }, { days: null })).toBe(false);
  });
});

describe('version resolution', () => {
  it('picks the latest version effective on the date', () => {
    const vs = [
      { id: 'a', version: '5.0', effectiveFrom: '2026-04-01', approvedAt: '1', definition: base },
      { id: 'b', version: '5.1', effectiveFrom: '2026-11-19', approvedAt: '2', definition: base },
    ];
    expect(resolvePolicyVersion(vs, '2026-11-18').version.id).toBe('a');
    expect(resolvePolicyVersion(vs, '2026-11-19').version.id).toBe('b');
    expect(resolvePolicyVersion(vs, '2026-01-01').warning).toBeTruthy();
  });
});

describe('contract PDF extraction', () => {
  it('reads the contract layout', () => {
    const text = `RATE CONTRACT\nContract No. RC-2026-099\nThis Rate Contract is entered into on 2026-11-15 between Corvo Engineering Pvt Ltd, having its registered\noffice at Plot 14 ("the Buyer"), and Acme Tools, Pune (Supplier ID S099)\n("the Supplier").\n1. Term. This contract is valid from 2026-11-15 to 2027-11-14 (both days inclusive).\n2. Value ceiling. The total value of purchase orders placed under this contract shall not exceed INR 20,00,000\n(excluding GST).\n3. Rates. The Supplier shall supply the items in Schedule A at the fixed rates below.\nSchedule A: Items and rates\n# Item code Description UoM Rate (INR)\n1 ITM-1036 Pneumatic cylinder 50x100 NOS 3,537.76\n2 ITM-1037 Solenoid valve 5/2 1/4 inch NOS 2,439.01\nFor Corvo Engineering Pvt Ltd`;
    const r = extractContractFromText(text);
    expect(r.missing).toEqual([]);
    expect(r.contract).toMatchObject({ id: 'RC-2026-099', supplierId: 'S099', startDate: '2026-11-15', endDate: '2027-11-14', valueCap: 2000000 });
    expect(r.contract.lines).toEqual([
      { itemCode: 'ITM-1036', description: 'Pneumatic cylinder 50x100', uom: 'NOS', rate: 3537.76 },
      { itemCode: 'ITM-1037', description: 'Solenoid valve 5/2 1/4 inch', uom: 'NOS', rate: 2439.01 },
    ]);
  });
});
