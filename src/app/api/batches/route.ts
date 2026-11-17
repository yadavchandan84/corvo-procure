import { NextResponse } from 'next/server';
import { actor, handle, readCsvFromRequest } from '@/server/http';
import { processBatchCsv } from '@/server/runs';
import { prisma } from '@/server/db';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const GET = handle(async () => {
  const batches = await prisma.prBatch.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { lines: true } }, runs: { orderBy: { createdAt: 'desc' }, select: { id: true, label: true, createdAt: true, createdBy: true, versionsUsed: true, summary: true, policyMode: true } } },
  });
  return NextResponse.json(batches);
});

/** Upload a PR batch CSV from the UI (multipart "file"), optionally forcing a policy version. */
export const POST = handle(async (req: Request) => {
  const url = new URL(req.url);
  const { text, name } = await readCsvFromRequest(req);
  const { run, result } = await processBatchCsv({ csvText: text, name, user: actor(req), forceVersionId: url.searchParams.get('policyVersionId'), source: 'UPLOAD' });
  return NextResponse.json({ runId: run.id, summary: result.summary, policyVersionsUsed: result.policyVersionsUsed });
});
