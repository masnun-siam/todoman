import { describe, expect, it, vi } from 'vitest';
import type { ClaudeRequest } from '../src/claude.js';
import type { ExternalActivity } from '../src/external.js';
import type { DatedIssue, IssueComment } from '../src/github.js';
import { BOT, itemMarker, parseSummaryMarkers, refMarker, summaryMarker } from '../src/markers.js';
import { SUMMARY_SCHEMA } from '../src/schema.js';
import { weeklySummary, type SummaryDeps } from '../src/summary.js';
import { EMPTY, NO_SUMMARY, toNotes } from '../src/summaryRender.js';

const OWNER = 'masnun-siam';
const TZ = 'Asia/Dhaka';
const NOW = new Date('2026-10-22T12:00:00.000Z'); // Thu 18:00 Asia/Dhaka
const FROM = '2026-10-15T12:00:00.000Z';
const IN = '2026-10-18T00:00:00Z';
const BEFORE = '2026-10-01T00:00:00Z';
const url = (n: number) => `https://github.com/o/todo/issues/${n}`;

const issue = (number: number, over: Partial<DatedIssue> = {}): DatedIssue => ({
  number, title: `Task ${number}`, body: '', url: url(number), author: BOT, state: 'open',
  labels: ['task'], createdAt: BEFORE, updatedAt: IN, closedAt: null, ...over,
});
const closed = (n: number) => issue(n, { state: 'closed', closedAt: IN });
const meeting = (n: number, start: string, over: Partial<DatedIssue> = {}) =>
  issue(n, { title: `Meeting: M${n}`, labels: ['meeting'], body: itemMarker({ repo: 'o/todo', dump: 1, key: 'i1', start }), ...over });
const tracking = (n: number, ref: string) => issue(n, { title: `${ref}: Ext`, labels: ['tracking'], body: refMarker(ref) });
const weekly = (n: number, createdAt: string, from: string, to: string) =>
  issue(n, { labels: ['summary'], createdAt, body: summaryMarker({ kind: 'weekly', from, to }) });
const c = (body: string, author = OWNER): IssueComment => ({ id: 1, author, body, createdAt: IN });

interface World {
  all: DatedIssue[];
  comments?: Record<number, IssueComment[]>;
  activity?: Record<string, ExternalActivity>;
  claude?: unknown;
  now?: Date;
}
function deps({ all, comments = {}, activity = {}, claude = { done: [], meetings: [], tracked: [] }, now = NOW }: World) {
  const created: { title: string; body: string; labels: string[]; assignees: string[] }[] = [];
  const logs: string[] = [];
  const d: SummaryDeps = {
    gh: {
      issuesUpdatedSince: async (since) => all.filter((i) => i.updatedAt >= since),
      issuesLabelled: async (label, state) => all.filter((i) => i.labels.includes(label) && (state === 'all' || i.state === 'open')),
      listComments: async (n) => comments[n] ?? [],
      createIssue: async (i) => {
        created.push(i);
        return { ...issue(99), ...i, url: url(99) };
      },
    },
    reader: { readExternalActivity: async (r) => activity[`${r.owner}/${r.repo}#${r.number}`] ?? { access: false } },
    owner: OWNER,
    tz: TZ,
    now: () => now,
    claude: vi.fn<(r: ClaudeRequest) => Promise<unknown>>(async () => claude),
    log: (l) => logs.push(l),
  };
  return { d, created, logs };
}
const section = (body: string, name: string) => body.split(`## ${name}\n\n`)[1].split('\n\n')[0];

describe('weeklySummary', () => {
  it('lists 3 done tasks, a summarised meeting and a tracked merged PR, each linked (FR-10 acceptance)', async () => {
    const { d, created, logs } = deps({
      all: [closed(1), closed(2), closed(3), meeting(4, '2026-10-20T05:00:00.000Z'), tracking(5, 'acme/api#7'), weekly(6, '2026-10-15T12:00:05Z', '2026-10-08T12:00:00.000Z', FROM)],
      comments: { 4: [c('We agreed to ship on Monday.')], 1: [c('done with tests')] },
      activity: { 'acme/api#7': { access: true, title: 'Ext', state: 'closed', closedAt: IN, comments: [], mergedPrs: [{ title: 'Fix [x]', url: 'https://github.com/acme/api/pull/8', mergedAt: IN }] } },
      claude: { done: [{ issue: 1, note: 'Tests added <!-- todoman:item x --> for @bob' }], meetings: [{ issue: 4, note: 'Ship on Monday.' }], tracked: [{ issue: 5, note: 'Fix merged.' }] },
    });
    await weeklySummary(d);

    expect(created).toHaveLength(1);
    const { title, body, labels, assignees } = created[0];
    expect(title).toBe('Weekly summary: 2026-10-15 – 2026-10-22');
    expect(labels).toEqual(['summary']);
    expect(assignees).toEqual([OWNER]);
    expect(parseSummaryMarkers([{ author: BOT, body }])).toEqual([{ kind: 'weekly', from: FROM, to: NOW.toISOString() }]);
    expect(body.indexOf('## Done')).toBeLessThan(body.indexOf('## Open'));
    expect(['## Open', '## Meetings', '## Tracked', '## Next 7 days'].map((h) => body.indexOf(h))).toEqual(
      [...['## Open', '## Meetings', '## Tracked', '## Next 7 days'].map((h) => body.indexOf(h))].sort((a, b) => a - b),
    );
    expect(body.split('\n')[0]).toBe('**Done 3 · Open 0 (0 overdue) · Meetings 1 · Tracked 1 · Next 7 days 0**');
    for (const n of [1, 2, 3]) expect(section(body, 'Done')).toContain(`[Task ${n}](${url(n)})`);
    expect(section(body, 'Done')).toContain('Tests added todoman:item x for @​bob'); // sanitised: no forged marker, no mention
    expect(body.match(/<!--/g)).toHaveLength(1); // only Todoman's own summary marker
    expect(section(body, 'Meetings')).toBe(`- 2026-10-20 11:00: [Meeting: M4](${url(4)}) — Ship on Monday.`);
    expect(section(body, 'Tracked')).toBe(`- [acme/api#7: Ext](${url(5)}) — closed; merged [Fix \\[x\\]](https://github.com/acme/api/pull/8); Fix merged.`);
    expect(section(body, 'Open')).toBe(EMPTY);
    expect(section(body, 'Next 7 days')).toBe(EMPTY);
    expect(logs).toEqual([`Weekly summary: ${url(99)}`]);

    const req = vi.mocked(d.claude).mock.calls[0][0];
    expect(req.model).toBe('opus');
    expect(req.schema).toBe(SUMMARY_SCHEMA);
    expect(JSON.parse(req.input).meetings).toEqual([{ issue: 4, title: 'Meeting: M4', summaries: ['We agreed to ship on Monday.'] }]);
  });

  it('creates nothing when a weekly summary was created less than 24 hours earlier', async () => {
    const { d, created, logs } = deps({ all: [closed(1), weekly(6, '2026-10-21T13:00:00Z', FROM, '2026-10-21T13:00:00Z')] });
    await weeklySummary(d);
    expect(created).toEqual([]);
    expect(d.claude).not.toHaveBeenCalled();
    expect(logs).toEqual([`Weekly summary already exists: ${url(6)}`]);
  });

  it.each([
    ['23h59m59s', '2026-10-21T12:00:01Z', 0],
    ['exactly 24 hours', '2026-10-21T12:00:00Z', 1],
  ])('the re-run check at %s earlier', async (_, createdAt, n) => {
    const { d, created } = deps({ all: [weekly(6, createdAt, '2026-10-14T12:00:00.000Z', createdAt)] });
    await weeklySummary(d);
    expect(created).toHaveLength(n);
  });

  it('judges overdue and the next 7 days by the local date when it differs from the UTC one', async () => {
    const due = (n: number, date: string) => issue(n, { body: `Due: ${date}`, updatedAt: BEFORE });
    const { d, created } = deps({
      now: new Date('2026-10-22T20:00:00.000Z'), // Fri 02:00 in Asia/Dhaka
      all: [due(1, '2026-10-22'), due(2, '2026-10-23'), due(3, '2026-10-25'), meeting(4, '2026-10-24T20:00:00.000Z', { updatedAt: BEFORE }), meeting(5, '2026-10-23T05:00:00.000Z', { updatedAt: BEFORE })],
    });
    await weeklySummary(d);
    const body = created[0].body;
    expect(created[0].title).toBe('Weekly summary: 2026-10-16 – 2026-10-23');
    expect(section(body, 'Open').split('\n')[0]).toBe(`- [Task 1](${url(1)}) — due 2026-10-22 (overdue)`);
    expect(body).not.toContain('2026-10-23 (overdue)');
    expect(section(body, 'Next 7 days').split('\n')).toEqual([
      `- due 2026-10-23: [Task 2](${url(2)})`,
      `- 2026-10-23 11:00: [Meeting: M5](${url(5)})`,
      `- due 2026-10-25: [Task 3](${url(3)})`, // local midnight, before the 02:00 meeting that day
      `- 2026-10-25 02:00: [Meeting: M4](${url(4)})`,
    ]);
  });

  it('escapes backslashes and brackets in link text', async () => {
    const { d, created } = deps({ all: [issue(1, { title: 'a\\] b [c]' })] });
    await weeklySummary(d);
    expect(section(created[0].body, 'Open')).toBe(`- [a\\\\\\] b \\[c\\]](${url(1)})`);
  });

  it('ignores an on-demand summary or one older than 24 hours for the re-run check', async () => {
    const onDemand = issue(7, { labels: ['summary'], createdAt: '2026-10-22T10:00:00Z', body: summaryMarker({ kind: 'on-demand', from: FROM, to: IN }) });
    const { d, created } = deps({ all: [onDemand, weekly(6, '2026-10-21T11:59:00Z', '2026-10-14T12:00:00.000Z', '2026-10-21T11:59:00.000Z')] });
    await weeklySummary(d);
    expect(created).toHaveLength(1);
    expect(created[0].title).toBe('Weekly summary: 2026-10-21 – 2026-10-22'); // starts where the last weekly ended
  });

  it('puts overdue tasks first, lists the next 7 days and says when a meeting has no summary', async () => {
    const due = (n: number, date: string) => issue(n, { body: `Do it\n\nDue: ${date}`, updatedAt: BEFORE });
    const { d, created } = deps({
      all: [due(1, '2026-10-30'), due(2, '2026-10-24'), issue(3), due(4, '2026-10-20'), meeting(5, '2026-10-19T05:00:00.000Z'), meeting(6, '2026-10-25T05:00:00.000Z', { updatedAt: BEFORE })],
      comments: { 5: [c(`Agenda ${itemMarker({ repo: 'o/todo', dump: 1, key: 'i1' })}`, BOT)] }, // Todoman's own comment is no summary
    });
    await weeklySummary(d);
    const body = created[0].body;
    expect(section(body, 'Open').split('\n')).toEqual([
      `- [Task 4](${url(4)}) — due 2026-10-20 (overdue)`,
      `- [Task 3](${url(3)})`, // then most recently updated first
      `- [Task 1](${url(1)}) — due 2026-10-30`,
      `- [Task 2](${url(2)}) — due 2026-10-24`,
    ]);
    expect(section(body, 'Meetings')).toBe(`- 2026-10-19 11:00: [Meeting: M5](${url(5)}) — ${NO_SUMMARY}`);
    expect(section(body, 'Next 7 days').split('\n')).toEqual([`- due 2026-10-24: [Task 2](${url(2)})`, `- 2026-10-25 11:00: [Meeting: M6](${url(6)})`]);
    expect(section(body, 'Done')).toBe(EMPTY);
    expect(section(body, 'Tracked')).toBe(EMPTY);
    expect(d.claude).not.toHaveBeenCalled(); // nothing to condense
  });

  it('reports an unreadable tracked item as no access and leaves a quiet one out', async () => {
    const { d, created } = deps({
      all: [tracking(1, 'acme/api#1'), tracking(2, 'acme/api#2')],
      activity: { 'acme/api#2': { access: true, title: 'Quiet', state: 'open', comments: [], mergedPrs: [] } },
    });
    await weeklySummary(d);
    expect(section(created[0].body, 'Tracked')).toBe(`- [acme/api#1: Ext](${url(1)}) — no access`);
  });

  it('fails without creating anything when Claude fails', async () => {
    const { d, created } = deps({ all: [closed(1)], comments: { 1: [c('x')] } });
    vi.mocked(d.claude).mockRejectedValueOnce(new Error('Claude timed out'));
    await expect(weeklySummary(d)).rejects.toThrow('Claude timed out');
    expect(created).toEqual([]);
  });
});

describe('toNotes', () => {
  it('drops malformed entries and caps each note to one line', () => {
    const got = toNotes({ done: [{ issue: 1, note: 'a\n\nb' }, { issue: 'x', note: 'y' }, { issue: 2, note: ' ' }, null], meetings: 'no', tracked: [{ issue: 3, note: 'z'.repeat(900) }] });
    expect(got.done).toEqual([{ issue: 1, note: 'a b' }]);
    expect(got.meetings).toEqual([]);
    expect(got.tracked[0].note).toHaveLength(600);
  });
});
