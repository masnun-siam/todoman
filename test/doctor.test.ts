import { describe, expect, it } from 'vitest';
import { baseChecks, runDoctor, secretChecks, type SecretDeps } from '../src/doctor.js';
import type { Gh } from '../src/github.js';
import { LABELS } from '../src/labels.js';
import { ClaudeError } from '../src/claude.js';
import { GoogleError } from '../src/google.js';

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

const SECRETS = {
  CLAUDE_CODE_OAUTH_TOKEN: 'sk-claude-SECRET',
  GOOGLE_CLIENT_ID: 'cid-SECRET',
  GOOGLE_CLIENT_SECRET: 'csecret-SECRET',
  GOOGLE_REFRESH_TOKEN: 'rtoken-SECRET',
  GH_READ_TOKENS: '{"masnun-siam":"ghp_A-SECRET","acme":"ghp_B-SECRET"}',
};
function deps(over: Partial<SecretDeps> = {}) {
  const calls: string[] = [];
  const d: SecretDeps = {
    claude: async () => {
      calls.push('claude');
      return { ok: true };
    },
    probeCalendar: async () => 'ok',
    canReadOwner: async (_t, o) => (calls.push(`read ${o}`), true),
    ...over,
  };
  return { d, calls };
}
const secretDoctor = async (env: Record<string, string | undefined>, d: SecretDeps) => {
  const lines: string[] = [];
  const result = await runDoctor(stub().gh, (l) => lines.push(l), secretChecks(env, d), 'test/fixtures').then(() => 'ok', (e: Error) => e.message);
  return { lines, result, out: lines.join('\n') };
};

describe('doctor secret checks', () => {
  it('passes with every secret set, running Claude once and reading each owner', async () => {
    const { d, calls } = deps();
    const { lines, result } = await secretDoctor(SECRETS, d);
    expect(result).toBe('ok');
    expect(lines.filter((l) => l.startsWith('PASS'))).toHaveLength(4);
    expect(calls).toEqual(['claude', 'read masnun-siam', 'read acme']);
  });
  it('fails a missing Google secret and names it, without calling Google', async () => {
    let probed = false;
    const { d } = deps({ probeCalendar: async () => ((probed = true), 'ok') });
    const { lines, result } = await secretDoctor({ ...SECRETS, GOOGLE_REFRESH_TOKEN: undefined }, d);
    expect(result).toContain('1 check');
    expect(lines.find((l) => l.startsWith('FAIL'))).toMatch(/^FAIL Google.*GOOGLE_REFRESH_TOKEN secret/);
    expect(probed).toBe(false);
  });
  it('names each missing secret', async () => {
    const { out, result } = await secretDoctor({}, deps().d);
    expect(result).toContain('3 check');
    for (const n of ['CLAUDE_CODE_OAUTH_TOKEN', 'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN', 'GH_READ_TOKENS']) expect(out).toContain(n);
  });
  it('reports a missing scope and an unreadable calendar with their own fixes', async () => {
    expect((await secretDoctor(SECRETS, deps({ probeCalendar: async () => 'scope' }).d)).out).toContain('calendar.events scope');
    expect((await secretDoctor(SECRETS, deps({ probeCalendar: async () => 'read' }).d)).out).toContain('primary calendar;');
  });
  it('reports malformed GH_READ_TOKENS, accepts {} and names an owner whose token fails', async () => {
    for (const bad of ['{not json', '["x"]', '{"a":1}']) {
      expect((await secretDoctor({ ...SECRETS, GH_READ_TOKENS: bad }, deps().d)).out).toContain('FAIL GH_READ_TOKENS can read each owner: Fix the GH_READ_TOKENS secret');
    }
    expect((await secretDoctor({ ...SECRETS, GH_READ_TOKENS: '{}' }, deps().d)).result).toBe('ok');
    const { out } = await secretDoctor(SECRETS, deps({ canReadOwner: async (_t, o) => o !== 'acme' }).d);
    expect(out).toContain('token for acme (');
    expect(out).not.toContain('masnun-siam');
  });
  it('tells a failed CLI install and an unreachable Google apart from a bad secret', async () => {
    const { d } = deps({
      claude: async () => {
        throw new ClaudeError('install');
      },
      probeCalendar: async () => {
        throw new GoogleError('failed');
      },
    });
    const { out } = await secretDoctor(SECRETS, d);
    expect(out).toContain('Could not install the Claude CLI');
    expect(out).toContain('Could not reach Google');
    const auth = await secretDoctor(SECRETS, deps({ probeCalendar: async () => Promise.reject(new GoogleError('auth')) }).d);
    expect(auth.out).toContain('Google refused the refresh');
  });
  it('never prints a token or an error body', async () => {
    const boom = async (): Promise<never> => {
      throw new Error('body: sk-claude-SECRET rtoken-SECRET ghp_A-SECRET');
    };
    const { out, result } = await secretDoctor(SECRETS, { claude: boom, probeCalendar: boom, canReadOwner: boom });
    expect(result).toContain('3 check');
    expect(out).not.toMatch(/-SECRET|body:/);
  });
});
