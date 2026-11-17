import { safeParsePolicyDefinition, KNOWN_ROUTES, type PolicyDefinition } from './schema';
import { referencedFacts } from './conditions';
import { FACT_MAP } from './facts';

export interface ValidationResult {
  ok: boolean;
  definition?: PolicyDefinition;
  errors: string[];
  warnings: string[];
}

/** Schema validation plus semantic checks the schema cannot express. */
export function validatePolicy(input: unknown): ValidationResult {
  const parsed = safeParsePolicyDefinition(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
      warnings: [],
    };
  }
  const def = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  for (const r of def.rules) {
    if (ids.has(r.id)) errors.push(`Rule id ${r.id} is used twice.`);
    ids.add(r.id);
    for (const f of referencedFacts(r.when)) {
      if (!FACT_MAP[f]) errors.push(`Rule ${r.id} uses unknown fact "${f}".`);
    }
    if (!(KNOWN_ROUTES as readonly string[]).includes(r.outcome.route)) {
      warnings.push(`Rule ${r.id} uses route "${r.outcome.route}", which is not one of the standard output routes.`);
    }
    if (r.outcome.decision === 'PO' && r.outcome.supplier === 'none') errors.push(`Rule ${r.id} places a PO but does not say which supplier (contract or preferred_1).`);
    if (r.outcome.decision !== 'PO' && r.outcome.supplier !== 'none') warnings.push(`Rule ${r.id} is not a PO; its supplier strategy is ignored.`);
  }
  if (!def.rules.some((r) => r.enabled && r.outcome.route === 'NEW_ITEM_SOURCING')) warnings.push('No enabled rule routes new items to NEW_ITEM_SOURCING (policy 1.2).');
  const w = def.preferredSuppliers.weights;
  if (w.frequency + w.recency + w.contract + w.onTime + w.quality <= 0) errors.push('Preferred supplier weights must not all be zero.');
  return { ok: errors.length === 0, definition: def, errors, warnings };
}
