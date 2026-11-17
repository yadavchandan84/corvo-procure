import type { PolicyDefinition } from './policy/schema';

export interface Item {
  code: string;
  description: string;
  uom: string;
  category: string;
  itemType: string;
  standardPrice: number;
}

export interface Supplier {
  id: string;
  name: string;
  city: string;
  categories: string[];
  status: string;
  onTimePct: number;
  qualityRating: number;
}

export interface PoRecord {
  poNumber: string;
  poDate: string; // YYYY-MM-DD
  supplierId: string;
  itemCode: string;
  quantity: number;
  uom: string;
  unitPrice: number;
  plant: string;
  deliveredOnTime: boolean;
}

export interface ContractLine {
  itemCode: string;
  description: string;
  uom: string;
  rate: number;
}

export type ContractSource = 'REGISTER' | 'PDF' | 'MANUAL';

export interface Contract {
  id: string;
  supplierId: string;
  supplierName: string;
  startDate: string;
  endDate: string;
  valueCap: number;
  /** Consumed value as at the register update. Contracts signed after the update start at zero. */
  consumedValue: number;
  source: ContractSource;
  lines: ContractLine[];
}

export interface Plant {
  code: string;
  name: string;
}

export interface MasterData {
  items: Item[];
  suppliers: Supplier[];
  poHistory: PoRecord[];
  contracts: Contract[];
  plants: Plant[];
}

/** One PR line as received (CSV upload or chat). */
export interface PrLineInput {
  prNo: string;
  prLine: string;
  createdAt: string; // raw value
  requester: string;
  department: string;
  plant: string;
  itemCode: string;
  description: string;
  quantity: string; // raw value
  uom: string;
  estimatedUnitPrice: string; // raw value
  needByDate: string; // raw value
  urgency: string;
}

export interface PolicyVersionRecord {
  id: string;
  version: string;
  effectiveFrom: string; // YYYY-MM-DD
  approvedAt?: string | null;
  definition: PolicyDefinition;
}

export type Decision = 'PO' | 'SOURCING_REQUEST' | '';

export interface MatchResult {
  itemCode: string | null; // null = new item
  method: 'code' | 'code_in_text' | 'description' | 'new' | 'ambiguous';
  score: number;
  candidates: { itemCode: string; description: string; score: number }[];
  note?: string;
}

export interface PreferredSupplierEntry {
  rank: number;
  supplierId: string;
  supplierName: string;
  score: number;
  poCount: number;
  lastPoDate: string | null;
  daysSinceLastPo: number | null;
  recency: number;
  frequency: number;
  hasContract: boolean;
  onTimePct: number;
  qualityRating: number;
  referencePrice: number | null;
  referenceSource: string; // e.g. "PO 7300244 (2026-10-19)" or "Contract RC-2026-007"
  components: { frequency: number; recency: number; contract: number; onTime: number; quality: number };
}

export interface RuleTraceEntry {
  ruleId: string;
  clause: string;
  title: string;
  matched: boolean;
  skippedReason?: string;
  conditions: { text: string; result: boolean; actual: unknown }[];
}

export interface ContractCheck {
  contractId: string;
  supplierId: string;
  supplierStatus: string;
  rate: number;
  startDate: string;
  endDate: string;
  valueCap: number;
  consumedBefore: number;
  valueAtRate: number;
  applicable: boolean;
  usable: boolean;
  note: string;
}

export interface RequirementResult {
  groupId: string;
  itemCode: string | null;
  itemDescription: string;
  category: string | null;
  itemType: string | null;
  plant: string;
  isNewItem: boolean;
  requirementDate: string;
  firstCreatedAt: string;
  isEmergency: boolean;
  lineKeys: string[]; // "PR-26-00001/1"
  totalQuantity: number;
  uom: string;
  unitPriceForValue: number | null;
  valuationSource: string;
  value: number | null;
  policyVersion: string;
  policyVersionId: string;
  ruleId: string;
  clause: string;
  decision: Decision;
  route: string;
  supplierId: string | null;
  supplierName: string | null;
  unitPrice: number | null;
  poId: string | null;
  suggestedSupplierIds: string[];
  approvals: string[];
  reliedOn: string[]; // contract ids / PO numbers
  reason: string;
  contractChecks: ContractCheck[];
  preferred: PreferredSupplierEntry[];
  ruleTrace: RuleTraceEntry[];
  facts: Record<string, unknown>;
  warnings: string[];
}

export interface DecisionRow {
  pr_no: string;
  pr_line: string;
  resolved_item_code: string;
  group_id: string;
  po_id: string;
  decision: string;
  route: string;
  supplier_id: string;
  unit_price: string;
  group_value_inr: string;
  suggested_supplier_ids: string;
  policy_version: string;
  reason: string;
}

export interface LineResult {
  index: number;
  key: string;
  input: PrLineInput;
  createdAt: string | null;
  needBy: string | null;
  quantity: number | null;
  estimatedUnitPrice: number | null;
  isEmergency: boolean;
  match: MatchResult | null;
  status: 'OK' | 'NOT_PROCESSED';
  notProcessedReason?: string;
  groupId: string | null;
  warnings: string[];
}

export interface PurchaseOrderDraft {
  poId: string;
  supplierId: string;
  supplierName: string;
  plant: string;
  route: string;
  firstCreatedAt: string;
  groupIds: string[];
  totalValue: number;
}

export interface EngineResult {
  rows: DecisionRow[];
  lines: LineResult[];
  requirements: RequirementResult[];
  purchaseOrders: PurchaseOrderDraft[];
  policyVersionsUsed: string[];
  summary: {
    lines: number;
    requirements: number;
    purchaseOrders: number;
    byRoute: Record<string, number>;
    notProcessed: number;
    totalValue: number;
  };
}
