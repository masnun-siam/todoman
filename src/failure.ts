import { ClaudeError } from './claude.js';
import { setState } from './dump.js';
import type { Issue, ProcessGh } from './github.js';
import { GoogleError } from './google.js';
import { readMarker } from './markers.js';

/** Fixed step names a failure comment can carry (FR-9). */
export const STEPS = {
  read: 'reading the dump',
  parse: 'parsing it with Claude',
  create: 'creating items',
  result: 'posting the result',
  run: 'running the workflow',
} as const;
export type Step = (typeof STEPS)[keyof typeof STEPS];

export const RETRY = 'Comment `retry` (or any reply) to try again.';
export const CANCELLED = 'the run was cancelled or timed out before it finished.';

const CLAUDE: Record<ClaudeError['kind'], string> = {
  timeout: 'Claude timed out.',
  failed: 'Claude failed to run. If it keeps failing, renew the CLAUDE_CODE_OAUTH_TOKEN secret with `claude setup-token`.',
  invalid: 'Claude returned invalid output twice.',
  install: 'the Claude CLI could not be installed. If it keeps failing, check the npm registry status.',
};
const GOOGLE: Record<GoogleError['kind'], string> = {
  auth: 'the Google authorization must be renewed: create a new refresh token and save it as the GOOGLE_REFRESH_TOKEN secret.',
  failed: 'a Google Calendar request failed. If it keeps failing, check the Google Workspace status page.',
};

/** A fixed message with its fix; never the error's own text, which may hold an API body or a secret. */
export function failureMessage(e: unknown): string {
  if (e instanceof ClaudeError) return CLAUDE[e.kind];
  if (e instanceof GoogleError) return GOOGLE[e.kind];
  if (typeof (e as { status?: unknown } | null)?.status === 'number') {
    return 'a GitHub request failed. If it keeps failing, check githubstatus.com and that the workflow has `issues: write`.';
  }
  return 'an unexpected error occurred. If it keeps failing, check the workflow run log.';
}

/** `read` is the newest comment id the run read (FR-8); the cancel step knows none and leaves the last one standing. */
export function failureComment(step: Step, message: string, read?: number): string {
  const parts = [`Todoman failed while ${step}: ${message}`, RETRY];
  if (read !== undefined) parts.push(readMarker(read));
  return parts.join('\n\n');
}

/** Post the failure comment, then set `failed`. */
export async function failDump(gh: ProcessGh, issue: Issue, body: string): Promise<void> {
  await gh.comment(issue.number, body);
  await setState(gh, issue, 'failed');
}
