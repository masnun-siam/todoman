import { describe, expect, it } from 'vitest';
import type { CreatedItem } from '../src/dump.js';
import type { DatedIssue, Issue } from '../src/github.js';
import { HANDLERS, type ItemContext } from '../src/handlers.js';
import { summaryHandler } from '../src/handlers/summary.js';
import { BOT, itemMarker, parseItemMarkers, parseSummaryMarkers, summaryMarker } from '../src/markers.js';
import { isCreated } from '../src/match.js';
import { onDemandPeriod, onDemandSummary, type SummaryDeps } from '../src/summary.js';

const TZ = 'Asia/Dhaka'; // UTC+6
const NOW = new Date('2026-10-23T10:00:00.000Z'); // Fri 16:00 in Dhaka
const url = (n: number) => `https://github.com/o/todo/issues/${n}`;
const summary = (n: number, createdAt: string, from: string, to: string, kind: 'weekly' | 'on-demand' = 'on-demand'): DatedIssue => ({
  number: n, title: `Summary ${n}`, body: summaryMarker({ kind, from, to }), url: url(n), author: BOT, state: 'open',
  labels: ['summary'], createdAt, updatedAt: createdAt, closedAt: null,
});

function deps(all: DatedIssue[] = []) {
  const created: { title: string; body: string; labels: string[] }[] = [];
  const d: SummaryDeps = {
    gh: {
      issuesUpdatedSince: async () => [],
      issuesLabelled: async (label) => all.filter((i) => i.labels.includes(label)),
      listComments: async () => [],
      createIssue: async (i) => {
        created.push(i);
        return { ...summary(99, NOW.toISOString(), '', ''), title: i.title, body: i.body, labels: i.labels };
      },
    },
    reader: { readExternalActivity: async () => ({ access: false }) },
    owner: 'masnun-siam',
    tz: TZ,
    now: () => NOW,
    claude: async () => { throw new Error('no text to condense'); },
    log: () => undefined,
  };
  return { d, created };
}

describe('onDemandPeriod (FR-11)', () => {
  it('covers whole local days', () => {
    expect(onDemandPeriod('2026-10-12', '2026-10-18', TZ, NOW)).toEqual({ from: '2026-10-11T18:00:00.000Z', to: '2026-10-18T18:00:00.000Z' });
  });
  it('ends at the run time when the last day is today', () => {
    expect(onDemandPeriod('2026-10-23', '2026-10-23', TZ, NOW)).toEqual({ from: '2026-10-22T18:00:00.000Z', to: NOW.toISOString() });
  });
});

describe('onDemandSummary (FR-11)', () => {
  const YESTERDAY = { from: '2026-10-21T18:00:00.000Z', to: '2026-10-22T18:00:00.000Z' };

  it('opens a fresh summary issue with an on-demand marker and the extra marker', async () => {
    const { d, created } = deps();
    const extra = itemMarker({ repo: 'o/todo', dump: 5, key: 'i1' });
    const { issue, reused } = await onDemandSummary(d, '2026-10-22', '2026-10-22', extra);
    expect(reused).toBe(false);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ title: 'Summary: 2026-10-22 – 2026-10-22', labels: ['summary'] });
    expect(parseSummaryMarkers([{ author: BOT, body: issue.body }])).toEqual([{ kind: 'on-demand', ...YESTERDAY }]);
    expect(parseItemMarkers([{ author: BOT, body: issue.body }])).toEqual([{ repo: 'o/todo', dump: 5, key: 'i1' }]);
  });
  it('reuses a summary for exactly that period created after it ended, of either kind', async () => {
    for (const kind of ['on-demand', 'weekly'] as const) {
      const { d, created } = deps([summary(7, '2026-10-22T19:00:00Z', YESTERDAY.from, YESTERDAY.to, kind)]);
      const { issue, reused } = await onDemandSummary(d, '2026-10-22', '2026-10-22');
      expect([reused, issue.number, created.length]).toEqual([true, 7, 0]);
    }
  });
  it('creates a fresh one when the match was created before its period ended, or covers another period', async () => {
    const { d, created } = deps([
      summary(7, '2026-10-22T17:00:00Z', YESTERDAY.from, YESTERDAY.to), // made during the day it covers
      summary(8, '2026-10-23T00:00:00Z', YESTERDAY.from, '2026-10-22T17:00:00.000Z'),
      { ...summary(9, '2026-10-23T00:00:00Z', YESTERDAY.from, YESTERDAY.to), author: 'mallory' }, // not the bot's marker
    ]);
    expect((await onDemandSummary(d, '2026-10-22', '2026-10-22')).reused).toBe(false);
    expect(created).toHaveLength(1);
  });
  it('refuses a period that has not started yet', async () => {
    const { d, created } = deps();
    await expect(onDemandSummary(d, '2026-10-24', '2026-10-24')).rejects.toThrow('has not started');
    expect(created).toHaveLength(0);
  });
  it('never reuses a summary for today, whose period ends at the run time', async () => {
    const { d, created } = deps([summary(7, '2026-10-23T09:00:00Z', '2026-10-22T18:00:00.000Z', '2026-10-23T09:00:00.000Z')]);
    expect((await onDemandSummary(d, '2026-10-23', '2026-10-23')).reused).toBe(false);
    expect(created).toHaveLength(1);
  });
});

describe('summaryHandler (FR-11)', () => {
  const dump: Issue = { number: 5, title: 'd', body: '', url: url(5), author: 'masnun-siam', state: 'open', labels: [], createdAt: '' };
  const ctx = (reused: boolean, calls: string[][]): ItemContext => ({
    gh: {} as ItemContext['gh'], calendar: {} as ItemContext['calendar'], external: () => { throw new Error('unused'); },
    repo: 'o/todo', owner: 'masnun-siam', tz: TZ, dump, key: 'i2',
    summarise: async (from, to, marker) => (calls.push([from, to, marker]), { issue: summary(12, '', '', ''), reused }),
  });

  it('is registered for summaries', () => {
    expect(HANDLERS.find((h) => h.type === 'summary')).toBe(summaryHandler);
  });
  it('links a fresh summary with its summary label and marks it with the item key', async () => {
    const calls: string[][] = [];
    const got = await summaryHandler.create({ type: 'summary', from: '2026-10-22', to: '2026-10-22' }, ctx(false, calls));
    expect(got).toEqual({ title: 'Summary 12', url: url(12), details: [], labels: ['summary'] });
    expect(calls).toEqual([['2026-10-22', '2026-10-22', itemMarker({ repo: 'o/todo', dump: 5, key: 'i2' })]]);
  });
  it('says "existing #n" when it reuses one', async () => {
    const got = await summaryHandler.create({ type: 'summary', from: '2026-10-12', to: '2026-10-18' }, ctx(true, []));
    expect(got).toMatchObject({ details: ['existing #12'], labels: ['summary'] });
  });
});

describe('isCreated for summaries (FR-8)', () => {
  const made: CreatedItem[] = [{ key: 'i1', type: 'summary', title: 'Summary: 2026-10-23 – 2026-10-23', url: url(12) }];
  it('matches a summary this dump already created for the same days, and only that', () => {
    expect(isCreated({ type: 'summary', from: '2026-10-23', to: '2026-10-23' }, made)).toBe(true);
    expect(isCreated({ type: 'summary', from: '2026-10-22', to: '2026-10-23' }, made)).toBe(false);
    expect(isCreated({ type: 'task', title: 'Summary: 2026-10-23 – 2026-10-23', body: '', labels: [] }, made)).toBe(false);
  });
});
