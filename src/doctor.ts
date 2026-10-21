import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { LABELS } from './labels.js';
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
      if (text === null) return fix;
      try {
        const people: unknown = parse(text);
        const ok =
          Array.isArray(people) &&
          people.every((p) => p && typeof p.name === 'string' && typeof p.email === 'string' && Array.isArray(p.aliases));
        return ok ? undefined : fix;
      } catch {
        return fix;
      }
    },
  },
];

/** Create any missing Todoman label; existing labels (and their colours) are left alone. */
export async function ensureLabels(gh: Gh): Promise<void> {
  const have = new Set(await gh.labelNames());
  for (const l of LABELS) if (!have.has(l.name)) await gh.createLabel(l.name, l.color, l.description);
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
