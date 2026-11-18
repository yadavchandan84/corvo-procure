import { NextResponse } from 'next/server';
import { prisma } from '@/server/db';
import { llmSelfCheck } from '@/server/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET /api/health (database) · GET /api/health?ai=1 (also checks the AI provider) */
export async function GET(req: Request) {
  const checkAi = new URL(req.url).searchParams.get('ai') === '1';
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, db: 'up', ...(checkAi ? { ai: await llmSelfCheck() } : {}) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 503 });
  }
}
