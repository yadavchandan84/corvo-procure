import { NextResponse } from 'next/server';
import { actor, handle } from '@/server/http';
import { prisma } from '@/server/db';
import { approveDraft, impactPreview, rejectDraft, updateDraft } from '@/server/policy';
import { HttpError } from '@/server/runs';
import { validatePolicy } from '@/engine/policy/validate';
import { describeRule } from '@/engine/policy/diff';
import { parsePolicyDefinition } from '@/engine/policy/schema';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const GET = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const v = await prisma.policyVersion.findUnique({ where: { id } });
  if (!v) throw new HttpError(404, 'Version not found');
  const validation = validatePolicy(v.definition);
  const def = parsePolicyDefinition(v.definition);
  const parent = v.parentId ? await prisma.policyVersion.findUnique({ where: { id: v.parentId }, select: { id: true, version: true, effectiveFrom: true } }) : null;
  const url = new URL(req.url);
  const impact = url.searchParams.get('impact') === '1' ? await impactPreview(id, url.searchParams.get('batchId') ?? undefined) : null;
  return NextResponse.json({ ...v, parent, validation: { ok: validation.ok, errors: validation.errors, warnings: validation.warnings }, rulesText: def.rules.map((r) => ({ id: r.id, text: describeRule(r), enabled: r.enabled })), impact });
});

export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = (await req.json()) as { version?: string; effectiveFrom?: string; definition?: unknown };
  return NextResponse.json(await updateDraft(id, actor(req), body));
});

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = (await req.json()) as { action: 'APPROVE' | 'REJECT'; comment?: string };
  if (body.action === 'APPROVE') return NextResponse.json(await approveDraft(id, actor(req), body.comment));
  if (body.action === 'REJECT') {
    if (!body.comment?.trim()) throw new HttpError(400, 'Say why the draft is rejected.');
    return NextResponse.json(await rejectDraft(id, actor(req), body.comment));
  }
  throw new HttpError(400, 'Unknown action');
});
