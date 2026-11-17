import type { PolicyDefinition, PolicyRule } from './schema';
import { describeCondition } from './conditions';
import { formatINR } from '../format';

/**
 * Plain-language differences between two policy definitions. This is computed from the data,
 * never taken from the AI, so what the approver reads is exactly what will change.
 */
export interface PolicyChange {
  kind: 'parameter' | 'rule_added' | 'rule_removed' | 'rule_changed' | 'rule_moved';
  path: string;
  text: string;
  before?: unknown;
  after?: unknown;
}

const LABELS: Record<string, { label: string; unit?: 'days' | 'hours' | 'inr' | 'pct' }> = {
  'scope.plants': { label: 'Plants the policy applies to' },
  'intake.rejectNonPositiveQuantity': { label: 'Reject lines with zero or negative quantity' },
  'intake.rejectPlantsOutsideScope': { label: 'Reject lines for plants outside the policy scope' },
  'intake.rejectMissingNeedBy': { label: 'Reject lines without a need-by date' },
  'intake.rejectUomMismatch': { label: 'Reject lines whose unit differs from the item master' },
  'intake.rejectAmbiguousItems': { label: 'Send back lines that match several items equally' },
  'intake.emergencyUrgencyValues': { label: 'Urgency values treated as Emergency' },
  'itemMatching.useRequesterCode': { label: "Use the requester's item code when valid (1.1)" },
  'itemMatching.minScore': { label: 'Minimum description match score' },
  'itemMatching.minMargin': { label: 'Minimum lead of best match over second' },
  'newItems.neverClub': { label: 'New items are never clubbed (1.2)' },
  'clubbing.enabled': { label: 'Clubbing of similar PR lines (2.1)' },
  'clubbing.sameFields': { label: 'Lines must share (2.2)' },
  'clubbing.creationWindowDays': { label: 'Clubbing window from first line creation (2.2)', unit: 'days' },
  'clubbing.needByWindowDays': { label: 'Clubbing need-by window, either side (2.2)', unit: 'days' },
  'valuation.priceSources': { label: 'Valuation price order (3.1)' },
  'valuation.lastPoLookbackDays': { label: 'Last-PO price lookback for valuation (3.1b)', unit: 'days' },
  'valuation.lastPoSuppliers': { label: 'Suppliers whose POs count for valuation (3.1b)' },
  'contracts.requireEligibleSupplier': { label: 'Contract supplier must be Active (4.1)' },
  'contracts.enforceCeiling': { label: 'Enforce contract value ceiling (4.2)' },
  'contracts.minHeadroomPctAfter': { label: 'Minimum contract ceiling left after a requirement', unit: 'pct' },
  'contracts.excludeIfEndsWithinDays': { label: 'Do not use contracts ending within', unit: 'days' },
  'contracts.selection': { label: 'Contract selection when several apply (4.3)' },
  'eligibility.allowedStatuses': { label: 'Supplier statuses allowed to receive POs/suggestions (5.7)' },
  'eligibility.minOnTimePct': { label: 'Minimum supplier on-time %', unit: 'pct' },
  'eligibility.minQualityRating': { label: 'Minimum supplier quality rating' },
  'eligibility.excludedSupplierIds': { label: 'Suppliers excluded by policy' },
  'eligibility.statusOverrides': { label: 'Supplier status overrides' },
  'preferredSuppliers.lookbackDays': { label: 'Preferred list PO lookback (6.1)', unit: 'days' },
  'preferredSuppliers.includeContractHolders': { label: 'Contract holders join the preferred list (6.1b)' },
  'preferredSuppliers.recencyBands': { label: 'Recency score bands (6.2)' },
  'preferredSuppliers.weights.frequency': { label: 'Ranking weight: purchase frequency (6.2)' },
  'preferredSuppliers.weights.recency': { label: 'Ranking weight: recency (6.2)' },
  'preferredSuppliers.weights.contract': { label: 'Ranking weight: contract held (6.2)' },
  'preferredSuppliers.weights.onTime': { label: 'Ranking weight: on-time delivery (6.2)' },
  'preferredSuppliers.weights.quality': { label: 'Ranking weight: quality rating (6.2)' },
  'preferredSuppliers.referencePriceLookbackDays': { label: 'Reference price PO lookback (6.3)', unit: 'days' },
  'preferredSuppliers.exportTopN': { label: 'Suppliers per item in the preferred list export' },
  'suggestions.topUpFromCategory': { label: 'Top up suggestions from category suppliers (6.4)' },
  'suggestions.topUpWeights.onTime': { label: 'Top-up ordering weight: on-time (6.4)' },
  'suggestions.topUpWeights.quality': { label: 'Top-up ordering weight: quality (6.4)' },
  'suggestions.newItemsGetSuggestions': { label: 'New items get supplier suggestions (6.4)' },
  'consolidation.enabled': { label: 'PO consolidation (7.1)' },
  'consolidation.sameFields': { label: 'Requirements on one PO must share (7.1)' },
  'consolidation.windowHours': { label: 'PO consolidation window (7.1)', unit: 'hours' },
  'consolidation.maxRequirementsPerPo': { label: 'Maximum requirements per PO (0 = no limit)' },
};

function show(v: unknown, unit?: string): string {
  if (v === null || v === undefined) return 'not set';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') {
    if (unit === 'days') return `${v} days`;
    if (unit === 'hours') return `${v} hours`;
    if (unit === 'inr') return formatINR(v);
    if (unit === 'pct') return `${v}%`;
    return String(v);
  }
  if (Array.isArray(v)) {
    if (v.length && typeof v[0] === 'object') return v.map((x) => JSON.stringify(x)).join(', ');
    return v.length ? v.join(', ') : 'none';
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    return entries.length ? entries.map(([k, x]) => `${k}: ${String(x)}`).join(', ') : 'none';
  }
  return String(v);
}

function flatten(obj: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const keys = Object.keys(obj as object);
    const isLeafMap = prefix === 'eligibility.statusOverrides';
    if (isLeafMap) {
      out[prefix] = obj;
      return out;
    }
    for (const k of keys) flatten((obj as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k, out);
  } else out[prefix] = obj;
  return out;
}

export function describeOutcome(r: PolicyRule): string {
  const o = r.outcome;
  const parts = [o.decision === 'PO' ? 'PO' : o.decision === 'SOURCING_REQUEST' ? 'Sourcing request' : 'Not processed', `route ${o.route}`];
  if (o.supplier === 'contract') parts.push('contract supplier at contract rate');
  if (o.supplier === 'preferred_1') parts.push('1st preferred supplier at its reference price');
  if (o.suggestCount) parts.push(`suggest ${o.suggestCount} suppliers`);
  if (o.approvals.length) parts.push(`needs ${o.approvals.join(', ')}`);
  return parts.join(', ');
}

export function describeRule(r: PolicyRule): string {
  return `${r.clause} ${r.title}: when ${describeCondition(r.when)} then ${describeOutcome(r)}${r.enabled ? '' : ' (disabled)'}`;
}

export function diffPolicies(before: PolicyDefinition, after: PolicyDefinition): PolicyChange[] {
  const changes: PolicyChange[] = [];
  const { rules: rb, meta: mb, ...pb } = before;
  const { rules: ra, meta: ma, ...pa } = after;
  void mb;
  void ma;
  const fb = flatten(pb);
  const fa = flatten(pa);
  const keys = Array.from(new Set([...Object.keys(fb), ...Object.keys(fa)]));
  for (const k of keys) {
    if (JSON.stringify(fb[k]) === JSON.stringify(fa[k])) continue;
    const meta = LABELS[k] ?? { label: k };
    changes.push({ kind: 'parameter', path: k, before: fb[k], after: fa[k], text: `${meta.label}: ${show(fb[k], meta.unit)} → ${show(fa[k], meta.unit)}` });
  }

  const beforeIds = rb.map((r) => r.id);
  const afterIds = ra.map((r) => r.id);
  for (const r of ra) {
    const old = rb.find((x) => x.id === r.id);
    const pos = afterIds.indexOf(r.id);
    if (!old) {
      const prev = pos > 0 ? ra[pos - 1] : null;
      changes.push({
        kind: 'rule_added',
        path: `rules.${r.id}`,
        after: r,
        text: `New rule ${r.clause} "${r.title}" ${prev ? `after ${prev.clause}` : 'at the top'} (checked in position ${pos + 1}): when ${describeCondition(r.when)} then ${describeOutcome(r)}.`,
      });
      continue;
    }
    const sub: string[] = [];
    if (JSON.stringify(old.when) !== JSON.stringify(r.when)) sub.push(`condition was "${describeCondition(old.when)}", now "${describeCondition(r.when)}"`);
    if (JSON.stringify(old.outcome) !== JSON.stringify(r.outcome)) sub.push(`outcome was "${describeOutcome(old)}", now "${describeOutcome(r)}"`);
    if (old.enabled !== r.enabled) sub.push(r.enabled ? 'enabled' : 'disabled');
    if (old.title !== r.title || old.clause !== r.clause) sub.push(`renamed from ${old.clause} "${old.title}" to ${r.clause} "${r.title}"`);
    if (sub.length) changes.push({ kind: 'rule_changed', path: `rules.${r.id}`, before: old, after: r, text: `Rule ${r.clause} "${r.title}": ${sub.join('; ')}.` });
  }
  for (const r of rb) {
    if (!afterIds.includes(r.id)) changes.push({ kind: 'rule_removed', path: `rules.${r.id}`, before: r, text: `Rule ${r.clause} "${r.title}" removed.` });
  }
  // order changes among rules present in both
  const commonBefore = beforeIds.filter((id) => afterIds.includes(id));
  const commonAfter = afterIds.filter((id) => beforeIds.includes(id));
  if (JSON.stringify(commonBefore) !== JSON.stringify(commonAfter)) {
    changes.push({
      kind: 'rule_moved',
      path: 'rules',
      before: commonBefore,
      after: commonAfter,
      text: `Rule order changed: ${commonBefore.map((id) => rb.find((r) => r.id === id)!.clause).join(' → ')} becomes ${commonAfter.map((id) => ra.find((r) => r.id === id)!.clause).join(' → ')}.`,
    });
  }
  return changes;
}
