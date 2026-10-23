import { describe, expect, it } from 'vitest';
import { ClaudeError } from '../src/claude.js';
import { shouldProcess, type Dump } from '../src/dump.js';
import type { ExternalReader } from '../src/external.js';
import { ItemError, RETRY } from '../src/failure.js';
import type { Issue, IssueComment, ProcessGh } from '../src/github.js';
import { GoogleError } from '../src/google.js';
import type { ItemHandler } from '../src/handlers.js';
import { meetingHandler } from '../src/handlers/meeting.js';
import { taskHandler } from '../src/handlers/task.js';
import { trackingHandler } from '../src/handlers/tracking.js';
import type { Calendar } from '../src/google.js';
import { BOT, itemMarker, readMarker } from '../src/markers.js';
import { failInterruptedRun, processDump, type ProcessDeps } from '../src/process.js';
import { endState } from '../src/result.js';

const OWNER = 'masnun-siam';
const REPO = 'masnun-siam/todo-sandbox';
const NOW = new Date('2026-10-21T06:00:00Z');
const MIN = 60_000;
const noAccess = (): ExternalReader => ({ readExternal: async () => ({ access: false }), readExternalActivity: async () => ({ access: false }) });
const noSummary = (): never => { throw new Error('unused'); };

const dumpIssue = (over: Partial<Issue> = {}): Issue => ({
  number: 5, title: 'buy milk', body: '', url: 'https://github.com/x/5', author: OWNER, state: 'open', labels: [], createdAt: '2026-10-21T05:00:00Z', ...over,
});
const comment = (id: number, author: string, body = 'reply'): IssueComment => ({ id, author, body, createdAt: '2026-10-21T05:30:00Z' });

/** In-memory data repo; records every write. */
function fakeGh(issue: Issue, comments: IssueComment[] = [], extra: { since?: Date; issues?: Issue[] } = {}) {
  const writes: string[] = [];
  const issues = extra.issues ?? [];
  const gh: ProcessGh = {
    labelNames: async () => ['area:home', 'task', 'processed'],
    fileText: async () => '- name: Asif\n  aliases: [asif]\n  email: asif@example.com\n',
    getIssue: async () => structuredClone(issue),
    listComments: async () => comments,
    labeledAt: async () => extra.since ?? null,
    issuesSince: async () => issues,
    addLabel: async (n, l) => void writes.push(`+${l}#${n}`),
    removeLabel: async (n, l) => void writes.push(`-${l}#${n}`),
    comment: async (n, b) => void writes.push(`comment#${n}:${b}`),
    closeCompleted: async (n) => void writes.push(`close#${n}`),
    openIssues: async (l) => issues.filter((i) => i.state === 'open' && i.labels.includes(l)),
    createLabel: async (name) => void writes.push(`label:${name}`),
    createIssue: async ({ title, body, labels }) => {
      const n = 100 + issues.length;
      const made = dumpIssue({ number: n, url: `https://github.com/x/${n}`, author: BOT, title, body, labels });
      issues.push(made);
      writes.push(`create:${title}`);
      return made;
    },
  };
  return { gh, writes };
}

const task: ItemHandler = { type: 'task', create: async (i) => ({ title: 'title' in i ? i.title : '', url: 'https://github.com/x/9', details: ['Due: 2026-10-22'], labels: ['task'] }) };
const broken: ItemHandler = { type: 'task', create: async () => { throw new Error('ghp_SECRET boom.'); } };

async function run(gh: ProcessGh, output: unknown, handlers = [task], calendar = {} as ProcessDeps['calendar']) {
  const inputs: string[] = [];
  const logs: string[] = [];
  await processDump({ gh, calendar, external: noAccess, summarise: noSummary, repo: REPO, issue: 5, owner: OWNER, tz: 'Asia/Dhaka', now: () => NOW, handlers, log: (l) => logs.push(l), claude: async (r) => (inputs.push(r.input), output) });
  return { inputs, logs };
}
const milk = { items: [{ type: 'task', title: 'Buy milk', due: '2026-10-22' }], questions: [] };
const comments = (w: string[]) => w.filter((x) => x.startsWith('comment#'));

describe('end state (FR-6)', () => {
  const ok = { type: 'task', ok: true as const, created: { title: 't', url: 'u', details: [], labels: [] } };
  const bad = { type: 'task', ok: false as const, title: 't', reason: 'r' };
  const q = [{ about: 'a', question: 'b' }];
  it.each([
    [[ok], [], 'processed'],
    [[ok], q, 'needs-info'],
    [[ok, bad], q, 'failed'],
    [[bad], [], 'failed'],
    [[], q, 'needs-info'],
  ] as const)('%#', (results, questions, want) => {
    expect(endState([...results], [...questions])).toBe(want);
  });
});

describe('gate (FR-8)', () => {
  const d = (labels: string[], cs: IssueComment[] = [], over: Partial<Dump> = {}): Dump => ({ issue: dumpIssue({ labels }), comments: cs, processingSince: null, ...over });
  const read = comment(10, BOT, readMarker(10));
  it('takes a fresh open dump with no state label', () => {
    expect(shouldProcess(d([]), OWNER, NOW)).toBe(true);
    expect(shouldProcess(d(['area:home']), OWNER, NOW)).toBe(true);
  });
  it('skips closed dumps, foreign dumps, created items and processed dumps', () => {
    expect(shouldProcess({ ...d([]), issue: dumpIssue({ state: 'closed' }) }, OWNER, NOW)).toBe(false);
    expect(shouldProcess({ ...d([]), issue: dumpIssue({ author: 'mallory' }) }, OWNER, NOW)).toBe(false);
    expect(shouldProcess(d(['task']), OWNER, NOW)).toBe(false);
    expect(shouldProcess(d(['processed'], [read, comment(11, OWNER)]), OWNER, NOW)).toBe(false);
  });
  it.each(['needs-info', 'failed'])('%s needs an owner comment newer than the last read', (l) => {
    expect(shouldProcess(d([l], [comment(9, OWNER), read]), OWNER, NOW)).toBe(false);
    expect(shouldProcess(d([l], [read, comment(11, 'mallory')]), OWNER, NOW)).toBe(false);
    expect(shouldProcess(d([l], [read, comment(11, OWNER)]), OWNER, NOW)).toBe(true);
    expect(shouldProcess(d([l], [comment(11, OWNER)]), OWNER, NOW)).toBe(true);
  });
  it('ignores a read marker not written by the bot', () => {
    expect(shouldProcess(d(['needs-info'], [comment(9, OWNER), comment(10, OWNER, readMarker(99))]), OWNER, NOW)).toBe(true);
  });
  it('processing counts only after 15 minutes, and still needs a new comment', () => {
    const cs = [read, comment(11, OWNER)];
    expect(shouldProcess(d(['todoman:processing'], cs, { processingSince: new Date(NOW.getTime() - 14 * MIN) }), OWNER, NOW)).toBe(false);
    expect(shouldProcess(d(['todoman:processing'], cs, { processingSince: null }), OWNER, NOW)).toBe(false);
    expect(shouldProcess(d(['todoman:processing'], cs, { processingSince: new Date(NOW.getTime() - 16 * MIN) }), OWNER, NOW)).toBe(true);
    expect(shouldProcess(d(['todoman:processing'], [read], { processingSince: new Date(NOW.getTime() - 16 * MIN) }), OWNER, NOW)).toBe(false);
  });
});

describe('processDump', () => {
  it('processes a clear dump: processing label, one result comment, processed, closed', async () => {
    const { gh, writes } = fakeGh(dumpIssue(), [comment(3, 'mallory')]);
    await run(gh, milk);
    expect(writes[0]).toBe('+todoman:processing#5');
    const [c] = comments(writes);
    expect(comments(writes)).toHaveLength(1);
    expect(c).toContain('| task | [Buy milk](https://github.com/x/9) | `task` | Due: 2026-10-22 |');
    expect(c).toContain('To change anything, open a new dump.');
    expect(c).toContain(readMarker(3));
    expect(writes.slice(-3)).toEqual(['+processed#5', '-todoman:processing#5', 'close#5']);
  });
  it('builds the prompt with the dump, thread, clock, people, labels and created items', async () => {
    const made = dumpIssue({ number: 9, title: 'Call bank', author: BOT, labels: ['task'], body: itemMarker({ repo: REPO, dump: 5, key: 'i1' }) });
    const { gh } = fakeGh(dumpIssue({ labels: ['needs-info'] }), [comment(4, BOT, `When?\n${readMarker(2)}`), comment(6, OWNER, 'monday'), comment(7, 'mallory', 'evil')], { issues: [made] });
    const { inputs } = await run(gh, milk);
    const input = JSON.parse(inputs[0]);
    expect(input).toMatchObject({ now: NOW.toISOString(), timezone: 'Asia/Dhaka', dump: { title: 'buy milk', at: '2026-10-21T05:00:00Z' }, people: ['Asif'], labels: ['area:home'] });
    expect(input.thread).toEqual([{ from: 'Todoman', at: '2026-10-21T05:30:00Z', text: 'When?' }, { from: 'owner', at: '2026-10-21T05:30:00Z', text: 'monday' }]);
    expect(input.alreadyCreated).toEqual([{ type: 'task', title: 'Call bank' }]);
  });
  it('assigns keys after the highest already used for the dump', async () => {
    const made = dumpIssue({ number: 9, author: BOT, labels: ['task'], body: itemMarker({ repo: REPO, dump: 5, key: 'i3' }) });
    const keys: string[] = [];
    const spy: ItemHandler = { type: 'task', create: async (_i, ctx) => (keys.push(ctx.key), { title: 't', url: 'u', details: [], labels: [] }) };
    const { gh } = fakeGh(dumpIssue(), [], { issues: [made] });
    await run(gh, { items: [{ type: 'task', title: 'A' }, { type: 'task', title: 'B' }], questions: [] }, [spy]);
    expect(keys).toEqual(['i4', 'i5']);
  });
  it('a question leaves the dump open in needs-info, with clear items still created', async () => {
    const { gh, writes } = fakeGh(dumpIssue());
    await run(gh, { items: [...milk.items, { type: 'meeting', title: 'Sync with asif' }], questions: [] }, [task]);
    const [c] = comments(writes);
    expect(c).toContain('Buy milk');
    expect(c).toContain('Reply here to answer.');
    expect(c).not.toContain('open a new dump');
    expect(writes).toContain('+needs-info#5');
    expect(writes).not.toContain('close#5');
  });
  it('a failed item gives failed, open, and never posts the error text', async () => {
    const { gh, writes } = fakeGh(dumpIssue());
    await run(gh, milk, [broken]);
    expect(comments(writes)[0]).toContain('| task | Buy milk | — | not created: failed while creating items: an unexpected error occurred');
    expect(comments(writes)[0]).toContain(`Todoman failed while creating items. ${RETRY}`);
    expect(writes.join()).not.toContain('ghp_SECRET');
    expect(writes).toContain('+failed#5');
    expect(writes).not.toContain('close#5');
  });
  it('an item with no registered handler fails rather than vanishing', async () => {
    const { gh, writes } = fakeGh(dumpIssue());
    await run(gh, milk, []);
    expect(comments(writes)[0]).toContain('not supported yet');
    expect(writes).toContain('+failed#5');
  });
  it('a reply run swaps the old state label and only ever labels the dump', async () => {
    const { gh, writes } = fakeGh(dumpIssue({ labels: ['needs-info'] }), [comment(10, BOT, readMarker(4)), comment(12, OWNER)]);
    await run(gh, milk);
    expect(writes.filter((w) => /^[+-]/.test(w)).every((w) => w.endsWith('#5'))).toBe(true);
    expect(writes).toContain('-needs-info#5');
    expect(comments(writes)[0]).toContain(readMarker(12));
  });
  it('re-running a finished run changes nothing and never calls Claude', async () => {
    for (const [issue, cs] of [
      [dumpIssue({ state: 'closed', labels: ['processed'] }), [comment(3, BOT, readMarker(2))]],
      [dumpIssue({ labels: ['needs-info'] }), [comment(2, OWNER), comment(3, BOT, readMarker(2))]],
    ] as const) {
      const { gh, writes } = fakeGh(issue, [...cs]);
      const { inputs, logs } = await run(gh, milk);
      expect(writes).toEqual([]);
      expect(inputs).toEqual([]);
      expect(logs).toEqual(['Nothing to process']);
    }
  });
  it('skips a returned task matching one already created, without using a key', async () => {
    const made = dumpIssue({ number: 9, title: 'Buy milk', author: BOT, labels: ['task'], body: itemMarker({ repo: REPO, dump: 5, key: 'i1' }) });
    const keys: string[] = [];
    const spy: ItemHandler = { type: 'task', create: async (_i, ctx) => (keys.push(ctx.key), { title: 't', url: 'u', details: [], labels: [] }) };
    const { gh } = fakeGh(dumpIssue(), [], { issues: [made] });
    await run(gh, { items: [{ type: 'task', title: 'buy  MILK.' }, { type: 'task', title: 'Call bank' }], questions: [] }, [spy]);
    expect(keys).toEqual(['i2']);
  });
  it('creates two same-titled tasks returned together before either exists', async () => {
    const { gh, writes } = fakeGh(dumpIssue());
    await run(gh, { items: [{ type: 'task', title: 'Buy milk' }, { type: 'task', title: 'Buy milk' }], questions: [] }, [taskHandler]);
    expect(writes.filter((w) => w.startsWith('create:'))).toHaveLength(2);
  });
  it('"buy milk and meeting with asif" creates exactly one Buy milk across the first run and the reply run (FR-6, FR-8)', async () => {
    const issues: Issue[] = [];
    const meeting: ItemHandler = { type: 'meeting', create: async () => ({ title: 'Meeting: Sync with Asif', url: 'https://github.com/x/m', details: [], labels: [] }) };
    const handlers = [taskHandler, meeting];
    const first = fakeGh(dumpIssue({ title: 'buy milk and meeting with asif' }), [], { issues });
    await run(first.gh, { items: [{ type: 'task', title: 'Buy milk' }], questions: [{ about: 'Meeting with Asif', question: 'When is the meeting?' }] }, handlers);
    expect(first.writes).toContain('+needs-info#5');

    const reply = fakeGh(dumpIssue({ title: 'buy milk and meeting with asif', labels: ['needs-info'] }), [comment(10, BOT, readMarker(0)), comment(12, OWNER, 'monday 11am')], { issues });
    const meet = { type: 'meeting', title: 'Sync with Asif', start: '2026-10-26T11:00:00+06:00', durationMinutes: 60, attendees: ['Asif'], agenda: '' };
    // a misbehaving Claude returns Buy milk again; code still skips it
    const { inputs } = await run(reply.gh, { items: [{ type: 'task', title: 'Buy milk' }, meet], questions: [] }, handlers);
    expect(JSON.parse(inputs[0]).alreadyCreated).toEqual([{ type: 'task', title: 'Buy milk' }]);
    expect(issues.map((i) => i.title)).toEqual(['Buy milk']);
    expect(reply.writes.filter((w) => w.startsWith('create:'))).toEqual([]);
    expect(reply.writes).toContain('+processed#5');
    expect(reply.writes).toContain('close#5');
  });
});

describe('processDump tracking (FR-2, FR-5)', () => {
  const tracking = { type: 'tracking', ref: 'masnun-siam/meeting-manager#85', note: 'waiting on review' };
  it('a task and a tracking reference give two issues and one result comment', async () => {
    const { gh, writes } = fakeGh(dumpIssue({ body: 'call the bank, and review masnun-siam/meeting-manager#85' }));
    await run(gh, { items: [{ type: 'task', title: 'Call the bank' }, tracking], questions: [] }, [taskHandler, trackingHandler]);
    expect(writes.filter((w) => w.startsWith('create:'))).toEqual(['create:Call the bank', 'create:masnun-siam/meeting-manager#85']);
    expect(comments(writes)).toHaveLength(1);
    expect(comments(writes)[0]).toContain('| tracking | [masnun-siam/meeting-manager#85](https://github.com/x/101) |');
  });
  it('dumping the same reference twice gives one tracking issue and a note on it', async () => {
    const issues: Issue[] = [];
    const body = 'https://github.com/masnun-siam/meeting-manager/issues/85 waiting on review';
    const first = fakeGh(dumpIssue({ body }), [], { issues });
    await run(first.gh, { items: [tracking], questions: [] }, [trackingHandler]);
    const second = fakeGh(dumpIssue({ number: 6, body, createdAt: '2026-10-21T05:50:00Z' }), [], { issues });
    await processDump({ gh: second.gh, calendar: {} as ProcessDeps['calendar'], external: noAccess, summarise: noSummary, repo: REPO, issue: 6, owner: OWNER, tz: 'Asia/Dhaka', now: () => NOW, handlers: [trackingHandler], log: () => undefined, claude: async () => ({ items: [tracking], questions: [] }) });
    expect(issues).toHaveLength(1);
    expect(second.writes.filter((w) => w.startsWith('create:'))).toEqual([]);
    expect(second.writes.filter((w) => w.startsWith('comment#100:'))).toHaveLength(1);
    expect(comments(second.writes).find((c) => c.startsWith('comment#6:'))).toContain('added note to existing #100');
  });
  it('a re-run after the tracking issue was created skips it', async () => {
    const issues: Issue[] = [];
    const { gh, writes } = fakeGh(dumpIssue({ body: 'masnun-siam/meeting-manager#85' }), [], { issues });
    await run(gh, { items: [tracking], questions: [] }, [trackingHandler]);
    await run(gh, { items: [tracking], questions: [] }, [trackingHandler]);
    expect(writes.filter((w) => w.startsWith('create:'))).toHaveLength(1);
  });
});

describe('failures (FR-9)', () => {
  const SECRET = 'ghp_SECRET123';
  it('a failed item keeps its fixed message and adds the handler note, never the error text', async () => {
    const noted: ItemHandler = { type: 'task', create: async () => { throw new ItemError(new Error(SECRET), 'The calendar event exists and invites were sent.'); } };
    const { gh, writes } = fakeGh(dumpIssue());
    await run(gh, milk, [noted]);
    const [c] = comments(writes);
    expect(c).toContain('| task | Buy milk | — | not created: failed while creating items: an unexpected error occurred. If it keeps failing, check the workflow run log. The calendar event exists and invites were sent. |');
    expect(writes.join()).not.toContain(SECRET);
  });
  it.each([
    ['Claude times out', { claude: new ClaudeError('timeout') }, 'parsing it with Claude: Claude timed out.'],
    ['Claude returns invalid output twice', { claude: new ClaudeError('invalid') }, 'parsing it with Claude: Claude returned invalid output twice.'],
    ['Claude throws an error holding a secret', { claude: new Error(`401 ${SECRET}`) }, 'parsing it with Claude: an unexpected error occurred'],
    ['a GitHub read fails with the body', { gh: Object.assign(new Error(`{"message":"${SECRET}"}`), { status: 502 }) }, 'reading the dump: a GitHub request failed'],
  ] as const)('%s: failed, named step, fixed message, retry line, read marker, rethrown', async (_n, fail, want) => {
    const { gh, writes } = fakeGh(dumpIssue(), [comment(8, OWNER)]);
    if ('gh' in fail) gh.labelNames = async () => { throw fail.gh; };
    const claude = async () => { if ('claude' in fail) throw fail.claude; return milk; };
    await expect(processDump({ gh, calendar: {} as ProcessDeps['calendar'], external: noAccess, summarise: noSummary, repo: REPO, issue: 5, owner: OWNER, tz: 'Asia/Dhaka', now: () => NOW, handlers: [task], log: () => undefined, claude })).rejects.toBeDefined();
    const [c, ...rest] = comments(writes);
    expect(rest).toEqual([]);
    expect(c).toContain(`Todoman failed while ${want}`);
    expect(c).toContain(`${RETRY}\n\n${readMarker(8)}`);
    expect(writes.join()).not.toContain(SECRET);
    expect(writes.slice(-3, -1)).toEqual(['+failed#5', '-todoman:processing#5']);
  });
  it('a failure comment that cannot be posted still leaves the dump failed, not processing', async () => {
    const { gh, writes } = fakeGh(dumpIssue(), [comment(8, OWNER)]);
    gh.comment = async () => { throw new Error('down'); };
    await expect(processDump({ gh, calendar: {} as ProcessDeps['calendar'], external: noAccess, summarise: noSummary, repo: REPO, issue: 5, owner: OWNER, tz: 'Asia/Dhaka', now: () => NOW, handlers: [task], log: () => undefined, claude: async () => { throw new ClaudeError('timeout'); } })).rejects.toBeInstanceOf(ClaudeError);
    expect(writes).toEqual(['+todoman:processing#5', '+failed#5', '-todoman:processing#5']);
  });
  it('a revoked Google token fails the item with how to renew it, keeping the items created', async () => {
    const meeting: ItemHandler = { type: 'meeting', create: async () => { throw new GoogleError('auth'); } };
    const meet = { type: 'meeting', title: 'Sync with Asif', start: '2026-10-26T11:00:00+06:00', durationMinutes: 60, attendees: ['Asif'], agenda: '' };
    const { gh, writes } = fakeGh(dumpIssue());
    await run(gh, { items: [...milk.items, meet], questions: [] }, [task, meeting]);
    const [c] = comments(writes);
    expect(c).toContain('Buy milk](https://github.com/x/9)');
    expect(c).toContain('| meeting | Sync with Asif | — | not created: failed while creating items: the Google authorization must be renewed: create a new refresh token and save it as the GOOGLE_REFRESH_TOKEN secret.');
    expect(c).toContain(RETRY);
    expect(writes).toContain('+failed#5');
  });
  it('an owner reply on a failed dump reprocesses it and creates only the missing items', async () => {
    const made = dumpIssue({ number: 9, title: 'Buy milk', author: BOT, labels: ['task'], body: itemMarker({ repo: REPO, dump: 5, key: 'i1' }) });
    const issues = [made];
    const { gh, writes } = fakeGh(dumpIssue({ labels: ['failed'] }), [comment(10, BOT, `failed\n${readMarker(4)}`), comment(12, OWNER, 'retry')], { issues });
    await run(gh, { items: [{ type: 'task', title: 'Buy milk' }, { type: 'task', title: 'Call bank' }], questions: [] }, [taskHandler]);
    expect(issues.map((i) => i.title)).toEqual(['Buy milk', 'Call bank']);
    expect(writes).toContain('-failed#5');
    expect(writes).toContain('close#5');
  });
  it('a dump stuck in processing for over 15 minutes is reprocessed by the next owner comment', async () => {
    const { gh, writes } = fakeGh(dumpIssue({ labels: ['todoman:processing'] }), [comment(12, OWNER, 'retry')], { since: new Date(NOW.getTime() - 16 * MIN) });
    await run(gh, milk);
    expect(writes).toContain('+processed#5');
  });
});

describe('failInterruptedRun (cancel or timeout, FR-9)', () => {
  it('marks a dump left in processing failed with the cancel message', async () => {
    const { gh, writes } = fakeGh(dumpIssue({ labels: ['todoman:processing'] }));
    await failInterruptedRun(gh, 5, () => undefined);
    expect(writes).toEqual([
      '+failed#5',
      '-todoman:processing#5',
      `comment#5:Todoman failed while running the workflow: the run stopped before it finished (cancelled, timed out or crashed).\n\n${RETRY}`,
    ]);
  });
  it.each([
    ['already failed by the run', dumpIssue({ labels: ['failed'] })],
    ['never started processing', dumpIssue()],
    ['closed', dumpIssue({ state: 'closed', labels: ['todoman:processing'] })],
  ])('does nothing when the dump was %s', async (_n, issue) => {
    const { gh, writes } = fakeGh(issue);
    const logs: string[] = [];
    await failInterruptedRun(gh, 5, (l) => logs.push(l));
    expect(writes).toEqual([]);
    expect(logs).toEqual(['Nothing to mark failed']);
  });
});

describe('processDump questions (FR-7)', () => {
  const meetingStub: ItemHandler = { type: 'meeting', create: async (i) => ({ title: 'title' in i ? i.title : '', url: 'https://github.com/x/10', details: [], labels: [] }) };
  const ask = { items: [], questions: [{ about: 'meeting with asif about prd review', question: 'When is the meeting?' }] };
  const meeting = { type: 'meeting', title: 'PRD review with Asif', start: '2026-10-26T11:00:00+06:00', durationMinutes: 60, attendees: ['asif'], agenda: 'PRD review' };

  it('a dump over 10,000 characters creates nothing, never calls Claude and asks to split', async () => {
    const { gh, writes } = fakeGh(dumpIssue({ body: 'x'.repeat(10_000) }));
    const { inputs } = await run(gh, milk);
    expect(inputs).toEqual([]);
    expect(comments(writes)[0]).toContain('Please split it into smaller dumps. Reply here to answer.');
    expect(writes).toContain('+needs-info#5');
    expect(writes).not.toContain('close#5');
  });
  it('"asdf" goes to needs-info with the PRD wording', async () => {
    const { gh, writes } = fakeGh(dumpIssue({ title: 'asdf' }));
    await run(gh, { items: [], questions: [] });
    expect(comments(writes)[0]).toBe(`comment#5:I couldn't find a task, meeting or reference in this. Reply here to answer.\n\n${readMarker(0)}`);
    expect(writes).toContain('+needs-info#5');
  });
  it('more than 10 items creates nothing and asks to split', async () => {
    const { gh, writes } = fakeGh(dumpIssue());
    await run(gh, { items: Array.from({ length: 11 }, () => milk.items[0]), questions: [] });
    expect(comments(writes)[0]).toContain('more than 10 items, so I created nothing');
    expect(comments(writes)[0]).not.toContain('Buy milk');
    expect(writes).toContain('+needs-info#5');
  });
  it('asks when the meeting is, then the reply creates it and processes the dump', async () => {
    const first = fakeGh(dumpIssue({ title: 'meeting with asif about prd review for 1 hour' }));
    await run(first.gh, ask, [meetingStub]);
    expect(comments(first.writes)[0]).toContain('- meeting with asif about prd review: When is the meeting?\n\nReply here to answer.');
    expect(first.writes).toContain('+needs-info#5');

    const reply = fakeGh(dumpIssue({ labels: ['needs-info'] }), [comment(10, BOT, `When?\n${readMarker(0)}`), comment(12, OWNER, 'monday 11am')]);
    const { inputs } = await run(reply.gh, { items: [meeting], questions: [] }, [meetingStub]);
    expect(JSON.parse(inputs[0]).thread.at(-1)).toEqual({ from: 'owner', at: '2026-10-21T05:30:00Z', text: 'monday 11am' });
    expect(comments(reply.writes)[0]).toContain('| meeting | [PRD review with Asif](https://github.com/x/10) |');
    expect(reply.writes).toContain('-needs-info#5');
    expect(reply.writes.slice(-3)).toEqual(['+processed#5', '-todoman:processing#5', 'close#5']);
  });
  it('buy milk and meeting: the first comment has the task row then the question, the reply only the meeting row', async () => {
    const first = fakeGh(dumpIssue({ title: 'buy milk and meeting with asif' }));
    await run(first.gh, { items: milk.items, questions: ask.questions }, [task]);
    const [c1] = comments(first.writes);
    expect(c1).toContain('| task | [Buy milk](https://github.com/x/9) | `task` | Due: 2026-10-22 |');
    expect(c1.indexOf('| task |')).toBeLessThan(c1.indexOf('When is the meeting?'));

    const made = dumpIssue({ number: 9, title: 'Buy milk', author: BOT, labels: ['task'], body: itemMarker({ repo: REPO, dump: 5, key: 'i1' }) });
    const reply = fakeGh(dumpIssue({ labels: ['needs-info'] }), [comment(10, BOT, readMarker(0)), comment(12, OWNER, 'monday 11am')], { issues: [made] });
    await run(reply.gh, { items: [milk.items[0], meeting], questions: [] }, [task, meetingStub]);
    const [c2] = comments(reply.writes);
    expect(c2).toContain('| meeting |');
    expect(c2).not.toContain('Buy milk');
  });
  it('a task titled "a | b" is one row with its title intact', async () => {
    const { gh, writes } = fakeGh(dumpIssue());
    await run(gh, { items: [{ type: 'task', title: 'a | b' }], questions: [] }, [task]);
    const rows = comments(writes)[0].split('\n').filter((l) => l.includes('| task |'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('[a \\| b]');
  });
  it('"skip it" after the rest was created processes the dump', async () => {
    const made = dumpIssue({ number: 9, title: 'Buy milk', author: BOT, labels: ['task'], body: itemMarker({ repo: REPO, dump: 5, key: 'i1' }) });
    const { gh, writes } = fakeGh(dumpIssue({ labels: ['needs-info'] }), [comment(10, BOT, readMarker(0)), comment(12, OWNER, 'skip it')], { issues: [made] });
    await run(gh, { items: [], questions: [] });
    expect(comments(writes)[0]).toContain('To change anything, open a new dump.');
    expect(writes).toContain('close#5');
  });
  it('"skip it" with nothing created processes and closes the dump', async () => {
    const { gh, writes } = fakeGh(dumpIssue({ labels: ['needs-info'] }), [comment(10, BOT, readMarker(0)), comment(12, OWNER, 'skip it')]);
    await run(gh, { items: [], questions: [] });
    const [c] = comments(writes);
    expect(c).toContain('To change anything, open a new dump.');
    expect(c).not.toContain("couldn't find");
    expect(writes).toContain('+processed#5');
    expect(writes).toContain('close#5');
  });
  it('a failed retry with nothing created still asks the nothing-found question', async () => {
    const { gh, writes } = fakeGh(dumpIssue({ labels: ['failed'] }), [comment(10, BOT, readMarker(0)), comment(12, OWNER, 'retry')]);
    await run(gh, { items: [], questions: [] });
    expect(comments(writes)[0]).toContain("I couldn't find a task, meeting or reference in this. Reply here to answer.");
    expect(writes).toContain('+needs-info#5');
    expect(writes).not.toContain('close#5');
  });
  it.each([
    ['in the past', '2026-10-20T11:00:00+06:00'],
    ['over 365 days ahead', '2027-10-22T11:00:00+06:00'],
  ])('a meeting time %s goes to needs-info, clear items still created', async (_, start) => {
    const { gh, writes } = fakeGh(dumpIssue());
    await run(gh, { items: [milk.items[0], { ...meeting, start }], questions: [] }, [task, meetingStub]);
    const [c] = comments(writes);
    expect(c).toContain('[Buy milk]');
    expect(c).toContain('PRD review with Asif: ');
    expect(c).not.toContain('https://github.com/x/10');
    expect(writes).toContain('+needs-info#5');
  });
});

describe('processDump meetings (FR-4, FR-4a, FR-8)', () => {
  /** A calendar that remembers ids, as Google does: a second insert of an id reads it back. */
  function fakeCalendar() {
    const ids = new Set<string>();
    const inserts: string[] = [];
    const calendar: Calendar = {
      insertEvent: async (e) => {
        inserts.push(e.id);
        const status = ids.has(e.id) ? 'existing' : 'created';
        ids.add(e.id);
        return { status, meetLink: 'https://meet/x', eventLink: 'https://calendar/e' };
      },
      describeEvent: async () => {},
    };
    return { calendar, ids, inserts };
  }
  const prd = { type: 'meeting', title: 'PRD review with Asif', start: '2026-10-26T11:00:00+06:00', durationMinutes: 60, attendees: ['asif', 'bob', 'rafi'], agenda: 'PRD review' };
  const title = 'have a meeting with asif and rafi about prd review on monday 11 am for 1 hour';
  const people = '- name: Asif\n  aliases: [asif]\n  email: asif@example.com\n- name: Bob\n  aliases: []\n  email: bob@example.com\n';

  it('creates the event and meeting issue, and the result comment lists when and who', async () => {
    const { gh, writes } = fakeGh(dumpIssue({ title }));
    gh.fileText = async () => people;
    const cal = fakeCalendar();
    await run(gh, { items: [prd], questions: [] }, [meetingHandler], cal.calendar);
    expect(cal.inserts).toHaveLength(1);
    expect(writes).toContain('create:Meeting: PRD review with Asif');
    const [c] = comments(writes);
    expect(c).toContain('| meeting | [Meeting: PRD review with Asif](https://github.com/x/100) | `meeting` | Mon 2026-10-26 11:00–12:00 Asia/Dhaka; 60 minutes; invited: Asif');
    expect(c).toContain('bob — not named in the dump, skipped');
    expect(c).toContain('rafi — not in people.yml, invite manually');
    expect(writes).toContain('close#5');
  });

  it('a retry after the event was made but the issue failed makes one issue and no second event', async () => {
    const issues: Issue[] = [];
    const cal = fakeCalendar();
    const first = fakeGh(dumpIssue({ title }), [], { issues });
    first.gh.createIssue = async () => {
      throw new Error('github down');
    };
    await run(first.gh, { items: [prd], questions: [] }, [meetingHandler], cal.calendar);
    expect(first.writes).toContain('+failed#5');

    const retry = fakeGh(dumpIssue({ title, labels: ['failed'] }), [comment(10, BOT, readMarker(0)), comment(12, OWNER, 'retry')], { issues });
    await run(retry.gh, { items: [prd], questions: [] }, [meetingHandler], cal.calendar);
    expect(cal.ids.size).toBe(1);
    expect(issues.map((i) => i.title)).toEqual(['Meeting: PRD review with Asif']);
    expect(retry.writes).toContain('close#5');

    // a later run that gets the meeting again skips it by start time: no insert at all
    const again = fakeGh(dumpIssue({ title, labels: ['failed'] }), [comment(10, BOT, readMarker(0)), comment(14, OWNER, 'again')], { issues });
    await run(again.gh, { items: [{ ...prd, title: 'Renamed' }], questions: [] }, [meetingHandler], cal.calendar);
    expect(cal.inserts).toHaveLength(2);
    expect(issues).toHaveLength(1);
  });

  it('reports a deleted event without creating anything', async () => {
    const { gh, writes } = fakeGh(dumpIssue({ title }));
    const calendar: Calendar = { insertEvent: async () => ({ status: 'deleted' }), describeEvent: async () => {} };
    await run(gh, { items: [prd], questions: [] }, [meetingHandler], calendar);
    expect(writes.filter((w) => w.startsWith('create:'))).toEqual([]);
    expect(comments(writes)[0]).toContain('| meeting | Meeting: PRD review with Asif | — | the calendar event was deleted |');
  });
});
