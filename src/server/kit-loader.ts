import fs from 'node:fs';
import path from 'node:path';
import type { Contract, MasterData } from '@/engine/types';
import { parseContracts, parseItems, parsePlants, parsePoHistory, parseSuppliers } from '@/engine/csv';
import { extractContractFromText, reconcileContract } from '@/engine/contract-text';
import { pdfToText } from './pdf';

/**
 * Load master data from a local copy of the task kit (used by the seed script, CLI and tests).
 * The kit itself is never committed. Contracts that exist only as signed PDFs are extracted from
 * contracts/pdf and added with consumed value 0 (policy 4.2 / 4.4).
 */
export async function loadKit(kitDir: string): Promise<{ data: MasterData; notes: string[] }> {
  const read = (...p: string[]) => fs.readFileSync(path.join(kitDir, ...p), 'utf8');
  const items = parseItems(read('master_data', 'item_master.csv'));
  const suppliers = parseSuppliers(read('master_data', 'supplier_master.csv'));
  const poHistory = parsePoHistory(read('master_data', 'po_history.csv'));
  const plants = parsePlants(read('master_data', 'plants.csv'));
  const contracts: Contract[] = parseContracts(read('contracts', 'contract_register.csv'), read('contracts', 'contract_lines.csv'));
  const notes: string[] = [];

  const pdfDir = path.join(kitDir, 'contracts', 'pdf');
  if (fs.existsSync(pdfDir)) {
    const itemMap = new Map(items.map((i) => [i.code, { description: i.description, uom: i.uom }]));
    for (const f of fs.readdirSync(pdfDir).filter((x) => x.toLowerCase().endsWith('.pdf')).sort()) {
      const text = await pdfToText(fs.readFileSync(path.join(pdfDir, f)));
      const ex = extractContractFromText(text, itemMap);
      const id = ex.contract.id ?? f.replace(/\.pdf$/i, '');
      const reg = contracts.find((c) => c.id === id);
      if (reg) {
        const diffs = reconcileContract(reg, ex.contract);
        if (diffs.length) notes.push(`${id}: register and PDF differ: ${diffs.join('; ')}`);
        continue;
      }
      if (ex.missing.length) {
        notes.push(`${f}: could not extract ${ex.missing.join(', ')}; skipped`);
        continue;
      }
      contracts.push({
        id,
        supplierId: ex.contract.supplierId!,
        supplierName: ex.contract.supplierName ?? suppliers.find((s) => s.id === ex.contract.supplierId)?.name ?? '',
        startDate: ex.contract.startDate!,
        endDate: ex.contract.endDate!,
        valueCap: ex.contract.valueCap!,
        consumedValue: 0,
        source: 'PDF',
        lines: ex.contract.lines,
      });
      notes.push(`${id}: PDF-only contract added (${ex.contract.supplierId}, ${ex.contract.startDate} to ${ex.contract.endDate}, ${ex.contract.lines.length} lines)`);
    }
  }
  return { data: { items, suppliers, poHistory, plants, contracts }, notes };
}
