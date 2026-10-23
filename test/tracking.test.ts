import { describe, expect, it } from 'vitest';
import type { ExternalItem, ExternalRef } from '../src/external.js';
import type { Issue, IssueComment, ProcessGh } from '../src/github.js';
import { HANDLERS, type ItemContext } from '../src/handlers.js';
import { trackingHandler } from '../src/handlers/tracking.js';
import { BOT, itemMarker, parseItemMarkers, parseRefMarkers, refMarker } from '../src/markers.js';

type NewIssue = Parameters<ProcessGh['createIssue']>[0];
const REF = 'masnun-siam/meeting-manager#85';
const item = (note = 'waiting on review', ref = REF) => ({ type: 'tracking' as const, ref, note });
const issue = (over: Partial<Issue>): Issue => ({
  number: 1, title: '', body: '', url: '', author: BOT, state: 'open', labels: ['tracking'], createdAt: '', ...over,
});

/** In-memory data repo plus an external reader; records every write and every read of the external item. */
function setup(o: { open?: Issue[]; comments?: IssueComment[]; ext?: ExternalItem; labels?: string[]; labelFails?: boolean } = {}) {
  const created: NewIssue[] = [];
  const comments: { n: number; body: string }[] = [];
  const labels: string[] = [];
  const reads: ExternalRef[] = [];
  const gh = {
    openIssues: async () => o.open ?? [],
    listComments: async () => o.comments ?? [],
    comment: async (n: number, body: string) => void comments.push({ n, body }),
    labelNames: async () => o.labels ?? ['tracking'],
    createLabel: async (name: string) => {
      if (o.labelFails) throw new Error('403');
      labels.push(name);
    },
    createIssue: async (i: NewIssue): Promise<Issue> => {
      created.push(i);
      return issue({ number: 40, title: i.title, body: i.body, url: 'https://github.com/o/r/issues/40', labels: i.labels });
    },
  } as unknown as ProcessGh;
  const external = () => ({
    readExternal: async (r: ExternalRef) => (reads.push(r), o.ext ?? { access: true as const, title: 'Fix login', state: 'open' as const }),
    readExternalActivity: async () => ({ access: false as const }),
  });
  const dump = issue({ number: 5, url: 'https://github.com/o/r/issues/5', author: 'masnun-siam', labels: [] });
  const ctx: ItemContext = { gh, calendar: {} as ItemContext['calendar'], external, repo: 'o/r', owner: 'masnun-siam', tz: 'Asia/Dhaka', dump, key: 'i2' };
  return { ctx, created, comments, labels, reads };
}

describe('trackingHandler (FR-5)', () => {
  it('is registered for tracking items', () => {
    expect(HANDLERS.find((h) => h.type === 'tracking')).toBe(trackingHandler);
  });

  it('creates a tracking issue with the external title, link, state, note, both markers, labels and owner', async () => {
    const { ctx, created, labels, reads } = setup();
    const got = await trackingHandler.create(item(), ctx);
    expect(reads).toEqual([{ owner: 'masnun-siam', repo: 'meeting-manager', number: 85 }]);
    const [i] = created;
    expect(i.title).toBe(`${REF}: Fix login`);
    expect(i.labels).toEqual(['tracking', 'repo:masnun-siam/meeting-manager']);
    expect(labels).toEqual(['repo:masnun-siam/meeting-manager']);
    expect(i.assignees).toEqual(['masnun-siam']);
    expect(i.body).toContain('Tracks https://github.com/masnun-siam/meeting-manager/issues/85');
    expect(i.body).toContain('State: open');
    expect(i.body).toContain('waiting on review');
    expect(i.body).toContain('Source dump: https://github.com/o/r/issues/5');
    expect(parseRefMarkers([{ author: BOT, body: i.body }])).toEqual([REF]);
    expect(parseItemMarkers([{ author: BOT, body: i.body }])).toEqual([{ repo: 'o/r', dump: 5, key: 'i2' }]);
    expect(got).toEqual({ title: `${REF}: Fix login`, url: 'https://github.com/o/r/issues/40', details: [] });
  });

  it('truncates the repo label to 50 characters and reuses an existing one in its own spelling', async () => {
    const long = `masnun-siam/${'x'.repeat(60)}#1`;
    const a = setup();
    await trackingHandler.create(item('n', long), a.ctx);
    expect(a.created[0].labels[1]).toHaveLength(50);
    const b = setup({ labels: ['tracking', 'repo:Masnun-Siam/Meeting-Manager'] });
    await trackingHandler.create(item(), b.ctx);
    expect(b.created[0].labels).toEqual(['tracking', 'repo:Masnun-Siam/Meeting-Manager']);
    expect(b.labels).toEqual([]);
  });

  it('caps the title at the 256-character GitHub limit', async () => {
    const { ctx, created } = setup({ ext: { access: true, title: 'x'.repeat(300), state: 'closed' } });
    await trackingHandler.create(item(), ctx);
    expect(created[0].title).toHaveLength(256);
    expect(created[0].title.startsWith(`${REF}: x`)).toBe(true);
    expect(created[0].body).toContain('State: closed');
  });

  it('still creates the issue without the repo label when the label cannot be made', async () => {
    const { ctx, created } = setup({ labelFails: true });
    await trackingHandler.create(item(), ctx);
    expect(created[0].labels).toEqual(['tracking']);
  });

  it('with no access, titles the issue with the reference alone and says access is missing', async () => {
    const { ctx, created } = setup({ ext: { access: false } });
    const got = await trackingHandler.create(item(), ctx);
    expect(created[0].title).toBe(REF);
    expect(created[0].body).not.toContain('State:');
    expect(got.details.join()).toContain('access missing');
  });

  it('comments the note on the oldest open bot tracking issue with the same ref, without reading the external item', async () => {
    const mine = (n: number) => issue({ number: n, title: `${REF}: Fix login`, url: `https://github.com/o/r/issues/${n}`, body: refMarker(REF) });
    const open = [mine(30), mine(12), issue({ number: 3, author: 'mallory', body: refMarker(REF) }), issue({ number: 4, body: refMarker('a/b#1') })];
    const { ctx, created, comments, reads } = setup({ open });
    const got = await trackingHandler.create(item('merged yet?', 'Masnun-Siam/Meeting-Manager#85'), ctx);
    expect(created).toEqual([]);
    expect(reads).toEqual([]);
    expect(comments).toHaveLength(1);
    expect(comments[0].n).toBe(12);
    expect(comments[0].body).toContain('merged yet?');
    expect(parseItemMarkers([{ author: BOT, body: comments[0].body }])).toEqual([{ repo: 'o/r', dump: 5, key: 'i2', ref: 'Masnun-Siam/Meeting-Manager#85' }]);
    expect(got).toEqual({ title: `${REF}: Fix login`, url: 'https://github.com/o/r/issues/12', details: ['added note to existing #12'] });
  });

  it('never posts the same note twice for one dump and ref', async () => {
    const open = [issue({ number: 12, body: refMarker(REF) })];
    const note = { id: 1, author: BOT, createdAt: '', body: itemMarker({ repo: 'o/r', dump: 5, key: 'i1', ref: REF }) };
    const again = setup({ open, comments: [note] });
    expect((await trackingHandler.create(item(), again.ctx)).details).toEqual(['added note to existing #12']);
    expect(again.comments).toEqual([]);
    // another dump's note, or a non-bot copy of this one, does not count
    const other = setup({ open, comments: [{ ...note, body: itemMarker({ repo: 'o/r', dump: 6, key: 'i1', ref: REF }) }, { ...note, author: 'mallory' }] });
    await trackingHandler.create(item(), other.ctx);
    expect(other.comments).toHaveLength(1);
  });

  it('rejects a non-tracking item', async () => {
    await expect(trackingHandler.create({ type: 'summary', from: '2026-10-01', to: '2026-10-07' }, setup().ctx)).rejects.toThrow();
  });
});
