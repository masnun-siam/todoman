import { daysBetween, isDate, parseWithOffset } from './dates.js';
import { resolveInvitees, type Person } from './invitees.js';
import { LABELS } from './labels.js';
import { MAX_ITEMS, TOO_MANY } from './questions.js';
import { sanitize } from './sanitize.js';

export interface Question {
  about: string;
  question: string;
}
export type ValidItem =
  | { type: 'task'; title: string; body: string; labels: string[]; due?: string }
  | { type: 'meeting'; title: string; start: string; durationMinutes: number; invitees: Person[]; skipped: string[]; agenda: string }
  | { type: 'tracking'; ref: string; note: string }
  | { type: 'summary'; from: string; to: string };
export interface Validated {
  items: ValidItem[];
  questions: Question[];
}
export interface ValidateContext {
  now: Date;
  /** The dump plus Siam's comments on it: where names and refs must literally appear. */
  text: string;
  /** Labels that exist on the data repo. */
  labels: string[];
  people: Person[];
}

const TODOMAN_LABELS = new Set(LABELS.map((l) => l.name));
const YEAR = 365 * 86_400_000;

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? sanitize(v).trim() : '');
const names = (v: unknown): string[] | null => (v === undefined ? [] : Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null);

function checkTitle(raw: Raw): string | { fail: string } {
  const title = text(raw.title);
  if (!title) return { fail: 'What should the title be?' };
  if (title.length > 120) return { fail: 'The title is over 120 characters; please shorten it.' };
  return title;
}

function task(raw: Raw, ctx: ValidateContext): ValidItem | string {
  const title = checkTitle(raw);
  if (typeof title !== 'string') return title.fail;
  if (raw.due !== undefined && !isDate(raw.due)) return 'What is the due date (YYYY-MM-DD)?';
  const labels = (names(raw.labels) ?? [])
    .map((l) => ctx.labels.find((r) => r.toLowerCase() === l.toLowerCase())) // GitHub labels are case-insensitive; keep the repo's spelling
    .filter((l): l is string => !!l && !TODOMAN_LABELS.has(l) && !l.startsWith('repo:') && !l.startsWith('todoman:'));
  return { type: 'task', title, body: text(raw.body), labels, ...(raw.due ? { due: raw.due as string } : {}) };
}

function meeting(raw: Raw, ctx: ValidateContext, seen: Set<number>): ValidItem | string {
  const title = checkTitle(raw);
  if (typeof title !== 'string') return title.fail;
  const at = parseWithOffset(raw.start);
  if (!at) return 'When is the meeting (date, time and timezone)?';
  if (at.getTime() <= ctx.now.getTime()) return 'That meeting time is in the past; when should it be?';
  if (at.getTime() > ctx.now.getTime() + YEAR) return 'That meeting is more than a year away; when should it be?';
  const d = raw.durationMinutes ?? 30; // FR-4: missing duration defaults to 30 minutes
  if (typeof d !== 'number' || !Number.isInteger(d) || d < 5 || d > 480) return 'How long is the meeting (5 to 480 minutes)?';
  const attendees = names(raw.attendees);
  if (!attendees) return 'Who should be invited (names only)?';
  const agenda = text(raw.agenda).replace(/(https?:\/\/|www\.)\S+/gi, '').replace(/\s+/g, ' ').trim();
  if (agenda.length > 500) return 'The agenda is over 500 characters; please shorten it.';
  if (seen.has(at.getTime())) return 'Another meeting starts at the same time; when should this one be?';
  seen.add(at.getTime());
  const { invited, skipped } = resolveInvitees(attendees, ctx.people, ctx.text);
  return { type: 'meeting', title, start: raw.start as string, durationMinutes: d, invitees: invited, skipped, agenda };
}

const REF = /^[\w.-]+\/[\w.-]+#\d+$/;

function tracking(raw: Raw, ctx: ValidateContext): ValidItem | string {
  const ref = typeof raw.ref === 'string' ? raw.ref.trim() : '';
  if (!REF.test(ref)) return 'Which issue or pull request (owner/repo#n) should be tracked?';
  const [path, n] = ref.split('#');
  const esc = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lead = '(?<![\\w.-])'; // a longer owner or host in front must not match
  const named = new RegExp(`${lead}${esc(path)}#${n}(?!\\d)|${lead}github\\.com/${esc(path)}/(issues|pull)/${n}(?!\\d)`, 'i').test(ctx.text);
  if (!named) return `Which issue or pull request is ${ref}? It is not mentioned in your text.`;
  const note = text(raw.note);
  if (!note) return `What should the note on ${ref} say?`;
  return { type: 'tracking', ref, note };
}

function summary(raw: Raw): ValidItem | string {
  const { from, to } = raw;
  if (!isDate(from) || !isDate(to) || from > to) return 'Which period should the summary cover (dates)?';
  if (daysBetween(from, to) + 1 > 31) return 'A summary covers at most 31 days; which period?';
  return { type: 'summary', from, to };
}

/** Validates the parser output (FR-7): a failing item becomes a question, never an error. */
export function validate(output: unknown, ctx: ValidateContext): Validated {
  const o = isObj(output) ? output : {};
  const raw = Array.isArray(o.items) ? o.items : [];
  const questions: Question[] = (Array.isArray(o.questions) ? o.questions : [])
    .filter((q): q is Raw => isObj(q) && typeof q.about === 'string' && typeof q.question === 'string')
    .map((q) => ({ about: text(q.about), question: text(q.question) }));
  if (raw.length > MAX_ITEMS) return { items: [], questions: [TOO_MANY] };
  const items: ValidItem[] = [];
  const seen = new Set<number>();
  raw.forEach((r: unknown, i) => {
    const about = isObj(r) && typeof r.title === 'string' ? text(r.title) : `item ${i + 1}`;
    const type = isObj(r) ? r.type : undefined;
    const res =
      !isObj(r) ? 'What should this item be?'
      : type === 'task' ? task(r, ctx)
      : type === 'meeting' ? meeting(r, ctx, seen)
      : type === 'tracking' ? tracking(r, ctx)
      : type === 'summary' ? summary(r)
      : 'What kind of item is this: a task, meeting, tracking note or summary?';
    if (typeof res === 'string') questions.push({ about: about || `item ${i + 1}`, question: res });
    else items.push(res);
  });
  return { items, questions };
}
