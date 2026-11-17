import { NextResponse } from 'next/server';
import { actor, handle } from '@/server/http';
import { prisma } from '@/server/db';
import { getLiveBatch, runLive } from '@/server/runs';

export const runtime = 'nodejs';

/** Latest run of the live chat queue (re-decided with POST). */
export const GET = handle(async () => {
  const batch = await getLiveBatch();
  const run = await prisma.decisionRun.findFirst({ where: { batchId: batch.id }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  return NextResponse.json({ batchId: batch.id, runId: run?.id ?? null });
});

export const POST = handle(async (req: Request) => {
  const { run } = await runLive(actor(req));
  return NextResponse.json({ runId: run.id });
});
