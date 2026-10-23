import * as github from '@actions/github';
import type { Env } from './config.js';

/** The slice of GitHub that doctor needs; tests pass a stub. */
export interface Gh {
  isPrivate(): Promise<boolean>;
  labelNames(): Promise<string[]>;
  createLabel(name: string, color: string, description: string): Promise<void>;
  /** File text from the data repo's default branch, or null when absent. */
  fileText(path: string): Promise<string | null>;
}

export interface Issue {
  number: number;
  title: string;
  body: string;
  url: string;
  author: string;
  state: 'open' | 'closed';
  labels: string[];
  createdAt: string;
}
export interface IssueComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
}

/** The slice of GitHub that process mode needs; tests pass a stub. */
export interface ProcessGh extends Pick<Gh, 'labelNames' | 'fileText'> {
  getIssue(n: number): Promise<Issue>;
  listComments(n: number): Promise<IssueComment[]>;
  /** When `label` was last added to issue `n`, or null if it never was. */
  labeledAt(n: number, label: string): Promise<Date | null>;
  /** Issues (not PRs) created at or after `since` (ISO). */
  issuesSince(since: string): Promise<Issue[]>;
  addLabel(n: number, label: string): Promise<void>;
  /** A label that is already gone is not an error. */
  removeLabel(n: number, label: string): Promise<void>;
  comment(n: number, body: string): Promise<void>;
  closeCompleted(n: number): Promise<void>;
}

type RawIssue = {
  number: number;
  title: string;
  body?: string | null;
  html_url: string;
  user: { login: string } | null;
  state: string;
  labels: (string | { name?: string })[];
  created_at: string;
};
const toIssue = (i: RawIssue): Issue => ({
  number: i.number,
  title: i.title,
  body: i.body ?? '',
  url: i.html_url,
  author: i.user?.login ?? '',
  state: i.state === 'closed' ? 'closed' : 'open',
  labels: i.labels.map((l) => (typeof l === 'string' ? l : (l.name ?? ''))),
  createdAt: i.created_at,
});
const status = (e: unknown): number | undefined => (e as { status?: number }).status;

export function createGh(env: Env): Gh & ProcessGh {
  const [owner, repo] = (env.GITHUB_REPOSITORY ?? '').split('/');
  const octokit = github.getOctokit(env.GITHUB_TOKEN ?? '');
  const api = octokit.rest;
  return {
    async isPrivate() {
      return (await api.repos.get({ owner, repo })).data.private;
    },
    async labelNames() {
      const rows = await octokit.paginate(api.issues.listLabelsForRepo, { owner, repo, per_page: 100 });
      return rows.map((l) => l.name);
    },
    async createLabel(name, color, description) {
      await api.issues.createLabel({ owner, repo, name, color, description });
    },
    async fileText(path) {
      try {
        const { data } = await api.repos.getContent({ owner, repo, path });
        return 'content' in data && !Array.isArray(data) ? Buffer.from(data.content, 'base64').toString('utf8') : null;
      } catch (e) {
        if (status(e) === 404) return null;
        throw e;
      }
    },
    async getIssue(n) {
      return toIssue((await api.issues.get({ owner, repo, issue_number: n })).data);
    },
    async listComments(n) {
      const rows = await octokit.paginate(api.issues.listComments, { owner, repo, issue_number: n, per_page: 100 });
      return rows.map((c) => ({ id: c.id, author: c.user?.login ?? '', body: c.body ?? '', createdAt: c.created_at }));
    },
    async labeledAt(n, label) {
      const rows = await octokit.paginate(api.issues.listEvents, { owner, repo, issue_number: n, per_page: 100 });
      const hit = rows.filter((e) => e.event === 'labeled' && 'label' in e && e.label?.name === label).at(-1);
      return hit ? new Date(hit.created_at) : null;
    },
    async issuesSince(since) {
      // `since` filters on updated_at, a superset of created-since; list endpoint, never search (PRD Data)
      const rows = await octokit.paginate(api.issues.listForRepo, { owner, repo, state: 'all', since, per_page: 100 });
      return rows.filter((i) => !i.pull_request && i.created_at >= since).map(toIssue);
    },
    async addLabel(n, label) {
      await api.issues.addLabels({ owner, repo, issue_number: n, labels: [label] });
    },
    async removeLabel(n, label) {
      try {
        await api.issues.removeLabel({ owner, repo, issue_number: n, name: label });
      } catch (e) {
        if (status(e) !== 404) throw e;
      }
    },
    async comment(n, body) {
      await api.issues.createComment({ owner, repo, issue_number: n, body });
    },
    async closeCompleted(n) {
      await api.issues.update({ owner, repo, issue_number: n, state: 'closed', state_reason: 'completed' });
    },
  };
}
