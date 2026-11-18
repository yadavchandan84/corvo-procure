import { describe, expect, it } from 'vitest';
import { applyEdits } from '@/engine/policy/edits';
import { POLICY_V5 } from '@/engine/policy/default-v5';
import { parsePolicyDefinition } from '@/engine/policy/schema';
import { validatePolicy } from '@/engine/policy/validate';

const base = parsePolicyDefinition(POLICY_V5);

describe('policy edits (AI answer format)', () => {
  it('applies parameter, limit, new-rule and move edits without touching the original', () => {
    const { definition, problems } = applyEdits(base, [
      { op: 'set', path: 'clubbing.creationWindowDays', value: 21 },
      { op: 'set_condition_value', ruleId: 'R5.5', fact: 'value', value: 1500000 },
      { op: 'set_condition_value', ruleId: 'R5.6', fact: 'value', value: 1500000 },
      {
        op: 'add_rule',
        after: 'R5.2',
        rule: {
          id: 'R5.2A',
          clause: '5.2A',
          title: 'Chakan safety items need quotes',
          enabled: true,
          when: { all: [{ fact: 'plant', op: 'eq', value: 'CHK1' }, { fact: 'category', op: 'eq', value: 'Safety & PPE' }] },
          outcome: { decision: 'SOURCING_REQUEST', route: 'RFQ', supplier: 'none', suggestCount: 3, approvals: [] },
        },
      },
      { op: 'move_rule', ruleId: 'R5.3', after: 'R5.4' },
    ]);
    expect(problems).toEqual([]);
    expect(validatePolicy(definition).ok).toBe(true);
    expect(definition.clubbing.creationWindowDays).toBe(21);
    expect(definition.rules.map((r) => r.id)).toEqual(['R1.2', 'R5.1', 'R5.2', 'R5.2A', 'R5.4', 'R5.3', 'R5.5', 'R5.6']);
    expect(base.clubbing.creationWindowDays).toBe(14);
    expect(base.rules).toHaveLength(7);
  });

  it('reports bad edits instead of applying them', () => {
    const { problems } = applyEdits(base, [
      { op: 'set', path: 'clubbing.nonsense', value: 1 },
      { op: 'set', path: '__proto__.x', value: 1 },
      { op: 'set_condition_value', ruleId: 'R9.9', fact: 'value', value: 1 },
      { op: 'remove_rule', ruleId: 'nope' },
    ]);
    expect(problems).toHaveLength(4);
  });
});
