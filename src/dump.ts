import type { Issue, IssueComment, ProcessGh } from './github.js';
import { BOT, lastRead, parseItemMarkers, parseRefMarkers, type ItemMarker } from './markers.js';

export const PROCESSING = 'todoman:processing';
export type EndState = 'processed' | 'needs-info' | 'failed';
export const STATE_LABELS: string[] = [PROCESSING, 'processed', 'needs-info', 'failed'];
const TYPE_LABELS = ['task', 'meeting', 'tracking', 'summary'];
const STUCK_MS = 15 * 60_000;

export interface Dump {
  issue: Issue;
  comments: IssueComment[];
  /** When todoman:processing was last added; null when the dump does not carry it. */
  processingSince: Date | null;
}

/** An issue Todoman already created for this dump, found by its item marker. */
export interface CreatedItem {
  key: string;
  type: string;
  title: string;
  url: string;
  /** A tracking issue's reference, `owner/repo#n`. */
  ref?: string;
}

/** The live dump: issue, whole thread and how long it has been processing. */
export async function readDump(gh: ProcessGh, n: number): Promise<Dump> {
  const [issue, comments] = await Promise.all([gh.getIssue(n), gh.listComments(n)]);
  const processingSince = issue.labels.includes(PROCESSING) ? await gh.labeledAt(n, PROCESSING) : null;
  return { issue, comments, processingSince };
}

/**
 * FR-8 gate on the live dump: an open dump with no state label, or one in needs-info, failed or
 * todoman:processing for over 15 minutes that has an owner comment newer than the last one read.
 */
export function shouldProcess(d: Dump, owner: string, now: Date): boolean {
  const { issue } = d;
  if (issue.state !== 'open' || issue.author !== owner || issue.labels.some((l) => TYPE_LABELS.includes(l))) return false;
  const states = issue.labels.filter((l) => STATE_LABELS.includes(l));
  if (states.length === 0) return true;
  if (states.includes(PROCESSING)) {
    // ponytail: no label event found counts as not stuck; the next comment after it shows up retries
    const stuck = d.processingSince !== null && now.getTime() - d.processingSince.getTime() > STUCK_MS;
    if (!stuck) return false;
  } else if (!states.some((l) => l === 'needs-info' || l === 'failed')) return false;
  const read = lastRead(d.comments);
  return d.comments.some((c) => c.author === owner && c.id > read);
}

/** Item markers for this dump from bot-authored issues created since the dump, and from its comments. */
export async function createdItems(gh: ProcessGh, repo: string, d: Dump): Promise<{ items: CreatedItem[]; markers: ItemMarker[] }> {
  const mine = (m: ItemMarker): boolean => m.repo === repo && m.dump === d.issue.number;
  const items: CreatedItem[] = [];
  for (const i of await gh.issuesSince(d.issue.createdAt)) {
    const src = [{ author: i.author, body: i.body }];
    const [ref] = parseRefMarkers(src);
    for (const m of parseItemMarkers(src).filter(mine)) {
      items.push({ key: m.key, type: i.labels.find((l) => TYPE_LABELS.includes(l)) ?? 'item', title: i.title, url: i.url, ...(ref ? { ref } : {}) });
    }
  }
  const fromComments = parseItemMarkers(d.comments).filter(mine);
  return { items, markers: [...items.map((i) => ({ repo, dump: d.issue.number, key: i.key })), ...fromComments] };
}

/** Owner and Todoman comments, oldest first: the thread Claude reads. */
export const thread = (d: Dump, owner: string): IssueComment[] => d.comments.filter((c) => c.author === owner || c.author === BOT);

/** Swap the dump's state label: add the new one first, so it never sits with none. */
export async function setState(gh: ProcessGh, issue: Issue, state: EndState | typeof PROCESSING): Promise<void> {
  if (!issue.labels.includes(state)) await gh.addLabel(issue.number, state);
  for (const l of issue.labels.filter((x) => STATE_LABELS.includes(x) && x !== state)) await gh.removeLabel(issue.number, l);
  issue.labels = [...issue.labels.filter((x) => !STATE_LABELS.includes(x)), state];
}
