import type { Contract, Item, MasterData, PoRecord, Supplier } from './types';
import type { PolicyDefinition } from './policy/schema';
import { buildItemIndex, type ItemIndex } from './matching';
import { dayNum } from './dates';

/** Pre-indexed master data, shared by every policy version in a run. */
export interface DataContext {
  data: MasterData;
  items: Map<string, Item>;
  suppliers: Map<string, Supplier>;
  poByItem: Map<string, PoRecord[]>; // sorted by date desc, then po number desc
  contractsByItem: Map<string, { contract: Contract; rate: number }[]>;
  itemIndex: ItemIndex;
  plants: Set<string>;
}

export function buildContext(data: MasterData): DataContext {
  const poByItem = new Map<string, PoRecord[]>();
  for (const po of data.poHistory) {
    const list = poByItem.get(po.itemCode) ?? [];
    list.push(po);
    poByItem.set(po.itemCode, list);
  }
  for (const list of poByItem.values()) {
    list.sort((a, b) => b.poDate.localeCompare(a.poDate) || b.poNumber.localeCompare(a.poNumber));
  }
  const contractsByItem = new Map<string, { contract: Contract; rate: number }[]>();
  for (const c of data.contracts) {
    for (const l of c.lines) {
      const list = contractsByItem.get(l.itemCode) ?? [];
      list.push({ contract: c, rate: l.rate });
      contractsByItem.set(l.itemCode, list);
    }
  }
  return {
    data,
    items: new Map(data.items.map((i) => [i.code, i])),
    suppliers: new Map(data.suppliers.map((s) => [s.id, s])),
    poByItem,
    contractsByItem,
    itemIndex: buildItemIndex(data.items),
    plants: new Set(data.plants.map((p) => p.code)),
  };
}

/** Supplier status after policy-level overrides. */
export function supplierStatus(ctx: DataContext, policy: PolicyDefinition, supplierId: string): string {
  const override = policy.eligibility.statusOverrides?.[supplierId];
  if (override) return override;
  return ctx.suppliers.get(supplierId)?.status ?? 'Unknown';
}

/** 4.1 / 5.7 / 6.1: may this supplier receive a PO or be suggested under this policy? */
export function isEligible(ctx: DataContext, policy: PolicyDefinition, supplierId: string): boolean {
  const s = ctx.suppliers.get(supplierId);
  if (!s) return false;
  const e = policy.eligibility;
  const status = supplierStatus(ctx, policy, supplierId).toLowerCase();
  if (!e.allowedStatuses.map((x) => x.toLowerCase()).includes(status)) return false;
  if (e.excludedSupplierIds.includes(supplierId)) return false;
  if (e.minOnTimePct !== null && e.minOnTimePct !== undefined && s.onTimePct < e.minOnTimePct) return false;
  if (e.minQualityRating !== null && e.minQualityRating !== undefined && s.qualityRating < e.minQualityRating) return false;
  return true;
}

/** POs for an item in the N days up to and including `asOf` (date window [asOf-N, asOf]). */
export function posInWindow(ctx: DataContext, itemCode: string, asOf: string, days: number): PoRecord[] {
  const end = dayNum(asOf);
  const start = end - days;
  return (ctx.poByItem.get(itemCode) ?? []).filter((p) => {
    const d = dayNum(p.poDate);
    return d >= start && d <= end;
  });
}

/** Most recent PO on or before `asOf`, optionally filtered. */
export function lastPo(ctx: DataContext, itemCode: string, asOf: string, filter?: (p: PoRecord) => boolean): PoRecord | null {
  const end = dayNum(asOf);
  for (const p of ctx.poByItem.get(itemCode) ?? []) {
    if (dayNum(p.poDate) > end) continue;
    if (filter && !filter(p)) continue;
    return p;
  }
  return null;
}
