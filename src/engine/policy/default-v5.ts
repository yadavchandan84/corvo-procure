import type { PolicyDefinitionInput } from './schema';

/**
 * Corvo Procurement Policy v5.0 (CORVO-PROC-POL-04), effective 1 April 2026, encoded as data.
 * This is the seed version; later versions are created through the app (upload, chat, editor).
 */
export const POLICY_V5_VERSION = '5.0';
export const POLICY_V5_EFFECTIVE_FROM = '2026-04-01';

export const POLICY_V5: PolicyDefinitionInput = {
  meta: {
    title: 'Corvo Engineering Pvt Ltd: Procurement Policy (PR to PO)',
    document: 'CORVO-PROC-POL-04',
    owner: 'Head of Procurement',
    currency: 'INR',
    notes: 'All values in INR excluding GST.',
  },
  scope: { plants: ['PUN1', 'CHK1'] },
  intake: {
    rejectNonPositiveQuantity: true,
    rejectPlantsOutsideScope: true,
    rejectMissingNeedBy: true,
    rejectUomMismatch: true,
    rejectAmbiguousItems: true,
    emergencyUrgencyValues: ['Emergency'],
  },
  itemMatching: { useRequesterCode: true, minScore: 0.7, minMargin: 0.05 },
  newItems: { neverClub: true },
  clubbing: {
    enabled: true,
    sameFields: ['item', 'plant'],
    creationWindowDays: 14,
    needByWindowDays: 7,
  },
  valuation: {
    priceSources: ['contract', 'last_po', 'standard_price'],
    lastPoLookbackDays: 365,
    lastPoSuppliers: 'any',
  },
  contracts: {
    requireEligibleSupplier: true,
    enforceCeiling: true,
    minHeadroomPctAfter: 0,
    excludeIfEndsWithinDays: 0,
    selection: 'lowest_rate_with_ceiling',
  },
  eligibility: {
    allowedStatuses: ['Active'],
    minOnTimePct: null,
    minQualityRating: null,
    excludedSupplierIds: [],
    statusOverrides: {},
  },
  rules: [
    {
      id: 'R1.2',
      clause: '1.2',
      title: 'New item',
      description: 'A line that matches no item master item always goes to sourcing, is never clubbed, and is valued at quantity x estimated unit price. No supplier suggestions (6.4).',
      enabled: true,
      when: { fact: 'is_new_item', op: 'is_true' },
      outcome: { decision: 'SOURCING_REQUEST', route: 'NEW_ITEM_SOURCING', supplier: 'none', suggestCount: 0, approvals: [] },
    },
    {
      id: 'R5.1',
      clause: '5.1',
      title: 'Capex item',
      description: 'The item type is Capex: sourcing request with 5 suggested suppliers. Needs capex approval.',
      enabled: true,
      when: { fact: 'item_type', op: 'eq', value: 'Capex' },
      outcome: { decision: 'SOURCING_REQUEST', route: 'CAPEX_SOURCING', supplier: 'none', suggestCount: 5, approvals: ['Capex approval'] },
    },
    {
      id: 'R5.2',
      clause: '5.2',
      title: 'Rate contract',
      description: 'A contract can be used (4.1 to 4.3): PO to the contract supplier at the contract rate, whatever the value.',
      enabled: true,
      when: { fact: 'contract_usable', op: 'is_true' },
      outcome: { decision: 'PO', route: 'CONTRACT_PO', supplier: 'contract', suggestCount: 0, approvals: [] },
    },
    {
      id: 'R5.3',
      clause: '5.3',
      title: 'Emergency PO',
      description: 'Emergency, value at or below ₹5,00,000, and the item was bought from an Active supplier in the last 365 days: PO to the 1st preferred supplier at its reference price.',
      enabled: true,
      when: {
        all: [
          { fact: 'is_emergency', op: 'is_true' },
          { fact: 'value', op: 'lte', value: 500000 },
          { fact: 'days_since_last_eligible_purchase', op: 'lte', value: 365 },
        ],
      },
      outcome: { decision: 'PO', route: 'EMERGENCY_PO', supplier: 'preferred_1', suggestCount: 0, approvals: [] },
    },
    {
      id: 'R5.4',
      clause: '5.4',
      title: 'Spot PO',
      description: 'Value below ₹2,00,000, and the item was bought from an Active supplier in the last 365 days: PO to the 1st preferred supplier at its reference price.',
      enabled: true,
      when: {
        all: [
          { fact: 'value', op: 'lt', value: 200000 },
          { fact: 'days_since_last_eligible_purchase', op: 'lte', value: 365 },
        ],
      },
      outcome: { decision: 'PO', route: 'SPOT_PO', supplier: 'preferred_1', suggestCount: 0, approvals: [] },
    },
    {
      id: 'R5.5',
      clause: '5.5',
      title: 'RFQ',
      description: 'Value below ₹10,00,000 (including small items never bought in the last 365 days): sourcing request, suggest 3 suppliers.',
      enabled: true,
      when: { fact: 'value', op: 'lt', value: 1000000 },
      outcome: { decision: 'SOURCING_REQUEST', route: 'RFQ', supplier: 'none', suggestCount: 3, approvals: [] },
    },
    {
      id: 'R5.6',
      clause: '5.6',
      title: 'RFP',
      description: 'Value ₹10,00,000 or more: sourcing request, suggest 5 suppliers.',
      enabled: true,
      when: { fact: 'value', op: 'gte', value: 1000000 },
      outcome: { decision: 'SOURCING_REQUEST', route: 'RFP', supplier: 'none', suggestCount: 5, approvals: [] },
    },
  ],
  preferredSuppliers: {
    lookbackDays: 548,
    includeContractHolders: true,
    recencyBands: [
      { maxDays: 90, score: 1 },
      { maxDays: 365, score: 0.5 },
    ],
    weights: { frequency: 0.3, recency: 0.25, contract: 0.2, onTime: 0.125, quality: 0.125 },
    referencePriceLookbackDays: 548,
    exportTopN: 3,
  },
  suggestions: {
    topUpFromCategory: true,
    topUpWeights: { onTime: 0.5, quality: 0.5 },
    newItemsGetSuggestions: false,
  },
  consolidation: {
    enabled: true,
    sameFields: ['supplier', 'plant', 'route'],
    windowHours: 24,
    maxRequirementsPerPo: 0,
  },
};
