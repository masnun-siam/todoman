import { describe, expect, it, vi } from 'vitest';
import { collect, MAX_ISSUES } from '../src/collect.js';
import type { ExternalActivity, Period } from '../src/external.js';
import type { DatedIssue, IssueComment, SummaryGh } from '../src/github.js';
import { BOT, itemMarker, refMarker } from '../src/markers.js';

const OWNER = 'masnun-siam';
const P: Period = { from: '2026-10-15T12:00:00.000Z', to: '2026-10-22T12:00:00.000Z' };
const IN = '2026-10-18T00:00:00Z';
const BEFORE = '2026-10-01T00:00:00Z';
const AFTER = '2026-10-23T00:00:00Z';

const issue = (number: number, over: Partial<DatedIssue> = {}): DatedIssue => ({
  number, title: `#${number}`, body: '', url: `https://github.com/o/todo/issues/${number}`, author: BOT, state: 'open',
  labels: ['task'], createdAt: BEFORE, updatedAt: IN, closedAt: null, ...over,
});
const meeting = (number: number, start: string, over: Partial<DatedIssue> = {}): DatedIssue =>
  issue(number, { labels: ['meeting'], body: itemMarker({ repo: 'o/todo', dump: 1, key: 'i1', start }), updatedAt: BEFORE, ...over });
const c = (createdAt: string, body = 'c'): IssueComment => ({ id: 1, author: OWNER, body, createdAt });

interface Data {
  all: DatedIssue[];
  comments?: Record<number, IssueComment[]>;
}
/** Answers like GitHub's list endpoints over `all`. */
function stub({ all, comments = {} }: Data): SummaryGh & { listComments: ReturnType<typeof vi.fn> } {
  return {
    issuesUpdatedSince: async (since) => all.filter((i) => i.updatedAt >= since),
    issuesLabelled: async (label, state) => all.filter((i) => i.labels.includes(label) && (state === 'all' || i.state === 'open')),
    listComments: vi.fn(async (n: number) => comments[n] ?? []),
  };
}
const noReader = { readExternalActivity: vi.fn(async (): Promise<ExternalActivity> => ({ access: false })) };
const numbers = (r: { issues: DatedIssue[] }) => r.issues.map((i) => i.number).sort((a, b) => a - b);

describe('collect', () => {
  it('keeps issues created, updated or closed in the period with only in-period comments', async () => {
    const gh = stub({
      all: [
        issue(1, { state: 'closed', closedAt: IN }),
        issue(2, { labels: ['area'], author: 'someone' }),
        issue(3, { state: 'closed', updatedAt: BEFORE, closedAt: BEFORE }), // untouched closed task
      ],
      comments: { 1: [c(BEFORE, 'old'), c(IN, 'new'), c(AFTER, 'later')] },
    });
    const got = await collect(gh, noReader, OWNER, P);
    expect(numbers(got)).toEqual([1, 2]);
    expect(got.issues.find((i) => i.number === 1)?.comments.map((x) => x.body)).toEqual(['new']);
    expect(got.leftOut).toBe(0);
  });

  it('never reads dumps or summaries as activity', async () => {
    const gh = stub({
      all: [
        issue(1, { author: OWNER, labels: [] }), // new dump
        issue(2, { author: OWNER, labels: ['area'] }), // dump with an area label only
        issue(3, { author: OWNER, labels: ['processed'], state: 'closed', closedAt: IN }),
        issue(4, { author: OWNER, labels: ['needs-info', 'task'] }), // state label wins
        issue(5, { labels: ['summary'] }),
        issue(6, { author: OWNER, labels: ['task'] }), // a task Siam labelled by hand counts
      ],
    });
    const got = await collect(gh, noReader, OWNER, P);
    expect(numbers(got)).toEqual([6]);
    expect(gh.listComments).not.toHaveBeenCalledWith(1);
  });

  it('includes every open task, even one untouched in the period', async () => {
    const gh = stub({ all: [issue(1, { updatedAt: BEFORE }), issue(2, { updatedAt: BEFORE, state: 'closed', closedAt: BEFORE })] });
    expect(numbers(await collect(gh, noReader, OWNER, P))).toEqual([1]);
    expect(gh.listComments).not.toHaveBeenCalled(); // untouched since before the period: no in-period comment
  });

  it('includes meetings starting in the period (with all comments) and open ones in the next 7 days', async () => {
    const gh = stub({
      all: [
        meeting(1, '2026-10-20T05:00:00.000Z', { state: 'closed' }), // in period, last updated before it
        meeting(2, '2026-10-25T05:00:00.000Z'), // next 7 days
        meeting(3, '2026-10-25T05:00:00.000Z', { state: 'closed' }), // next 7 days but closed
        meeting(4, '2026-11-05T05:00:00.000Z'), // too far ahead
        meeting(5, '2026-10-01T05:00:00.000Z'), // long past
      ],
      comments: { 1: [c('2026-10-10T00:00:00Z', 'notes before the period')] },
    });
    const got = await collect(gh, noReader, OWNER, P);
    expect(numbers(got)).toEqual([1, 2]);
    expect(got.issues.find((i) => i.number === 1)).toMatchObject({ start: '2026-10-20T05:00:00.000Z', comments: [{ body: 'notes before the period' }] });
  });

  it('ignores a meeting start forged by a non-bot author', async () => {
    const gh = stub({ all: [meeting(1, '2026-10-20T05:00:00.000Z', { author: 'someone' })] });
    expect(numbers(await collect(gh, noReader, OWNER, P))).toEqual([]);
  });

  it('for an on-demand past period, counts an issue updated after it only if it had an in-period comment', async () => {
    const gh = stub({
      all: [issue(1, { updatedAt: AFTER, state: 'closed', closedAt: AFTER }), issue(2, { updatedAt: AFTER, state: 'closed', closedAt: AFTER })],
      comments: { 1: [c(IN)], 2: [c(AFTER)] },
    });
    expect(numbers(await collect(gh, noReader, OWNER, P))).toEqual([1]);
  });

  it('reads each tracking issue external activity for the period through the reader', async () => {
    const activity: ExternalActivity = { access: true, title: 'Fix', state: 'merged', comments: [], mergedPrs: [{ title: 'Fix', url: 'pr', mergedAt: IN }] };
    const reader = { readExternalActivity: vi.fn(async () => activity) };
    const gh = stub({
      all: [
        issue(1, { labels: ['tracking'], body: refMarker('masnun-siam/meeting-manager#85'), updatedAt: BEFORE }),
        issue(2, { labels: ['tracking'], body: 'no marker' }),
      ],
    });
    const got = await collect(gh, reader, OWNER, P);
    expect(got.tracked).toEqual([{ issue: 1, ref: 'masnun-siam/meeting-manager#85', activity }]);
    expect(reader.readExternalActivity).toHaveBeenCalledWith({ owner: 'masnun-siam', repo: 'meeting-manager', number: 85 }, P);
  });

  it(`keeps the ${MAX_ISSUES} most recently updated issues and reports how many were left out`, async () => {
    const at = (k: number) => new Date(Date.parse(P.from) + k * 1000).toISOString();
    const gh = stub({ all: Array.from({ length: MAX_ISSUES + 5 }, (_, k) => issue(k + 1, { updatedAt: at(k) })) });
    const got = await collect(gh, noReader, OWNER, P);
    expect(got.issues).toHaveLength(MAX_ISSUES);
    expect(got.leftOut).toBe(5);
    expect(got.issues[0].number).toBe(MAX_ISSUES + 5);
    expect(Math.min(...got.issues.map((i) => i.number))).toBe(6);
  });
});
