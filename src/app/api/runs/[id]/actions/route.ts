import { NextResponse } from 'next/server';
import { actor, handle } from '@/server/http';
import { approve, HttpError, override, returnToRequester, type OverrideInput } from '@/server/runs';

export const runtime = 'nodejs';

/** Buyer actions on a requirement: APPROVE, OVERRIDE (comment required) or RETURN (comment required). */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = (await req.json()) as { groupId: string; action: 'APPROVE' | 'OVERRIDE' | 'RETURN'; comment?: string; override?: OverrideInput };
  if (!body.groupId) throw new HttpError(400, 'groupId is required');
  const user = actor(req);
  if (body.action === 'APPROVE') {
    const doc = await approve(id, body.groupId, user, body.comment);
    return NextResponse.json({ ok: true, document: doc });
  }
  if (body.action === 'OVERRIDE') {
    if (!body.override) throw new HttpError(400, 'override details are required');
    await override(id, body.groupId, user, body.comment ?? '', body.override);
    return NextResponse.json({ ok: true });
  }
  if (body.action === 'RETURN') {
    await returnToRequester(id, body.groupId, user, body.comment ?? '');
    return NextResponse.json({ ok: true });
  }
  throw new HttpError(400, 'Unknown action');
});
