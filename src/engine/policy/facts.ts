/**
 * Facts the engine computes for every requirement. Policy rule conditions can reference any of
 * them, so a new kind of rule (per plant, per category, per department, by need-by lead time,
 * by contract headroom, by supplier rating...) is a data change, not a code change.
 */

export type FactType = 'string' | 'number' | 'money' | 'boolean' | 'date' | 'string[]' | 'days';

export interface FactDef {
  name: string;
  label: string;
  type: FactType;
  description: string;
  /** Allowed values hint for UI pickers. */
  options?: string[];
}

export const FACTS: FactDef[] = [
  { name: 'item_code', label: 'item code', type: 'string', description: 'Resolved item code (empty for new items).' },
  { name: 'item_type', label: 'item type', type: 'string', description: 'Item type from the item master.', options: ['Material', 'Service', 'Capex'] },
  { name: 'category', label: 'item category', type: 'string', description: 'Item category from the item master, e.g. "Safety & PPE".' },
  { name: 'is_new_item', label: 'item is new (not in item master)', type: 'boolean', description: 'True when the line matched no item master item (1.2).' },
  { name: 'plant', label: 'plant', type: 'string', description: 'Plant code of the requirement, e.g. PUN1 or CHK1.' },
  { name: 'value', label: 'requirement value', type: 'money', description: 'Requirement value in INR per section 3 (total quantity x unit price).' },
  { name: 'unit_price_for_value', label: 'unit price used for valuation', type: 'money', description: 'Unit price used to value the requirement (3.1).' },
  { name: 'valuation_source', label: 'valuation source', type: 'string', description: 'Which 3.1 source priced the requirement.', options: ['contract', 'contract_out_of_ceiling', 'last_po', 'standard_price', 'requester_estimate'] },
  { name: 'total_quantity', label: 'total quantity', type: 'number', description: 'Sum of quantities of all clubbed lines.' },
  { name: 'line_count', label: 'number of PR lines', type: 'number', description: 'Number of PR lines clubbed into the requirement.' },
  { name: 'estimated_value', label: "requester's estimated value", type: 'money', description: 'Sum of quantity x estimated unit price, where given.' },
  { name: 'is_emergency', label: 'requirement is an emergency', type: 'boolean', description: 'True if any line is marked Emergency (2.3).' },
  { name: 'requirement_date', label: 'requirement date', type: 'date', description: 'Creation date of the first line (2.3), YYYY-MM-DD.' },
  { name: 'days_to_need_by', label: 'days from requirement date to earliest need-by date', type: 'days', description: 'Lead time the requester allowed.' },
  { name: 'departments', label: 'requesting departments', type: 'string[]', description: 'Departments of the clubbed lines.' },
  { name: 'contract_applicable', label: 'a rate contract applies (4.1)', type: 'boolean', description: 'A contract covers the item on the requirement date and its supplier is eligible.' },
  { name: 'contract_usable', label: 'a rate contract can be used (4.1 to 4.3)', type: 'boolean', description: 'An applicable contract also has enough ceiling left.' },
  { name: 'contract_id', label: 'contract that will be used', type: 'string', description: 'Id of the contract chosen under 4.3.' },
  { name: 'contract_supplier_id', label: 'contract supplier', type: 'string', description: 'Supplier of the contract chosen under 4.3.' },
  { name: 'contract_rate', label: 'contract rate', type: 'money', description: 'Rate of the contract chosen under 4.3.' },
  { name: 'contract_headroom_after', label: 'contract ceiling left after this requirement', type: 'money', description: 'Ceiling minus consumed minus this requirement, for the chosen contract.' },
  { name: 'contract_headroom_after_pct', label: 'contract ceiling left after this requirement (%)', type: 'number', description: 'Same as a percentage of the ceiling.' },
  { name: 'contract_days_to_end', label: 'days until the chosen contract ends', type: 'days', description: 'Contract end date minus requirement date.' },
  { name: 'days_since_last_purchase', label: 'days since the item was last bought (any supplier)', type: 'days', description: 'Empty if never bought.' },
  { name: 'days_since_last_eligible_purchase', label: 'days since the item was last bought from an Active supplier', type: 'days', description: 'Used by 5.3 and 5.4 ("bought from an Active supplier in the last 365 days"). Empty if never.' },
  { name: 'days_since_last_eligible_purchase_same_plant', label: 'days since the item was last bought from an Active supplier for this plant', type: 'days', description: 'Plant-specific purchase history. Empty if never.' },
  { name: 'eligible_po_count_365d', label: 'POs for the item from Active suppliers in the last 365 days', type: 'number', description: 'Count of history POs.' },
  { name: 'preferred_supplier_count', label: 'suppliers on the preferred list', type: 'number', description: 'Size of the preferred supplier list (6.1).' },
  { name: 'top_supplier_id', label: '1st preferred supplier', type: 'string', description: 'Supplier ranked first (6.2).' },
  { name: 'top_supplier_on_time_pct', label: "1st preferred supplier's on-time %", type: 'number', description: 'From the supplier master.' },
  { name: 'top_supplier_quality', label: "1st preferred supplier's quality rating", type: 'number', description: 'From the supplier master (0-5).' },
  { name: 'top_supplier_reference_price', label: "1st preferred supplier's reference price", type: 'money', description: 'Per 6.3.' },
  { name: 'top_supplier_has_contract', label: '1st preferred supplier has held a contract for the item', type: 'boolean', description: 'Per 6.1(b).' },
];

export const FACT_MAP: Record<string, FactDef> = Object.fromEntries(FACTS.map((f) => [f.name, f]));

export function isKnownFact(name: string): boolean {
  return name in FACT_MAP;
}
