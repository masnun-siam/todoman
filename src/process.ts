import type { ClaudeRequest } from './claude.js';
import { createdItems, PROCESSING, readDump, setState, shouldProcess, thread, type CreatedItem, type Dump } from './dump.js';
import { CANCELLED, failDump, failureComment, failureMessage, ItemError, STEPS, type Step } from './failure.js';
import type { ExternalReader } from './external.js';
import type { ProcessGh } from './github.js';
import type { Calendar } from './google.js';
import { HANDLERS, type ItemHandler, type Summarise } from './handlers.js';
import { parsePeople, type Person } from './invitees.js';
import { nextKey } from './keys.js';
import { LABELS } from './labels.js';
import { BOT } from './markers.js';
import { isCreated } from './match.js';
import { MODELS, PARSE_SYSTEM } from './prompts.js';
import { NOTHING_FOUND, nothingFound, TOO_LONG, tooLong } from './questions.js';
import { endState, resultComment, type ItemResult } from './result.js';
import { PARSER_SCHEMA } from './schema.js';
import { validate, type Question } from './validate.js';

export interface ProcessDeps {
  gh: ProcessGh;
  calendar: Calendar;
  external: () => ExternalReader;
  summarise: Summarise;
  /** Data repo full name, `owner/repo`. */
  repo: string;
  issue: number;
  owner: string;
  tz: string;
  now: () => Date;
  claude: (r: ClaudeRequest) => Promise<unknown>;
  log: (line: string) => void;
  handlers?: ItemHandler[];
}

const TODOMAN_LABELS = new Set(LABELS.map((l) => l.name));

/** The JSON Claude reads: dump, thread with timestamps, clock, people, labels and items already created. */
export function buildInput(d: Dump, owner: string, tz: string, now: Date, people: Person[], labels: string[], created: CreatedItem[]): string {
  return JSON.stringify({
    now: now.toISOString(),
    timezone: tz,
    dump: { title: d.issue.title, body: d.issue.body, at: d.issue.createdAt },
    thread: thread(d, owner).map((c) => ({ from: c.author === BOT ? 'Todoman' : 'owner', at: c.createdAt, text: c.body.replace(/<!--[\s\S]*?-->/g, '').trim() })),
    people: people.map((p) => p.name),
    labels: labels.filter((l) => !TODOMAN_LABELS.has(l)),
    alreadyCreated: created.map((c) => ({ type: c.type, title: c.title })),
  });
}

/** The Claude call that parses a dump; the parser evals (eval/run.ts) send the same request. */
export function parseRequest(input: string): ClaudeRequest {
  return {
    model: MODELS.parse,
    system: PARSE_SYSTEM,
    schema: PARSER_SCHEMA,
    input,
    validate: (v) => typeof v === 'object' && v !== null && Array.isArray((v as { items?: unknown }).items),
  };
}

/**
 * process mode (FR-2, FR-6, FR-7, FR-8, FR-9): gate on the live dump, parse, create items, post one result comment,
 * set the end state. A step that throws leaves the dump `failed` with a fixed message naming the step, then rethrows.
 */
export async function processDump(p: ProcessDeps): Promise<void> {
  const d = await readDump(p.gh, p.issue);
  if (!shouldProcess(d, p.owner, p.now())) {
    p.log('Nothing to process');
    return;
  }
  const answered = d.issue.labels.includes('needs-info'); // read before setState swaps the label
  await setState(p.gh, d.issue, PROCESSING);
  const read = Math.max(0, ...d.comments.map((c) => c.id));
  const at: { step: Step } = { step: STEPS.read };
  try {
    const { results, questions } = tooLong(d.issue) ? { results: [], questions: [TOO_LONG] } : await parseAndCreate(p, d, at, answered);
    at.step = STEPS.result;
    const state = endState(results, questions);
    await p.gh.comment(p.issue, resultComment(results, questions, state, read));
    await setState(p.gh, d.issue, state);
    if (state === 'processed') await p.gh.closeCompleted(p.issue);
    p.log(`Dump #${p.issue}: ${state}`);
  } catch (e) {
    // ponytail: if marking failed fails too, the workflow's failure step retries the mark
    await failDump(p.gh, d.issue, failureComment(at.step, failureMessage(e), read)).catch(() => undefined);
    throw e;
  }
}

/** The workflow's failure/cancel step (FR-9): a dump the run left in todoman:processing ends `failed`. */
export async function failInterruptedRun(gh: ProcessGh, n: number, log: (line: string) => void): Promise<void> {
  const issue = await gh.getIssue(n);
  if (issue.state !== 'open' || !issue.labels.includes(PROCESSING)) {
    log('Nothing to mark failed');
    return;
  }
  await failDump(gh, issue, failureComment(STEPS.run, CANCELLED));
  log(`Dump #${n}: failed`);
}

/**
 * Parse the dump with Claude, then create each valid item; `at` tracks the step for a failure comment.
 * `answered`: Siam replied to a `needs-info` question, so nothing left to create or ask ends the dump, not asks again.
 */
async function parseAndCreate(p: ProcessDeps, d: Dump, at: { step: Step }, answered: boolean): Promise<{ results: ItemResult[]; questions: Question[] }> {
  const [{ items: created, markers }, labels, peopleText] = await Promise.all([
    createdItems(p.gh, p.repo, d),
    p.gh.labelNames(),
    p.gh.fileText('people.yml'),
  ]);
  const people = (peopleText !== null && parsePeople(peopleText)) || [];
  const now = p.now();
  at.step = STEPS.parse;
  const output = await p.claude(parseRequest(buildInput(d, p.owner, p.tz, now, people, labels, created)));
  const ownText = [d.issue.title, d.issue.body, ...d.comments.filter((c) => c.author === p.owner).map((c) => c.body)].join('\n');
  const { items, questions } = validate(output, { now, tz: p.tz, text: ownText, labels, people });

  at.step = STEPS.create;
  const results: ItemResult[] = [];
  for (const item of items.filter((i) => !isCreated(i, created))) {
    const key = nextKey(markers, p.issue);
    markers.push({ repo: p.repo, dump: p.issue, key });
    const title = 'title' in item ? item.title : item.type === 'tracking' ? item.ref : `${item.from} – ${item.to}`;
    const handler = (p.handlers ?? HANDLERS).find((h) => h.type === item.type);
    if (!handler) {
      results.push({ type: item.type, ok: false, title, reason: `failed while ${STEPS.create}: this item type is not supported yet` });
      continue;
    }
    try {
      results.push({ type: item.type, ok: true, created: await handler.create(item, { gh: p.gh, calendar: p.calendar, external: p.external, summarise: p.summarise, repo: p.repo, owner: p.owner, tz: p.tz, dump: d.issue, key }) });
    } catch (e) {
      const note = e instanceof ItemError ? e.note : '';
      const reason = `failed while ${STEPS.create}: ${failureMessage(e instanceof ItemError ? e.cause : e)}`; // fixed text: never an error body
      results.push({ type: item.type, ok: false, title, reason, note });
    }
  }
  return { results, questions: !answered && nothingFound(items.length, questions.length, created.length) ? [NOTHING_FOUND] : questions };
}
