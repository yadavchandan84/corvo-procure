import { describe, expect, it } from 'vitest';
import { runEngine } from '@/engine/engine';
import { data, line, version, v5Synthetic } from './fixtures';

const byKey = (res: ReturnType<typeof runEngine>, prNo: string, prLine = '1') => res.rows.find((r) => r.pr_no === prNo && r.pr_line === prLine)!;

describe('clubbing (2.2)', () => {
  it('clubs same item + plant within 14 days and need-by within 7 days, and values the total', () => {
    const res = runEngine(data, [
      line({ prNo: 'A', itemCode: 'ITM-0001', quantity: '100', createdAt: '2026-11-02 09:00', needByDate: '2026-11-20' }),
      line({ prNo: 'B', itemCode: 'ITM-0001', quantity: '100', createdAt: '2026-11-10 09:00', needByDate: '2026-11-26' }),
      line({ prNo: 'C', itemCode: 'ITM-0001', quantity: '100', createdAt: '2026-11-10 09:00', needByDate: '2026-11-28' }), // 8 days off
      line({ prNo: 'D', itemCode: 'ITM-0001', quantity: '100', plant: 'P2', createdAt: '2026-11-03 09:00', needByDate: '2026-11-20' }),
      line({ prNo: 'E', itemCode: 'ITM-0001', quantity: '100', createdAt: '2026-11-17 09:00', needByDate: '2026-11-20' }), // 15 days after A
    ], [v5Synthetic()]);
    expect(byKey(res, 'A').group_id).toBe(byKey(res, 'B').group_id);
    expect(byKey(res, 'C').group_id).not.toBe(byKey(res, 'A').group_id);
    expect(byKey(res, 'D').group_id).not.toBe(byKey(res, 'A').group_id);
    expect(byKey(res, 'E').group_id).not.toBe(byKey(res, 'A').group_id);
    // last PO price 9.5 (PO 2 on 2026-10-01) x 200
    expect(byKey(res, 'A').group_value_inr).toBe('1900');
  });

  it('never clubs new items and values them at the requester estimate', () => {
    const res = runEngine(data, [
      line({ prNo: 'N1', description: 'Quantum flux capacitor', quantity: '2', estimatedUnitPrice: '500' }),
      line({ prNo: 'N2', description: 'Quantum flux capacitor', quantity: '2', estimatedUnitPrice: '500' }),
    ], [v5Synthetic()]);
    expect(byKey(res, 'N1').route).toBe('NEW_ITEM_SOURCING');
    expect(byKey(res, 'N1').resolved_item_code).toBe('NEW');
    expect(byKey(res, 'N1').group_id).not.toBe(byKey(res, 'N2').group_id);
    expect(byKey(res, 'N1').group_value_inr).toBe('1000');
    expect(byKey(res, 'N1').suggested_supplier_ids).toBe('');
  });
});

describe('contracts (4.1 to 4.3) and rules (5.x)', () => {
  it('skips blocked-supplier contracts and contracts without ceiling, taking the lowest-rate usable one', () => {
    const res = runEngine(data, [line({ prNo: 'K', itemCode: 'ITM-0002', quantity: '100' })], [v5Synthetic()]);
    const r = byKey(res, 'K');
    // RC-3 (rate 5) supplier blocked; RC-1 (18) has 1000 left < 1800; RC-2 (19) usable
    expect(r.route).toBe('CONTRACT_PO');
    expect(r.supplier_id).toBe('S2');
    expect(r.unit_price).toBe('19');
    expect(r.group_value_inr).toBe('1900');
  });

  it('consumes ceiling in requirement-date order', () => {
    const res = runEngine(data, [
      line({ prNo: 'K1', itemCode: 'ITM-0002', quantity: '50', createdAt: '2026-11-02 09:00' }), // 900 at RC-1 fits (1000 left)
      line({ prNo: 'K2', itemCode: 'ITM-0002', quantity: '50', plant: 'P2', createdAt: '2026-11-02 10:00' }), // RC-1 now has 100 left
    ], [v5Synthetic()]);
    expect(byKey(res, 'K1').supplier_id).toBe('S1');
    expect(byKey(res, 'K2').supplier_id).toBe('S2');
  });

  it('routes Capex before contracts and suggests 5 (topped up from category)', () => {
    const res = runEngine(data, [line({ prNo: 'C', itemCode: 'ITM-0004', quantity: '1' })], [v5Synthetic()]);
    const r = byKey(res, 'C');
    expect(r.route).toBe('CAPEX_SOURCING');
    expect(r.decision).toBe('SOURCING_REQUEST');
    expect(r.suggested_supplier_ids).toBe('S6;S5'); // only two eligible Machines suppliers
  });

  it('does not treat history with an Inactive supplier as "bought from an Active supplier"', () => {
    const res = runEngine(data, [line({ prNo: 'F', itemCode: 'ITM-0003', quantity: '10' })], [v5Synthetic()]);
    const r = byKey(res, 'F');
    // only recent PO is from S7 (Inactive); S4's PO is older than 365 days -> RFQ, never S7
    expect(r.route).toBe('RFQ');
    expect(r.suggested_supplier_ids.split(';')).not.toContain('S7');
    expect(r.suggested_supplier_ids.split(';')[0]).toBe('S4');
  });

  it('emergency PO allows up to the emergency limit', () => {
    const res = runEngine(data, [line({ prNo: 'E', itemCode: 'ITM-0001', quantity: '30000', urgency: 'Emergency' })], [v5Synthetic()]);
    expect(byKey(res, 'E').route).toBe('EMERGENCY_PO'); // 30000 x 9.5 = 2,85,000
  });
});

describe('consolidation (7)', () => {
  it('puts requirements with the same supplier, plant and route within 24h on one PO', () => {
    const res = runEngine(data, [
      line({ prNo: 'A', itemCode: 'ITM-0002', quantity: '10', createdAt: '2026-11-02 09:00' }),
      line({ prNo: 'B', itemCode: 'ITM-0001', quantity: '10', createdAt: '2026-11-02 12:00' }),
    ], [version('v', '5.0', '2026-04-01', (d) => {
      d.scope = { plants: ['P1', 'P2'] };
    })]);
    // A -> contract PO to S1 (RC-1); B -> spot PO to the 1st preferred supplier: different route -> different PO
    expect(byKey(res, 'A').po_id).not.toBe(byKey(res, 'B').po_id);
    const res2 = runEngine(data, [
      line({ prNo: 'A', itemCode: 'ITM-0001', quantity: '10', createdAt: '2026-11-02 09:00', needByDate: '2026-11-10' }),
      line({ prNo: 'B', itemCode: 'ITM-0001', quantity: '10', createdAt: '2026-11-03 08:59', needByDate: '2026-11-30' }),
      line({ prNo: 'C', itemCode: 'ITM-0001', quantity: '10', createdAt: '2026-11-03 09:01', needByDate: '2026-12-30' }),
    ], [v5Synthetic()]);
    expect(byKey(res2, 'A').group_id).not.toBe(byKey(res2, 'B').group_id);
    expect(byKey(res2, 'A').po_id).toBe(byKey(res2, 'B').po_id);
    expect(byKey(res2, 'C').po_id).not.toBe(byKey(res2, 'A').po_id);
  });
});

describe('intake validation', () => {
  it('does not process zero quantity, unknown plants, unit mismatches or ambiguous items', () => {
    const res = runEngine(data, [
      line({ prNo: 'Z', itemCode: 'ITM-0001', quantity: '0' }),
      line({ prNo: 'P', itemCode: 'ITM-0001', plant: 'P9', quantity: '5' }),
      line({ prNo: 'U', itemCode: 'ITM-0001', uom: 'KG', quantity: '5' }),
      line({ prNo: 'AM', description: 'widget bolt', quantity: '5' }),
      line({ prNo: 'OK', itemCode: 'ITM-0001', uom: 'PCS', quantity: '5' }),
    ], [v5Synthetic()]);
    for (const k of ['Z', 'P', 'U', 'AM']) {
      expect(byKey(res, k).route).toBe('NOT_PROCESSED');
      expect(byKey(res, k).reason).toMatch(/Not processed/);
    }
    expect(byKey(res, 'OK').route).not.toBe('NOT_PROCESSED');
  });
});

describe('policy as data', () => {
  it('applies each version from its effective date (requirement date decides)', () => {
    const v51 = version('v51', '5.1', '2026-11-10', (d) => {
      d.scope = { plants: ['P1', 'P2'] };
      const spot = d.rules!.find((r) => r.id === 'R5.4')!;
      (spot.when as { all: { fact: string; op: string; value?: unknown }[] }).all[0].value = 1000; // spot limit 1,000
    });
    const res = runEngine(data, [
      line({ prNo: 'BEFORE', itemCode: 'ITM-0001', quantity: '200', createdAt: '2026-11-09 23:59' }),
      line({ prNo: 'AFTER', itemCode: 'ITM-0001', quantity: '200', plant: 'P2', createdAt: '2026-11-10 00:01' }),
    ], [v5Synthetic(), v51]);
    expect(byKey(res, 'BEFORE').route).toBe('SPOT_PO');
    expect(byKey(res, 'BEFORE').policy_version).toBe('5.0');
    expect(byKey(res, 'AFTER').route).toBe('RFQ');
    expect(byKey(res, 'AFTER').policy_version).toBe('5.1');
  });

  it('supports a new plant-specific rule without code changes', () => {
    const v52 = version('v52', '5.2', '2026-04-01', (d) => {
      d.scope = { plants: ['P1', 'P2'] };
      d.rules!.splice(2, 0, {
        id: 'R-P2-FAST',
        clause: '5.1A',
        title: 'Plant P2 fasteners need quotes',
        when: { all: [{ fact: 'plant', op: 'eq', value: 'P2' }, { fact: 'category', op: 'eq', value: 'Fasteners' }] },
        outcome: { decision: 'SOURCING_REQUEST', route: 'RFQ', supplier: 'none', suggestCount: 3, approvals: [] },
      });
    });
    const res = runEngine(data, [
      line({ prNo: 'P1', itemCode: 'ITM-0001', quantity: '10', plant: 'P1' }),
      line({ prNo: 'P2', itemCode: 'ITM-0001', quantity: '10', plant: 'P2' }),
    ], [v52]);
    expect(byKey(res, 'P1').route).toBe('SPOT_PO');
    expect(byKey(res, 'P2').route).toBe('RFQ');
    expect(byKey(res, 'P2').reason).toContain('5.1A');
  });

  it('changes windows and limits through parameters', () => {
    const wide = version('w', '5.3', '2026-04-01', (d) => {
      d.scope = { plants: ['P1', 'P2'] };
      d.clubbing!.needByWindowDays = 30;
    });
    const inputs = [
      line({ prNo: 'A', itemCode: 'ITM-0001', quantity: '1', needByDate: '2026-11-10' }),
      line({ prNo: 'B', itemCode: 'ITM-0001', quantity: '1', needByDate: '2026-12-01' }),
    ];
    const narrow = runEngine(data, inputs, [v5Synthetic()]);
    const widened = runEngine(data, inputs, [wide]);
    expect(byKey(narrow, 'A').group_id).not.toBe(byKey(narrow, 'B').group_id);
    expect(byKey(widened, 'A').group_id).toBe(byKey(widened, 'B').group_id);
  });
});
