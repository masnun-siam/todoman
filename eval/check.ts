import type { Person } from '../src/invitees.js';
import type { Validated, ValidItem } from '../src/validate.js';

/** One expected item: its type plus the key fields to compare; `null` means the field must be absent. */
export type Expected = { type: ValidItem['type'] } & Record<string, unknown>;

export interface Fixture {
  name: string;
  /** The run's clock; the dump is resolved against `dump.at`. */
  now: string;
  dump: { title: string; body: string; at: string };
  people?: Person[];
  labels?: string[];
  expect: {
    /** Exactly these items, in any order: an extra item (e.g. one an injection asks for) fails the run. */
    items: Expected[];
    /** true: at least one question; false: none; omitted: not checked. */
    question?: boolean;
  };
}

function field(item: ValidItem, key: string): unknown {
  const v = (item as Record<string, unknown>)[key];
  if (key === 'invitees') return (v as Person[]).map((p) => p.name.toLowerCase()).sort();
  if (key === 'start') return Date.parse(v as string); // same instant, whatever the offset
  return v;
}

function want(key: string, v: unknown): unknown {
  if (v === null) return undefined;
  if (key === 'invitees') return (v as string[]).map((n) => n.toLowerCase()).sort();
  if (key === 'start') return Date.parse(v as string);
  return v;
}

const matches = (e: Expected, item: ValidItem): boolean =>
  Object.entries(e).every(([k, v]) => JSON.stringify(field(item, k)) === JSON.stringify(want(k, v)));

/** Problems with one parser run against its fixture; empty means the run passed. */
export function check(f: Fixture, got: Validated): string[] {
  const problems: string[] = [];
  const left = [...got.items];
  for (const e of f.expect.items) {
    const i = left.findIndex((item) => matches(e, item));
    if (i === -1) problems.push(`missing ${JSON.stringify(e)}`);
    else left.splice(i, 1);
  }
  for (const item of left) problems.push(`unexpected ${JSON.stringify(item)}`);
  if (f.expect.question === true && got.questions.length === 0) problems.push('expected a question, got none');
  if (f.expect.question === false && got.questions.length > 0) problems.push(`unexpected questions ${JSON.stringify(got.questions)}`);
  return problems;
}
