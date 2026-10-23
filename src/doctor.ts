import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ClaudeError, type ClaudeRequest } from './claude.js';
import type { Env } from './config.js';
import { parseReadTokens, READ_TOKENS_ERROR } from './external.js';
import { GoogleError, type CalendarProbe } from './google.js';
import { parsePeople } from './invitees.js';
import { LABELS } from './labels.js';
import { MODELS } from './prompts.js';
import type { Gh } from './github.js';

/** A check returns undefined on pass, or the fix on failure. Never put tokens or error bodies in it. */
export interface Check {
  name: string;
  run(ctx: DoctorContext): Promise<string | undefined>;
}
export interface DoctorContext {
  gh: Gh;
  /** Text of a template shipped with this Todoman version. */
  template(file: string): string;
}

const WORKFLOWS = ['process.yml', 'summary.yml'];
const norm = (s: string): string => s.replace(/\r\n/g, '\n').trim();

export const baseChecks: Check[] = [
  {
    name: 'data repo is private',
    async run({ gh }) {
      return (await gh.isPrivate()) ? undefined : 'Make the data repo private (Settings > Danger Zone).';
    },
  },
  {
    name: 'workflow files match the templates',
    async run({ gh, template }) {
      for (const f of WORKFLOWS) {
        const have = await gh.fileText(`.github/workflows/${f}`);
        if (have === null || norm(have) !== norm(template(f))) {
          return `Copy templates/${f} from the Todoman repo to .github/workflows/${f}.`;
        }
      }
    },
  },
  {
    name: 'people.yml parses',
    async run({ gh }) {
      const fix = 'Fix people.yml: a list of { name, aliases[], email } entries.';
      const text = await gh.fileText('people.yml');
      return text !== null && parsePeople(text) ? undefined : fix;
    },
  },
];

/** What the secret checks call; main wires the real clients, tests pass stubs. */
export interface SecretDeps {
  claude(r: ClaudeRequest): Promise<unknown>;
  probeCalendar(): Promise<CalendarProbe>;
  canReadOwner(token: string, owner: string): Promise<boolean>;
}

const missing = (env: Env, names: string[]): string | undefined => {
  const gone = names.filter((n) => !env[n]);
  return gone.length ? `Set the ${gone.join(', ')} secret${gone.length > 1 ? 's' : ''} on the data repo.` : undefined;
};

const PING: Omit<ClaudeRequest, 'model'> = {
  system: 'Reply with {"ok": true}.',
  schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
  input: 'ping',
  validate: (v) => (v as { ok?: unknown } | null)?.ok === true,
};
const GOOGLE = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'];
const GOOGLE_FIX: Record<Exclude<CalendarProbe, 'ok'>, string> = {
  scope: 'Re-authorize Google with the calendar.events scope and update GOOGLE_REFRESH_TOKEN.',
  read: 'Could not read the primary calendar; re-authorize Google and update GOOGLE_REFRESH_TOKEN.',
};

/** Checks that need Claude, Google and the external read tokens. All read-only: no event, issue or label is written. */
export function secretChecks(env: Env, deps: SecretDeps): Check[] {
  return [
    {
      name: 'Claude login works',
      async run() {
        const gone = missing(env, ['CLAUDE_CODE_OAUTH_TOKEN']);
        if (gone) return gone;
        try {
          await deps.claude({ ...PING, model: MODELS.parse });
        } catch (e) {
          if (e instanceof ClaudeError && e.kind === 'install') return 'Could not install the Claude CLI; re-run doctor.';
          return 'Renew CLAUDE_CODE_OAUTH_TOKEN with `claude setup-token`.'; // fixed text: never the CLI's output
        }
      },
    },
    {
      name: 'Google token refreshes, has calendar.events and reads the primary calendar',
      async run() {
        const gone = missing(env, GOOGLE);
        if (gone) return gone;
        let probe: CalendarProbe;
        try {
          probe = await deps.probeCalendar();
        } catch (e) {
          if (!(e instanceof GoogleError && e.kind === 'auth')) return 'Could not reach Google; re-run doctor.';
          return 'Google refused the refresh; check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and renew GOOGLE_REFRESH_TOKEN.';
        }
        return probe === 'ok' ? undefined : GOOGLE_FIX[probe];
      },
    },
    {
      name: 'GH_READ_TOKENS can read each owner',
      async run() {
        // ponytail: unset fails like any missing secret; `{}` is the explicit "track no other owners"
        if (env.GH_READ_TOKENS === undefined || env.GH_READ_TOKENS === '') return 'Set the GH_READ_TOKENS secret on the data repo (`{}` if you track no other owners).';
        let tokens: Map<string, string>;
        try {
          tokens = parseReadTokens(env.GH_READ_TOKENS);
        } catch {
          return `Fix the GH_READ_TOKENS secret: ${READ_TOKENS_ERROR}.`;
        }
        const bad: string[] = [];
        for (const [owner, token] of tokens) if (!(await deps.canReadOwner(token, owner))) bad.push(owner);
        return bad.length ? `Renew the GH_READ_TOKENS token for ${bad.join(', ')} (read-only: Issues, Pull requests, Metadata).` : undefined;
      },
    },
  ];
}

/** Create any missing Todoman label; existing labels (and their colours) are left alone. */
export async function ensureLabels(gh: Gh): Promise<void> {
  const have = new Set((await gh.labelNames()).map((n) => n.toLowerCase())); // GitHub label names are case-insensitive
  for (const l of LABELS) if (!have.has(l.name.toLowerCase())) await gh.createLabel(l.name, l.color, l.description);
}

/** Runs the checks, logs PASS/FAIL plus the fix per check, throws if any failed. */
export async function runDoctor(gh: Gh, log: (line: string) => void, checks: Check[] = baseChecks, actionPath = process.env.GITHUB_ACTION_PATH ?? '.'): Promise<void> {
  const ctx: DoctorContext = { gh, template: (f) => readFileSync(join(actionPath, 'templates', f), 'utf8') };
  let failed = 0;
  try {
    await ensureLabels(gh);
    log('PASS labels exist');
  } catch {
    failed++;
    log('FAIL labels exist: grant the token issues: write.');
  }
  for (const c of checks) {
    let fix: string | undefined;
    try {
      fix = await c.run(ctx);
    } catch {
      fix = 'Could not run this check; verify the token permissions.'; // fixed text: never echo an error body
    }
    if (fix === undefined) log(`PASS ${c.name}`);
    else {
      failed++;
      log(`FAIL ${c.name}: ${fix}`);
    }
  }
  if (failed) throw new Error(`doctor: ${failed} check(s) failed`);
}
