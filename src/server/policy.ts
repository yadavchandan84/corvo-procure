import type { Prisma } from '@prisma/client';
import { prisma } from './db';
import { audit, getApprovedVersions, getContext, getLatestApproved, toRecord } from './repo';
import { proposePolicyChange } from './policy-ai';
import { HttpError } from './runs';
import { diffPolicies } from '@/engine/policy/diff';
import { validatePolicy } from '@/engine/policy/validate';
import { parsePolicyDefinition, type PolicyDefinition } from '@/engine/policy/schema';
import { runEngine } from '@/engine/engine';
import { parseDate } from '@/engine/dates';
import type { PrLineInput } from '@/engine/types';

const json = (v: unknown) => v as Prisma.InputJsonValue;

function bumpVersion(v: string): string {
  const [maj, min] = v.split('.').map((x) => Number(x));
  return Number.isFinite(maj) ? `${maj}.${(Number.isFinite(min) ? min : 0) + 1}` : `${v}.1`;
}

export interface CreateDraftInput {
  sourceType: 'DOCUMENT' | 'CHAT' | 'EDITOR';
  sourceName?: string;
  text?: string;
  definition?: unknown;
  version?: string;
  effectiveFrom?: string;
  user: string;
}

/** Create a DRAFT version from a document, a chat description, or an edited definition. */
export async function createDraft(input: CreateDraftInput) {
  const base = await getLatestApproved();
  if (!base) throw new HttpError(500, 'No approved base policy.');
  const baseDef = parsePolicyDefinition(base.definition);
  let definition: PolicyDefinition;
  let summary: string[] = [];
  let aiNotes: Record<string, unknown> = {};
  let version = input.version?.trim() || '';
  let effectiveFrom = parseDate(input.effectiveFrom ?? '') ?? '';

  if (input.sourceType === 'EDITOR') {
    const v = validatePolicy(input.definition);
    if (!v.ok || !v.definition) throw new HttpError(400, `The policy is not valid: ${v.errors.join('; ')}`);
    definition = v.definition;
    aiNotes = { reader: 'editor', warnings: v.warnings };
  } else {
    if (!input.text || input.text.trim().length < 10) throw new HttpError(400, 'Describe the change or upload the amendment document.');
    const p = await proposePolicyChange({ version: base.version, effectiveFrom: base.effectiveFrom, definition: baseDef }, input.text, input.sourceType === 'DOCUMENT' ? 'document' : 'chat');
    definition = p.definition;
    summary = p.summary;
    version = version || p.version || '';
    effectiveFrom = effectiveFrom || p.effectiveFrom || '';
    aiNotes = { reader: p.reader, unrepresentable: p.unrepresentable, assumptions: p.assumptions, errors: p.validationErrors, warnings: p.validationWarnings, statedSummary: p.summary };
  }
  if (!version) version = bumpVersion(base.version);
  const changes = diffPolicies(baseDef, definition);
  const draft = await prisma.policyVersion.create({
    data: {
      version,
      effectiveFrom: effectiveFrom || base.effectiveFrom,
      status: 'DRAFT',
      definition: json(definition),
      changeSummary: json(changes),
      sourceType: input.sourceType,
      sourceName: input.sourceName ?? null,
      sourceText: input.text?.slice(0, 100000) ?? null,
      aiNotes: json({ ...aiNotes, effectiveFromMissing: !effectiveFrom, statedSummary: summary }),
      parentId: base.id,
      createdBy: input.user,
    },
  });
  await audit(input.user, 'POLICY_DRAFT_CREATED', 'PolicyVersion', draft.id, { version, effectiveFrom, sourceType: input.sourceType, sourceName: input.sourceName, changes: changes.length });
  return draft;
}

export async function updateDraft(id: string, user: string, patch: { version?: string; effectiveFrom?: string; definition?: unknown }) {
  const d = await prisma.policyVersion.findUnique({ where: { id } });
  if (!d) throw new HttpError(404, 'Version not found');
  if (d.status !== 'DRAFT') throw new HttpError(409, 'Only drafts can be edited. Create a new draft instead.');
  const data: Prisma.PolicyVersionUpdateInput = {};
  if (patch.version) data.version = patch.version.trim();
  if (patch.effectiveFrom) {
    const e = parseDate(patch.effectiveFrom);
    if (!e) throw new HttpError(400, 'Effective date must be YYYY-MM-DD.');
    data.effectiveFrom = e;
  }
  if (patch.definition !== undefined) {
    const v = validatePolicy(patch.definition);
    if (!v.ok || !v.definition) throw new HttpError(400, `The policy is not valid: ${v.errors.join('; ')}`);
    data.definition = json(v.definition);
    const parent = d.parentId ? await prisma.policyVersion.findUnique({ where: { id: d.parentId } }) : null;
    if (parent) data.changeSummary = json(diffPolicies(parsePolicyDefinition(parent.definition), v.definition));
  }
  const updated = await prisma.policyVersion.update({ where: { id }, data });
  await audit(user, 'POLICY_DRAFT_EDITED', 'PolicyVersion', id, { fields: Object.keys(data) });
  return updated;
}

export async function approveDraft(id: string, user: string, comment?: string) {
  const d = await prisma.policyVersion.findUnique({ where: { id } });
  if (!d) throw new HttpError(404, 'Version not found');
  if (d.status !== 'DRAFT') throw new HttpError(409, `Version is already ${d.status.toLowerCase()}.`);
  const v = validatePolicy(d.definition);
  if (!v.ok) throw new HttpError(400, `Cannot approve an invalid policy: ${v.errors.join('; ')}`);
  const clash = await prisma.policyVersion.findFirst({ where: { status: 'APPROVED', version: d.version } });
  if (clash) throw new HttpError(409, `Version ${d.version} already exists. Rename the draft before approving.`);
  const updated = await prisma.policyVersion.update({ where: { id }, data: { status: 'APPROVED', approvedBy: user, approvedAt: new Date(), reviewComment: comment ?? null } });
  await audit(user, 'POLICY_APPROVED', 'PolicyVersion', id, { version: d.version, effectiveFrom: d.effectiveFrom, comment });
  return updated;
}

export async function rejectDraft(id: string, user: string, comment: string) {
  const d = await prisma.policyVersion.findUnique({ where: { id } });
  if (!d) throw new HttpError(404, 'Version not found');
  if (d.status !== 'DRAFT') throw new HttpError(409, `Version is already ${d.status.toLowerCase()}.`);
  const updated = await prisma.policyVersion.update({ where: { id }, data: { status: 'REJECTED', rejectedBy: user, rejectedAt: new Date(), reviewComment: comment } });
  await audit(user, 'POLICY_REJECTED', 'PolicyVersion', id, { version: d.version, comment });
  return updated;
}

/**
 * What would change if this draft were approved: re-run the most recent uploaded batch with and
 * without it and list the lines whose decision changes.
 */
export async function impactPreview(id: string, batchId?: string) {
  const d = await prisma.policyVersion.findUnique({ where: { id } });
  if (!d) throw new HttpError(404, 'Version not found');
  const batch = batchId
    ? await prisma.prBatch.findUnique({ where: { id: batchId } })
    : await prisma.prBatch.findFirst({ where: { source: { not: 'CHAT' } }, orderBy: { createdAt: 'desc' } });
  if (!batch) return { batch: null, changed: [], total: 0 };
  const lines = await prisma.prLine.findMany({ where: { batchId: batch.id }, orderBy: [{ seq: 'asc' }, { insertedAt: 'asc' }] });
  const inputs: PrLineInput[] = lines.map(({ prNo, prLine, createdAt, requester, department, plant, itemCode, description, quantity, uom, estimatedUnitPrice, needByDate, urgency }) => ({
    prNo, prLine, createdAt, requester, department, plant, itemCode, description, quantity, uom, estimatedUnitPrice, needByDate, urgency,
  }));
  const [ctx, approved] = await Promise.all([getContext(), getApprovedVersions()]);
  const withDraft = d.status === 'APPROVED' ? approved : [...approved, { ...toRecord(d), approvedAt: new Date().toISOString() }];
  const without = approved.filter((v) => v.id !== d.id);
  const before = runEngine(ctx, inputs, without.length ? without : approved);
  const after = runEngine(ctx, inputs, withDraft);
  const changed = after.rows
    .map((a, i) => ({ a, b: before.rows[i] }))
    .filter(({ a, b }) => a.route !== b.route || a.supplier_id !== b.supplier_id || a.group_value_inr !== b.group_value_inr || a.suggested_supplier_ids !== b.suggested_supplier_ids || a.group_id !== b.group_id || a.po_id !== b.po_id)
    .map(({ a, b }) => ({
      key: `${a.pr_no}/${a.pr_line}`,
      item: a.resolved_item_code,
      before: { route: b.route, supplier: b.supplier_id, value: b.group_value_inr, version: b.policy_version, group: b.group_id, po: b.po_id },
      after: { route: a.route, supplier: a.supplier_id, value: a.group_value_inr, version: a.policy_version, group: a.group_id, po: a.po_id },
    }));
  return { batch: { id: batch.id, name: batch.name }, changed, total: after.rows.length };
}
