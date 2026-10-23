import { describe, expect, it } from 'vitest';
import type { Issue, ProcessGh } from '../src/github.js';
import type { ItemContext } from '../src/handlers.js';
import { HANDLERS } from '../src/handlers.js';
import { taskHandler } from '../src/handlers/task.js';
import { BOT, parseItemMarkers } from '../src/markers.js';

type NewIssue = Parameters<ProcessGh['createIssue']>[0];

function ctx(fail = false) {
  const sent: NewIssue[] = [];
  const gh = {
    createIssue: async (i: NewIssue): Promise<Issue> => {
      if (fail) throw new Error('boom');
      sent.push(i);
      return { number: 9, title: i.title, body: i.body, url: 'https://github.com/o/r/issues/9', author: BOT, state: 'open', labels: i.labels, createdAt: '' };
    },
  } as unknown as ProcessGh;
  const dump: Issue = { number: 5, title: 'd', body: '', url: 'https://github.com/o/r/issues/5', author: 'masnun-siam', state: 'open', labels: [], createdAt: '' };
  const c: ItemContext = { gh, calendar: {} as ItemContext['calendar'], external: () => { throw new Error('unused'); }, repo: 'o/r', owner: 'masnun-siam', tz: 'Asia/Dhaka', dump, key: 'i3' };
  return { c, sent };
}

describe('taskHandler (FR-3)', () => {
  it('is registered for tasks', () => {
    expect(HANDLERS.find((h) => h.type === 'task')).toBe(taskHandler);
  });
  it('creates a task issue with due line, dump link, labels, owner and marker', async () => {
    const { c, sent } = ctx();
    const got = await taskHandler.create({ type: 'task', title: 'Finish the tax form', body: 'the 2026 one', labels: ['area:home'], due: '2026-10-23' }, c);
    expect(sent).toHaveLength(1);
    const [i] = sent;
    expect(i.title).toBe('Finish the tax form');
    expect(i.labels).toEqual(['task', 'area:home']);
    expect(i.assignees).toEqual(['masnun-siam']);
    expect(i.body).toContain('the 2026 one');
    expect(i.body).toContain('Due: 2026-10-23');
    expect(i.body).toContain('Source dump: https://github.com/o/r/issues/5');
    expect(parseItemMarkers([{ author: BOT, body: i.body }])).toEqual([{ repo: 'o/r', dump: 5, key: 'i3' }]);
    expect(got).toEqual({ title: 'Finish the tax form', url: 'https://github.com/o/r/issues/9', details: ['Due: 2026-10-23'], labels: ['task', 'area:home'] });
  });
  it('leaves out the due line and empty body when not given', async () => {
    const { c, sent } = ctx();
    const got = await taskHandler.create({ type: 'task', title: 'Buy milk', body: '', labels: [] }, c);
    expect(sent[0].body).not.toContain('Due:');
    expect(sent[0].body.startsWith('Source dump:')).toBe(true);
    expect(sent[0].labels).toEqual(['task']);
    expect(got.details).toEqual([]);
  });
  it('rejects a non-task item and propagates a create failure', async () => {
    await expect(taskHandler.create({ type: 'summary', from: '2026-10-01', to: '2026-10-07' }, ctx().c)).rejects.toThrow();
    await expect(taskHandler.create({ type: 'task', title: 'x', body: '', labels: [] }, ctx(true).c)).rejects.toThrow('boom');
  });
});
