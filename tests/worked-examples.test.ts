/**
 * Checks the engine against the 14 worked decisions and 3 preferred-supplier lists in
 * Worked_Examples.pdf. Needs a local copy of the kit in ./kit (never committed), so it is
 * skipped when the kit is absent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadKit } from '@/server/kit-loader';
import { runEngine } from '@/engine/engine';
import { parsePrBatch } from '@/engine/csv';
import { buildContext } from '@/engine/context';
import { preferredList } from '@/engine/preferred';
import { parsePolicyDefinition } from '@/engine/policy/schema';
import { POLICY_V5 } from '@/engine/policy/default-v5';
import type { EngineResult, MasterData } from '@/engine/types';

const KIT = path.resolve(__dirname, '..', 'kit');
const hasKit = fs.existsSync(path.join(KIT, 'pr_batches', 'sample_pr_batch.csv'));
const d = hasKit ? describe : describe.skip;

d('worked examples (kit)', () => {
  let res: EngineResult;
  let data: MasterData;
  beforeAll(async () => {
    data = (await loadKit(KIT)).data;
    const { lines } = parsePrBatch(fs.readFileSync(path.join(KIT, 'pr_batches', 'sample_pr_batch.csv'), 'utf8'));
    res = runEngine(data, lines, [{ id: 'v5', version: '5.0', effectiveFrom: '2026-04-01', approvedAt: 'x', definition: parsePolicyDefinition(POLICY_V5) }]);
  });
  const row = (pr: string) => res.rows.find((r) => r.pr_no === `PR-26-${pr}` && r.pr_line === '1')!;
  const value = (pr: string) => Math.round(Number(row(pr).group_value_inr));

  it('1. contract PO', () => {
    expect(row('00019')).toMatchObject({ route: 'CONTRACT_PO', supplier_id: 'S001', unit_price: '9168.71' });
    expect(value('00019')).toBe(137531);
  });
  it('2. contract that exists only as a PDF', () => {
    expect(row('00045')).toMatchObject({ route: 'CONTRACT_PO', supplier_id: 'S021', unit_price: '2439.01' });
    expect(value('00045')).toBe(26829);
  });
  it('3. contract ceiling nearly used up', () => {
    expect(row('00004').group_id).toBe(row('00026').group_id);
    expect(row('00004')).toMatchObject({ route: 'RFQ', suggested_supplier_ids: 'S014;S013;S016' });
    expect(value('00004')).toBe(220256);
  });
  it('4. two contracts for the same item', () => {
    expect(row('00034').group_id).toBe(row('00032').group_id);
    expect(row('00034')).toMatchObject({ route: 'CONTRACT_PO', supplier_id: 'S007', unit_price: '7.06' });
    expect(value('00034')).toBe(32547);
  });
  it('5. split PRs clubbed into one requirement', () => {
    expect(new Set(['00146', '00144', '00145'].map((p) => row(p).group_id)).size).toBe(1);
    expect(row('00146')).toMatchObject({ route: 'SPOT_PO', supplier_id: 'S024' });
    expect(value('00146')).toBe(126472);
  });
  it('6. same item, different plants: not clubbed', () => {
    expect(row('00106').group_id).not.toBe(row('00103').group_id);
    expect(row('00106')).toMatchObject({ route: 'SPOT_PO', supplier_id: 'S027' });
    expect(row('00103').resolved_item_code).toBe('ITM-1044');
    expect(value('00106')).toBe(156170);
  });
  it('7. free-text item matched', () => {
    expect(row('00088')).toMatchObject({ resolved_item_code: 'ITM-1035', route: 'SPOT_PO', supplier_id: 'S023' });
    expect(value('00088')).toBe(97955);
  });
  it('8. emergency PO', () => {
    expect(row('00059')).toMatchObject({ route: 'EMERGENCY_PO', supplier_id: 'S014' });
    expect(value('00059')).toBe(253184);
  });
  it('9. RFQ above the PO limit', () => {
    expect(row('00089')).toMatchObject({ resolved_item_code: 'ITM-1066', route: 'RFQ', suggested_supplier_ids: 'S043;S044;S042' });
    expect(value('00089')).toBe(336562);
  });
  it('10. RFQ, small but never bought', () => {
    expect(row('00050')).toMatchObject({ route: 'RFQ', suggested_supplier_ids: 'S003;S002;S005' });
    expect(value('00050')).toBe(80300);
  });
  it('11. RFP', () => {
    expect(row('00100')).toMatchObject({ route: 'RFP', suggested_supplier_ids: 'S020;S017;S019;S018' });
    expect(value('00100')).toBe(2070780);
  });
  it('12. Capex', () => {
    expect(row('00047')).toMatchObject({ resolved_item_code: 'ITM-1071', route: 'CAPEX_SOURCING', suggested_supplier_ids: 'S045;S047;S020;S048;S046' });
    expect(value('00047')).toBe(6036704);
  });
  it('13. new item', () => {
    expect(row('00170')).toMatchObject({ resolved_item_code: 'NEW', route: 'NEW_ITEM_SOURCING', suggested_supplier_ids: '' });
    expect(value('00170')).toBe(141100);
  });
  it('14. several requirements on one PO', () => {
    expect(row('00031').group_id).toBe(row('00035').group_id);
    expect(row('00031').group_id).not.toBe(row('00034').group_id);
    expect(row('00031').po_id).toBe(row('00034').po_id);
    expect(value('00031')).toBe(23227);
  });

  it('preferred supplier lists as of 1 Nov 2026', () => {
    const ctx = buildContext(data);
    const def = parsePolicyDefinition(POLICY_V5);
    const ids = (item: string) => preferredList(ctx, def, item, '2026-11-01').map((e) => e.supplierId);
    expect(ids('ITM-1048')).toEqual(['S029', 'S030']);
    expect(ids('ITM-1036')).toEqual(['S023', 'S022', 'S024']);
    expect(ids('ITM-1016')).toEqual(['S009', 'S010']);
  });

  it('never gives a PO to, or suggests, a blocked or inactive supplier', () => {
    const bad = new Set(data.suppliers.filter((s) => s.status !== 'Active').map((s) => s.id));
    for (const r of res.rows) {
      expect(bad.has(r.supplier_id)).toBe(false);
      for (const s of r.suggested_supplier_ids.split(';').filter(Boolean)) expect(bad.has(s)).toBe(false);
    }
  });
});
