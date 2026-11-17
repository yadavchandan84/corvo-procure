import type { Prisma } from '@prisma/client';
import { prisma } from './db';
import { audit, getApprovedVersions, getContext, nextCounter } from './repo';
import { runEngine } from '@/engine/engine';
import { parsePrBatch } from '@/engine/csv';
import { isEligible } from '@/engine/context';
import { resolvePolicyVersion } from '@/engine/engine';
import { parsePolicyDefinition } from '@/engine/policy/schema';
import type { EngineResult, PrLineInput, RequirementResult } from '@/engine/types';
import { nowIST } from '@/engine/dates';
import { round2 } from '@/engine/format';

const json = (v: unknown) => v as Prisma.InputJsonValue;

export const LIVE_BATCH_NAME = 'Chat intake (live queue)';

function toInput(l: {
  prNo: string;
  prLine: string;
  createdAt: string;
  requester: string;
  department: string;
  plant: string;
  itemCode: string;
  description: string;
  quantity: string;
  uom: string;
  estimatedUnitPrice: string;
  needByDate: string;
  urgency: string;
}): PrLineInput {
  return {
    prNo: l.prNo,
    prLine: l.prLine,
    createdAt: l.createdAt,
    requester: l.requester,
    department: l.department,
    plant: l.plant,
    itemCode: l.itemCode,
    description: l.description,
    quantity: l.quantity,
    uom: l.uom,
    estimatedUnitPrice: l.estimatedUnitPrice,
    needByDate: l.needByDate,
    urgency: l.urgency,
  };
}

async function storeLines(batchId: string, lines: PrLineInput[], offset = 0) {
  await prisma.prLine.createMany({
    data: lines.map((l, i) => ({ batchId, seq: offset + i, ...l })),
    skipDuplicates: true,
  });
}

async function createRun(batchId: string, label: string, inputs: PrLineInput[], user: string, opts: { forceVersionId?: string | null; extraConsumption?: Record<string, number> }) {
  const [ctx, versions] = await Promise.all([getContext(), getApprovedVersions()]);
  const result = runEngine(ctx, inputs, versions, { forceVersionId: opts.forceVersionId, extraConsumption: opts.extraConsumption });
  const run = await prisma.decisionRun.create({
    data: {
      batchId,
      label,
      policyMode: opts.forceVersionId ? 'FORCED' : 'EFFECTIVE_DATE',
      forcedVersionId: opts.forceVersionId ?? null,
      versionsUsed: result.policyVersionsUsed,
      summary: json(result.summary),
      result: json(result),
      createdBy: user,
    },
  });
  await audit(user, 'BATCH_PROCESSED', 'DecisionRun', run.id, { batchId, label, summary: result.summary, versionsUsed: result.policyVersionsUsed, forcedVersionId: opts.forceVersionId ?? null });
  return { run, result };
}

/** Parse a PR batch CSV, store it as a batch, run the engine and store the run. */
export async function processBatchCsv(params: { csvText: string; name: string; user: string; forceVersionId?: string | null; source?: string }) {
  const { lines, errors } = parsePrBatch(params.csvText);
  if (errors.length && !lines.length) throw new HttpError(400, errors.join(' '));
  if (errors.length) throw new HttpError(400, `The CSV is not in the PR batch format: ${errors.join(' ')}`);
  const batch = await prisma.prBatch.create({ data: { name: params.name, source: params.source ?? 'UPLOAD', uploadedBy: params.user } });
  await storeLines(batch.id, lines);
  await audit(params.user, 'BATCH_UPLOADED', 'PrBatch', batch.id, { name: params.name, lines: lines.length });
  const { run, result } = await createRun(batch.id, params.name, lines, params.user, { forceVersionId: params.forceVersionId });
  return { batch, run, result };
}

/** Re-run a stored batch with the policy versions approved now. */
export async function rerunBatch(batchId: string, user: string, forceVersionId?: string | null) {
  const batch = await prisma.prBatch.findUnique({ where: { id: batchId }, include: { lines: { orderBy: [{ seq: 'asc' }, { insertedAt: 'asc' }] } } });
  if (!batch) throw new HttpError(404, 'Batch not found');
  if (batch.source === 'CHAT') return runLive(user);
  const label = `${batch.name} (re-run ${nowIST()})`;
  return createRun(batch.id, label, batch.lines.map(toInput), user, { forceVersionId });
}

// ---------- live chat intake ----------

export async function getLiveBatch() {
  const existing = await prisma.prBatch.findFirst({ where: { source: 'CHAT' } });
  if (existing) return existing;
  return prisma.prBatch.create({ data: { name: LIVE_BATCH_NAME, source: 'CHAT', uploadedBy: 'system' } });
}

/** Lines already turned into a PO or sourcing request leave the live queue and stop clubbing. */
async function closedLiveLineKeys(batchId: string): Promise<{ keys: Set<string>; consumption: Record<string, number> }> {
  const docs = await prisma.document.findMany({ where: { run: { batchId } } });
  const keys = new Set<string>();
  const consumption: Record<string, number> = {};
  for (const d of docs) {
    d.lineKeys.forEach((k) => keys.add(k));
    const p = d.payload as { contractId?: string | null; contractValue?: number };
    if (d.type === 'PO' && p.contractId) consumption[p.contractId] = (consumption[p.contractId] ?? 0) + (p.contractValue ?? 0);
  }
  return { keys, consumption };
}

export async function runLive(user: string) {
  const batch = await getLiveBatch();
  const lines = await prisma.prLine.findMany({ where: { batchId: batch.id }, orderBy: [{ seq: 'asc' }, { insertedAt: 'asc' }] });
  const { keys, consumption } = await closedLiveLineKeys(batch.id);
  const open = lines.filter((l) => !keys.has(`${l.prNo}/${l.prLine}`));
  return createRun(batch.id, LIVE_BATCH_NAME, open.map(toInput), user, { extraConsumption: consumption });
}

export async function addChatPr(line: Omit<PrLineInput, 'prNo' | 'prLine' | 'createdAt'>, user: string) {
  const batch = await getLiveBatch();
  const n = await nextCounter('CHAT_PR');
  const prNo = `PR-CH-${String(n).padStart(5, '0')}`;
  const input: PrLineInput = { ...line, prNo, prLine: '1', createdAt: nowIST() };
  const seq = await prisma.prLine.count({ where: { batchId: batch.id } });
  await storeLines(batch.id, [input], seq);
  await audit(user, 'PR_CREATED', 'PrLine', prNo, input);
  const { run, result } = await runLive(user);
  return { prNo, input, run, result };
}

// ---------- buyer workspace ----------

export type RequirementStatus = 'PENDING' | 'APPROVED' | 'OVERRIDDEN' | 'RETURNED';

export interface OverrideInput {
  decision: 'PO' | 'SOURCING_REQUEST';
  route: string;
  supplierId?: string | null;
  unitPrice?: number | null;
  suggestedSupplierIds?: string[];
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function getRunView(runId: string) {
  const run = await prisma.decisionRun.findUnique({
    where: { id: runId },
    include: { batch: true, actions: { orderBy: { createdAt: 'asc' } }, documents: { orderBy: { createdAt: 'asc' } } },
  });
  if (!run) throw new HttpError(404, 'Run not found');
  const result = run.result as unknown as EngineResult;
  const status: Record<string, { status: RequirementStatus; document?: string; override?: OverrideInput; lastComment?: string; by?: string; at?: string }> = {};
  for (const a of run.actions) {
    const prev = status[a.groupId] ?? { status: 'PENDING' as RequirementStatus };
    if (a.action === 'APPROVE') status[a.groupId] = { ...prev, status: 'APPROVED', document: (a.payload as { document?: string } | null)?.document, by: a.actor, at: a.createdAt.toISOString() };
    if (a.action === 'OVERRIDE') status[a.groupId] = { ...prev, status: 'OVERRIDDEN', override: (a.payload as unknown as { override: OverrideInput }).override, lastComment: a.comment ?? '', by: a.actor, at: a.createdAt.toISOString() };
    if (a.action === 'RETURN') status[a.groupId] = { ...prev, status: 'RETURNED', lastComment: a.comment ?? '', by: a.actor, at: a.createdAt.toISOString() };
  }
  return { run, result, status };
}

function documentType(route: string, decision: string): string {
  if (decision === 'PO') return 'PO';
  if (['RFQ', 'RFP', 'CAPEX_SOURCING', 'NEW_ITEM_SOURCING'].includes(route)) return route;
  return 'RFQ';
}

async function newDocNumber(type: string): Promise<string> {
  const prefix = type === 'PO' ? 'PO' : type === 'CAPEX_SOURCING' ? 'CAPEX' : type === 'NEW_ITEM_SOURCING' ? 'NIS' : type;
  const n = await nextCounter(`DOC_${prefix}`);
  return `${prefix}-26-${String(n).padStart(5, '0')}`;
}

export async function approve(runId: string, groupId: string, user: string, comment?: string) {
  const { run, result, status } = await getRunView(runId);
  const req = result.requirements.find((r) => r.groupId === groupId);
  if (!req) throw new HttpError(404, `Requirement ${groupId} not found`);
  const st = status[groupId]?.status ?? 'PENDING';
  if (st === 'APPROVED') throw new HttpError(409, `${groupId} is already approved (${status[groupId].document}).`);
  if (st === 'RETURNED') throw new HttpError(409, `${groupId} was returned to the requester.`);
  if (!req.decision) throw new HttpError(409, `${groupId} has no decision to approve (not processed).`);

  const ov = st === 'OVERRIDDEN' ? status[groupId].override! : null;
  const decision = ov?.decision ?? req.decision;
  const route = ov?.route ?? req.route;
  // a PO decided by the engine covers every pending requirement on the same draft PO (7.1)
  let members: RequirementResult[] = [req];
  if (!ov && decision === 'PO' && req.poId) {
    members = result.requirements.filter((r) => r.poId === req.poId && (status[r.groupId]?.status ?? 'PENDING') === 'PENDING');
  }
  const type = documentType(route, decision);
  const number = await newDocNumber(type);
  const supplierId = decision === 'PO' ? ov?.supplierId ?? req.supplierId : null;
  const lines = members.map((m) => {
    const unitPrice = decision === 'PO' ? (ov ? ov.unitPrice ?? m.unitPrice : m.unitPrice) : null;
    return {
      groupId: m.groupId,
      itemCode: m.itemCode,
      description: m.itemDescription,
      quantity: m.totalQuantity,
      uom: m.uom,
      unitPrice,
      lineValue: unitPrice !== null && unitPrice !== undefined ? round2(unitPrice * m.totalQuantity) : m.value,
      prLines: m.lineKeys,
    };
  });
  const contractId = !ov && req.route === 'CONTRACT_PO' ? req.reliedOn[0] ?? null : null;
  const totalValue = round2(lines.reduce((s, l) => s + (l.lineValue ?? 0), 0));
  const doc = await prisma.document.create({
    data: {
      runId,
      type,
      number,
      supplierId,
      groupIds: members.map((m) => m.groupId),
      lineKeys: members.flatMap((m) => m.lineKeys),
      totalValue,
      payload: json({
        route,
        decision,
        plant: req.plant,
        supplierId,
        supplierName: req.supplierName,
        suggestedSupplierIds: decision === 'SOURCING_REQUEST' ? ov?.suggestedSupplierIds ?? req.suggestedSupplierIds : [],
        lines,
        policyVersion: req.policyVersion,
        clause: req.clause,
        reliedOn: req.reliedOn,
        approvals: req.approvals,
        contractId,
        contractValue: contractId ? totalValue : 0,
        overridden: !!ov,
      }),
      createdBy: user,
    },
  });
  for (const m of members) {
    await prisma.buyerAction.create({ data: { runId, groupId: m.groupId, action: 'APPROVE', actor: user, comment: comment ?? null, payload: json({ document: number }) } });
  }
  await audit(user, 'DECISION_APPROVED', 'Requirement', `${run.id}:${groupId}`, { document: number, type, groups: members.map((m) => m.groupId), overridden: !!ov });
  return doc;
}

export async function override(runId: string, groupId: string, user: string, comment: string, input: OverrideInput) {
  if (!comment || comment.trim().length < 5) throw new HttpError(400, 'An override needs a written reason (at least a few words).');
  const { result, status } = await getRunView(runId);
  const req = result.requirements.find((r) => r.groupId === groupId);
  if (!req) throw new HttpError(404, `Requirement ${groupId} not found`);
  if (status[groupId]?.status === 'APPROVED') throw new HttpError(409, `${groupId} is already approved.`);
  const ctx = await getContext();
  const versions = await getApprovedVersions();
  const def = parsePolicyDefinition(resolvePolicyVersion(versions, req.requirementDate).version.definition);
  if (input.decision === 'PO') {
    if (!input.supplierId) throw new HttpError(400, 'A PO override needs a supplier.');
    if (!isEligible(ctx, def, input.supplierId)) throw new HttpError(400, `Supplier ${input.supplierId} is not Active and cannot receive a PO (policy 5.7).`);
    if (!input.unitPrice || input.unitPrice <= 0) throw new HttpError(400, 'A PO override needs a unit price.');
  } else {
    for (const s of input.suggestedSupplierIds ?? []) {
      if (!isEligible(ctx, def, s)) throw new HttpError(400, `Supplier ${s} is not Active and cannot be suggested (policy 5.7).`);
    }
  }
  const original = { decision: req.decision, route: req.route, supplierId: req.supplierId, unitPrice: req.unitPrice, suggestedSupplierIds: req.suggestedSupplierIds, clause: req.clause, policyVersion: req.policyVersion };
  await prisma.buyerAction.create({ data: { runId, groupId, action: 'OVERRIDE', actor: user, comment, payload: json({ original, override: input }) } });
  await audit(user, 'DECISION_OVERRIDDEN', 'Requirement', `${runId}:${groupId}`, { original, override: input, comment });
}

export async function returnToRequester(runId: string, groupId: string, user: string, comment: string) {
  if (!comment || comment.trim().length < 5) throw new HttpError(400, 'Say why the requirement goes back to the requester.');
  const { status } = await getRunView(runId);
  if (status[groupId]?.status === 'APPROVED') throw new HttpError(409, `${groupId} is already approved.`);
  await prisma.buyerAction.create({ data: { runId, groupId, action: 'RETURN', actor: user, comment } });
  await audit(user, 'REQUIREMENT_RETURNED', 'Requirement', `${runId}:${groupId}`, { comment });
}
