import { NextResponse } from 'next/server';
import { actor, handle } from '@/server/http';
import { prisma } from '@/server/db';
import { audit, invalidateContext } from '@/server/repo';
import { HttpError } from '@/server/runs';
import { parseDate } from '@/engine/dates';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  const contracts = await prisma.contract.findMany({ include: { lines: true }, orderBy: [{ startDate: 'asc' }, { id: 'asc' }] });
  const suppliers = await prisma.supplier.findMany({ select: { id: true, name: true, status: true } });
  const status = new Map(suppliers.map((s) => [s.id, s.status]));
  return NextResponse.json(contracts.map((c) => ({ ...c, supplierStatus: status.get(c.supplierId) ?? 'Unknown' })));
});

interface ContractBody {
  id: string;
  supplierId: string;
  supplierName?: string;
  startDate: string;
  endDate: string;
  valueCap: number;
  consumedValue?: number;
  source?: 'PDF' | 'MANUAL';
  fileName?: string;
  extractedText?: string;
  lines: { itemCode: string; description?: string; uom?: string; rate: number }[];
}

/** Add a contract that exists only as a signed PDF (after extraction or manual entry). */
export const POST = handle(async (req: Request) => {
  const b = (await req.json()) as ContractBody;
  const user = actor(req);
  const errors: string[] = [];
  if (!b.id?.trim()) errors.push('contract id');
  const supplier = b.supplierId ? await prisma.supplier.findUnique({ where: { id: b.supplierId } }) : null;
  if (!supplier) errors.push('a supplier id that exists in the supplier master');
  const start = parseDate(b.startDate);
  const end = parseDate(b.endDate);
  if (!start || !end) errors.push('start and end dates (YYYY-MM-DD)');
  if (start && end && end < start) errors.push('an end date on or after the start date');
  if (!(b.valueCap > 0)) errors.push('a value ceiling above zero');
  if (!b.lines?.length) errors.push('at least one item line');
  const items = await prisma.item.findMany({ where: { code: { in: (b.lines ?? []).map((l) => l.itemCode) } } });
  for (const l of b.lines ?? []) {
    if (!items.find((i) => i.code === l.itemCode)) errors.push(`item ${l.itemCode} to exist in the item master`);
    if (!(l.rate > 0)) errors.push(`a rate for ${l.itemCode}`);
  }
  if (errors.length) throw new HttpError(400, `The contract needs ${errors.join(', ')}.`);
  if (await prisma.contract.findUnique({ where: { id: b.id } })) throw new HttpError(409, `Contract ${b.id} already exists.`);
  const c = await prisma.contract.create({
    data: {
      id: b.id.trim(),
      supplierId: b.supplierId,
      supplierName: b.supplierName || supplier!.name,
      startDate: start!,
      endDate: end!,
      valueCap: b.valueCap,
      // 4.2: contracts signed after the register update start at zero consumption
      consumedValue: b.consumedValue ?? 0,
      source: b.source ?? 'MANUAL',
      fileName: b.fileName ?? null,
      extractedText: b.extractedText?.slice(0, 20000) ?? null,
      addedBy: user,
      lines: { create: b.lines.map((l) => ({ itemCode: l.itemCode, description: l.description || items.find((i) => i.code === l.itemCode)!.description, uom: l.uom || items.find((i) => i.code === l.itemCode)!.uom, rate: l.rate })) },
    },
    include: { lines: true },
  });
  invalidateContext();
  await audit(user, 'CONTRACT_ADDED', 'Contract', c.id, { source: c.source, supplierId: c.supplierId, startDate: c.startDate, endDate: c.endDate, valueCap: c.valueCap, lines: c.lines.length });
  return NextResponse.json(c);
});
