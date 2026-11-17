import { NextResponse } from 'next/server';
import { handle } from '@/server/http';
import { prisma } from '@/server/db';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  const entityId = url.searchParams.get('entityId');
  const logs = await prisma.auditLog.findMany({
    where: entityId ? { entityId: { contains: entityId } } : undefined,
    orderBy: { at: 'desc' },
    take: Number(url.searchParams.get('take') ?? 300),
  });
  return NextResponse.json(logs);
});
