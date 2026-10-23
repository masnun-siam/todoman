// Parser evals (manual, uses the subscription): each fixture runs 3 times through the real prompt,
// CLI and validator, and must pass 3 of 3. Run before release and after any prompt change.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runClaude } from '../src/claude.js';
import { buildInput, parseRequest } from '../src/process.js';
import { validate } from '../src/validate.js';
import { check, type Fixture } from './check.js';

const RUNS = 3;
const OWNER = 'masnun-siam';
const TZ = 'Asia/Dhaka';
const dir = join(process.cwd(), 'eval', 'fixtures');
const bin = join(process.cwd(), 'node_modules', '.bin', 'claude'); // the CLI pinned in the lockfile
const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
if (!token) {
  console.error('Set CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) to run the evals.');
  process.exit(1);
}

async function runOnce(f: Fixture): Promise<string[]> {
  const issue = { number: 1, title: f.dump.title, body: f.dump.body, url: '', author: OWNER, state: 'open' as const, labels: [], createdAt: f.dump.at };
  const now = new Date(f.now);
  const people = f.people ?? [];
  const labels = f.labels ?? [];
  const input = buildInput({ issue, comments: [], processingSince: null }, OWNER, TZ, now, people, labels, []);
  try {
    const output = await runClaude(parseRequest(input), { token: token as string, bin });
    return check(f, validate(output, { now, text: `${f.dump.title}\n${f.dump.body}`, labels, people }));
  } catch (e) {
    return [e instanceof Error ? e.message : 'run failed'];
  }
}

let failed = 0;
for (const file of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
  const f = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Fixture;
  const runs = await Promise.all(Array.from({ length: RUNS }, () => runOnce(f)));
  const passed = runs.filter((p) => p.length === 0).length;
  if (passed < RUNS) failed++;
  console.log(`${passed === RUNS ? 'PASS' : 'FAIL'} ${f.name}: ${passed}/${RUNS}`);
  runs.forEach((p, i) => p.forEach((line) => console.log(`  run ${i + 1}: ${line}`)));
}
console.log(failed ? `${failed} fixture(s) failed` : 'All fixtures passed');
process.exit(failed ? 1 : 0);
