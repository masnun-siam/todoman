import type { ClaudeRequest } from './claude.js';
import { collect } from './collect.js';
import { localDate } from './dates.js';
import type { ExternalReader, Period } from './external.js';
import type { ProcessGh, SummaryGh } from './github.js';
import { parseSummaryMarkers, summaryMarker } from './markers.js';
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
  const c = await collect(d.gh, d.reader, d.owner, p);
  const s = sections(c, p, d.tz);
  const notes = needsClaude(s)
    ? toNotes(await d.claude({ model: MODELS.summary, system: SUMMARY_SYSTEM, schema: SUMMARY_SCHEMA, input: summaryInput(s, p), validate: isNotes }))
    : NO_NOTES;
  const issue = await d.gh.createIssue({
    title: summaryTitle('Weekly summary', p, d.tz),
    body: renderSummary(s, notes, c.leftOut, summaryMarker({ kind: 'weekly', ...p })),
    labels: ['summary'],
    assignees: [d.owner],
  });
  d.log(`Weekly summary: ${issue.url}`);
}
