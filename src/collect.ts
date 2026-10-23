import { STATE_LABELS } from './dump.js';
import { inPeriod, parseRef, type ExternalActivity, type ExternalReader, type Period } from './external.js';
import type { DatedIssue, IssueComment, SummaryGh } from './github.js';
import { hasLabel, isTodomanLabel, labelIn } from './labels.js';
import { parseItemMarkers, parseRefMarkers } from './markers.js';

export const MAX_ISSUES = 300;
const NEXT_MS = 7 * 86_400_000;

export interface CollectedIssue extends DatedIssue {
  /** In-period comments; for a meeting whose start falls in the period, all of them (summaries come after it). */
  comments: IssueComment[];
  /** Meeting start (UTC ISO) from the meeting issue's item marker. */
  start?: string;
}
export interface Tracked {
  /** The data repo's tracking issue. */
  issue: number;
  ref: string;
  activity: ExternalActivity;
}
export interface Collected {
  /** Most recently updated first, at most MAX_ISSUES. */
  issues: CollectedIssue[];
  /** Issues beyond MAX_ISSUES that were left out. */
  leftOut: number;
  tracked: Tracked[];
}

/** A dump: opened by the owner and carrying none of Todoman's labels or one of the dump state labels. */
const isDump = (i: DatedIssue, owner: string): boolean =>
  i.author === owner && (!i.labels.some(isTodomanLabel) || i.labels.some((l) => labelIn(l, STATE_LABELS)));
/** Dumps and summaries are never activity (FR-10). */
const counts = (i: DatedIssue, owner: string): boolean => !isDump(i, owner) && !hasLabel(i.labels, 'summary');
const startOf = (i: DatedIssue): string | undefined => parseItemMarkers([i]).find((m) => m.start)?.start;

/**
 * FR-10/FR-11: everything a summary of `p` needs. Data repo issues created, updated or closed in `p`
 * with their in-period comments; all open tasks; open meetings starting in the 7 days after `p`;
 * meetings starting in `p`; and for each tracking issue its external item's activity in `p`.
 */
export async function collect(gh: SummaryGh, reader: Pick<ExternalReader, 'readExternalActivity'>, owner: string, p: Period): Promise<Collected> {
  const [updated, openTasks, meetings, openTracking] = await Promise.all([
    gh.issuesUpdatedSince(p.from),
    gh.issuesLabelled('task', 'open'),
    gh.issuesLabelled('meeting', 'all'),
    gh.issuesLabelled('tracking', 'open'),
  ]);
  const allComments = new Map<number, IssueComment[]>();
  const commentsOf = async (n: number): Promise<IssueComment[]> => {
    if (!allComments.has(n)) allComments.set(n, await gh.listComments(n));
    return allComments.get(n) ?? [];
  };

  const active: DatedIssue[] = [];
  for (const i of updated.filter((x) => counts(x, owner) && Date.parse(x.createdAt) < Date.parse(p.to))) {
    // updated after `p` ends (an on-demand past period): only its comments can show activity inside `p`
    const touched = [i.createdAt, i.updatedAt, i.closedAt].some((t) => t && inPeriod(t, p));
    if (touched || (await commentsOf(i.number)).some((c) => inPeriod(c.createdAt, p))) active.push(i);
  }
  const next: Period = { from: p.to, to: new Date(Date.parse(p.to) + NEXT_MS).toISOString() };
  const meetingsKept = meetings.filter((i) => {
    const start = startOf(i);
    return start !== undefined && (inPeriod(start, p) || (i.state === 'open' && inPeriod(start, next)));
  });

  const byNumber = new Map<number, DatedIssue>();
  for (const i of [...active, ...openTasks, ...meetingsKept, ...openTracking]) if (counts(i, owner)) byNumber.set(i.number, i);
  const all = [...byNumber.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const kept = all.slice(0, MAX_ISSUES);

  // ponytail: sequential reads keep clear of GitHub's secondary rate limit; at most ~300 per run
  const issues: CollectedIssue[] = [];
  const tracked: Tracked[] = [];
  for (const i of kept) {
    const start = startOf(i);
    const meetingInPeriod = hasLabel(i.labels, 'meeting') && start !== undefined && inPeriod(start, p);
    // a comment bumps updated_at, so an issue last updated before `p` has no in-period comment to read
    const untouched = Date.parse(i.updatedAt) < Date.parse(p.from);
    const comments = meetingInPeriod ? await commentsOf(i.number) : untouched ? [] : (await commentsOf(i.number)).filter((c) => inPeriod(c.createdAt, p));
    issues.push({ ...i, comments, ...(start ? { start } : {}) });
    if (!hasLabel(i.labels, 'tracking')) continue;
    const ref = parseRefMarkers([i])[0];
    const r = ref ? parseRef(ref) : null;
    if (r) tracked.push({ issue: i.number, ref, activity: await reader.readExternalActivity(r, p) });
  }
  return { issues, leftOut: all.length - kept.length, tracked };
}
