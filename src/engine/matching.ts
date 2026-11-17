import type { Item, MatchResult } from './types';

/**
 * Deterministic item matcher (policy 1.1). It never invents items: it only ranks item master
 * entries against what the requester typed. Short forms ("brg", "hyd", "pneu"), units written
 * in different ways (24" / 24 inch), hyphens and plurals are normalised on both sides, then
 * candidates are scored with IDF-weighted token overlap. A size/model number in the request
 * that conflicts with the item ("M10" vs "M16") heavily penalises that item.
 */

const SYNONYMS: Record<string, string> = {
  brg: 'bearing',
  brgs: 'bearing',
  bearings: 'bearing',
  hyd: 'hydraulic',
  hydr: 'hydraulic',
  pneu: 'pneumatic',
  pneum: 'pneumatic',
  cyl: 'cylinder',
  rod: 'electrode',
  rods: 'electrode',
  elec: 'electric',
  sol: 'solenoid',
  valv: 'valve',
  mtr: 'mtr',
  qty: '',
  ltr: 'ltr',
  lit: 'ltr',
  litre: 'ltr',
  liter: 'ltr',
  inches: 'inch',
  '"': 'inch',
  mildsteel: 'ms',
  stainless: 'ss',
  ss304: 'ss 304',
  glove: 'glove',
  goggle: 'goggle',
  tonne: 'ton',
  tons: 'ton',
  calib: 'calibration',
  svc: 'service',
  services: 'service',
  monthly: 'monthly',
  laptops: 'laptop',
  monitors: 'monitor',
  sheets: 'sheet',
  bolts: 'bolt',
  nuts: 'nut',
  screws: 'screw',
  washers: 'washer',
  keyboard: 'keyboard',
  kb: 'keyboard',
  aluminum: 'aluminium',
  alu: 'aluminium',
  tyre: 'tire',
  ppe: 'ppe',
};

/** Words that carry no item meaning in a request. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'and', 'with', 'for', 'to', 'as', 'per', 'sample', 'urgent', 'urgently', 'asap',
  'repeat', 'required', 'require', 'req', 'need', 'needed', 'needs', 'pls', 'please', 'maintenance',
  'use', 'qty', 'nos', 'no', 'pcs', 'pc', 'piece', 'pieces', 'unit', 'units', 'some', 'approx', 'about',
  'new', 'same', 'type', 'item', 'items', 'kindly', 'want', 'buy', 'order', 'by', 'at', 'on', 'from',
  'immediately', 'in', 'i', 'we', 'our', 'my', 'is', 'are', 'it', 'this', 'that', 'like', 'or', 'just', 'stock',
]);

export function normalizeText(raw: string): string {
  let s = ` ${raw.toLowerCase()} `;
  s = s.replace(/×/g, 'x');
  s = s.replace(/[“”″]/g, '"');
  s = s.replace(/(\d)\s*"/g, '$1 inch ');
  s = s.replace(/"/g, ' ');
  s = s.replace(/\(([^)]*)\)/g, ' $1 ');
  // join number + unit written apart: "3 mm" -> "3mm", "30 hp" -> "30hp", "2 kw" -> "2kw"
  s = s.replace(/(\d)\s+(mm|kg|kw|hp|lph|cum|sqmm|micron|gsm|w|a|t)\b/g, '$1$2');
  // "1/2in" / "1/2 in" -> "1/2 inch"
  s = s.replace(/(\d)\s?in\b/g, '$1 inch');
  // dimensions "50 x 100" -> "50x100"
  s = s.replace(/(\d)\s*x\s*(\d)/g, '$1x$2');
  s = s.replace(/(\d)\s*x\s*(\d)/g, '$1x$2');
  // hyphens and other separators become spaces (keep '/', '.', and 'x' inside tokens)
  s = s.replace(/[-_,;:+*#!?&'`~|\\[\]{}<>=@$%^]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function stem(tok: string): string {
  if (/\d/.test(tok)) return tok;
  if (tok.length > 4 && tok.endsWith('ies')) return `${tok.slice(0, -3)}y`;
  if (tok.length > 3 && tok.endsWith('s') && !tok.endsWith('ss')) return tok.slice(0, -1);
  return tok;
}

export function tokenize(raw: string): string[] {
  const out: string[] = [];
  for (let t of normalizeText(raw).split(' ')) {
    t = t.replace(/^\.+|\.+$/g, '');
    if (!t) continue;
    if (t in SYNONYMS) {
      const syn = SYNONYMS[t];
      if (!syn) continue;
      for (const p of syn.split(' ')) out.push(stem(p));
      continue;
    }
    if (STOPWORDS.has(t)) continue;
    out.push(stem(t));
  }
  return out;
}

const hasDigit = (t: string) => /\d/.test(t);

export interface ItemIndex {
  items: Item[];
  tokens: Map<string, string[]>;
  idf: Map<string, number>;
  byCode: Map<string, Item>;
}

export function buildItemIndex(items: Item[]): ItemIndex {
  const tokens = new Map<string, string[]>();
  const df = new Map<string, number>();
  for (const it of items) {
    const toks = Array.from(new Set(tokenize(it.description)));
    tokens.set(it.code, toks);
    for (const t of toks) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = items.length || 1;
  const idf = new Map<string, number>();
  for (const [t, c] of df) idf.set(t, Math.log(1 + n / c));
  return { items, tokens, idf, byCode: new Map(items.map((i) => [i.code.toUpperCase(), i])) };
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const dp = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n];
}

/** Similarity of a query token to an item token (1 = same). Numbers must match exactly. */
function tokenSim(q: string, t: string): number {
  if (q === t) return 1;
  if (hasDigit(q) || hasDigit(t)) {
    // "6308zz" vs "6308 zz" style joins and "m10" inside "m10x40" are handled by exact tokens only
    return 0;
  }
  if (q.length >= 4 && t.startsWith(q)) return 0.85; // "pneumat" -> "pneumatic"
  if (t.length >= 4 && q.startsWith(t)) return 0.8;
  if (q.length >= 5 && t.length >= 5 && levenshtein(q, t) <= 1) return 0.85; // typo
  if (q.length >= 7 && t.length >= 7 && levenshtein(q, t) <= 2) return 0.7;
  return 0;
}

/** Numbers like "40" inside "m10x40" or "1250x2500" become comparable parts. */
function numericParts(tokens: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of tokens) {
    if (!hasDigit(t)) continue;
    out.add(t);
    for (const p of t.split(/x|\//)) if (p) out.add(p);
  }
  return out;
}

function scoreItem(queryTokens: string[], index: ItemIndex, item: Item): number {
  const itemTokens = index.tokens.get(item.code) ?? [];
  if (!itemTokens.length || !queryTokens.length) return 0;
  const w = (t: string) => (index.idf.get(t) ?? Math.log(1 + index.items.length)) * (hasDigit(t) ? 1.6 : 1);

  let matchedQ = 0;
  let totalQ = 0;
  const usedItem = new Set<string>();
  for (const q of queryTokens) {
    const qw = w(q);
    totalQ += qw;
    let best = 0;
    let bestTok = '';
    for (const t of itemTokens) {
      const s = tokenSim(q, t);
      if (s > best) {
        best = s;
        bestTok = t;
      }
    }
    if (best > 0) {
      matchedQ += qw * best;
      usedItem.add(bestTok);
    }
  }
  let totalI = 0;
  let matchedI = 0;
  for (const t of itemTokens) {
    const tw = w(t);
    totalI += tw;
    if (usedItem.has(t)) matchedI += tw;
  }
  const qCov = matchedQ / totalQ;
  const iCov = matchedI / totalI;
  let score = 0.6 * qCov + 0.4 * iCov;

  // Conflicting size/model numbers: the request names a number the item does not have AND the
  // item has a number the request does not have -> almost certainly a different variant.
  const qNums = numericParts(queryTokens);
  const iNums = numericParts(itemTokens);
  const qOnly = [...queryTokens.filter(hasDigit)].filter((t) => !iNums.has(t) && !t.split(/x|\//).every((p) => iNums.has(p)));
  const iOnly = [...itemTokens.filter(hasDigit)].filter((t) => !qNums.has(t) && !t.split(/x|\//).every((p) => qNums.has(p)));
  if (qOnly.length && iOnly.length) score *= 0.45;
  else if (qOnly.length) score *= 0.8;
  return Math.max(0, Math.min(1, score));
}

const CODE_RE = /\bitm[\s-]?(\d{4})\b/i;

export function findCodeInText(text: string): string | null {
  const m = text.match(CODE_RE);
  return m ? `ITM-${m[1]}` : null;
}

export interface MatchOptions {
  minScore: number;
  minMargin: number;
  useRequesterCode: boolean;
}

/** Rank candidates for free text. */
export function rankItems(text: string, index: ItemIndex, limit = 5) {
  const q = tokenize(text);
  return index.items
    .map((it) => ({ itemCode: it.code, description: it.description, score: Math.round(scoreItem(q, index, it) * 1000) / 1000 }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.itemCode.localeCompare(b.itemCode))
    .slice(0, limit);
}

export function matchItem(itemCode: string, description: string, index: ItemIndex, opts: MatchOptions): MatchResult {
  const code = (itemCode ?? '').trim().toUpperCase();
  if (code && opts.useRequesterCode) {
    const item = index.byCode.get(code);
    if (item) return { itemCode: item.code, method: 'code', score: 1, candidates: [{ itemCode: item.code, description: item.description, score: 1 }] };
  }
  const inText = findCodeInText(description ?? '');
  if (inText && index.byCode.has(inText)) {
    const item = index.byCode.get(inText)!;
    return { itemCode: item.code, method: 'code_in_text', score: 1, candidates: [{ itemCode: item.code, description: item.description, score: 1 }] };
  }
  const candidates = rankItems(description ?? '', index, 5);
  const note = code && !index.byCode.has(code) ? `Item code ${code} is not in the item master; matched on description instead.` : undefined;
  const best = candidates[0];
  if (!best || best.score < opts.minScore) {
    return { itemCode: null, method: 'new', score: best?.score ?? 0, candidates, note };
  }
  const second = candidates[1];
  if (second && best.score - second.score < opts.minMargin) {
    return { itemCode: null, method: 'ambiguous', score: best.score, candidates, note };
  }
  return { itemCode: best.itemCode, method: 'description', score: best.score, candidates, note };
}
