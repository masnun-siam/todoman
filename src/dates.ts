const pad = (n: number): string => String(n).padStart(2, '0');
const DAY = 86_400_000;

interface Local {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  weekday: number; // 0 = Sunday
}

function localParts(at: Date, tz: string): Local {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

function offsetMinutes(at: Date, tz: string): number {
  const l = localParts(at, tz);
  return (Date.UTC(l.y, l.m - 1, l.d, l.h, l.mi) - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000;
}

const fmtOffset = (min: number): string => `${min < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(min) / 60))}:${pad(Math.abs(min) % 60)}`;

/** 'YYYY-MM-DD' of an instant in `tz`. */
export function localDate(at: Date, tz: string): string {
  const l = localParts(at, tz);
  return `${l.y}-${pad(l.m)}-${pad(l.d)}`;
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

/** ISO date-time with `tz`'s offset for a local wall-clock date ('YYYY-MM-DD') and time ('HH:mm'). */
export function atLocal(date: string, time: string, tz: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = offsetMinutes(new Date(guess), tz);
  const off = offsetMinutes(new Date(guess - first * 60_000), tz); // second pass settles DST edges
  return `${date}T${time}:00${fmtOffset(off)}`;
}

/**
 * Nearest future occurrence of a weekday (0 = Sunday), resolved against the time the message
 * was sent, never the time of a later run. Today counts if `time` is still ahead (or there is no time).
 * Returns 'YYYY-MM-DD', or an offset date-time when `time` ('HH:mm') is given.
 */
export function nextWeekday(sentAt: Date, weekday: number, tz: string, time?: string): string {
  const now = localParts(sentAt, tz);
  let delta = (weekday - now.weekday + 7) % 7;
  if (delta === 0 && time && time <= `${pad(now.h)}:${pad(now.mi)}`) delta = 7;
  const date = addDays(localDate(sentAt, tz), delta);
  return time ? atLocal(date, time, tz) : date;
}

/** A real calendar date in 'YYYY-MM-DD' form. */
export function isDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s;
}

/** Whole days from a to b (both 'YYYY-MM-DD'). */
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** An ISO date-time that carries an explicit offset (or Z); null otherwise. */
export function parseWithOffset(s: unknown): Date | null {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(s)) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) || !isDate(s.slice(0, 10)) ? null : new Date(t);
}
