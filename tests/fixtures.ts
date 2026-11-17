/**
 * Small synthetic data set (not the task kit) for unit tests. Everything here is made up.
 */
import type { MasterData, PolicyVersionRecord, PrLineInput } from '@/engine/types';
import { POLICY_V5 } from '@/engine/policy/default-v5';
import { parsePolicyDefinition, type PolicyDefinitionInput } from '@/engine/policy/schema';

export const data: MasterData = {
  plants: [
    { code: 'P1', name: 'Plant one' },
    { code: 'P2', name: 'Plant two' },
  ],
  items: [
    { code: 'ITM-0001', description: 'Widget bolt M8x20', uom: 'NOS', category: 'Fasteners', itemType: 'Material', standardPrice: 10 },
    { code: 'ITM-0002', description: 'Widget bolt M12x40', uom: 'NOS', category: 'Fasteners', itemType: 'Material', standardPrice: 20 },
    { code: 'ITM-0003', description: 'Coolant blue 20L', uom: 'LTR', category: 'Fluids', itemType: 'Material', standardPrice: 100 },
    { code: 'ITM-0004', description: 'Lathe machine 6 ft', uom: 'NOS', category: 'Machines', itemType: 'Capex', standardPrice: 900000 },
    { code: 'ITM-0005', description: 'Cleaning service (monthly)', uom: 'MON', category: 'Services', itemType: 'Service', standardPrice: 50000 },
  ],
  suppliers: [
    { id: 'S1', name: 'Alpha', city: 'X', categories: ['Fasteners'], status: 'Active', onTimePct: 90, qualityRating: 4 },
    { id: 'S2', name: 'Beta', city: 'X', categories: ['Fasteners'], status: 'Active', onTimePct: 70, qualityRating: 3 },
    { id: 'S3', name: 'Gamma', city: 'X', categories: ['Fasteners'], status: 'Blocked', onTimePct: 99, qualityRating: 5 },
    { id: 'S4', name: 'Delta', city: 'X', categories: ['Fluids'], status: 'Active', onTimePct: 80, qualityRating: 4 },
    { id: 'S5', name: 'Eps', city: 'X', categories: ['Machines'], status: 'Active', onTimePct: 85, qualityRating: 4 },
    { id: 'S6', name: 'Zeta', city: 'X', categories: ['Machines'], status: 'Active', onTimePct: 95, qualityRating: 4.5 },
    { id: 'S7', name: 'Eta', city: 'X', categories: ['Fluids'], status: 'Inactive', onTimePct: 99, qualityRating: 5 },
  ],
  poHistory: [
    { poNumber: '1', poDate: '2026-09-01', supplierId: 'S1', itemCode: 'ITM-0001', quantity: 10, uom: 'NOS', unitPrice: 9, plant: 'P1', deliveredOnTime: true },
    { poNumber: '2', poDate: '2026-10-01', supplierId: 'S2', itemCode: 'ITM-0001', quantity: 10, uom: 'NOS', unitPrice: 9.5, plant: 'P1', deliveredOnTime: true },
    { poNumber: '3', poDate: '2026-08-01', supplierId: 'S1', itemCode: 'ITM-0001', quantity: 10, uom: 'NOS', unitPrice: 8.5, plant: 'P2', deliveredOnTime: true },
    { poNumber: '4', poDate: '2026-10-10', supplierId: 'S7', itemCode: 'ITM-0003', quantity: 10, uom: 'LTR', unitPrice: 95, plant: 'P1', deliveredOnTime: true },
    { poNumber: '5', poDate: '2025-01-10', supplierId: 'S4', itemCode: 'ITM-0003', quantity: 10, uom: 'LTR', unitPrice: 90, plant: 'P1', deliveredOnTime: true },
  ],
  contracts: [
    {
      id: 'RC-1',
      supplierId: 'S1',
      supplierName: 'Alpha',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      valueCap: 10000,
      consumedValue: 9000,
      source: 'REGISTER',
      lines: [{ itemCode: 'ITM-0002', description: 'Widget bolt M12x40', uom: 'NOS', rate: 18 }],
    },
    {
      id: 'RC-2',
      supplierId: 'S2',
      supplierName: 'Beta',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      valueCap: 100000,
      consumedValue: 0,
      source: 'REGISTER',
      lines: [{ itemCode: 'ITM-0002', description: 'Widget bolt M12x40', uom: 'NOS', rate: 19 }],
    },
    {
      id: 'RC-3',
      supplierId: 'S3',
      supplierName: 'Gamma',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      valueCap: 100000,
      consumedValue: 0,
      source: 'REGISTER',
      lines: [{ itemCode: 'ITM-0002', description: 'Widget bolt M12x40', uom: 'NOS', rate: 5 }],
    },
  ],
};

export function v5(id = 'v5', effectiveFrom = '2026-04-01'): PolicyVersionRecord {
  return { id, version: '5.0', effectiveFrom, approvedAt: '2026-03-01', definition: parsePolicyDefinition(POLICY_V5) };
}

export function version(id: string, ver: string, effectiveFrom: string, mutate: (d: PolicyDefinitionInput) => void): PolicyVersionRecord {
  const def = JSON.parse(JSON.stringify(POLICY_V5)) as PolicyDefinitionInput;
  mutate(def);
  return { id, version: ver, effectiveFrom, approvedAt: '2026-11-01', definition: parsePolicyDefinition(def) };
}

let n = 0;
export function line(p: Partial<PrLineInput>): PrLineInput {
  n += 1;
  return {
    prNo: p.prNo ?? `PR-${String(n).padStart(4, '0')}`,
    prLine: p.prLine ?? '1',
    createdAt: p.createdAt ?? '2026-11-02 10:00',
    requester: p.requester ?? 'Tester',
    department: p.department ?? 'Stores',
    plant: p.plant ?? 'P1',
    itemCode: p.itemCode ?? '',
    description: p.description ?? '',
    quantity: p.quantity ?? '1',
    uom: p.uom ?? '',
    estimatedUnitPrice: p.estimatedUnitPrice ?? '',
    needByDate: p.needByDate ?? '2026-11-20',
    urgency: p.urgency ?? 'Normal',
  };
}

/** v5 with the synthetic plants in scope. */
export function v5Synthetic(): PolicyVersionRecord {
  return version('v5', '5.0', '2026-04-01', (d) => {
    d.scope = { plants: ['P1', 'P2'] };
  });
}
