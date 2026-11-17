import { z } from 'zod';

/**
 * The procurement policy as data. Every limit, window, rule order, condition and outcome the
 * engine applies lives here. A new policy version is a new PolicyDefinition with an effective
 * date; the engine code never changes.
 */

export const OPERATORS = [
  'eq',
  'neq',
  'lt',
  'lte',
  'gt',
  'gte',
  'in',
  'not_in',
  'contains',
  'is_true',
  'is_false',
  'exists',
  'not_exists',
] as const;
export type Operator = (typeof OPERATORS)[number];

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { always: true }
  | { fact: string; op: Operator; value?: unknown };

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(conditionSchema) }).strict(),
    z.object({ any: z.array(conditionSchema) }).strict(),
    z.object({ not: conditionSchema }).strict(),
    z.object({ always: z.literal(true) }).strict(),
    z
      .object({
        fact: z.string().min(1),
        op: z.enum(OPERATORS),
        value: z.unknown().optional(),
      })
      .strict(),
  ]),
);

export const SUPPLIER_STRATEGIES = ['contract', 'preferred_1', 'none'] as const;
export const DECISIONS = ['PO', 'SOURCING_REQUEST', 'NOT_PROCESSED'] as const;

export const outcomeSchema = z.object({
  decision: z.enum(DECISIONS),
  route: z.string().min(1),
  /** contract = supplier of the usable contract at contract rate; preferred_1 = 1st preferred supplier at its reference price. */
  supplier: z.enum(SUPPLIER_STRATEGIES).default('none'),
  /** Number of suppliers to suggest for a sourcing event (policy 6.4). 0 = no suggestions. */
  suggestCount: z.number().int().min(0).max(20).default(0),
  /** Extra approvals the buyer must obtain, e.g. "Capex approval". */
  approvals: z.array(z.string()).default([]),
  note: z.string().optional(),
});
export type RuleOutcome = z.infer<typeof outcomeSchema>;

export const ruleSchema = z.object({
  id: z.string().min(1),
  clause: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean().default(true),
  when: conditionSchema,
  outcome: outcomeSchema,
});
export type PolicyRule = z.infer<typeof ruleSchema>;

const eligibilitySchema = z.object({
  /** Supplier statuses that may receive POs or be suggested (policy 4.1, 5.7, 6.1, 6.4). */
  allowedStatuses: z.array(z.string()).default(['Active']),
  /** Optional minimum ratings a supplier must meet to be eligible. */
  minOnTimePct: z.number().min(0).max(100).nullable().default(null),
  minQualityRating: z.number().min(0).max(5).nullable().default(null),
  /** Suppliers excluded by policy regardless of master-data status. */
  excludedSupplierIds: z.array(z.string()).default([]),
  /** Policy-level status overrides, e.g. { "S013": "Blocked" }. */
  statusOverrides: z.record(z.string()).default({}),
});

export const policyDefinitionSchema = z.object({
  meta: z
    .object({
      title: z.string().default('Procurement Policy'),
      document: z.string().default(''),
      owner: z.string().default(''),
      currency: z.string().default('INR'),
      notes: z.string().optional(),
    })
    .default({}),
  scope: z.object({
    /** Plants the policy applies to. Lines for other plants are NOT_PROCESSED. */
    plants: z.array(z.string()).min(1),
  }),
  intake: z
    .object({
      rejectNonPositiveQuantity: z.boolean().default(true),
      rejectPlantsOutsideScope: z.boolean().default(true),
      rejectMissingNeedBy: z.boolean().default(true),
      /** A unit that differs from the item master unit cannot be valued safely. */
      rejectUomMismatch: z.boolean().default(true),
      /** Requests whose description matches several items equally well are sent back. */
      rejectAmbiguousItems: z.boolean().default(true),
      /** Urgency values that mark a line as an emergency (case-insensitive). */
      emergencyUrgencyValues: z.array(z.string()).default(['Emergency']),
    })
    .default({}),
  itemMatching: z
    .object({
      /** 1.1: if the requester gave a valid item code, use it. */
      useRequesterCode: z.boolean().default(true),
      /** Minimum match score (0-1) to accept a description match in batch processing. */
      minScore: z.number().min(0).max(1).default(0.7),
      /** Minimum lead of the best candidate over the second-best. */
      minMargin: z.number().min(0).max(1).default(0.05),
    })
    .default({}),
  newItems: z
    .object({
      /** 1.2: new items are never clubbed. */
      neverClub: z.boolean().default(true),
    })
    .default({}),
  clubbing: z.object({
    enabled: z.boolean().default(true),
    /** Fields that must be equal for a line to join a requirement (2.2). */
    sameFields: z.array(z.enum(['item', 'plant'])).default(['item', 'plant']),
    /** Max calendar days between the line's creation and the requirement's first line (2.2). */
    creationWindowDays: z.number().min(0),
    /** Max days (either side) between the line's need-by and the first line's need-by (2.2). */
    needByWindowDays: z.number().min(0),
  }),
  valuation: z.object({
    /** 3.1 price sources in order. */
    priceSources: z.array(z.enum(['contract', 'last_po', 'standard_price'])).min(1),
    /** 3.1(b) lookback for the most recent PO price. */
    lastPoLookbackDays: z.number().min(0),
    /** Whose POs count for 3.1(b): any supplier, or eligible suppliers only. */
    lastPoSuppliers: z.enum(['any', 'eligible']).default('any'),
  }),
  contracts: z.object({
    /** 4.1 the contract supplier must be eligible (Active). */
    requireEligibleSupplier: z.boolean().default(true),
    /** 4.2 consumed + requirement value must not exceed the ceiling. */
    enforceCeiling: z.boolean().default(true),
    /** Optional: minimum share of the ceiling that must remain after the requirement (0-100). */
    minHeadroomPctAfter: z.number().min(0).max(100).default(0),
    /** Optional: do not use contracts ending within this many days of the requirement date. */
    excludeIfEndsWithinDays: z.number().min(0).default(0),
    /** 4.3 selection when several contracts apply. */
    selection: z.enum(['lowest_rate_with_ceiling', 'earliest_end_with_ceiling']).default('lowest_rate_with_ceiling'),
  }),
  eligibility: eligibilitySchema.default({}),
  /** Section 5: applied in order, first match decides. */
  rules: z.array(ruleSchema).min(1),
  preferredSuppliers: z.object({
    /** 6.1(a) PO lookback. */
    lookbackDays: z.number().min(1),
    /** 6.1(b) include suppliers with a contract for the item that started on or before the date. */
    includeContractHolders: z.boolean().default(true),
    /** Recency score bands: first band whose maxDays >= days since last PO wins; else 0. */
    recencyBands: z
      .array(z.object({ maxDays: z.number().min(0), score: z.number().min(0).max(1) }))
      .default([
        { maxDays: 90, score: 1 },
        { maxDays: 365, score: 0.5 },
      ]),
    /** Ranking weights (6.2). Components are each scaled 0-1. */
    weights: z.object({
      frequency: z.number().min(0),
      recency: z.number().min(0),
      contract: z.number().min(0),
      onTime: z.number().min(0),
      quality: z.number().min(0),
    }),
    /** 6.3 reference price: latest PO in this many days, else latest contract rate. */
    referencePriceLookbackDays: z.number().min(1),
    /** How many suppliers the preferred-list export shows per item. */
    exportTopN: z.number().int().min(1).default(3),
  }),
  suggestions: z
    .object({
      /** 6.4 top up from other eligible suppliers listing the item's category. */
      topUpFromCategory: z.boolean().default(true),
      /** Weights for "best delivery and quality record first". */
      topUpWeights: z.object({ onTime: z.number().min(0), quality: z.number().min(0) }).default({ onTime: 0.5, quality: 0.5 }),
      /** 6.4 new items get no suggestions. */
      newItemsGetSuggestions: z.boolean().default(false),
    })
    .default({}),
  consolidation: z.object({
    enabled: z.boolean().default(true),
    sameFields: z.array(z.enum(['supplier', 'plant', 'route'])).default(['supplier', 'plant', 'route']),
    /** 7.1 window measured from the first requirement on the PO. */
    windowHours: z.number().min(0),
    /** Optional cap on requirements per PO (0 = no cap). */
    maxRequirementsPerPo: z.number().int().min(0).default(0),
  }),
});

export type PolicyDefinition = z.infer<typeof policyDefinitionSchema>;
export type PolicyDefinitionInput = z.input<typeof policyDefinitionSchema>;

export function parsePolicyDefinition(input: unknown): PolicyDefinition {
  return policyDefinitionSchema.parse(input);
}

export function safeParsePolicyDefinition(input: unknown) {
  return policyDefinitionSchema.safeParse(input);
}

export const KNOWN_ROUTES = [
  'CONTRACT_PO',
  'EMERGENCY_PO',
  'SPOT_PO',
  'RFQ',
  'RFP',
  'CAPEX_SOURCING',
  'NEW_ITEM_SOURCING',
  'NOT_PROCESSED',
] as const;
