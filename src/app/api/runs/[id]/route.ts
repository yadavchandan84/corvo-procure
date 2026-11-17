import { NextResponse } from 'next/server';
import { handle } from '@/server/http';
import { getRunView } from '@/server/runs';

export const runtime = 'nodejs';

export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { run, result, status } = await getRunView(id);
  return NextResponse.json({
    id: run.id,
    label: run.label,
    createdAt: run.createdAt,
    createdBy: run.createdBy,
    policyMode: run.policyMode,
    versionsUsed: run.versionsUsed,
    batch: { id: run.batch.id, name: run.batch.name, source: run.batch.source },
    summary: result.summary,
    requirements: result.requirements,
    lines: result.lines,
    rows: result.rows,
    purchaseOrders: result.purchaseOrders,
    status,
    actions: run.actions,
    documents: run.documents,
  });
});
