import type { Contract, ContractLine } from './types';
import { parseDate } from './dates';

/**
 * Extract a rate contract from the text of a signed contract PDF. Works on the Corvo contract
 * layout (contract number, supplier id, term, value ceiling, Schedule A table) and tolerates the
 * different line breaks that PDF text extractors produce. Returns what it found plus the fields it
 * could not find, so the buyer can complete them by hand before saving.
 */
export interface ExtractedContract {
  contract: Partial<Contract> & { lines: ContractLine[] };
  missing: string[];
  confidence: 'high' | 'medium' | 'low';
}

const UOMS = ['NOS', 'KG', 'PAIR', 'CYL', 'LTR', 'MTR', 'SET', 'ROL', 'REAM', 'JOB', 'MON', 'BKT', 'BRL', 'QTR', 'PCS', 'EA'];

function money(s: string): number {
  return Number(s.replace(/[,\s]/g, ''));
}

export function extractContractFromText(raw: string, knownItems?: Map<string, { description: string; uom: string }>): ExtractedContract {
  const text = raw.replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  const flat = text.replace(/\s*\n\s*/g, ' ');
  const missing: string[] = [];

  const id = flat.match(/Contract\s*No\.?\s*[:#]?\s*([A-Z]{1,4}-\d{4}-\d{2,4})/i)?.[1] ?? flat.match(/\b(RC-\d{4}-\d{2,4})\b/)?.[1];
  const supplierId = flat.match(/Supplier\s*ID\s*[:#]?\s*(S\d{2,4})/i)?.[1];
  let supplierName = flat.match(/\band\s+(.+?),\s*[A-Za-z .]+\s*\(Supplier\s*ID/i)?.[1]?.trim();
  if (!supplierName) supplierName = flat.match(/For\s+(?!Corvo)(.+?)\s+Authorised Signatory/i)?.[1]?.trim();
  const term = flat.match(/valid\s+from\s+(\d{4}-\d{2}-\d{2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})\s+(?:to|until|till)\s+(\d{4}-\d{2}-\d{2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})/i);
  const startDate = term ? parseDate(term[1]) : null;
  const endDate = term ? parseDate(term[2]) : null;
  const cap = flat.match(/(?:shall\s+not\s+exceed|ceiling[^0-9]{0,40})\s*(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d+)?)/i)?.[1];

  // Schedule A rows: "<n> ITM-xxxx <description> <UOM> <rate>"
  const lines: ContractLine[] = [];
  // the schedule heading is the last "Schedule A" mention (the body also refers to it)
  const parts = flat.split(/Schedule\s*A/i);
  const schedule = parts.length > 1 ? parts[parts.length - 1] : flat;
  const uomAlt = UOMS.join('|');
  const rowRe = new RegExp(`(?:\\b\\d{1,3}\\s+)?(ITM-\\d{4})\\s+(.+?)\\s+(${uomAlt})\\s+([\\d,]+(?:\\.\\d{1,2})?)(?=\\s|$)`, 'g');
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(schedule))) {
    const code = m[1];
    if (lines.some((l) => l.itemCode === code)) continue;
    lines.push({ itemCode: code, description: m[2].trim(), uom: m[3], rate: money(m[4]) });
  }
  // Fallback: item codes found but the row regex failed (unusual layout) -> use item master text
  if (!lines.length && knownItems) {
    for (const code of new Set(schedule.match(/ITM-\d{4}/g) ?? [])) {
      const after = schedule.slice(schedule.indexOf(code));
      const rate = after.match(/\s([\d,]+\.\d{2})\b/)?.[1];
      const item = knownItems.get(code);
      if (rate && item) lines.push({ itemCode: code, description: item.description, uom: item.uom, rate: money(rate) });
    }
  }

  if (!id) missing.push('contract id');
  if (!supplierId) missing.push('supplier id');
  if (!startDate) missing.push('start date');
  if (!endDate) missing.push('end date');
  if (!cap) missing.push('value ceiling');
  if (!lines.length) missing.push('item lines');

  return {
    contract: {
      id,
      supplierId,
      supplierName,
      startDate: startDate ?? undefined,
      endDate: endDate ?? undefined,
      valueCap: cap ? money(cap) : undefined,
      consumedValue: 0,
      lines,
    },
    missing,
    confidence: missing.length === 0 ? 'high' : missing.length <= 2 ? 'medium' : 'low',
  };
}

/** Compare a register contract with its signed PDF and list differences. */
export function reconcileContract(register: Contract, pdf: Partial<Contract> & { lines: ContractLine[] }): string[] {
  const diffs: string[] = [];
  if (pdf.supplierId && pdf.supplierId !== register.supplierId) diffs.push(`supplier ${register.supplierId} in register vs ${pdf.supplierId} in PDF`);
  if (pdf.startDate && pdf.startDate !== register.startDate) diffs.push(`start ${register.startDate} vs ${pdf.startDate}`);
  if (pdf.endDate && pdf.endDate !== register.endDate) diffs.push(`end ${register.endDate} vs ${pdf.endDate}`);
  if (pdf.valueCap !== undefined && Math.abs(pdf.valueCap - register.valueCap) > 0.5) diffs.push(`ceiling ${register.valueCap} vs ${pdf.valueCap}`);
  for (const l of pdf.lines) {
    const r = register.lines.find((x) => x.itemCode === l.itemCode);
    if (!r) diffs.push(`${l.itemCode} in PDF but not in register lines`);
    else if (Math.abs(r.rate - l.rate) > 0.005) diffs.push(`${l.itemCode} rate ${r.rate} vs ${l.rate}`);
  }
  for (const r of register.lines) if (!pdf.lines.some((l) => l.itemCode === r.itemCode)) diffs.push(`${r.itemCode} in register but not in PDF`);
  return diffs;
}
