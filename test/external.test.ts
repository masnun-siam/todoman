import { describe, expect, it } from 'vitest';
import { canReadOwner, createReader, parseReadTokens, parseRef, READ_TOKENS_ERROR, refString, type ExternalGh } from '../src/external.js';

const REF = { owner: 'masnun-siam', repo: 'meeting-manager', number: 85 };
const PERIOD = { from: '2026-10-15T12:00:00Z', to: '2026-10-22T12:00:00Z' };
const TOKENS = JSON.stringify({ 'masnun-siam': 'tok-siam', acme: 'tok-acme' });

function stub(over: Partial<ExternalGh> = {}) {
  const used: string[] = [];
  const clientFor = (token: string): ExternalGh => {
    used.push(token);
    return {
      issue: async () => ({ title: 'Fix <!-- x --> for @bob', state: 'open', closedAt: null, mergedAt: null, body: 'SECRET BODY' }) as never,
      comments: async () => [],
      linkedPrs: async () => [],
      ...over,
    };
  };
  return { used, clientFor };
}

describe('parseRef', () => {
  it('accepts github.com URLs and owner/repo#n', () => {
    expect(parseRef('https://github.com/masnun-siam/meeting-manager/issues/85')).toEqual(REF);
    expect(parseRef('https://github.com/masnun-siam/meeting-manager/pull/85/files')).toEqual(REF);
    expect(parseRef('masnun-siam/meeting-manager#85')).toEqual(REF);
    expect(refString(REF)).toBe('masnun-siam/meeting-manager#85');
  });
  it('rejects other hosts and malformed text', () => {
    for (const bad of ['https://gitlab.com/masnun-siam/meeting-manager/issues/85', 'https://github.com.evil.io/a/b/issues/1', 'https://github.com/a/b/wiki/1', 'a/b', '#85']) {
      expect(parseRef(bad)).toBeNull();
    }
  });
});

describe('parseReadTokens', () => {
  it('is empty when unset', () => expect(parseReadTokens(undefined).size).toBe(0));
  it('throws a fixed config error that never echoes the value', () => {
    for (const bad of ['{nope ghp_LEAK', '["ghp_LEAK"]', '{"a": 1}', '{"a": ""}', 'null']) {
      expect(() => parseReadTokens(bad)).toThrow(READ_TOKENS_ERROR);
      try {
        parseReadTokens(bad);
      } catch (e) {
        expect((e as Error).message).not.toContain('LEAK');
      }
    }
  });
});

describe('readExternal', () => {
  it('uses only the token for that exact owner, and returns sanitised title and state, never the body', async () => {
    const s = stub();
    const item = await createReader({ GH_READ_TOKENS: TOKENS }, s.clientFor).readExternal(REF);
    expect(s.used).toEqual(['tok-siam']);
    expect(item).toEqual({ access: true, title: 'Fix  x  for @​bob', state: 'open' });
  });
  it('matches the owner case-insensitively (same GitHub account)', async () => {
    const s = stub();
    await createReader({ GH_READ_TOKENS: TOKENS }, s.clientFor).readExternal({ ...REF, owner: 'Masnun-Siam' });
    expect(s.used).toEqual(['tok-siam']);
  });
  it('gives no access, without trying any token, for an owner with no token', async () => {
    const s = stub();
    const r = createReader({ GH_READ_TOKENS: TOKENS }, s.clientFor);
    expect(await r.readExternal({ ...REF, owner: 'someone-else' })).toEqual({ access: false });
    expect(await createReader({}, s.clientFor).readExternal(REF)).toEqual({ access: false });
    expect(s.used).toEqual([]);
  });
  it('gives no access, never an error, on 404 or any failure', async () => {
    for (const status of [404, 403, 401, 500]) {
      const s = stub({ issue: async () => Promise.reject(Object.assign(new Error('x'), { status })) });
      expect(await createReader({ GH_READ_TOKENS: TOKENS }, s.clientFor).readExternal(REF)).toEqual({ access: false });
    }
  });
  it('reports merged and closed states', async () => {
    const merged = stub({ issue: async () => ({ title: 't', state: 'closed', closedAt: '2026-10-16T00:00:00Z', mergedAt: '2026-10-16T00:00:00Z' }) });
    expect(await createReader({ GH_READ_TOKENS: TOKENS }, merged.clientFor).readExternal(REF)).toMatchObject({ state: 'merged' });
    const closed = stub({ issue: async () => ({ title: 't', state: 'closed', closedAt: '2026-10-16T00:00:00Z', mergedAt: null }) });
    expect(await createReader({ GH_READ_TOKENS: TOKENS }, closed.clientFor).readExternal(REF)).toMatchObject({ state: 'closed' });
  });
  it('throws the config error on malformed GH_READ_TOKENS', () => {
    expect(() => createReader({ GH_READ_TOKENS: '{' }, stub().clientFor)).toThrow(READ_TOKENS_ERROR);
  });
});

describe('readExternalActivity', () => {
  it('returns only in-period comments and PRs merged in the period, sanitised', async () => {
    let since = '';
    const s = stub({
      comments: async (_r, sinceArg) => {
        since = sinceArg;
        return [
          { author: 'a', body: 'before', createdAt: '2026-10-15T11:59:59Z' },
          { author: 'b', body: 'in <!-- m --> @x', createdAt: '2026-10-15T12:00:00Z' },
          { author: 'c', body: 'at end', createdAt: '2026-10-22T12:00:00Z' },
        ];
      },
      linkedPrs: async () => [
        { title: 'merged in', url: 'u1', mergedAt: '2026-10-20T00:00:00Z' },
        { title: 'open', url: 'u2', mergedAt: null },
        { title: 'merged before', url: 'u3', mergedAt: '2026-10-01T00:00:00Z' },
      ],
    });
    const a = await createReader({ GH_READ_TOKENS: TOKENS }, s.clientFor).readExternalActivity(REF, PERIOD);
    expect(since).toBe(PERIOD.from);
    expect(a).toEqual({
      access: true,
      title: 'Fix  x  for @​bob',
      state: 'open',
      comments: [{ author: 'b', body: 'in  m  @​x', createdAt: '2026-10-15T12:00:00Z' }],
      mergedPrs: [{ title: 'merged in', url: 'u1', mergedAt: '2026-10-20T00:00:00Z' }],
    });
  });
  it('gives no access for a missing token or a failed read', async () => {
    const s = stub({ comments: async () => Promise.reject(Object.assign(new Error('x'), { status: 404 })) });
    expect(await createReader({ GH_READ_TOKENS: TOKENS }, s.clientFor).readExternalActivity(REF, PERIOD)).toEqual({ access: false });
    expect(await createReader({}, s.clientFor).readExternalActivity(REF, PERIOD)).toEqual({ access: false });
  });
});

describe('canReadOwner', () => {
  const owners = (list: string[]) => async () => list;

  it('passes when the token can read a repo of the owner, in any case', async () => {
    expect(await canReadOwner('t', 'acme', owners(['masnun-siam', 'ACME']))).toBe(true);
    expect(await canReadOwner('t', 'acme', owners(['Acme']))).toBe(true);
  });

  it('fails when the token reads only other owners or nothing', async () => {
    expect(await canReadOwner('t', 'acme', owners(['masnun-siam']))).toBe(false);
    expect(await canReadOwner('t', 'acme', owners([]))).toBe(false);
  });

  it('fails, never throws, when listing rejects', async () => {
    const ownersFor = async (): Promise<string[]> => {
      throw new Error('Bad credentials');
    };
    expect(await canReadOwner('t', 'acme', ownersFor)).toBe(false);
  });
});
