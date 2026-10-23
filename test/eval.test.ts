import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { check, type Fixture } from '../eval/check.js';
import type { ValidItem } from '../src/validate.js';

const asif = { name: 'Asif', aliases: [], email: 'asif@example.com' };
const bob = { name: 'Bob', aliases: [], email: 'bob@example.com' };
const meeting = (invitees = [asif]): ValidItem => ({ type: 'meeting', title: 'PRD review', start: '2026-10-26T05:00:00Z', durationMinutes: 60, invitees, skipped: [], agenda: '' });
const fixture = (expect: Fixture['expect']): Fixture => ({ name: 'f', now: '2026-10-21T04:01:00Z', dump: { title: 't', body: '', at: '2026-10-21T04:00:00Z' }, expect });

describe('eval check', () => {
  const f = fixture({ items: [{ type: 'meeting', start: '2026-10-26T11:00:00+06:00', durationMinutes: 60, invitees: ['asif'] }], question: false });

  it('passes the same instant in another offset and invitee names in any case', () => {
    expect(check(f, { items: [meeting()], questions: [] })).toEqual([]);
  });

  it('fails an extra invitee or an extra item, as an injection would add', () => {
    expect(check(f, { items: [meeting([asif, bob])], questions: [] })[0]).toMatch(/^missing/);
    expect(check(f, { items: [meeting(), { type: 'task', title: 'x', body: '', labels: [] }], questions: [] })).toEqual([expect.stringMatching(/^unexpected/)]);
  });

  it('checks a field expected absent and the question expectation', () => {
    const g = fixture({ items: [{ type: 'task', due: null }], question: true });
    expect(check(g, { items: [{ type: 'task', title: 'x', body: '', labels: [] }], questions: [{ about: 'a', question: 'q' }] })).toEqual([]);
    expect(check(g, { items: [{ type: 'task', title: 'x', body: '', labels: [], due: '2026-10-23' }], questions: [] })).toHaveLength(3);
  });

  it('every fixture file is well formed', () => {
    const dir = join(process.cwd(), 'eval', 'fixtures');
    const files = readdirSync(dir).filter((n) => n.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const n of files) {
      const x = JSON.parse(readFileSync(join(dir, n), 'utf8')) as Fixture;
      expect(Number.isNaN(Date.parse(x.now)) || Number.isNaN(Date.parse(x.dump.at)), n).toBe(false);
      expect(Array.isArray(x.expect.items), n).toBe(true);
    }
  });
});
