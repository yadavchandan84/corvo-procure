import type {
  ContractCheck,
  DecisionRow,
  EngineResult,
  LineResult,
  MasterData,
  PolicyVersionRecord,
  PrLineInput,
  PurchaseOrderDraft,
  RequirementResult,
  RuleTraceEntry,
} from './types';
import { parsePolicyDefinition, type PolicyDefinition, type PolicyRule } from './policy/schema';
import { evaluateCondition, describeCondition, type ConditionTrace } from './policy/conditions';
import { buildContext, isEligible, lastPo, posInWindow, supplierStatus, type DataContext } from './context';
import { matchItem, normalizeText, rankItems } from './matching';
import { preferredList, suggestSuppliers } from './preferred';
import { dateOf, dayNum, minuteNum, parseDate, parseDateTime } from './dates';
import { csvNumber, formatINR, formatPrice, round2 } from './format';
import { canonicalUom, sameUom } from './uom';

export interface EngineOptions {
  /** Apply this policy version to every requirement instead of resolving by effective date. */
  forceVersionId?: string | null;
  /** Ceiling already consumed by POs issued in the app after the register update, by contract id. */
  extraConsumption?: Record<string, number>;
}

interface ResolvedPolicy {
  record: PolicyVersionRecord;
  def: PolicyDefinition;
}

/** Pick the approved version in force on `date`: latest effectiveFrom <= date (ties: latest approval). */
export function resolvePolicyVersion<T extends PolicyVersionRecord>(versions: T[], date: string): { version: T; warning?: string } {
  if (!versions.length) throw new Error('No approved policy version is available.');
  const sorted = [...versions].sort(
    (a, b) =>
      a.effectiveFrom.localeCompare(b.effectiveFrom) ||
      (a.approvedAt ?? '').localeCompare(b.approvedAt ?? '') ||
      a.version.localeCompare(b.version, undefined, { numeric: true }),
  );
  let chosen: T | null = null;
  for (const v of sorted) if (v.effectiveFrom <= date) chosen = v;
  if (!chosen) {
    return { version: sorted[0], warning: `No policy version was in force on ${date}; applied the earliest version ${sorted[0].version}.` };
  }
  return { version: chosen };
}

interface WorkLine extends LineResult {
  createdMin: number;
  createdDate: string;
  needByDay: number;
  itemCode: string | null;
  plant: string;
  policy: ResolvedPolicy;
}

interface WorkReq {
  groupId: string;
  isNew: boolean;
  itemCode: string | null;
  plant: string;
  lines: WorkLine[];
  policy: ResolvedPolicy;
}

function natCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

function num(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[,₹\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function runEngine(
  source: MasterData | DataContext,
  inputs: PrLineInput[],
  versionRecords: PolicyVersionRecord[],
  options: EngineOptions = {},
): EngineResult {
  const ctx: DataContext = 'itemIndex' in source ? source : buildContext(source);
  const resolvedCache = new Map<string, ResolvedPolicy>();
  const toResolved = (rec: PolicyVersionRecord): ResolvedPolicy => {
    let r = resolvedCache.get(rec.id);
    if (!r) {
      r = { record: rec, def: parsePolicyDefinition(rec.definition) };
      resolvedCache.set(rec.id, r);
    }
    return r;
  };
  const forced = options.forceVersionId ? versionRecords.find((v) => v.id === options.forceVersionId) : null;
  if (options.forceVersionId && !forced) throw new Error(`Policy version ${options.forceVersionId} not found.`);
  const policyFor = (date: string): { p: ResolvedPolicy; warning?: string } => {
    if (forced) return { p: toResolved(forced) };
    const { version, warning } = resolvePolicyVersion(versionRecords, date);
    return { p: toResolved(version), warning };
  };

  // ---------- 1. Intake: parse, validate, match (policy section 1) ----------
  const seenKeys = new Set<string>();
  const lines: WorkLine[] = inputs.map((input, index) => {
    const key = `${input.prNo}/${input.prLine}`;
    const createdAt = parseDateTime(input.createdAt);
    const needBy = parseDate(input.needByDate);
    const quantity = num(input.quantity);
    const est = num(input.estimatedUnitPrice);
    const plant = (input.plant ?? '').trim().toUpperCase();
    const fallbackDate = createdAt ? dateOf(createdAt) : '9999-12-31';
    const { p: policy, warning: pw } = policyFor(fallbackDate);
    const def = policy.def;
    const warnings: string[] = pw ? [pw] : [];
    const emergencyValues = def.intake.emergencyUrgencyValues.map((u) => u.toLowerCase());
    const isEmergency = emergencyValues.includes((input.urgency ?? '').trim().toLowerCase());

    let notProcessedReason: string | undefined;
    const reject = (r: string) => {
      if (!notProcessedReason) notProcessedReason = r;
    };

    if (seenKeys.has(key)) reject(`Duplicate PR line ${key} in the same batch; only the first occurrence is processed.`);
    seenKeys.add(key);
    if (!createdAt) reject(`Creation timestamp "${input.createdAt}" is missing or invalid.`);
    if (!plant) reject('Plant is missing.');
    else if (def.intake.rejectPlantsOutsideScope && !def.scope.plants.includes(plant)) {
      const known = ctx.plants.has(plant);
      reject(
        `Plant ${plant} is ${known ? 'outside the policy scope' : 'not in the plant master'}; policy v${policy.record.version} applies to ${def.scope.plants.join(' and ')} only. Return to requester to correct the plant.`,
      );
    }
    if (quantity === null) reject(`Quantity "${input.quantity}" is missing or not a number.`);
    else if (def.intake.rejectNonPositiveQuantity && quantity <= 0) reject(`Quantity is ${quantity}; a PR line must have a positive quantity. Return to requester.`);
    if (!needBy && def.intake.rejectMissingNeedBy) reject(`Need-by date "${input.needByDate}" is missing or invalid.`);
    if (!(input.itemCode ?? '').trim() && !(input.description ?? '').trim()) reject('Neither an item code nor a description was given.');

    // Item matching (1.1) is done even for rejected lines, so the buyer sees what was asked for.
    let match = null as LineResult['match'];
    if ((input.itemCode ?? '').trim() || (input.description ?? '').trim()) {
      match = matchItem(input.itemCode, input.description, ctx.itemIndex, def.itemMatching);
      if (match.note) warnings.push(match.note);
      if (match.method === 'code' && (input.description ?? '').trim()) {
        const ranked = rankItems(input.description, ctx.itemIndex, 3);
        const own = ranked.find((r) => r.itemCode === match!.itemCode)?.score ?? 0;
        if (ranked[0] && ranked[0].itemCode !== match.itemCode && ranked[0].score >= 0.8 && own < 0.4) {
          warnings.push(`Description "${input.description}" looks like ${ranked[0].itemCode} (${ranked[0].description}); item code ${match.itemCode} was used as given (1.1).`);
        }
      }
      if (match.method === 'ambiguous' && def.intake.rejectAmbiguousItems) {
        reject(
          `Description "${input.description}" matches several items equally well (${match.candidates
            .slice(0, 3)
            .map((c) => `${c.itemCode} ${c.description}`)
            .join('; ')}). Ask the requester which one.`,
        );
      }
    }
    const itemCode = match?.itemCode ?? null;
    const item = itemCode ? ctx.items.get(itemCode) : undefined;
    if (item && input.uom && !sameUom(input.uom, item.uom)) {
      if (def.intake.rejectUomMismatch) reject(`Unit ${input.uom} differs from the item master unit ${item.uom} for ${item.code}; the quantity cannot be valued. Return to requester.`);
      else warnings.push(`Unit ${input.uom} differs from item master unit ${item.uom}.`);
    }
    if (createdAt && needBy && dayNum(needBy) < dayNum(dateOf(createdAt))) warnings.push(`Need-by date ${needBy} is before the creation date.`);
    if (match?.method === 'new' && est === null) warnings.push('New item without an estimated unit price: the requirement cannot be valued.');

    return {
      index,
      key,
      input,
      createdAt,
      needBy,
      quantity,
      estimatedUnitPrice: est,
      isEmergency,
      match,
      status: notProcessedReason ? 'NOT_PROCESSED' : 'OK',
      notProcessedReason,
      groupId: null,
      warnings,
      createdMin: createdAt ? minuteNum(createdAt) : Number.MAX_SAFE_INTEGER,
      createdDate: createdAt ? dateOf(createdAt) : fallbackDate,
      needByDay: needBy ? dayNum(needBy) : Number.NaN,
      itemCode,
      plant,
      policy,
    } satisfies WorkLine;
  });

  // ---------- 2. Clubbing (policy section 2) ----------
  const ordered = lines
    .filter((l) => l.status === 'OK')
    .sort((a, b) => a.createdMin - b.createdMin || natCompare(a.input.prNo, b.input.prNo) || natCompare(a.input.prLine, b.input.prLine));

  const reqs: WorkReq[] = [];
  for (const line of ordered) {
    const isNew = !line.itemCode;
    let target: WorkReq | undefined;
    if (!(isNew && line.policy.def.newItems.neverClub)) {
      target = reqs.find((r) => {
        const c = r.policy.def.clubbing;
        if (!c.enabled || r.isNew !== isNew) return false;
        const first = r.lines[0];
        // same item is always required (a requirement is valued as one item); new items, if a
        // policy ever allows clubbing them, must have the same normalised description
        if (isNew) {
          if (r.policy.def.newItems.neverClub) return false;
          if (normalizeText(first.input.description) !== normalizeText(line.input.description)) return false;
        } else if (r.itemCode !== line.itemCode) return false;
        if (c.sameFields.includes('plant') && r.plant !== line.plant) return false;
        const createdGap = dayNum(line.createdDate) - dayNum(first.createdDate);
        if (createdGap < 0 || createdGap > c.creationWindowDays) return false;
        if (Number.isNaN(line.needByDay) || Number.isNaN(first.needByDay)) return false;
        return Math.abs(line.needByDay - first.needByDay) <= c.needByWindowDays;
      });
    }
    if (target) target.lines.push(line);
    else reqs.push({ groupId: '', isNew, itemCode: line.itemCode, plant: line.plant, lines: [line], policy: line.policy });
  }
  reqs.forEach((r, i) => {
    r.groupId = `REQ-${String(i + 1).padStart(4, '0')}`;
    r.lines.forEach((l) => (l.groupId = r.groupId));
    // the requirement is governed by the version in force on its requirement date
    const { p, warning } = policyFor(r.lines[0].createdDate);
    r.policy = p;
    if (warning && !r.lines[0].warnings.includes(warning)) r.lines[0].warnings.push(warning);
  });

  // ---------- 3-6. Value, contracts, rules, suppliers (sections 3 to 6) ----------
  const consumed = new Map<string, number>(ctx.data.contracts.map((c) => [c.id, c.consumedValue + (options.extraConsumption?.[c.id] ?? 0)]));
  const results: RequirementResult[] = [];

  for (const r of reqs) {
    const def = r.policy.def;
    const first = r.lines[0];
    const reqDate = first.createdDate;
    const reqDay = dayNum(reqDate);
    const item = r.itemCode ? ctx.items.get(r.itemCode) : undefined;
    const qty = round2(r.lines.reduce((s, l) => s + (l.quantity ?? 0), 0));
    const isEmergency = r.lines.some((l) => l.isEmergency);
    const warnings = r.lines.flatMap((l) => l.warnings);
    const reliedOn: string[] = [];

    // contracts 4.1-4.3
    const contractChecks: ContractCheck[] = [];
    if (item) {
      for (const { contract, rate } of ctx.contractsByItem.get(item.code) ?? []) {
        const inDate = contract.startDate <= reqDate && reqDate <= contract.endDate;
        const status = supplierStatus(ctx, def, contract.supplierId);
        const eligible = isEligible(ctx, def, contract.supplierId);
        const daysToEnd = dayNum(contract.endDate) - reqDay;
        const endsSoon = def.contracts.excludeIfEndsWithinDays > 0 && daysToEnd <= def.contracts.excludeIfEndsWithinDays;
        const applicable = inDate && (!def.contracts.requireEligibleSupplier || eligible) && !endsSoon;
        const before = consumed.get(contract.id) ?? 0;
        const valueAtRate = round2(qty * rate);
        const headroomAfter = contract.valueCap - before - valueAtRate;
        const ceilingOk = !def.contracts.enforceCeiling || headroomAfter >= -0.005;
        const pctOk = contract.valueCap > 0 ? (headroomAfter / contract.valueCap) * 100 >= def.contracts.minHeadroomPctAfter - 1e-9 : true;
        const usable = applicable && ceilingOk && pctOk;
        let note: string;
        if (!inDate) note = `not valid on ${reqDate} (${contract.startDate} to ${contract.endDate})`;
        else if (!eligible && def.contracts.requireEligibleSupplier) note = `supplier ${contract.supplierId} is ${status}`;
        else if (endsSoon) note = `ends within ${def.contracts.excludeIfEndsWithinDays} days`;
        else if (!ceilingOk) note = `ceiling ${formatINR(contract.valueCap)} would be exceeded: consumed ${formatINR(before)} + this ${formatINR(valueAtRate)}`;
        else if (!pctOk) note = `less than ${def.contracts.minHeadroomPctAfter}% of the ceiling would remain`;
        else note = `usable: consumed ${formatINR(before)} + this ${formatINR(valueAtRate)} within ceiling ${formatINR(contract.valueCap)}`;
        contractChecks.push({
          contractId: contract.id,
          supplierId: contract.supplierId,
          supplierStatus: status,
          rate,
          startDate: contract.startDate,
          endDate: contract.endDate,
          valueCap: contract.valueCap,
          consumedBefore: before,
          valueAtRate,
          applicable,
          usable,
          note,
        });
      }
    }
    const applicable = contractChecks.filter((c) => c.applicable).sort((a, b) => a.rate - b.rate || a.contractId.localeCompare(b.contractId));
    const usableSorted = contractChecks
      .filter((c) => c.usable)
      .sort((a, b) =>
        def.contracts.selection === 'earliest_end_with_ceiling'
          ? a.endDate.localeCompare(b.endDate) || a.rate - b.rate
          : a.rate - b.rate || a.endDate.localeCompare(b.endDate) || a.contractId.localeCompare(b.contractId),
      );
    const chosen = usableSorted[0] ?? null;

    // valuation 3.1 (new items: 1.2)
    let unitPriceForValue: number | null = null;
    let valuationSource = '';
    let valuationText = '';
    let value: number | null = null;
    if (r.isNew) {
      const allEst = r.lines.every((l) => l.estimatedUnitPrice !== null);
      if (allEst) {
        value = round2(r.lines.reduce((s, l) => s + (l.quantity ?? 0) * (l.estimatedUnitPrice ?? 0), 0));
        unitPriceForValue = qty ? round2(value / qty) : null;
      }
      valuationSource = 'requester_estimate';
      valuationText = allEst ? `${qty} ${first.input.uom} x requester's estimate ${formatPrice(unitPriceForValue)}` : 'no requester estimate given';
    } else if (item) {
      for (const src of def.valuation.priceSources) {
        if (src === 'contract') {
          if (chosen) {
            unitPriceForValue = chosen.rate;
            valuationSource = 'contract';
            valuationText = `contract ${chosen.contractId} rate ${formatPrice(chosen.rate)}`;
          } else if (applicable.length) {
            unitPriceForValue = applicable[0].rate;
            valuationSource = 'contract_out_of_ceiling';
            valuationText = `lowest applicable contract rate ${formatPrice(applicable[0].rate)} (${applicable[0].contractId}, out of ceiling)`;
          }
        } else if (src === 'last_po') {
          const lp = lastPo(ctx, item.code, reqDate, def.valuation.lastPoSuppliers === 'eligible' ? (p) => isEligible(ctx, def, p.supplierId) : undefined);
          if (lp && reqDay - dayNum(lp.poDate) <= def.valuation.lastPoLookbackDays) {
            unitPriceForValue = lp.unitPrice;
            valuationSource = 'last_po';
            valuationText = `last PO ${lp.poNumber} (${lp.poDate}, ${lp.supplierId}) at ${formatPrice(lp.unitPrice)}`;
          }
        } else if (src === 'standard_price') {
          if (item.standardPrice > 0) {
            unitPriceForValue = item.standardPrice;
            valuationSource = 'standard_price';
            valuationText = `item master standard price ${formatPrice(item.standardPrice)}`;
          }
        }
        if (unitPriceForValue !== null) break;
      }
      if (unitPriceForValue !== null) value = round2(qty * unitPriceForValue);
    }

    // purchase history facts
    const eligibleFilter = (p: { supplierId: string }) => isEligible(ctx, def, p.supplierId);
    const lpAny = item ? lastPo(ctx, item.code, reqDate) : null;
    const lpEligible = item ? lastPo(ctx, item.code, reqDate, eligibleFilter) : null;
    const lpEligiblePlant = item ? lastPo(ctx, item.code, reqDate, (p) => eligibleFilter(p) && p.plant === r.plant) : null;
    const preferred = item ? preferredList(ctx, def, item.code, reqDate) : [];
    const top = preferred[0] ?? null;
    const daysTo = (d: string | undefined | null) => (d ? reqDay - dayNum(d) : null);
    const minNeedBy = Math.min(...r.lines.map((l) => l.needByDay).filter((n) => !Number.isNaN(n)));
    const estValue = r.lines.reduce((s, l) => s + (l.estimatedUnitPrice !== null ? (l.quantity ?? 0) * l.estimatedUnitPrice : 0), 0);

    const facts: Record<string, unknown> = {
      item_code: item?.code ?? '',
      item_type: item?.itemType ?? '',
      category: item?.category ?? '',
      is_new_item: r.isNew,
      plant: r.plant,
      value,
      unit_price_for_value: unitPriceForValue,
      valuation_source: valuationSource,
      total_quantity: qty,
      line_count: r.lines.length,
      estimated_value: round2(estValue),
      is_emergency: isEmergency,
      requirement_date: reqDate,
      days_to_need_by: Number.isFinite(minNeedBy) ? minNeedBy - reqDay : null,
      departments: Array.from(new Set(r.lines.map((l) => l.input.department).filter(Boolean))),
      contract_applicable: applicable.length > 0,
      contract_usable: !!chosen,
      contract_id: chosen?.contractId ?? '',
      contract_supplier_id: chosen?.supplierId ?? '',
      contract_rate: chosen?.rate ?? null,
      contract_headroom_after: chosen ? round2(chosen.valueCap - chosen.consumedBefore - chosen.valueAtRate) : null,
      contract_headroom_after_pct: chosen && chosen.valueCap ? round2(((chosen.valueCap - chosen.consumedBefore - chosen.valueAtRate) / chosen.valueCap) * 100) : null,
      contract_days_to_end: chosen ? dayNum(chosen.endDate) - reqDay : null,
      days_since_last_purchase: daysTo(lpAny?.poDate),
      days_since_last_eligible_purchase: daysTo(lpEligible?.poDate),
      days_since_last_eligible_purchase_same_plant: daysTo(lpEligiblePlant?.poDate),
      eligible_po_count_365d: item ? posInWindow(ctx, item.code, reqDate, 365).filter(eligibleFilter).length : 0,
      preferred_supplier_count: preferred.length,
      top_supplier_id: top?.supplierId ?? '',
      top_supplier_on_time_pct: top?.onTimePct ?? null,
      top_supplier_quality: top?.qualityRating ?? null,
      top_supplier_reference_price: top?.referencePrice ?? null,
      top_supplier_has_contract: top?.hasContract ?? false,
    };

    // rules (section 5): first enabled rule that fits decides
    const ruleTrace: RuleTraceEntry[] = [];
    let matched: PolicyRule | null = null;
    let matchedConds: ConditionTrace[] = [];
    for (const rule of def.rules) {
      if (!rule.enabled) continue;
      const conds: ConditionTrace[] = [];
      const ok = evaluateCondition(rule.when, facts, conds);
      const entry: RuleTraceEntry = { ruleId: rule.id, clause: rule.clause, title: rule.title, matched: ok, conditions: conds };
      if (ok && rule.outcome.decision === 'PO') {
        if (rule.outcome.supplier === 'contract' && !chosen) {
          entry.matched = false;
          entry.skippedReason = 'conditions held but no usable contract supplier exists';
        } else if (rule.outcome.supplier === 'preferred_1' && !top) {
          entry.matched = false;
          entry.skippedReason = 'conditions held but there is no eligible preferred supplier (5.7)';
        }
      }
      ruleTrace.push(entry);
      if (entry.matched) {
        matched = rule;
        matchedConds = conds;
        break;
      }
    }

    let decision: RequirementResult['decision'] = '';
    let route = 'NOT_PROCESSED';
    let supplierId: string | null = null;
    let unitPrice: number | null = null;
    let suggested: string[] = [];
    let supplierText = '';
    const approvals: string[] = [];
    if (matched) {
      const o = matched.outcome;
      route = o.route;
      decision = o.decision === 'NOT_PROCESSED' ? '' : o.decision;
      approvals.push(...o.approvals);
      if (o.decision === 'PO') {
        if (o.supplier === 'contract' && chosen) {
          supplierId = chosen.supplierId;
          unitPrice = chosen.rate;
          consumed.set(chosen.contractId, (consumed.get(chosen.contractId) ?? 0) + chosen.valueAtRate);
          reliedOn.push(chosen.contractId);
          supplierText = `Contract ${chosen.contractId} with ${chosen.supplierId} ${ctx.suppliers.get(chosen.supplierId)?.name ?? ''} at ${formatPrice(chosen.rate)}; ${chosen.note}.`;
        } else if (o.supplier === 'preferred_1' && top) {
          supplierId = top.supplierId;
          unitPrice = top.referencePrice ?? unitPriceForValue;
          if (lpEligible) reliedOn.push(`PO ${lpEligible.poNumber}`);
          const refPo = top.referenceSource.startsWith('PO ') ? top.referenceSource.split(' ')[1] : null;
          if (refPo && !reliedOn.includes(`PO ${refPo}`)) reliedOn.push(`PO ${refPo}`);
          if (top.referenceSource.startsWith('Contract ')) reliedOn.push(top.referenceSource.replace('Contract ', ''));
          supplierText = `1st preferred supplier ${top.supplierId} ${top.supplierName} (score ${top.score.toFixed(3)}) at its reference price ${formatPrice(unitPrice)} from ${top.referenceSource}.${
            lpEligible ? ` Last bought from an Active supplier on PO ${lpEligible.poNumber} (${lpEligible.poDate}, ${lpEligible.supplierId}).` : ''
          }`;
        } else {
          warnings.push('Rule outcome is a PO but names no supplier strategy.');
        }
      } else if (o.decision === 'SOURCING_REQUEST' && o.suggestCount > 0 && (!r.isNew || def.suggestions.newItemsGetSuggestions)) {
        const s = suggestSuppliers(ctx, def, item?.category ?? null, preferred, o.suggestCount);
        suggested = s.ids;
        const fromList = suggested.filter((id) => !s.notes.includes(id));
        supplierText = `Suggested ${suggested.length ? suggested.join(', ') : 'none'}${
          fromList.length ? ` (preferred list: ${fromList.join(', ')}` : ' ('
        }${s.notes.length ? `${fromList.length ? '; ' : ''}category top-up: ${s.notes.join(', ')}` : ''}).`;
        if (suggested.length < o.suggestCount) supplierText += ` Only ${suggested.length} eligible supplier(s) found for ${o.suggestCount} required.`;
        if (lpAny && valuationSource === 'last_po') reliedOn.push(`PO ${lpAny.poNumber}`);
      } else if (r.isNew) {
        supplierText = 'New item: no supplier suggestions, the buyer finds suppliers (6.4).';
      }
      if (valuationSource === 'last_po' && decision !== 'PO') {
        const lp = lastPo(ctx, item!.code, reqDate, def.valuation.lastPoSuppliers === 'eligible' ? eligibleFilter : undefined);
        if (lp && !reliedOn.includes(`PO ${lp.poNumber}`)) reliedOn.push(`PO ${lp.poNumber}`);
      }
      if (valuationSource === 'contract_out_of_ceiling' && applicable[0] && !reliedOn.includes(applicable[0].contractId)) reliedOn.push(applicable[0].contractId);
    }

    const valueText = value !== null ? `Value ${formatINR(value)} = ${qty} ${item?.uom ?? first.input.uom} x ${valuationText}.` : `Value unknown (${valuationText}).`;
    const condText = matched ? matchedConds.filter((c) => c.result).map((c) => c.text).join('; ') : '';
    const reason = matched
      ? `Policy v${r.policy.record.version} clause ${matched.clause} (${matched.title}): ${condText || describeCondition(matched.when)}. ${valueText} ${supplierText}${
          r.lines.length > 1 ? ` Clubbed ${r.lines.length} PR lines (2.2).` : ''
        }${approvals.length ? ` Needs: ${approvals.join(', ')}.` : ''}`.trim()
      : `No rule in policy v${r.policy.record.version} matched this requirement. ${valueText}`;

    results.push({
      groupId: r.groupId,
      itemCode: item?.code ?? null,
      itemDescription: item?.description ?? first.input.description,
      category: item?.category ?? null,
      itemType: item?.itemType ?? null,
      plant: r.plant,
      isNewItem: r.isNew,
      requirementDate: reqDate,
      firstCreatedAt: first.createdAt ?? '',
      isEmergency,
      lineKeys: r.lines.map((l) => l.key),
      totalQuantity: qty,
      uom: item ? item.uom : canonicalUom(first.input.uom),
      unitPriceForValue,
      valuationSource,
      value,
      policyVersion: r.policy.record.version,
      policyVersionId: r.policy.record.id,
      ruleId: matched?.id ?? '',
      clause: matched?.clause ?? '',
      decision,
      route,
      supplierId,
      supplierName: supplierId ? ctx.suppliers.get(supplierId)?.name ?? null : null,
      unitPrice: unitPrice === null ? null : round2(unitPrice),
      poId: null,
      suggestedSupplierIds: suggested,
      approvals,
      reliedOn,
      reason,
      contractChecks,
      preferred,
      ruleTrace,
      facts,
      warnings: Array.from(new Set(warnings)),
    });
  }

  // ---------- 7. PO consolidation ----------
  const resultById = new Map(results.map((r) => [r.groupId, r]));
  const firstMin = (r: RequirementResult) => (r.firstCreatedAt ? minuteNum(r.firstCreatedAt) : Number.MAX_SAFE_INTEGER);
  const poReqs = results.filter((r) => r.decision === 'PO' && r.supplierId).sort((a, b) => firstMin(a) - firstMin(b) || a.groupId.localeCompare(b.groupId));
  const pos: (PurchaseOrderDraft & { firstMin: number; policyVersionId: string })[] = [];
  for (const r of poReqs) {
    const def = toResolved(versionRecords.find((v) => v.id === r.policyVersionId)!).def;
    const c = def.consolidation;
    let target = c.enabled
      ? pos.find(
          (po) =>
            po.policyVersionId === r.policyVersionId &&
            (!c.sameFields.includes('supplier') || po.supplierId === r.supplierId) &&
            (!c.sameFields.includes('plant') || po.plant === r.plant) &&
            (!c.sameFields.includes('route') || po.route === r.route) &&
            po.supplierId === r.supplierId &&
            firstMin(r) - po.firstMin <= c.windowHours * 60 &&
            (c.maxRequirementsPerPo === 0 || po.groupIds.length < c.maxRequirementsPerPo),
        )
      : undefined;
    if (!target) {
      target = {
        poId: `PO-${String(pos.length + 1).padStart(4, '0')}`,
        supplierId: r.supplierId!,
        supplierName: r.supplierName ?? '',
        plant: r.plant,
        route: r.route,
        firstCreatedAt: r.firstCreatedAt,
        groupIds: [],
        totalValue: 0,
        firstMin: firstMin(r),
        policyVersionId: r.policyVersionId,
      };
      pos.push(target);
    }
    target.groupIds.push(r.groupId);
    target.totalValue = round2(target.totalValue + (r.unitPrice ?? 0) * r.totalQuantity);
    r.poId = target.poId;
    if (target.groupIds.length > 1) {
      const firstReq = resultById.get(target.groupIds[0])!;
      r.reason += ` Consolidated into ${target.poId} with ${target.groupIds.length - 1} other requirement(s) (same supplier, plant and route within ${c.windowHours}h of ${firstReq.groupId}) (7.1).`;
      if (target.groupIds.length === 2) firstReq.reason += ` ${target.poId} also carries later requirements (7.1).`;
    }
  }

  // ---------- Output rows (one per PR line, input order) ----------
  const rows: DecisionRow[] = lines.map((l) => {
    if (l.status === 'NOT_PROCESSED' || !l.groupId) {
      return {
        pr_no: l.input.prNo,
        pr_line: l.input.prLine,
        resolved_item_code: l.match?.itemCode ?? (l.match?.method === 'new' ? 'NEW' : ''),
        group_id: '',
        po_id: '',
        decision: '',
        route: 'NOT_PROCESSED',
        supplier_id: '',
        unit_price: '',
        group_value_inr: '',
        suggested_supplier_ids: '',
        policy_version: l.policy.record.version,
        reason: `Not processed: ${l.notProcessedReason ?? 'invalid line'}`,
      };
    }
    const r = resultById.get(l.groupId)!;
    const isPo = r.decision === 'PO';
    return {
      pr_no: l.input.prNo,
      pr_line: l.input.prLine,
      resolved_item_code: r.itemCode ?? 'NEW',
      group_id: r.groupId,
      po_id: isPo ? r.poId ?? '' : '',
      decision: r.decision,
      route: r.route,
      supplier_id: isPo ? r.supplierId ?? '' : '',
      unit_price: isPo ? csvNumber(r.unitPrice) : '',
      group_value_inr: csvNumber(r.value),
      suggested_supplier_ids: r.decision === 'SOURCING_REQUEST' ? r.suggestedSupplierIds.join(';') : '',
      policy_version: r.policyVersion,
      reason: `${r.reason}${r.reliedOn.length ? ` Relied on: ${r.reliedOn.join(', ')}.` : ''}`,
    };
  });

  const byRoute: Record<string, number> = {};
  for (const row of rows) byRoute[row.route] = (byRoute[row.route] ?? 0) + 1;

  return {
    rows,
    lines: lines.map(({ createdMin, createdDate, needByDay, itemCode, plant, policy, ...rest }) => {
      void createdMin;
      void createdDate;
      void needByDay;
      void itemCode;
      void plant;
      void policy;
      return rest;
    }),
    requirements: results,
    purchaseOrders: pos.map(({ firstMin, policyVersionId, ...rest }) => {
      void firstMin;
      void policyVersionId;
      return rest;
    }),
    policyVersionsUsed: Array.from(new Set(results.map((r) => r.policyVersion))),
    summary: {
      lines: lines.length,
      requirements: results.length,
      purchaseOrders: pos.length,
      byRoute,
      notProcessed: rows.filter((r) => r.route === 'NOT_PROCESSED').length,
      totalValue: round2(results.reduce((s, r) => s + (r.value ?? 0), 0)),
    },
  };
}
