import * as chrono from 'chrono-node';
import { addDays } from '@/engine/dates';

/**
 * Deterministic slot extraction for the requester chat. Works without any AI. When an AI is
 * configured its extraction is merged in, but item codes always come from the item matcher.
 */
export interface Slots {
  itemText?: string;
  quantity?: number;
  uom?: string;
  plant?: string;
  needBy?: string;
  urgency?: 'Normal' | 'Emergency';
  urgentHint?: boolean;
  estimatedUnitPrice?: number;
  department?: string;
}

const UNIT_WORDS = 'nos|no|pcs|pc|pieces?|units?|kgs?|kg|kilos?|ltrs?|litres?|liters?|l|mtrs?|meters?|metres?|m|pairs?|prs?|sets?|rolls?|rol|reams?|jobs?|months?|mon|qtrs?|quarters?|cyl|cylinders?|bkts?|buckets?|brls?|barrels?|boxes?|nos\\.';

export const PLANTS: { code: string; re: RegExp }[] = [
  { code: 'CHK1', re: /\b(chk1|chakan)\b/i },
  { code: 'PUN1', re: /\b(pun1|bhosari|pune)\b/i },
];

const DEPARTMENTS = ['Maintenance', 'Production', 'Stores', 'Quality', 'Tool Room', 'IT', 'Admin'];

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function extractSlots(message: string, today: string): Slots {
  const out: Slots = {};
  let rest = ` ${message} `;

  // price: "@ 120", "at rs 120 each", "₹1,200 per unit", "estimated 500"
  const price = rest.match(/(?:@|\bat\s+(?:\brs\.?|₹|\binr\b)|(?:\brs\b\.?|₹|\binr\b)|\bestimate[ds]?\s*(?:price|cost|unit price)?\s*(?:of|is|:|=)?\s*(?:\brs\b\.?|₹|\binr\b)?)\s*([\d,]+(?:\.\d+)?)\s*(?:\/-)?\s*(?:each|per\s+\w+|\/\s*\w+|a\s+piece)?/i);
  if (price) {
    out.estimatedUnitPrice = Number(price[1].replace(/,/g, ''));
    rest = rest.replace(price[0], ' ');
  }

  // dates (relative to today in IST)
  const ref = new Date(`${today}T12:00:00`);
  const parsed = chrono.en.GB.parse(rest, ref, { forwardDate: true });
  if (parsed.length) {
    const p = parsed[0];
    out.needBy = isoLocal(p.start.date());
    rest = rest.replace(p.text, ' ');
  } else {
    const inDays = rest.match(/\bwithin\s+(\d+)\s+days?\b/i);
    if (inDays) {
      out.needBy = addDays(today, Number(inDays[1]));
      rest = rest.replace(inDays[0], ' ');
    }
  }
  rest = rest.replace(/\b(by|before|on|till|until|latest)\s+(?=\s|$)/gi, ' ');

  for (const p of PLANTS) {
    const m = rest.match(p.re);
    if (m) {
      out.plant = p.code;
      rest = rest.replace(new RegExp(`\\b(for|at|in|to)?\\s*(the)?\\s*${m[0]}\\s*(plant)?\\b`, 'i'), ' ');
      break;
    }
  }

  if (/\b(emergency|breakdown|line\s*down|machine\s*down|critical)\b/i.test(rest)) {
    out.urgency = 'Emergency';
    rest = rest.replace(/\b(it'?s\s+an?\s+)?(emergency|breakdown|line\s*down|machine\s*down|critical)\b/gi, ' ');
  } else if (/\b(normal|not urgent|routine|regular)\b/i.test(rest)) {
    out.urgency = 'Normal';
    rest = rest.replace(/\b(normal|not urgent|routine|regular)\b(\s+urgency)?/gi, ' ');
  } else if (/\b(urgent|urgently|asap|immediately)\b/i.test(rest)) {
    out.urgentHint = true;
    rest = rest.replace(/\b(urgent|urgently|asap|immediately)\b/gi, ' ');
  }

  for (const d of DEPARTMENTS) {
    const re = new RegExp(`\\b(for\\s+)?${d}(\\s+(dept|department|team))?\\b`, 'i');
    if (re.test(rest) && /dept|department|team|for /i.test(rest)) {
      out.department = d;
      rest = rest.replace(re, ' ');
      break;
    }
  }

  // quantity: first standalone number (not part of a size like 6205, M10, 1/2, 50x100), optional unit
  const explicit = rest.match(new RegExp(`\\b(?:qty|quantity)\\s*(?:of|:|=|is)?\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*(${UNIT_WORDS})?(?=\\s|$|[,.])`, 'i'));
  if (explicit) {
    out.quantity = Number(explicit[1].replace(/,/g, ''));
    if (explicit[2]) out.uom = explicit[2].toUpperCase();
    rest = rest.replace(explicit[0], ' ');
  } else {
    const qtyRe = new RegExp(`(?:^|\\s)(\\d{1,3}(?:,\\d{2,3})+|\\d+(?:\\.\\d+)?)\\s*(${UNIT_WORDS})?(?=\\s|$|[,.])`, 'gi');
    for (const words of rest.matchAll(qtyRe)) {
      const n = Number(words[1].replace(/,/g, ''));
      // a leading number is a quantity; a number after item words is only a quantity when a unit follows
      const before = rest.slice(0, words.index).trim();
      const leading = !before || /^(i\s+)?(need|want|require|order|get|buy|please|pls|kindly|send|we need|need about|about|around|approx)(\s+\w+){0,2}$/i.test(before);
      if (leading || words[2]) {
        out.quantity = n;
        if (words[2]) out.uom = words[2].toUpperCase();
        rest = rest.slice(0, words.index) + ' ' + rest.slice((words.index ?? 0) + words[0].length);
        break;
      }
    }
  }

  rest = rest
    .replace(/\b(hi|hello|hey|please|pls|kindly|i|we|need|needs|needed|want|require|required|would like|to order|order|get|buy|raise|a|an|the|pr|for|of|some|about|around|approx|urgency|plant|dept|department|thanks|thank you)\b/gi, ' ')
    .replace(/[,;:!?]+/g, ' ')
    .replace(/(^|\s)\.+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (rest.length >= 2 && /[a-z]/i.test(rest)) out.itemText = rest;
  return out;
}

export function isYes(text: string): boolean {
  return /^\s*(y|yes|yep|yeah|ok|okay|confirm|confirmed|correct|right|submit|go ahead|looks good|sure|create( it)?|raise( it)?)\b/i.test(text);
}

export function isNo(text: string): boolean {
  return /^\s*(n|no|nope|wrong|incorrect|not right)\b/i.test(text);
}

export function isCancel(text: string): boolean {
  return /^\s*(cancel|stop|start over|reset|restart|new request|clear)\b/i.test(text);
}
