import { NextResponse } from 'next/server';
import { handle } from '@/server/http';
import { getApprovedVersions, getContext } from '@/server/repo';
import { preferredForAllItems } from '@/engine';
import { parseDate, todayIST } from '@/engine/dates';
import { preferredToCsv } from '@/engine/csv';
import { parsePolicyDefinition } from '@/engine/policy/schema';

export const runtime = 'nodejs';

/**
 * GET /api/preferred?date=YYYY-MM-DD[&item=ITM-1048][&format=csv][&policyVersionId=]
 * Preferred supplier lists for every item as of the date (policy section 6), with score breakdowns.
 * format=csv returns item_code, rank, supplier_id, reference_price (top N, N from the policy).
 */
export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  const date = parseDate(url.searchParams.get('date') ?? '') ?? todayIST();
  const [ctx, versions] = await Promise.all([getContext(), getApprovedVersions()]);
  const { version, lists } = preferredForAllItems(ctx, versions, date, url.searchParams.get('policyVersionId'));
  const def = parsePolicyDefinition(version.definition);
  if (url.searchParams.get('format') === 'csv') {
    return new Response(preferredToCsv(lists, def.preferredSuppliers.exportTopN), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="preferred-suppliers-${date}.csv"` },
    });
  }
  const item = url.searchParams.get('item');
  return NextResponse.json({
    date,
    policyVersion: version.version,
    weights: def.preferredSuppliers.weights,
    recencyBands: def.preferredSuppliers.recencyBands,
    lookbackDays: def.preferredSuppliers.lookbackDays,
    exportTopN: def.preferredSuppliers.exportTopN,
    lists: (item ? lists.filter((l) => l.itemCode === item) : lists).map((l) => ({ ...l, category: ctx.items.get(l.itemCode)?.category })),
  });
});
