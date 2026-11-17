import { NextResponse } from 'next/server';
import { handle } from '@/server/http';
import { prisma } from '@/server/db';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  const runs = await prisma.decisionRun.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, label: true, createdAt: true, createdBy: true, versionsUsed: true, summary: true, policyMode: true, batch: { select: { id: true, name: true, source: true } }, _count: { select: { actions: true, documents: true } } },
  });
  return NextResponse.json(runs);
});
