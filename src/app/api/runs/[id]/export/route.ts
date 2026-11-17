import { handle } from '@/server/http';
import { getRunView } from '@/server/runs';
import { decisionsToCsv } from '@/engine/csv';

export const runtime = 'nodejs';

/** CSV export in the brief's section 4 format, one row per PR line. */
export const GET = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { run, result } = await getRunView(id);
  const name = new URL(req.url).searchParams.get('filename') || `decisions-${run.batch.name.replace(/\.csv$/i, '').replace(/[^\w.-]+/g, '_')}-${run.id.slice(-6)}.csv`;
  return new Response(decisionsToCsv(result.rows), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` },
  });
});
