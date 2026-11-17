import { NextResponse } from 'next/server';
import { actor, handle } from '@/server/http';
import { masterDataCounts, replaceMasterData } from '@/server/repo';
import { HttpError } from '@/server/runs';
import { parseContracts, parseItems, parsePlants, parsePoHistory, parseSuppliers } from '@/engine/csv';
import type { MasterData } from '@/engine/types';
import { llmInfo } from '@/server/llm';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const GET = handle(async () => NextResponse.json({ counts: await masterDataCounts(), ai: llmInfo() }));

/**
 * Import master data CSVs (multipart). Fields (all optional): item_master, supplier_master,
 * po_history, plants, contract_register + contract_lines (together).
 */
export const POST = handle(async (req: Request) => {
  const form = await req.formData();
  const text = async (k: string) => {
    const f = form.get(k);
    return f && typeof f !== 'string' ? await f.text() : null;
  };
  const data: Partial<MasterData> = {};
  const items = await text('item_master');
  const suppliers = await text('supplier_master');
  const po = await text('po_history');
  const plants = await text('plants');
  const register = await text('contract_register');
  const lines = await text('contract_lines');
  if (items) data.items = parseItems(items);
  if (suppliers) data.suppliers = parseSuppliers(suppliers);
  if (po) data.poHistory = parsePoHistory(po);
  if (plants) data.plants = parsePlants(plants);
  if (register || lines) {
    if (!register || !lines) throw new HttpError(400, 'Upload contract_register and contract_lines together.');
    data.contracts = parseContracts(register, lines);
  }
  if (!Object.keys(data).length) throw new HttpError(400, 'No files received.');
  await replaceMasterData(data, actor(req));
  return NextResponse.json({ ok: true, counts: await masterDataCounts() });
});
