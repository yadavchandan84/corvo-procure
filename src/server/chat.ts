import type { Prisma } from '@prisma/client';
import { prisma } from './db';
import { getApprovedVersions, getContext } from './repo';
import { addChatPr } from './runs';
import { llmConfig, llmJson } from './llm';
import { extractSlots, isCancel, isNo, isYes, type Slots } from './chat-parse';
import { findCodeInText, rankItems } from '@/engine/matching';
import { canonicalUom } from '@/engine/uom';
import { parseDate, todayIST } from '@/engine/dates';
import { formatINR, formatPrice } from '@/engine/format';
import { resolvePolicyVersion } from '@/engine/engine';
import { parsePolicyDefinition } from '@/engine/policy/schema';

/**
 * Requester chat: a slot-filling assistant. It matches the item against the item master (never
 * invents one), asks for whatever is missing (item, quantity, plant, need-by date, urgency, and an
 * estimated price for new items), confirms, creates the PR and tells the requester what the policy
 * will do with it.
 */

interface Draft {
  itemCode?: string | null;
  itemDescription?: string;
  itemUom?: string;
  isNew?: boolean;
  newDescription?: string;
  pendingText?: string;
  quantity?: number;
  uomGiven?: string;
  plant?: string;
  needBy?: string;
  urgency?: 'Normal' | 'Emergency';
  urgentHint?: boolean;
  estimatedUnitPrice?: number;
  department?: string;
}

interface ChatState {
  stage: 'collecting' | 'confirming' | 'done';
  awaiting?: 'item' | 'item_choice' | 'new_item_confirm' | 'quantity' | 'plant' | 'need_by' | 'urgency' | 'estimate' | 'confirm';
  candidates?: { itemCode: string; description: string; score: number }[];
  draft: Draft;
  created: string[];
}

export interface ChatReply {
  role: 'assistant';
  content: string;
  options?: { label: string; value: string }[];
  card?: Record<string, unknown>;
}

const fresh = (department?: string): ChatState => ({ stage: 'collecting', draft: { department }, created: [] });

async function aiSlots(message: string, today: string, awaiting?: string): Promise<Slots> {
  if (!llmConfig()) return {};
  try {
    const r = await llmJson<Record<string, unknown>>(
      `Extract purchase request details from an employee's chat message at an engineering factory. Plants: PUN1 (Bhosari, Pune) and CHK1 (Chakan). Return JSON {"item_text": string|null (the item as described, without quantity, plant, date or filler words), "quantity": number|null, "uom": string|null, "plant": "PUN1"|"CHK1"|null, "need_by": "YYYY-MM-DD"|null, "urgency": "Normal"|"Emergency"|null, "estimated_unit_price": number|null}. Only fill what the message states. Never guess item codes. Today is ${today}.${awaiting ? ` The assistant had just asked for: ${awaiting}.` : ''}`,
      message,
      { timeoutMs: 7000 },
    );
    const s: Slots = {};
    if (typeof r.item_text === 'string' && r.item_text.trim()) s.itemText = r.item_text.trim();
    if (typeof r.quantity === 'number' && r.quantity > 0) s.quantity = r.quantity;
    if (typeof r.uom === 'string' && r.uom) s.uom = r.uom.toUpperCase();
    if (r.plant === 'PUN1' || r.plant === 'CHK1') s.plant = r.plant;
    const nb = typeof r.need_by === 'string' ? parseDate(r.need_by) : null;
    if (nb) s.needBy = nb;
    if (r.urgency === 'Normal' || r.urgency === 'Emergency') s.urgency = r.urgency;
    if (typeof r.estimated_unit_price === 'number' && r.estimated_unit_price > 0) s.estimatedUnitPrice = r.estimated_unit_price;
    return s;
  } catch {
    return {};
  }
}

export async function handleChat(params: { sessionId?: string | null; message: string; user: string; department?: string }) {
  const user = params.user || 'Requester';
  let session = params.sessionId ? await prisma.chatSession.findUnique({ where: { id: params.sessionId } }) : null;
  if (!session) session = await prisma.chatSession.create({ data: { kind: 'REQUESTER', user, state: fresh(params.department) as unknown as Prisma.InputJsonValue } });
  let state = session.state as unknown as ChatState;
  const message = params.message.trim();
  await prisma.chatMessage.create({ data: { sessionId: session.id, role: 'user', content: message } });

  const replies: ChatReply[] = [];
  const say = (content: string, extra: Partial<ChatReply> = {}) => replies.push({ role: 'assistant', content, ...extra });

  const ctx = await getContext();
  const versions = await getApprovedVersions();
  const today = todayIST();
  const policy = parsePolicyDefinition(resolvePolicyVersion(versions, today).version.definition);
  const plants = policy.scope.plants;

  if (isCancel(message)) {
    state = fresh(state.draft.department);
    say('Cleared. What do you need to buy? For example: "need 200 nitrile gloves for Chakan by next Friday".');
    return save(session.id, state, replies);
  }
  if (state.stage === 'done') state = { ...fresh(state.draft.department), created: state.created };
  const d = state.draft;
  if (params.department && !d.department) d.department = params.department;

  const setItem = (code: string) => {
    const it = ctx.items.get(code)!;
    d.itemCode = it.code;
    d.itemDescription = it.description;
    d.itemUom = it.uom;
    d.isNew = false;
    d.newDescription = undefined;
    state.candidates = undefined;
  };

  /** Match free text to the item master; returns true when resolved without a question. */
  const resolveItem = (text: string): boolean => {
    const code = findCodeInText(text);
    if (code && ctx.items.has(code)) {
      setItem(code);
      say(`Item ${code}: ${ctx.items.get(code)!.description} (unit ${ctx.items.get(code)!.uom}).`);
      return true;
    }
    const ranked = rankItems(text, ctx.itemIndex, 4);
    const [best, second] = ranked;
    if (best && best.score >= 0.85 && (!second || best.score - second.score >= 0.1)) {
      setItem(best.itemCode);
      say(`I matched "${text}" to ${best.itemCode} ${best.description} (unit ${ctx.items.get(best.itemCode)!.uom}).`);
      return true;
    }
    d.pendingText = text;
    if (best && best.score >= 0.4) {
      state.candidates = ranked.filter((r) => r.score >= 0.3).slice(0, 3);
      state.awaiting = 'item_choice';
      say(`Which item do you mean by "${text}"?`, {
        options: [...state.candidates.map((c) => ({ label: `${c.itemCode} ${c.description}`, value: c.itemCode })), { label: 'None of these: it is a new item', value: 'NEW' }],
      });
      return false;
    }
    state.awaiting = 'new_item_confirm';
    say(`I could not find "${text}" in the item master. Is this a new item that Corvo has not bought before? If you meant something else, describe it differently or give the item code.`, {
      options: [
        { label: 'Yes, it is a new item', value: 'yes' },
        { label: 'No, let me rephrase', value: 'no' },
      ],
    });
    return false;
  };

  // ----- answers to a specific question -----
  let slots: Slots = {};
  let consumedAsAnswer = false;
  if (state.awaiting === 'item_choice') {
    const pick = message.toUpperCase().match(/ITM-\d{4}|NEW|^[1-3]$/)?.[0];
    if (pick === 'NEW' || /new item|none/i.test(message)) {
      d.isNew = true;
      d.itemCode = null;
      d.newDescription = d.pendingText;
      state.candidates = undefined;
      say(`OK, I will raise "${d.newDescription}" as a new item. It goes to sourcing so Procurement can find suppliers.`);
      consumedAsAnswer = true;
    } else if (pick) {
      const code = /^[1-3]$/.test(pick) ? state.candidates?.[Number(pick) - 1]?.itemCode : pick;
      if (code && ctx.items.has(code)) {
        setItem(code);
        say(`Got it: ${code} ${d.itemDescription} (unit ${d.itemUom}).`);
        consumedAsAnswer = true;
      }
    }
  } else if (state.awaiting === 'new_item_confirm') {
    if (isYes(message)) {
      d.isNew = true;
      d.itemCode = null;
      d.newDescription = d.pendingText;
      say(`OK, "${d.newDescription}" will be raised as a new item (policy 1.2: new items always go to sourcing).`);
      consumedAsAnswer = true;
    } else if (isNo(message)) {
      state.awaiting = 'item';
      say('Please describe the item again, e.g. with its size or model, or give the item code.');
      return save(session.id, state, replies);
    }
  } else if (state.awaiting === 'confirm') {
    if (isYes(message)) return create(session.id, state, replies, user, policy.scope.plants);
    if (isNo(message)) {
      say('What should I change? You can say e.g. "quantity 300", "plant Chakan", "need by 5 Dec" or "emergency".');
      return save(session.id, state, replies);
    }
  }

  if (!consumedAsAnswer) {
    slots = extractSlots(message, today);
    // a bare number answers the question we asked
    const bare = message.match(/^\s*(?:rs\.?|₹)?\s*([\d,]+(?:\.\d+)?)\s*([a-z]+)?\s*$/i);
    if (bare && state.awaiting === 'estimate') slots = { estimatedUnitPrice: Number(bare[1].replace(/,/g, '')) };
    if (bare && state.awaiting === 'quantity') slots = { quantity: Number(bare[1].replace(/,/g, '')), uom: bare[2]?.toUpperCase() };
    if (state.awaiting === 'urgency' && /\bno\b|not/i.test(message) && !slots.urgency) slots.urgency = 'Normal';
    if (state.awaiting === 'urgency' && /\byes\b/i.test(message) && !slots.urgency) slots.urgency = 'Emergency';
    // the AI only helps with free-form descriptions; short answers to a question are parsed locally,
    // so a slow or busy AI never slows down the conversation
    const freeForm = !state.awaiting || state.awaiting === 'item';
    const ai = freeForm ? await aiSlots(message, today, state.awaiting) : {};
    slots = { ...ai, ...Object.fromEntries(Object.entries(slots).filter(([, v]) => v !== undefined)), itemText: ai.itemText ?? slots.itemText };
    if (state.awaiting && !['item', 'item_choice', 'new_item_confirm'].includes(state.awaiting) && (d.itemCode || d.isNew)) {
      // while answering another question, leftover words are not a new item
      const ranked = slots.itemText ? rankItems(slots.itemText, ctx.itemIndex, 1) : [];
      if (!(ranked[0] && ranked[0].score >= 0.85 && ranked[0].itemCode !== d.itemCode)) slots.itemText = undefined;
    }
  }

  if (slots.quantity !== undefined) {
    if (slots.quantity <= 0) say('The quantity must be more than zero.');
    else d.quantity = slots.quantity;
  }
  if (slots.uom) d.uomGiven = slots.uom;
  if (slots.plant) {
    if (plants.includes(slots.plant)) d.plant = slots.plant;
    else say(`Plant ${slots.plant} is not covered by the procurement policy (${plants.join(', ')}).`);
  }
  if (slots.needBy) {
    if (slots.needBy < today) say(`${slots.needBy} is in the past. When do you need it?`);
    else d.needBy = slots.needBy;
  }
  if (slots.urgency) d.urgency = slots.urgency;
  if (slots.urgentHint && !d.urgency) d.urgentHint = true;
  if (slots.estimatedUnitPrice !== undefined) d.estimatedUnitPrice = slots.estimatedUnitPrice;
  if (slots.department) d.department = slots.department;

  if (slots.itemText && !consumedAsAnswer) {
    const resolved = resolveItem(slots.itemText);
    if (!resolved) return save(session.id, state, replies);
  }

  // ----- what is still missing -----
  if (!d.itemCode && !d.isNew) {
    state.awaiting = 'item';
    if (!replies.length) say('What item do you need? Give a description (with size or model if it has one) or the item code.');
    return save(session.id, state, replies);
  }
  if (!d.quantity) {
    state.awaiting = 'quantity';
    say(`How many${d.itemUom ? ` (in ${d.itemUom})` : ''}?`);
    return save(session.id, state, replies);
  }
  if (!d.plant) {
    state.awaiting = 'plant';
    say('Which plant is it for?', { options: plants.map((p) => ({ label: `${p} ${ctx.data.plants.find((x) => x.code === p)?.name ?? ''}`.trim(), value: p })) });
    return save(session.id, state, replies);
  }
  if (!d.needBy) {
    state.awaiting = 'need_by';
    say('By when do you need it? (a date, or e.g. "next Friday", "in 2 weeks")');
    return save(session.id, state, replies);
  }
  if (!d.urgency) {
    state.awaiting = 'urgency';
    say(
      d.urgentHint
        ? 'You said it is urgent. Is it an Emergency (breakdown or production stoppage)? Emergencies can be bought without quotes up to the emergency limit; otherwise it is Normal.'
        : 'Is this a normal requirement or an Emergency (breakdown or production stoppage)?',
      { options: [{ label: 'Normal', value: 'Normal' }, { label: 'Emergency', value: 'Emergency' }] },
    );
    return save(session.id, state, replies);
  }
  if (d.isNew && d.estimatedUnitPrice === undefined) {
    state.awaiting = 'estimate';
    say('This is a new item, so I need your estimated unit price (₹, excluding GST) to value the request.');
    return save(session.id, state, replies);
  }

  // ----- confirm -----
  state.stage = 'confirming';
  state.awaiting = 'confirm';
  const uom = d.isNew ? canonicalUom(d.uomGiven) || 'NOS' : d.itemUom!;
  const uomNote = !d.isNew && d.uomGiven && canonicalUom(d.uomGiven) !== d.itemUom ? ` Note: this item is bought in ${d.itemUom}; the quantity is recorded in ${d.itemUom}.` : '';
  say(`Please confirm the purchase request:${uomNote}`, {
    card: {
      type: 'pr_summary',
      item: d.isNew ? `NEW: ${d.newDescription}` : `${d.itemCode} ${d.itemDescription}`,
      quantity: `${d.quantity} ${uom}`,
      plant: d.plant,
      needBy: d.needBy,
      urgency: d.urgency,
      department: d.department ?? '',
      estimate: d.estimatedUnitPrice !== undefined ? formatPrice(d.estimatedUnitPrice) : '',
    },
    options: [
      { label: 'Confirm and raise PR', value: 'yes' },
      { label: 'Change something', value: 'no' },
    ],
  });
  return save(session.id, state, replies);
}

async function create(sessionId: string, state: ChatState, replies: ChatReply[], user: string, plants: string[]) {
  const d = state.draft;
  void plants;
  const { prNo, result } = await addChatPr(
    {
      requester: user,
      department: d.department ?? '',
      plant: d.plant!,
      itemCode: d.isNew ? 'NEW' : d.itemCode!,
      description: d.isNew ? d.newDescription! : d.itemDescription!,
      quantity: String(d.quantity),
      uom: d.isNew ? canonicalUom(d.uomGiven) || 'NOS' : d.itemUom!,
      estimatedUnitPrice: d.estimatedUnitPrice !== undefined ? String(d.estimatedUnitPrice) : '',
      needByDate: d.needBy!,
      urgency: d.urgency!,
    },
    user,
  );
  const row = result.rows.find((r) => r.pr_no === prNo);
  const req = row?.group_id ? result.requirements.find((r) => r.groupId === row.group_id) : undefined;
  let outcome = '';
  if (row?.route === 'NOT_PROCESSED') outcome = `It could not be processed: ${row.reason}`;
  else if (req) {
    const others = req.lineKeys.filter((k) => !k.startsWith(`${prNo}/`));
    const what =
      req.decision === 'PO'
        ? `${req.route.replace('_', ' ')} to ${req.supplierId} ${req.supplierName ?? ''} at ${formatPrice(req.unitPrice)} per ${req.uom}`
        : `${req.route.replace(/_/g, ' ')}${req.suggestedSupplierIds.length ? ` with suggested suppliers ${req.suggestedSupplierIds.join(', ')}` : ''}`;
    outcome = `Under policy v${req.policyVersion} (clause ${req.clause} ${req.ruleTrace.find((t) => t.matched)?.title ?? ''}) it goes to ${what}. Requirement value ${formatINR(req.value)}.${
      others.length ? ` It was clubbed with ${others.join(', ')} (same item and plant, policy 2.2), so the limits apply to the total.` : ''
    } A buyer will review it in the workspace.`;
  }
  replies.push({
    role: 'assistant',
    content: `Raised ${prNo}. ${outcome}`,
    card: req ? { type: 'pr_created', prNo, groupId: req.groupId, route: req.route, decision: req.decision, supplier: req.supplierId, value: req.value, clause: req.clause, version: req.policyVersion } : { type: 'pr_created', prNo },
    options: [{ label: 'Raise another request', value: 'new request' }],
  });
  state.created = [...state.created, prNo];
  state.stage = 'done';
  state.awaiting = undefined;
  return save(sessionId, state, replies);
}

async function save(sessionId: string, state: ChatState, replies: ChatReply[]) {
  await prisma.chatSession.update({ where: { id: sessionId }, data: { state: state as unknown as Prisma.InputJsonValue } });
  for (const r of replies) {
    await prisma.chatMessage.create({ data: { sessionId, role: 'assistant', content: r.content, meta: { options: r.options, card: r.card } as unknown as Prisma.InputJsonValue } });
  }
  return { sessionId, replies, state };
}

export async function getChat(sessionId: string) {
  const s = await prisma.chatSession.findUnique({ where: { id: sessionId }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
  if (!s) return null;
  return {
    sessionId: s.id,
    state: s.state,
    messages: s.messages.map((m) => ({ role: m.role, content: m.content, ...((m.meta as object) ?? {}) })),
  };
}
