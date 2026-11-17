import { NextResponse } from 'next/server';
import { handle } from '@/server/http';
import { prisma } from '@/server/db';
import { pdfToText } from '@/server/pdf';
import { HttpError } from '@/server/runs';
import { extractContractFromText, reconcileContract } from '@/engine/contract-text';
import type { Contract } from '@/engine/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Read a signed contract PDF and return the extracted fields for the buyer to check and save. */
export const POST = handle(async (req: Request) => {
  const form = await req.formData();
  const file = form.get('file') as File | null;
  if (!file || typeof file === 'string') throw new HttpError(400, 'Attach the contract PDF as "file".');
  const text = file.name.toLowerCase().endsWith('.pdf') ? await pdfToText(await file.arrayBuffer()) : await file.text();
  const items = await prisma.item.findMany();
  const ex = extractContractFromText(text, new Map(items.map((i) => [i.code, { description: i.description, uom: i.uom }])));
  const supplier = ex.contract.supplierId ? await prisma.supplier.findUnique({ where: { id: ex.contract.supplierId } }) : null;
  const existing = ex.contract.id ? await prisma.contract.findUnique({ where: { id: ex.contract.id }, include: { lines: true } }) : null;
  const differences = existing ? reconcileContract({ ...existing, lines: existing.lines } as unknown as Contract, ex.contract) : [];
  const unknownItems = ex.contract.lines.filter((l) => !items.find((i) => i.code === l.itemCode)).map((l) => l.itemCode);
  return NextResponse.json({
    fileName: file.name,
    text,
    ...ex,
    supplier: supplier ? { id: supplier.id, name: supplier.name, status: supplier.status } : null,
    existing: existing ? { id: existing.id, source: existing.source } : null,
    differences,
    unknownItems,
  });
});
