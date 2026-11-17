import { NextResponse } from 'next/server';
import { actor, handle } from '@/server/http';
import { prisma } from '@/server/db';
import { ensureSeedPolicy } from '@/server/repo';
import { createDraft } from '@/server/policy';
import { documentToText } from '@/server/pdf';
import { HttpError } from '@/server/runs';
import { todayIST } from '@/engine/dates';
import { llmInfo } from '@/server/llm';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** List all versions (drafts, approved, rejected) with the one in force today marked. */
export const GET = handle(async () => {
  await ensureSeedPolicy();
  const versions = await prisma.policyVersion.findMany({
    orderBy: [{ createdAt: 'desc' }],
    select: { id: true, version: true, effectiveFrom: true, status: true, sourceType: true, sourceName: true, createdBy: true, createdAt: true, approvedBy: true, approvedAt: true, rejectedBy: true, reviewComment: true, changeSummary: true },
  });
  const today = todayIST();
  const inForce = versions
    .filter((v) => v.status === 'APPROVED' && v.effectiveFrom <= today)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || (b.approvedAt?.getTime() ?? 0) - (a.approvedAt?.getTime() ?? 0))[0];
  return NextResponse.json({ today, inForceId: inForce?.id ?? null, ai: llmInfo(), versions });
});

/**
 * Create a draft. multipart: file (PDF/TXT/MD) + optional version/effectiveFrom;
 * JSON: { sourceType: 'CHAT', text } | { sourceType: 'DOCUMENT', text, sourceName } | { sourceType: 'EDITOR', definition, version, effectiveFrom }
 */
export const POST = handle(async (req: Request) => {
  const user = actor(req);
  const type = req.headers.get('content-type') ?? '';
  if (type.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const pasted = (form.get('text') as string | null) ?? '';
    let text = pasted;
    let name = 'pasted text';
    if (file && typeof file !== 'string') {
      name = file.name;
      text = await documentToText(file.name, await file.arrayBuffer());
    }
    if (!text.trim()) throw new HttpError(400, 'Upload the amendment (PDF or text) or paste its text.');
    const draft = await createDraft({ sourceType: 'DOCUMENT', sourceName: name, text, version: (form.get('version') as string) || undefined, effectiveFrom: (form.get('effectiveFrom') as string) || undefined, user });
    return NextResponse.json(draft);
  }
  const body = (await req.json()) as { sourceType: 'DOCUMENT' | 'CHAT' | 'EDITOR'; text?: string; definition?: unknown; version?: string; effectiveFrom?: string; sourceName?: string };
  const draft = await createDraft({ ...body, user });
  return NextResponse.json(draft);
});
