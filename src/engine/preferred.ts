import type { PreferredSupplierEntry, Supplier } from './types';
import type { PolicyDefinition } from './policy/schema';
import { type DataContext, isEligible, posInWindow } from './context';
import { dayNum } from './dates';
import { round2 } from './format';

/**
 * Preferred supplier list (policy section 6), recalculated as of a date.
 *
 * Membership (6.1): eligible (Active) suppliers with a PO for the item in the lookback window,
 * or a contract for the item that started on or before the date (even if expired).
 *
 * Ranking (6.2): weighted score of five components, each scaled 0..1:
 *   frequency = this supplier's PO count in the window / the highest count among listed suppliers
 *   recency   = recency band score of the supplier's last PO (1 within 90 days, 0.5 within 365, else 0)
 *   contract  = 1 if the supplier has held a contract for the item, else 0
 *   onTime    = on-time delivery % / 100
 *   quality   = quality rating / 5
 * Weights live in the policy (v5.0: 0.30 / 0.25 / 0.20 / 0.125 / 0.125). Ties: lower supplier id.
 *
 * Reference price (6.3): the supplier's most recent PO price in the window; if none, the rate in
 * its most recent contract for the item.
 */
export function preferredList(ctx: DataContext, policy: PolicyDefinition, itemCode: string, asOf: string): PreferredSupplierEntry[] {
  const ps = policy.preferredSuppliers;
  const asOfDay = dayNum(asOf);
  const windowPos = posInWindow(ctx, itemCode, asOf, ps.lookbackDays);
  const refPos = ps.referencePriceLookbackDays === ps.lookbackDays ? windowPos : posInWindow(ctx, itemCode, asOf, ps.referencePriceLookbackDays);

  const contracts = (ctx.contractsByItem.get(itemCode) ?? []).filter((c) => dayNum(c.contract.startDate) <= asOfDay);

  const ids = new Set<string>();
  for (const p of windowPos) ids.add(p.supplierId);
  if (ps.includeContractHolders) for (const c of contracts) ids.add(c.contract.supplierId);

  const raw = [...ids]
    .filter((id) => isEligible(ctx, policy, id))
    .map((id) => {
      const s = ctx.suppliers.get(id) as Supplier;
      const pos = windowPos.filter((p) => p.supplierId === id); // sorted desc
      const last = pos[0] ?? null;
      const daysSince = last ? asOfDay - dayNum(last.poDate) : null;
      let recency = 0;
      if (daysSince !== null) {
        const band = [...ps.recencyBands].sort((a, b) => a.maxDays - b.maxDays).find((b) => daysSince <= b.maxDays);
        recency = band ? band.score : 0;
      }
      const supplierContracts = contracts
        .filter((c) => c.contract.supplierId === id)
        .sort((a, b) => b.contract.startDate.localeCompare(a.contract.startDate));
      const hasContract = supplierContracts.length > 0;
      const refPo = refPos.find((p) => p.supplierId === id) ?? null;
      let referencePrice: number | null = null;
      let referenceSource = '';
      if (refPo) {
        referencePrice = refPo.unitPrice;
        referenceSource = `PO ${refPo.poNumber} (${refPo.poDate})`;
      } else if (supplierContracts[0]) {
        referencePrice = supplierContracts[0].rate;
        referenceSource = `Contract ${supplierContracts[0].contract.id}`;
      }
      return { s, poCount: pos.length, last, daysSince, recency, hasContract, referencePrice, referenceSource };
    });

  const maxCount = Math.max(1, ...raw.map((r) => r.poCount));
  const w = ps.weights;
  const entries = raw.map((r) => {
    const components = {
      frequency: r.poCount / maxCount,
      recency: r.recency,
      contract: r.hasContract ? 1 : 0,
      onTime: r.s.onTimePct / 100,
      quality: r.s.qualityRating / 5,
    };
    const score =
      w.frequency * components.frequency +
      w.recency * components.recency +
      w.contract * components.contract +
      w.onTime * components.onTime +
      w.quality * components.quality;
    return {
      rank: 0,
      supplierId: r.s.id,
      supplierName: r.s.name,
      score: Math.round(score * 10000) / 10000,
      poCount: r.poCount,
      lastPoDate: r.last?.poDate ?? null,
      daysSinceLastPo: r.daysSince,
      recency: r.recency,
      frequency: Math.round(components.frequency * 1000) / 1000,
      hasContract: r.hasContract,
      onTimePct: r.s.onTimePct,
      qualityRating: r.s.qualityRating,
      referencePrice: r.referencePrice === null ? null : round2(r.referencePrice),
      referenceSource: r.referenceSource,
      components,
    } satisfies PreferredSupplierEntry;
  });
  entries.sort((a, b) => b.score - a.score || a.supplierId.localeCompare(b.supplierId));
  entries.forEach((e, i) => (e.rank = i + 1));
  return entries;
}

/** "Best delivery and quality record first" score used for 6.4 top-up. */
export function ratingScore(policy: PolicyDefinition, s: Supplier): number {
  const w = policy.suggestions.topUpWeights;
  const total = w.onTime + w.quality || 1;
  return (w.onTime * (s.onTimePct / 100) + w.quality * (s.qualityRating / 5)) / total;
}

/** 6.4: preferred list in order, topped up from eligible suppliers listing the item's category. */
export function suggestSuppliers(
  ctx: DataContext,
  policy: PolicyDefinition,
  category: string | null,
  preferred: PreferredSupplierEntry[],
  count: number,
): { ids: string[]; notes: string[] } {
  const ids = preferred.slice(0, count).map((p) => p.supplierId);
  const notes: string[] = [];
  if (ids.length < count && policy.suggestions.topUpFromCategory && category) {
    const extra = ctx.data.suppliers
      .filter((s) => !ids.includes(s.id) && s.categories.some((c) => c.toLowerCase() === category.toLowerCase()) && isEligible(ctx, policy, s.id))
      .sort((a, b) => ratingScore(policy, b) - ratingScore(policy, a) || a.id.localeCompare(b.id));
    for (const s of extra) {
      if (ids.length >= count) break;
      ids.push(s.id);
      notes.push(s.id);
    }
  }
  return { ids, notes };
}
