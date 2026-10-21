import { describe, expect, it } from 'vitest';
import { baseChecks, runDoctor } from '../src/doctor.js';
import type { Gh } from '../src/github.js';
import { LABELS } from '../src/labels.js';

const TEMPLATE = 'name: x\n';
const PEOPLE = '- name: A\n  aliases: [a]\n  email: a@example.com\n';

function stub(over: Partial<{ priv: boolean; labels: string[]; files: Record<string, string | null> }> = {}) {
  const created: string[] = [];
  const files: Record<string, string | null> = {
    '.github/workflows/process.yml': TEMPLATE,
    '.github/workflows/summary.yml': TEMPLATE,
    'people.yml': PEOPLE,
    ...over.files,
  };
  const gh: Gh = {
    isPrivate: async () => over.priv ?? true,
    labelNames: async () => over.labels ?? [],
    createLabel: async (n) => void created.push(n),
    fileText: async (p) => files[p] ?? null,
  };
  return { gh, created };
}
const doctor = async (gh: Gh) => {
  const lines: string[] = [];
  const result = await runDoctor(gh, (l) => lines.push(l), baseChecks, 'test/fixtures').then(() => 'ok', (e: Error) => e.message);
  return { lines, result };
};

describe('doctor', () => {
  it('creates every missing label once, and leaves existing ones alone', async () => {
    const a = stub({ labels: ['task', 'my-area'] });
    await doctor(a.gh);
    expect(a.created).toEqual(LABELS.map((l) => l.name).filter((n) => n !== 'task'));
    const b = stub({ labels: LABELS.map((l) => l.name) });
    await doctor(b.gh);
    expect(b.created).toEqual([]);
  });
  it('passes when everything is right', async () => {
    const { lines, result } = await doctor(stub().gh);
    expect(result).toBe('ok');
    expect(lines.every((l) => l.startsWith('PASS'))).toBe(true);
  });
  it('fails on a public repo', async () => {
    const { lines, result } = await doctor(stub({ priv: false }).gh);
    expect(result).toContain('1 check');
    expect(lines.find((l) => l.startsWith('FAIL'))).toContain('private');
  });
  it('fails when a workflow differs or is missing', async () => {
    expect((await doctor(stub({ files: { '.github/workflows/process.yml': 'name: other' } }).gh)).result).toContain('failed');
    expect((await doctor(stub({ files: { '.github/workflows/summary.yml': null } }).gh)).result).toContain('failed');
  });
  it('fails when people.yml is malformed, wrong-shaped or missing', async () => {
    for (const bad of ['a: [', '- name: A', null]) {
      expect((await doctor(stub({ files: { 'people.yml': bad } }).gh)).result).toContain('failed');
    }
  });
  it('prints a fixed message, never an error body, when GitHub fails', async () => {
    const { gh } = stub();
    gh.isPrivate = async () => {
      throw new Error('ghp_SECRET body');
    };
    const { lines } = await doctor(gh);
    expect(lines.join('\n')).not.toContain('ghp_SECRET');
  });
});
