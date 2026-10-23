import { describe, expect, it, vi } from 'vitest';

const calls: Record<string, unknown[]> = {};
const rec = (name: string, impl: (a: unknown) => unknown = () => ({ data: {} })) =>
  vi.fn(async (a: unknown) => ((calls[name] ??= []).push(a), impl(a)));
const issue = (number: number, created_at: string, extra = {}) => ({ number, created_at, title: 't', html_url: 'u', user: { login: 'x' }, state: 'open', labels: ['task', { name: 'area' }], ...extra });
const rest = {
  issues: {
    listForRepo: vi.fn(),
    listEvents: vi.fn(),
    removeLabel: rec('removeLabel', () => Promise.reject(Object.assign(new Error('gone'), { status: 404 }))),
    update: rec('update'),
    create: rec('create', (a) => ({ data: { ...issue(9, '2026-10-21T06:00:00Z'), ...(a as object), html_url: 'https://github.com/o/r/issues/9', user: { login: 'github-actions[bot]' } } })),
  },
};
const lists: Map<unknown, unknown[]> = new Map([
  [rest.issues.listForRepo, [issue(1, '2026-10-20T00:00:00Z'), issue(2, '2026-10-21T05:00:00Z'), issue(3, '2026-10-22T00:00:00Z', { pull_request: {} })]],
  [rest.issues.listEvents, [{ event: 'labeled', label: { name: 'todoman:processing' }, created_at: '2026-10-21T01:00:00Z' }, { event: 'labeled', label: { name: 'todoman:processing' }, created_at: '2026-10-21T02:00:00Z' }, { event: 'labeled', label: { name: 'failed' }, created_at: '2026-10-21T03:00:00Z' }]],
]);
vi.mock('@actions/github', () => ({ getOctokit: () => ({ rest, paginate: async (fn: unknown) => lists.get(fn) ?? [] }) }));

const { createGh } = await import('../src/github.js');
const gh = createGh({ GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' });

describe('createGh (process methods)', () => {
  it('issuesSince keeps issues created at or after since, never PRs', async () => {
    const got = await gh.issuesSince('2026-10-21T05:00:00Z');
    expect(got.map((i) => i.number)).toEqual([2]);
    expect(got[0].labels).toEqual(['task', 'area']);
  });
  it('labeledAt is the last time that label was added', async () => {
    expect(await gh.labeledAt(5, 'todoman:processing')).toEqual(new Date('2026-10-21T02:00:00Z'));
    expect(await gh.labeledAt(5, 'needs-info')).toBeNull();
  });
  it('removeLabel ignores a label that is already gone', async () => {
    await expect(gh.removeLabel(5, 'failed')).resolves.toBeUndefined();
  });
  it('closeCompleted closes as completed', async () => {
    await gh.closeCompleted(5);
    expect(calls.update).toEqual([{ owner: 'o', repo: 'r', issue_number: 5, state: 'closed', state_reason: 'completed' }]);
  });
  it('createIssue sends title, body, labels and assignees and returns the issue', async () => {
    const got = await gh.createIssue({ title: 'Buy milk', body: 'b', labels: ['task'], assignees: ['masnun-siam'] });
    expect(calls.create).toEqual([{ owner: 'o', repo: 'r', title: 'Buy milk', body: 'b', labels: ['task'], assignees: ['masnun-siam'] }]);
    expect(got).toMatchObject({ number: 9, title: 'Buy milk', url: 'https://github.com/o/r/issues/9', author: 'github-actions[bot]', labels: ['task'] });
  });
});
