import type { ClaudeRequest } from './claude.js';
import { createdItems, PROCESSING, readDump, setState, shouldProcess, thread, type CreatedItem, type Dump } from './dump.js';
import { CANCELLED, failDump, failureComment, failureMessage, STEPS, type Step } from './failure.js';
import type { ProcessGh } from './github.js';
import { HANDLERS, type ItemHandler } from './handlers.js';
import { parsePeople, type Person } from './invitees.js';
import { nextKey } from './keys.js';
import { LABELS } from './labels.js';
import { BOT, type ItemMarker } from './markers.js';
import { isCreated } from './match.js';
import { MODELS, PARSE_SYSTEM } from './prompts.js';
import { endState, resultComment, type ItemResult } from './result.js';
import { PARSER_SCHEMA } from './schema.js';
import { validate, type ValidItem } from './validate.js';

export interface ProcessDeps {
  gh: ProcessGh;
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

/** Create each item not created yet; a failed item never undoes the others (FR-9). */
async function createItems(p: ProcessDeps, d: Dump, items: ValidItem[], created: CreatedItem[], markers: ItemMarker[]): Promise<ItemResult[]> {
  const results: ItemResult[] = [];
  for (const item of items.filter((i) => !isCreated(i, created))) {
    const key = nextKey(markers, p.issue);
    markers.push({ repo: p.repo, dump: p.issue, key });
    const title = 'title' in item ? item.title : item.type === 'tracking' ? item.ref : `${item.from} – ${item.to}`;
    const handler = (p.handlers ?? HANDLERS).find((h) => h.type === item.type);
    if (!handler) {
      results.push({ type: item.type, ok: false, title, reason: 'this item type is not supported yet' });
      continue;
    }
    try {
      results.push({ type: item.type, ok: true, created: await handler.create(item, { gh: p.gh, repo: p.repo, owner: p.owner, tz: p.tz, dump: d.issue, key }) });
    } catch (e) {
      results.push({ type: item.type, ok: false, title, reason: failureMessage(e) }); // fixed text: never an error body
    }
  }
  return results;
}

/**
 * process mode (FR-2, FR-6, FR-8, FR-9): gate on the live dump, parse, create items, post one result
 * comment, set the end state. A step that throws leaves the dump `failed` with a fixed message, then rethrows.
 */
export async function processDump(p: ProcessDeps): Promise<void> {
  const d = await readDump(p.gh, p.issue);
  if (!shouldProcess(d, p.owner, p.now())) {
    p.log('Nothing to process');
    return;
  }
  await setState(p.gh, d.issue, PROCESSING);
  const read = Math.max(0, ...d.comments.map((c) => c.id));
  let step: Step = STEPS.read;
  try {
    const [{ items: created, markers }, labels, peopleText] = await Promise.all([
      createdItems(p.gh, p.repo, d),
      p.gh.labelNames(),
      p.gh.fileText('people.yml'),
    ]);
    const people = (peopleText !== null && parsePeople(peopleText)) || [];
    const now = p.now();
    step = STEPS.parse;
    const output = await p.claude({
      model: MODELS.parse,
      system: PARSE_SYSTEM,
      schema: PARSER_SCHEMA,
      input: buildInput(d, p.owner, p.tz, now, people, labels, created),
      validate: (v) => typeof v === 'object' && v !== null && Array.isArray((v as { items?: unknown }).items),
    });
    const ownText = [d.issue.title, d.issue.body, ...d.comments.filter((c) => c.author === p.owner).map((c) => c.body)].join('\n');
    const { items, questions } = validate(output, { now, text: ownText, labels, people });

    step = STEPS.create;
    const results = await createItems(p, d, items, created, markers);

    step = STEPS.result;
    const state = endState(results, questions);
    await p.gh.comment(p.issue, resultComment(results, questions, state, read));
    await setState(p.gh, d.issue, state);
    if (state === 'processed') await p.gh.closeCompleted(p.issue);
    p.log(`Dump #${p.issue}: ${state}`);
  } catch (e) {
    // ponytail: if marking failed fails too, the dump stays processing and the workflow's failure step retries the mark
    await failDump(p.gh, d.issue, failureComment(step, failureMessage(e), read)).catch(() => undefined);
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
