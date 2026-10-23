import * as core from '@actions/core';
import { loadConfig, type Env } from './config.js';
import { installClaude, runClaude } from './claude.js';
import { eventActor, eventIssue, isOwner } from './gate.js';
import { baseChecks, runDoctor, secretChecks } from './doctor.js';
import { canReadOwner, createReader, type ExternalReader } from './external.js';
import { createGh } from './github.js';
import { createCalendar, probeCalendar } from './google.js';
import { failInterruptedRun, processDump } from './process.js';
import { maskSecrets } from './secrets.js';
import { weeklySummary } from './summary.js';

export const MODES = ['process', 'summary', 'doctor'] as const;
export type Mode = (typeof MODES)[number];

const handlers: Record<Mode, (env: Env) => Promise<void> | void> = {
  process: (env) => {
    const issue = eventIssue(env);
    if (!issue) throw new Error('process: the event has no issue');
    const gh = createGh(env);
    if (env['INPUT_ON-FAILURE'] === 'true') return failInterruptedRun(gh, issue, core.info); // the workflow's failure/cancel step
    const { owner, tz } = loadConfig(env);
    let bin: string | undefined; // installed only once the gate lets a run reach Claude
    let reader: ExternalReader | undefined; // built on first tracking item, so a bad GH_READ_TOKENS fails only that item
    return processDump({
      gh,
      calendar: createCalendar(env),
      external: () => (reader ??= createReader(env)),
      repo: env.GITHUB_REPOSITORY ?? '',
      issue,
      owner,
      tz,
      now: () => new Date(),
      claude: (r) => runClaude(r, { token: env.CLAUDE_CODE_OAUTH_TOKEN ?? '', bin: (bin ??= installClaude(env.GITHUB_ACTION_PATH ?? '.')) }),
      log: core.info,
    });
  },
  summary: (env) => {
    const { owner, tz } = loadConfig(env);
    let bin: string | undefined; // installed only when the summary has text to condense
    return weeklySummary({
      gh: createGh(env),
      reader: createReader(env),
      owner,
      tz,
      now: () => new Date(),
      claude: (r) => runClaude(r, { token: env.CLAUDE_CODE_OAUTH_TOKEN ?? '', bin: (bin ??= installClaude(env.GITHUB_ACTION_PATH ?? '.')) }),
      log: core.info,
    });
  },
  doctor: (env) =>
    runDoctor(createGh(env), core.info, [
      ...baseChecks,
      ...secretChecks(env, {
        claude: (r) => runClaude(r, { token: env.CLAUDE_CODE_OAUTH_TOKEN ?? '', bin: installClaude(env.GITHUB_ACTION_PATH ?? '.') }),
        probeCalendar: () => probeCalendar(env),
        canReadOwner,
      }),
    ]),
};

export async function run(mode: string, env: Env = process.env): Promise<void> {
  if (!(MODES as readonly string[]).includes(mode)) {
    throw new Error(`unknown mode: ${mode}`);
  }
  const cfg = loadConfig(env);
  if (mode !== 'doctor' && !cfg.enabled) {
    core.info('Todoman disabled');
    return;
  }
  if (mode === 'process' && !isOwner(eventActor(env), cfg.owner)) {
    core.info('Ignoring event from a non-owner');
    return;
  }
  maskSecrets(env, core.setSecret);
  await handlers[mode as Mode](env);
}
