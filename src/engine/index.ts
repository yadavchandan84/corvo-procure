export * from './types';
export { runEngine, resolvePolicyVersion, type EngineOptions } from './engine';
export { buildContext, type DataContext } from './context';
export { preferredList, suggestSuppliers, ratingScore } from './preferred';
export { matchItem, rankItems, buildItemIndex, tokenize, findCodeInText } from './matching';
export * from './csv';
export * from './dates';
export * from './format';
export { extractContractFromText, reconcileContract } from './contract-text';

import type { MasterData, PolicyVersionRecord, PreferredSupplierEntry } from './types';
import { buildContext, type DataContext } from './context';
import { preferredList } from './preferred';
import { resolvePolicyVersion } from './engine';
import { parsePolicyDefinition } from './policy/schema';

/** Preferred supplier lists for every item as of a date, under the version in force on that date. */
export function preferredForAllItems(
  source: MasterData | DataContext,
  versions: PolicyVersionRecord[],
  asOf: string,
  forceVersionId?: string | null,
): { version: PolicyVersionRecord; lists: { itemCode: string; description: string; entries: PreferredSupplierEntry[] }[] } {
  const ctx = 'itemIndex' in source ? source : buildContext(source);
  const version = forceVersionId ? versions.find((v) => v.id === forceVersionId) ?? resolvePolicyVersion(versions, asOf).version : resolvePolicyVersion(versions, asOf).version;
  const def = parsePolicyDefinition(version.definition);
  const lists = [...ctx.data.items]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((it) => ({ itemCode: it.code, description: it.description, entries: preferredList(ctx, def, it.code, asOf) }));
  return { version, lists };
}
