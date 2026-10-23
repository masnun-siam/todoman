import * as core from '@actions/core';
import { loadConfig, type Env } from './config.js';
import { installClaude, runClaude } from './claude.js';
import { eventActor, eventDates, eventIssue, isOwner } from './gate.js';
import { baseChecks, runDoctor, secretChecks } from './doctor.js';
import { canReadOwner, createReader, type ExternalReader } from './external.js';
import { localDate } from './dates.js';
import { createGh } from './github.js';
import { createCalendar, probeCalendar } from './google.js';
import { failInterruptedRun, processDump } from './process.js';
import { maskSecrets } from './secrets.js';
import { onDemandSummary, weeklySummary, type SummaryDeps } from './summary.js';
import { periodProblem } from './validate.js';

export const MODES = ['process', 'summary', 'doctor'] as const;
export type Mode = (typeof MODES)[number];

/** What a summary needs; Claude is installed only when there is text to condense, the reader built on first tracking issue. */
function summaryDeps(env: Env): SummaryDeps {
  const { owner, tz } = loadConfig(env);
  let bin: string | undefined;
  let reader: ExternalReader | undefined; // so a bad GH_READ_TOKENS spares a summary without tracking issues
  return {
    gh: createGh(env),
    reader: { readExternalActivity: (r, p) => (reader ??= createReader(env)).readExternalActivity(r, p) },
    owner,
    tz,
    now: () => new Date(),
    claude: (r) => runClaude(r, { token: env.CLAUDE_CODE_OAUTH_TOKEN ?? '', bin: (bin ??= installClaude(env.GITHUB_ACTION_PATH ?? '.')) }),
    log: core.info,
  };
}

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
      summarise: (from, to, marker) => onDemandSummary(summaryDeps(env), from, to, marker),
      repo: env.GITHUB_REPOSITORY ?? '',
      issue,
      owner,
      tz,
      now: () => new Date(),
      claude: (r) => runClaude(r, { token: env.CLAUDE_CODE_OAUTH_TOKEN ?? '', bin: (bin ??= installClaude(env.GITHUB_ACTION_PATH ?? '.')) }),
      log: core.info,
    });
  },
  summary: async (env) => {
    const { from, to } = eventDates(env);
    if (!from && !to) return weeklySummary(summaryDeps(env)); // schedule, or a dispatch without dates (FR-10)
    const problem = periodProblem(from, to, localDate(new Date(), loadConfig(env).tz));
    if (problem) throw new Error(`summary: ${problem} Give from and to as YYYY-MM-DD.`);
    const { issue, reused } = await onDemandSummary(summaryDeps(env), from, to);
    core.info(`${reused ? 'Existing summary' : 'Summary'}: ${issue.url}`);
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
