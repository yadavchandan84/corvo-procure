/**
 * Date helpers. All PR, PO and contract dates in Corvo data are local (IST) wall-clock values
 * without a timezone. We never convert timezones: dates are handled as day numbers and
 * datetimes as minute numbers, both computed in UTC from the naive wall-clock value.
 */

const DAY_MS = 86_400_000;

/** Parse 'YYYY-MM-DD', 'YYYY/MM/DD', 'DD-MM-YYYY' or 'DD/MM/YYYY' (optionally followed by a time). */
export function parseDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return fmt(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return fmt(+m[3], +m[2], +m[1]);
  return null;
}

/** Parse a naive datetime into 'YYYY-MM-DD HH:mm'. Time defaults to 00:00. */
export function parseDateTime(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input).trim();
  const date = parseDate(s);
  if (!date) return null;
  const t = s.match(/[ T](\d{1,2}):(\d{2})/);
  const hh = t ? Math.min(23, +t[1]) : 0;
  const mm = t ? Math.min(59, +t[2]) : 0;
  return `${date} ${pad(hh)}:${pad(mm)}`;
}

function fmt(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Day number for 'YYYY-MM-DD' (days since 1970-01-01). */
export function dayNum(date: string): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** Minute number for 'YYYY-MM-DD HH:mm'. */
export function minuteNum(dateTime: string): number {
  const day = dayNum(dateTime);
  const t = dateTime.slice(11, 16);
  const [hh, mm] = t ? t.split(':').map(Number) : [0, 0];
  return day * 1440 + (hh || 0) * 60 + (mm || 0);
}

export function dateOf(dateTime: string): string {
  return dateTime.slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return dayNum(to) - dayNum(from);
}

export function addDays(date: string, days: number): string {
  const dt = new Date((dayNum(date) + days) * DAY_MS);
  return dt.toISOString().slice(0, 10);
}

/** Today's date in IST as 'YYYY-MM-DD'. */
export function todayIST(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return ist.toISOString().slice(0, 10);
}

/** Current IST wall-clock time as 'YYYY-MM-DD HH:mm'. */
export function nowIST(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return ist.toISOString().slice(0, 16).replace('T', ' ');
}
