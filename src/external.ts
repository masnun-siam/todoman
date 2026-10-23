import * as github from '@actions/github';
import type { Env } from './config.js';
import { sanitize } from './sanitize.js';

/** A GitHub issue or PR on github.com. */
export interface ExternalRef {
  owner: string;
  repo: string;
  number: number;
}
export type ExternalState = 'open' | 'closed' | 'merged';
/** Tracking result: title and state only, never the body. */
export type ExternalItem = { access: true; title: string; state: ExternalState } | { access: false };
export interface ExternalComment {
  author: string;
  body: string;
  createdAt: string;
}
export interface MergedPr {
  title: string;
  url: string;
  mergedAt: string;
}
export interface Period {
  /** ISO date-times; from inclusive, to exclusive. */
  from: string;
  to: string;
}
export type ExternalActivity =
  | { access: true; title: string; state: ExternalState; closedAt?: string; comments: ExternalComment[]; mergedPrs: MergedPr[] }
  | { access: false };

/** The slice of GitHub the reader needs, bound to one owner's token; tests pass a stub. */
export interface ExternalGh {
  issue(r: ExternalRef): Promise<{ title: string; state: string; closedAt: string | null; mergedAt: string | null }>;
  /** Comments updated at or after `since`. */
  comments(r: ExternalRef, since: string): Promise<ExternalComment[]>;
  /** PRs that cross-reference the item, with their merge time (null if not merged). */
  linkedPrs(r: ExternalRef): Promise<{ title: string; url: string; mergedAt: string | null }[]>;
}
export type ClientFor = (token: string) => ExternalGh;

const OWNER = '[A-Za-z0-9-]+';
const REPO = '[\\w.-]+';
const URL_RE = new RegExp(`^https?://github\\.com/(${OWNER})/(${REPO})/(?:issues|pull)/(\\d+)(?:[/?#].*)?$`);
const SHORT_RE = new RegExp(`^(${OWNER})/(${REPO})#(\\d+)$`);

/** Parses a full github.com issue/PR URL or `owner/repo#n`; anything else (other hosts included) is null. */
export function parseRef(text: string): ExternalRef | null {
  const m = URL_RE.exec(text.trim()) ?? SHORT_RE.exec(text.trim());
  return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null;
}
export const refString = (r: ExternalRef): string => `${r.owner}/${r.repo}#${r.number}`;

export const READ_TOKENS_ERROR = 'GH_READ_TOKENS must be a JSON object mapping an owner to a token string';

/** Owner (lower-cased) to token. Unset is empty; malformed throws a fixed config error that never echoes the value. */
export function parseReadTokens(raw: string | undefined): Map<string, string> {
  if (!raw) return new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(READ_TOKENS_ERROR);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(READ_TOKENS_ERROR);
  const entries = Object.entries(parsed);
  if (entries.some(([, t]) => typeof t !== 'string' || !t)) throw new Error(READ_TOKENS_ERROR);
  return new Map(entries.map(([o, t]) => [o.toLowerCase(), t as string])); // GitHub logins are case-insensitive: same account
}

const stateOf = (i: { state: string; mergedAt: string | null }): ExternalState =>
  i.mergedAt ? 'merged' : i.state === 'open' ? 'open' : 'closed';

/** Whether `iso` falls in `p` (from inclusive, to exclusive). */
export const inPeriod = (iso: string, p: Period): boolean => {
  const t = Date.parse(iso);
  return t >= Date.parse(p.from) && t < Date.parse(p.to);
};

export interface ExternalReader {
  readExternal(r: ExternalRef): Promise<ExternalItem>;
  readExternalActivity(r: ExternalRef, p: Period): Promise<ExternalActivity>;
}

/** Each ref is read only with the token mapped to its exact owner; no token or any failure is "no access", never an error. */
export function createReader(env: Env, clientFor: ClientFor = octokitClient): ExternalReader {
  const tokens = parseReadTokens(env.GH_READ_TOKENS);
  const clients = new Map<string, ExternalGh>();
  const client = (r: ExternalRef): ExternalGh | undefined => {
    const owner = r.owner.toLowerCase();
    const token = tokens.get(owner);
    if (!token) return undefined;
    if (!clients.has(owner)) clients.set(owner, clientFor(token));
    return clients.get(owner);
  };
  return {
    async readExternal(r) {
      const gh = client(r);
      if (!gh) return { access: false };
      try {
        const i = await gh.issue(r);
        return { access: true, title: sanitize(i.title), state: stateOf(i) };
      } catch {
        return { access: false }; // 404/403/401 or any other failure: unreadable
      }
    },
    async readExternalActivity(r, p) {
      const gh = client(r);
      if (!gh) return { access: false };
      try {
        const [i, comments, prs] = await Promise.all([gh.issue(r), gh.comments(r, p.from), gh.linkedPrs(r)]);
        return {
          access: true,
          title: sanitize(i.title),
          state: stateOf(i),
          ...(i.closedAt ? { closedAt: i.closedAt } : {}),
          comments: comments.filter((c) => inPeriod(c.createdAt, p)).map((c) => ({ ...c, body: sanitize(c.body) })),
          mergedPrs: prs
            .filter((pr): pr is MergedPr => pr.mergedAt !== null && inPeriod(pr.mergedAt, p))
            .map((pr) => ({ ...pr, title: sanitize(pr.title) })),
        };
      } catch {
        return { access: false };
      }
    },
  };
}

function octokitClient(token: string): ExternalGh {
  const octokit = github.getOctokit(token);
  const api = octokit.rest.issues;
  const at = (r: ExternalRef) => ({ owner: r.owner, repo: r.repo, issue_number: r.number });
  return {
    async issue(r) {
      const { data } = await api.get(at(r));
      return { title: data.title, state: data.state, closedAt: data.closed_at, mergedAt: data.pull_request?.merged_at ?? null };
    },
    async comments(r, since) {
      const rows = await octokit.paginate(api.listComments, { ...at(r), since, per_page: 100 });
      return rows.map((c) => ({ author: c.user?.login ?? '', body: c.body ?? '', createdAt: c.created_at }));
    },
    async linkedPrs(r) {
      const rows = await octokit.paginate(api.listEventsForTimeline, { ...at(r), per_page: 100 });
      return rows.flatMap((e) => {
        const src = 'source' in e ? e.source?.issue : undefined;
        if (e.event !== 'cross-referenced' || !src?.pull_request) return [];
        return [{ title: src.title, url: src.html_url, mergedAt: src.pull_request.merged_at ?? null }];
      });
    },
  };
}
