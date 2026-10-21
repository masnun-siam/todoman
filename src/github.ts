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

export function createGh(env: Env): Gh {
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
        if ((e as { status?: number }).status === 404) return null;
        throw e;
      }
    },
  };
}
