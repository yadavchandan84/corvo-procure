import { NextResponse } from 'next/server';
import { actor, handle, readCsvFromRequest } from '@/server/http';
import { processBatchCsv } from '@/server/runs';
import { decisionsToCsv } from '@/engine/csv';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/process-batch
 * Body: the PR batch CSV (raw text/csv, multipart field "file", or JSON {"csv": "..."}).
 * Query: format=json (default) | csv ; policyVersionId=<id> to force one version.
 * Returns the decisions, one row per PR line, and stores the batch and run for the buyer workspace.
 */
export const POST = handle(async (req: Request) => {
  const url = new URL(req.url);
  const { text, name } = await readCsvFromRequest(req);
  const { run, result, batch } = await processBatchCsv({
    csvText: text,
    name,
    user: actor(req),
    forceVersionId: url.searchParams.get('policyVersionId'),
    source: 'API',
  });
  if ((url.searchParams.get('format') ?? '').toLowerCase() === 'csv' || (req.headers.get('accept') ?? '').includes('text/csv')) {
    return new Response(decisionsToCsv(result.rows), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="decisions-${run.id}.csv"` },
    });
  }
  return NextResponse.json({ runId: run.id, batchId: batch.id, summary: result.summary, policyVersionsUsed: result.policyVersionsUsed, decisions: result.rows });
});
