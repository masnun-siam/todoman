import type { Collected, CollectedIssue, Tracked } from './collect.js';
import { addDays, localDate, localTime } from './dates.js';
import { inPeriod, type Period } from './external.js';
import { BOT } from './markers.js';
import { sanitize } from './sanitize.js';

const NEXT_MS = 7 * 86_400_000;
const NOTE_MAX = 600;
export const EMPTY = 'Nothing this week.';
export const NO_SUMMARY = 'no summary added';

/** Claude's condensed text for one issue in a section. */
export interface Note {
  issue: number;
  note: string;
}
export interface Notes {
  done: Note[];
  meetings: Note[];
  tracked: Note[];
}
export const NO_NOTES: Notes = { done: [], meetings: [], tracked: [] };

export interface Sections {
  done: CollectedIssue[];
  /** Overdue first. */
  open: CollectedIssue[];
  meetings: CollectedIssue[];
  tracked: { issue: CollectedIssue; t: Tracked }[];
  next: CollectedIssue[];
  /** The run's local date ('YYYY-MM-DD'): before it a due date is overdue. */
  today: string;
  tz: string;
}

/** A task's due date from the `Due: YYYY-MM-DD` line its body carries (FR-3). */
export const dueOf = (i: CollectedIssue): string | undefined => /^Due: (\d{4}-\d{2}-\d{2})$/m.exec(i.body)?.[1];
const has = (i: CollectedIssue, label: string): boolean => i.labels.includes(label);
/** Comment text Claude reads: markers stripped, empty ones dropped. */
const texts = (i: CollectedIssue, from: (author: string) => boolean = () => true): string[] =>
  i.comments.filter((c) => from(c.author)).map((c) => c.body.replace(/<!--[\s\S]*?-->/g, '').trim()).filter(Boolean);
/** Meeting summaries are the comments a person added; Todoman's own are not. */
const summaries = (i: CollectedIssue): string[] => texts(i, (a) => a !== BOT);
const active = (t: Tracked, p: Period): boolean =>
  !t.activity.access || t.activity.comments.length > 0 || t.activity.mergedPrs.length > 0 || (t.activity.closedAt !== undefined && inPeriod(t.activity.closedAt, p));

/** FR-10: the collected issues grouped into the summary's sections. */
export function sections(c: Collected, p: Period, tz: string): Sections {
  const today = localDate(new Date(p.to), tz);
  const week = addDays(today, 7);
  const next: Period = { from: p.to, to: new Date(Date.parse(p.to) + NEXT_MS).toISOString() };
  const tasks = c.issues.filter((i) => has(i, 'task'));
  const open = tasks.filter((i) => i.state === 'open');
  const overdue = (i: CollectedIssue): boolean => (dueOf(i) ?? today) < today;
  const byNumber = new Map(c.issues.map((i) => [i.number, i]));
  const when = (i: CollectedIssue): string => (has(i, 'meeting') ? (i.start ?? '') : `${dueOf(i)}T00:00`);
  return {
    done: tasks.filter((i) => i.closedAt !== null && inPeriod(i.closedAt, p)),
    open: [...open.filter(overdue).sort((a, b) => (dueOf(a) ?? '').localeCompare(dueOf(b) ?? '')), ...open.filter((i) => !overdue(i))],
    meetings: c.issues.filter((i) => has(i, 'meeting') && i.start !== undefined && inPeriod(i.start, p)).sort((a, b) => Date.parse(a.start ?? '') - Date.parse(b.start ?? '')),
    tracked: c.tracked.filter((t) => active(t, p)).flatMap((t) => (byNumber.has(t.issue) ? [{ issue: byNumber.get(t.issue) as CollectedIssue, t }] : [])),
    next: [
      ...open.filter((i) => { const d = dueOf(i); return d !== undefined && d >= today && d < week; }),
      ...c.issues.filter((i) => has(i, 'meeting') && i.state === 'open' && i.start !== undefined && inPeriod(i.start, next)),
    ].sort((a, b) => when(a).localeCompare(when(b))),
    today,
    tz,
  };
}

/** True when a section has text for Claude to condense; otherwise the summary needs no Claude call. */
export const needsClaude = (s: Sections): boolean => s.done.some((i) => texts(i).length) || s.meetings.some((i) => summaries(i).length) || s.tracked.some(({ t }) => t.activity.access);

/** The JSON Claude reads (data, never instructions): only the text it condenses, keyed by issue number. */
export function summaryInput(s: Sections, p: Period): string {
  return JSON.stringify({
    period: p,
    timezone: s.tz,
    done: s.done.map((i) => ({ issue: i.number, title: i.title, comments: texts(i) })),
    meetings: s.meetings.filter((i) => summaries(i).length).map((i) => ({ issue: i.number, title: i.title, summaries: summaries(i) })),
    tracked: s.tracked.flatMap(({ issue, t }) =>
      t.activity.access
        ? [{ issue: issue.number, ref: t.ref, title: t.activity.title, state: t.activity.state, notes: texts(issue), comments: t.activity.comments.map((c) => ({ author: c.author, text: c.body })), mergedPrs: t.activity.mergedPrs.map((pr) => pr.title) }]
        : [],
    ),
  });
}

/** Claude's output as Notes: unknown shapes dropped, every note sanitised, one line, capped. */
export function toNotes(v: unknown): Notes {
  const list = (x: unknown): Note[] =>
    (Array.isArray(x) ? x : []).flatMap((n: { issue?: unknown; note?: unknown }) =>
      n && Number.isInteger(n.issue) && typeof n.note === 'string' && n.note.trim()
        ? [{ issue: n.issue as number, note: sanitize(n.note).replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX) }]
        : [],
    );
  const o = (v ?? {}) as Partial<Record<keyof Notes, unknown>>;
  return { done: list(o.done), meetings: list(o.meetings), tracked: list(o.tracked) };
}

const link = (i: CollectedIssue): string => `[${sanitize(i.title).replace(/[[\]]/g, '\\$&')}](${i.url})`;
const noteFor = (notes: Note[], i: CollectedIssue): string | undefined => notes.find((n) => n.issue === i.number)?.note;
const section = (title: string, lines: string[]): string => `## ${title}\n\n${lines.length ? lines.join('\n') : EMPTY}`;

function trackedLine({ issue, t }: Sections['tracked'][number], notes: Note[]): string {
  const a = t.activity;
  if (!a.access) return `- ${link(issue)} — no access`;
  const facts = [
    a.state,
    a.comments.length ? `${a.comments.length} new comment${a.comments.length === 1 ? '' : 's'}` : '',
    ...a.mergedPrs.map((pr) => `merged [${pr.title.replace(/[[\]]/g, '\\$&')}](${pr.url})`),
    noteFor(notes, issue) ?? '',
  ].filter(Boolean);
  return `- ${link(issue)} — ${facts.join('; ')}`;
}

/** FR-10 layout: headline with counts, Done, Open, Meetings, Tracked, Next 7 days; lists only, every line links its issue. */
export function renderSummary(s: Sections, notes: Notes, leftOut: number, marker: string): string {
  const at = (iso: string): string => `${localDate(new Date(iso), s.tz)} ${localTime(new Date(iso), s.tz)}`;
  const overdue = s.open.filter((i) => (dueOf(i) ?? s.today) < s.today).length;
  const headline = `**Done ${s.done.length} · Open ${s.open.length} (${overdue} overdue) · Meetings ${s.meetings.length} · Tracked ${s.tracked.length} · Next 7 days ${s.next.length}**`;
  const parts = [headline];
  if (leftOut) parts.push(`${leftOut} more issue${leftOut === 1 ? ' was' : 's were'} left out: only the 300 most recently updated are listed.`);
  parts.push(
    section('Done', s.done.map((i) => `- ${link(i)}${noteFor(notes.done, i) ? ` — ${noteFor(notes.done, i)}` : ''}`)),
    section('Open', s.open.map((i) => {
      const due = dueOf(i);
      return `- ${link(i)}${due ? ` — due ${due}${due < s.today ? ' (overdue)' : ''}` : ''}`;
    })),
    section('Meetings', s.meetings.map((i) => `- ${at(i.start ?? '')}: ${link(i)} — ${summaries(i).length ? (noteFor(notes.meetings, i) ?? 'summary added') : NO_SUMMARY}`)),
    section('Tracked', s.tracked.map((x) => trackedLine(x, notes.tracked))),
    section('Next 7 days', s.next.map((i) => `- ${i.start ? at(i.start) : `due ${dueOf(i)}`}: ${link(i)}`)),
    marker,
  );
  return parts.join('\n\n');
}
