import type { ClaudeRequest } from './claude.js';
import { collect } from './collect.js';
import { addDays, atLocal, localDate } from './dates.js';
import type { ExternalReader, Period } from './external.js';
import type { Issue, ProcessGh, SummaryGh } from './github.js';
import { parseSummaryMarkers, summaryMarker, type SummaryMarker } from './markers.js';
import { weeklyPeriod } from './periods.js';
import { MODELS, SUMMARY_SYSTEM } from './prompts.js';
import { SUMMARY_SCHEMA } from './schema.js';
import { needsClaude, NO_NOTES, renderSummary, sections, summaryInput, toNotes } from './summaryRender.js';

const DAY_MS = 86_400_000;

export interface SummaryDeps {
  gh: SummaryGh & Pick<ProcessGh, 'createIssue'>;
  reader: Pick<ExternalReader, 'readExternalActivity'>;
  owner: string;
  tz: string;
  now: () => Date;
  claude: (r: ClaudeRequest) => Promise<unknown>;
  log: (line: string) => void;
}

export const summaryTitle = (kind: string, p: Period, tz: string): string =>
  `${kind}: ${localDate(new Date(p.from), tz)} – ${localDate(new Date(p.to), tz)}`;

const isNotes = (v: unknown): boolean =>
  typeof v === 'object' && v !== null && ['done', 'meetings', 'tracked'].every((k) => Array.isArray((v as Record<string, unknown>)[k]));

/** FR-10: one weekly `summary` issue per period; a weekly summary created in the last 24 hours means this run creates nothing. */
export async function weeklySummary(d: SummaryDeps): Promise<void> {
  const now = d.now();
  const recent = (await d.gh.issuesLabelled('summary', 'all')).find(
    (i) => now.getTime() - Date.parse(i.createdAt) < DAY_MS && parseSummaryMarkers([i]).some((m) => m.kind === 'weekly'),
  );
  if (recent) {
    d.log(`Weekly summary already exists: ${recent.url}`);
    return;
  }
  const p = await weeklyPeriod(d.gh, now);
  const issue = await writeSummary(d, summaryTitle('Weekly summary', p, d.tz), { kind: 'weekly', ...p });
  d.log(`Weekly summary: ${issue.url}`);
}

/** FR-11: whole days `from`..`to` (YYYY-MM-DD) in `tz`, ending at `now` when the last day is today (or later). */
export function onDemandPeriod(from: string, to: string, tz: string, now: Date): Period {
  const end = Math.min(Date.parse(atLocal(addDays(to, 1), '00:00', tz)), now.getTime());
  return { from: new Date(atLocal(from, '00:00', tz)).toISOString(), to: new Date(end).toISOString() };
}

export const onDemandTitle = (from: string, to: string): string => `Summary: ${from} – ${to}`;

/**
 * FR-11: the summary for `from`..`to`; an existing one for exactly that period is reused only if it was
 * created after the period ended. `extra` goes on a fresh issue's body, e.g. the dump's item marker.
 */
export async function onDemandSummary(d: SummaryDeps, from: string, to: string, extra = ''): Promise<{ issue: Issue; reused: boolean }> {
  const p = onDemandPeriod(from, to, d.tz, d.now());
  if (p.from >= p.to) throw new Error('summary: the period has not started yet');
  const existing = (await d.gh.issuesLabelled('summary', 'all')).find(
    (i) => Date.parse(i.createdAt) >= Date.parse(p.to) && parseSummaryMarkers([i]).some((m) => m.from === p.from && m.to === p.to),
  );
  if (existing) return { issue: existing, reused: true };
  return { issue: await writeSummary(d, onDemandTitle(from, to), { kind: 'on-demand', ...p }, extra), reused: false };
}

/** FR-10 collection and layout for `m`'s period, opened as a `summary` issue assigned to the owner. */
async function writeSummary(d: SummaryDeps, title: string, m: SummaryMarker, extra = ''): Promise<Issue> {
  const p = { from: m.from, to: m.to };
  const c = await collect(d.gh, d.reader, d.owner, p);
  const s = sections(c, p, d.tz);
  const notes = needsClaude(s)
    ? toNotes(await d.claude({ model: MODELS.summary, system: SUMMARY_SYSTEM, schema: SUMMARY_SCHEMA, input: summaryInput(s, p), validate: isNotes }))
    : NO_NOTES;
  const marker = [summaryMarker(m), extra].filter(Boolean).join('\n');
  return d.gh.createIssue({ title, body: renderSummary(s, notes, c.leftOut, marker), labels: ['summary'], assignees: [d.owner] });
}
