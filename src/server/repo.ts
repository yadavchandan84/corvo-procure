import type { Prisma } from '@prisma/client';
import { prisma } from './db';
import type { Contract, MasterData, PolicyVersionRecord } from '@/engine/types';
import { buildContext, type DataContext } from '@/engine/context';
import { parsePolicyDefinition, type PolicyDefinition } from '@/engine/policy/schema';
import { POLICY_V5, POLICY_V5_EFFECTIVE_FROM, POLICY_V5_VERSION } from '@/engine/policy/default-v5';

export async function audit(actor: string, action: string, entityType: string, entityId: string, details?: unknown) {
  await prisma.auditLog.create({
    data: { actor, action, entityType, entityId, details: (details ?? undefined) as Prisma.InputJsonValue | undefined },
  });
}

export async function nextCounter(name: string): Promise<number> {
  const c = await prisma.counter.upsert({ where: { name }, create: { name, value: 1 }, update: { value: { increment: 1 } } });
  return c.value;
}

export async function loadMasterData(): Promise<MasterData> {
  const [items, suppliers, poHistory, plants, contracts] = await Promise.all([
    prisma.item.findMany({ orderBy: { code: 'asc' } }),
    prisma.supplier.findMany({ orderBy: { id: 'asc' } }),
    prisma.poHistory.findMany(),
    prisma.plant.findMany(),
    prisma.contract.findMany({ include: { lines: true }, orderBy: { id: 'asc' } }),
  ]);
  return {
    items,
    suppliers,
    poHistory,
    plants,
    contracts: contracts.map(
      (c): Contract => ({
        id: c.id,
        supplierId: c.supplierId,
        supplierName: c.supplierName,
        startDate: c.startDate,
        endDate: c.endDate,
        valueCap: c.valueCap,
        consumedValue: c.consumedValue,
        source: c.source,
        lines: c.lines.map((l) => ({ itemCode: l.itemCode, description: l.description, uom: l.uom, rate: l.rate })),
      }),
    ),
  };
}

let ctxCache: { key: string; ctx: DataContext } | null = null;

/** Master data context, cached per warm server instance until master data changes. */
export async function getContext(): Promise<DataContext> {
  const [items, suppliers, pos, contracts, lines, lastContract] = await Promise.all([
    prisma.item.count(),
    prisma.supplier.count(),
    prisma.poHistory.count(),
    prisma.contract.count(),
    prisma.contractLine.count(),
    prisma.auditLog.findFirst({ where: { entityType: { in: ['MasterData', 'Contract'] } }, orderBy: { at: 'desc' }, select: { at: true } }),
  ]);
  const key = `${items}/${suppliers}/${pos}/${contracts}/${lines}/${lastContract?.at.toISOString() ?? ''}`;
  if (ctxCache?.key === key) return ctxCache.ctx;
  const ctx = buildContext(await loadMasterData());
  ctxCache = { key, ctx };
  return ctx;
}

export function invalidateContext() {
  ctxCache = null;
}

/** Seed policy v5.0 as the first approved version if the store is empty. */
export async function ensureSeedPolicy(): Promise<void> {
  const count = await prisma.policyVersion.count();
  if (count > 0) return;
  const def = parsePolicyDefinition(POLICY_V5);
  const v = await prisma.policyVersion.create({
    data: {
      version: POLICY_V5_VERSION,
      effectiveFrom: POLICY_V5_EFFECTIVE_FROM,
      status: 'APPROVED',
      definition: def as unknown as Prisma.InputJsonValue,
      changeSummary: [{ kind: 'parameter', path: '', text: 'Initial version: Corvo Procurement Policy v5.0 (CORVO-PROC-POL-04) encoded as data.' }] as unknown as Prisma.InputJsonValue,
      sourceType: 'SEED',
      sourceName: 'Corvo_Procurement_Policy.pdf (v5.0)',
      createdBy: 'system',
      approvedBy: 'system (baseline)',
      approvedAt: new Date('2026-04-01T00:00:00+05:30'),
    },
  });
  await audit('system', 'POLICY_SEEDED', 'PolicyVersion', v.id, { version: POLICY_V5_VERSION });
}

export function toRecord(v: { id: string; version: string; effectiveFrom: string; approvedAt: Date | null; definition: unknown }): PolicyVersionRecord {
  return {
    id: v.id,
    version: v.version,
    effectiveFrom: v.effectiveFrom,
    approvedAt: v.approvedAt ? v.approvedAt.toISOString() : null,
    definition: parsePolicyDefinition(v.definition) as PolicyDefinition,
  };
}

export async function getApprovedVersions(): Promise<PolicyVersionRecord[]> {
  await ensureSeedPolicy();
  const rows = await prisma.policyVersion.findMany({ where: { status: 'APPROVED' }, orderBy: [{ effectiveFrom: 'asc' }, { approvedAt: 'asc' }] });
  return rows.map(toRecord);
}

/** The version a new draft should be based on: the approved version with the latest effective date. */
export async function getLatestApproved() {
  await ensureSeedPolicy();
  return prisma.policyVersion.findFirst({ where: { status: 'APPROVED' }, orderBy: [{ effectiveFrom: 'desc' }, { approvedAt: 'desc' }] });
}

export async function masterDataCounts() {
  const [items, suppliers, poHistory, plants, contracts, pdfContracts] = await Promise.all([
    prisma.item.count(),
    prisma.supplier.count(),
    prisma.poHistory.count(),
    prisma.plant.count(),
    prisma.contract.count(),
    prisma.contract.count({ where: { source: { not: 'REGISTER' } } }),
  ]);
  return { items, suppliers, poHistory, plants, contracts, pdfContracts };
}

/** Replace master data from parsed CSVs (each part optional). */
export async function replaceMasterData(data: Partial<MasterData>, actor: string) {
  await prisma.$transaction(
    async (tx) => {
      if (data.items) {
        await tx.item.deleteMany();
        await tx.item.createMany({ data: data.items });
      }
      if (data.suppliers) {
        await tx.supplier.deleteMany();
        await tx.supplier.createMany({ data: data.suppliers });
      }
      if (data.plants) {
        await tx.plant.deleteMany();
        await tx.plant.createMany({ data: data.plants });
      }
      if (data.poHistory) {
        await tx.poHistory.deleteMany();
        await tx.poHistory.createMany({ data: data.poHistory });
      }
      if (data.contracts) {
        // the register is replaced; PDF/manual contracts added by buyers are kept unless re-supplied
        const ids = data.contracts.map((c) => c.id);
        await tx.contract.deleteMany({ where: { OR: [{ source: 'REGISTER' }, { id: { in: ids } }] } });
        for (const c of data.contracts) {
          await tx.contract.create({
            data: {
              id: c.id,
              supplierId: c.supplierId,
              supplierName: c.supplierName,
              startDate: c.startDate,
              endDate: c.endDate,
              valueCap: c.valueCap,
              consumedValue: c.consumedValue,
              source: c.source,
              addedBy: actor,
              lines: { create: c.lines },
            },
          });
        }
      }
    },
    { timeout: 60000 },
  );
  invalidateContext();
  await audit(actor, 'MASTER_DATA_IMPORTED', 'MasterData', 'master', {
    items: data.items?.length,
    suppliers: data.suppliers?.length,
    plants: data.plants?.length,
    poHistory: data.poHistory?.length,
    contracts: data.contracts?.length,
  });
}
