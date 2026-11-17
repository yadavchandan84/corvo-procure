import Papa from 'papaparse';
import type { Contract, ContractLine, DecisionRow, Item, Plant, PoRecord, PrLineInput, PreferredSupplierEntry, Supplier } from './types';
import { parseDate } from './dates';

export type CsvRecord = Record<string, string>;

function normHeader(h: string): string {
  return h
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function parseCsv(text: string): CsvRecord[] {
  const res = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: normHeader,
  });
  return res.data.map((row) => {
    const out: CsvRecord = {};
    for (const [k, v] of Object.entries(row)) out[k] = v === undefined || v === null ? '' : String(v).trim();
    return out;
  });
}

function pick(row: CsvRecord, ...names: string[]): string {
  for (const n of names) if (row[n] !== undefined && row[n] !== '') return row[n];
  return '';
}

function toNum(v: string): number {
  const n = Number(String(v).replace(/[,₹\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export const PR_BATCH_COLUMNS = [
  'pr_no',
  'pr_line',
  'created_at',
  'requester',
  'department',
  'plant',
  'item_code',
  'description',
  'quantity',
  'uom',
  'estimated_unit_price',
  'need_by_date',
  'urgency',
] as const;

/** PR batch CSV in the sample format (header names are matched case/space-insensitively). */
export function parsePrBatch(text: string): { lines: PrLineInput[]; errors: string[] } {
  const rows = parseCsv(text);
  const errors: string[] = [];
  if (!rows.length) errors.push('The file has no data rows.');
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  for (const req of ['pr_no', 'created_at', 'plant', 'quantity']) {
    if (rows.length && !headers.includes(req) && !(req === 'created_at' && headers.includes('created'))) errors.push(`Missing column "${req}".`);
  }
  const lines = rows.map((r, i) => ({
    prNo: pick(r, 'pr_no', 'pr_number', 'pr'),
    prLine: pick(r, 'pr_line', 'line', 'line_no') || '1',
    createdAt: pick(r, 'created_at', 'created', 'creation_time', 'created_on'),
    requester: pick(r, 'requester', 'requested_by'),
    department: pick(r, 'department', 'dept'),
    plant: pick(r, 'plant', 'plant_code'),
    itemCode: pick(r, 'item_code', 'item'),
    description: pick(r, 'description', 'item_description', 'desc'),
    quantity: pick(r, 'quantity', 'qty'),
    uom: pick(r, 'uom', 'unit'),
    estimatedUnitPrice: pick(r, 'estimated_unit_price', 'est_unit_price', 'estimated_price', 'unit_price'),
    needByDate: pick(r, 'need_by_date', 'need_by', 'required_by', 'needby'),
    urgency: pick(r, 'urgency', 'priority') || 'Normal',
    _row: i,
  }));
  return { lines: lines.map(({ _row, ...l }) => (void _row, l)), errors };
}

export function parseItems(text: string): Item[] {
  return parseCsv(text)
    .filter((r) => r.item_code)
    .map((r) => ({
      code: r.item_code.toUpperCase(),
      description: r.description,
      uom: r.uom,
      category: r.category,
      itemType: r.item_type,
      standardPrice: toNum(r.standard_price),
    }));
}

export function parseSuppliers(text: string): Supplier[] {
  return parseCsv(text)
    .filter((r) => r.supplier_id)
    .map((r) => ({
      id: r.supplier_id,
      name: r.name,
      city: r.city,
      categories: (r.categories || '').split(/[;|]/).map((c) => c.trim()).filter(Boolean),
      status: r.status,
      onTimePct: toNum(r.on_time_pct),
      qualityRating: toNum(r.quality_rating),
    }));
}

export function parsePoHistory(text: string): PoRecord[] {
  return parseCsv(text)
    .filter((r) => r.po_number && r.item_code)
    .map((r) => ({
      poNumber: r.po_number,
      poDate: parseDate(r.po_date) ?? r.po_date,
      supplierId: r.supplier_id,
      itemCode: r.item_code.toUpperCase(),
      quantity: toNum(r.quantity),
      uom: r.uom,
      unitPrice: toNum(r.unit_price),
      plant: r.plant,
      deliveredOnTime: /^(true|yes|1|y)$/i.test(r.delivered_on_time),
    }));
}

export function parsePlants(text: string): Plant[] {
  return parseCsv(text)
    .filter((r) => r.plant)
    .map((r) => ({ code: r.plant.toUpperCase(), name: r.name }));
}

export function parseContracts(registerText: string, linesText: string): Contract[] {
  const lines = parseCsv(linesText).filter((r) => r.contract_id && r.item_code);
  const byContract = new Map<string, ContractLine[]>();
  for (const l of lines) {
    const list = byContract.get(l.contract_id) ?? [];
    list.push({ itemCode: l.item_code.toUpperCase(), description: l.description, uom: l.uom, rate: toNum(l.rate) });
    byContract.set(l.contract_id, list);
  }
  return parseCsv(registerText)
    .filter((r) => r.contract_id)
    .map((r) => ({
      id: r.contract_id,
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      startDate: parseDate(r.start_date) ?? r.start_date,
      endDate: parseDate(r.end_date) ?? r.end_date,
      valueCap: toNum(r.value_cap),
      consumedValue: toNum(r.consumed_value),
      source: 'REGISTER' as const,
      lines: byContract.get(r.contract_id) ?? [],
    }));
}

export const DECISION_COLUMNS: (keyof DecisionRow)[] = [
  'pr_no',
  'pr_line',
  'resolved_item_code',
  'group_id',
  'po_id',
  'decision',
  'route',
  'supplier_id',
  'unit_price',
  'group_value_inr',
  'suggested_supplier_ids',
  'policy_version',
  'reason',
];

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  return Papa.unparse({ fields: columns, data: rows.map((r) => columns.map((c) => (r[c] === null || r[c] === undefined ? '' : String(r[c])))) }, { newline: '\n' }) + '\n';
}

export function decisionsToCsv(rows: DecisionRow[]): string {
  return toCsv(rows as unknown as Record<string, unknown>[], DECISION_COLUMNS as string[]);
}

export const PREFERRED_COLUMNS = ['item_code', 'rank', 'supplier_id', 'reference_price'];

export function preferredToCsv(lists: { itemCode: string; entries: PreferredSupplierEntry[] }[], topN: number): string {
  const rows: Record<string, unknown>[] = [];
  for (const l of lists) {
    for (const e of l.entries.slice(0, topN)) {
      rows.push({ item_code: l.itemCode, rank: e.rank, supplier_id: e.supplierId, reference_price: e.referencePrice ?? '' });
    }
  }
  return toCsv(rows, PREFERRED_COLUMNS);
}
