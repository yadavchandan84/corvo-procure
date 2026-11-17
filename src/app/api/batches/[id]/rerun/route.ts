import { NextResponse } from 'next/server';
import { actor, handle } from '@/server/http';
import { rerunBatch } from '@/server/runs';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { policyVersionId?: string | null };
  const { run, result } = await rerunBatch(id, actor(req), body.policyVersionId ?? null);
  return NextResponse.json({ runId: run.id, summary: result.summary, policyVersionsUsed: result.policyVersionsUsed });
});
