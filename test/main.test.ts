import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '@actions/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/main.js';

vi.mock('@actions/core');
vi.mock('../src/github.js', () => ({ createGh: () => ({}) }));
vi.mock('../src/process.js', () => ({
  processDump: async (p: { log: (l: string) => void; issue: number }) => p.log(`mode: process #${p.issue}`),
  failInterruptedRun: async (_gh: unknown, n: number, log: (l: string) => void) => log(`on-failure #${n}`),
}));
vi.mock('../src/summary.js', () => ({
  weeklySummary: async (d: { log: (l: string) => void }) => d.log('mode: summary'),
  onDemandSummary: async (_d: unknown, from: string, to: string) => ({ issue: { url: `summary ${from}..${to}` }, reused: from === to }),
}));
vi.mock('../src/doctor.js', () => ({ baseChecks: [], secretChecks: () => [], runDoctor: async (_gh: unknown, log: (l: string) => void) => log('mode: doctor') }));

function event(login: string, extra: object = { issue: { number: 5 } }, name = login): string {
  const p = join(tmpdir(), `todoman-event-${name}.json`);
  writeFileSync(p, JSON.stringify({ sender: { login }, ...extra }));
  return p;
}
const dispatch = (from: string, to: string) => ({ ...on, GITHUB_EVENT_PATH: event('masnun-siam', { inputs: { mode: 'summary', from, to } }, `${from}-${to}`) });
const on = { FEATURE_DUMP_TO_ISSUES: 'true' };
const mine = { ...on, GITHUB_EVENT_PATH: event('masnun-siam') };

afterEach(() => vi.clearAllMocks());

describe('run', () => {
  it('rejects an unknown mode', async () => {
    await expect(run('nope', on)).rejects.toThrow('unknown mode: nope');
  });
  it.each(['process', 'summary'])('%s is disabled unless flag is exactly true', async (m) => {
    for (const flag of [undefined, '', 'false', 'TRUE']) {
      await run(m, { FEATURE_DUMP_TO_ISSUES: flag, GITHUB_EVENT_PATH: mine.GITHUB_EVENT_PATH, CLAUDE_CODE_OAUTH_TOKEN: 's' });
    }
    expect(core.info).toHaveBeenCalledTimes(4);
    expect(core.info).toHaveBeenCalledWith('Todoman disabled');
    expect(core.setSecret).not.toHaveBeenCalled();
  });
  it('doctor ignores the flag', async () => {
    await run('doctor', {});
    expect(core.info).toHaveBeenCalledWith('mode: doctor');
  });
  it('runs process for the owner and summary without an event', async () => {
    await run('process', mine);
    await run('summary', on);
    expect(core.info).toHaveBeenCalledWith('mode: process #5');
    expect(core.info).toHaveBeenCalledWith('mode: summary');
  });
  it('a dispatched summary with dates runs on demand and prints its link (FR-11)', async () => {
    await run('summary', dispatch('2026-10-12', '2026-10-18'));
    await run('summary', dispatch('2026-10-22', '2026-10-22'));
    await run('summary', dispatch('', ''));
    expect(vi.mocked(core.info).mock.calls.map((c) => c[0])).toEqual([
      'Summary: summary 2026-10-12..2026-10-18',
      'Existing summary: summary 2026-10-22..2026-10-22',
      'mode: summary',
    ]);
  });
  it.each([['2026-10-01', '2026-11-01'], ['2026-10-12', ''], ['2026-10-18', '2026-10-12'], ['monday', 'friday'], ['2999-01-01', '2999-01-02']])(
    'refuses a dispatched period %s..%s',
    async (from, to) => {
      await expect(run('summary', dispatch(from, to))).rejects.toThrow(/^summary: /);
    },
  );
  it('refuses a dispatched period that has not started with the periodProblem message', async () => {
    await expect(run('summary', dispatch('2999-01-01', '2999-01-02'))).rejects.toThrow(
      'summary: That period has not started yet; which period should the summary cover? Give from and to as YYYY-MM-DD.',
    );
  });
  it('on-failure true marks the run failed instead of processing', async () => {
    await run('process', { ...mine, 'INPUT_ON-FAILURE': 'true' });
    await run('process', { ...mine, 'INPUT_ON-FAILURE': 'false' });
    expect(vi.mocked(core.info).mock.calls.map((c) => c[0])).toEqual(['on-failure #5', 'mode: process #5']);
  });
  it('ignores a foreign author before reading any secret', async () => {
    await run('process', { ...on, GITHUB_EVENT_PATH: event('mallory'), CLAUDE_CODE_OAUTH_TOKEN: 's' });
    expect(core.info).not.toHaveBeenCalledWith('mode: process #5');
    expect(core.setSecret).not.toHaveBeenCalled();
  });
  it('honours TODOMAN_OWNER', async () => {
    await run('process', { ...on, TODOMAN_OWNER: 'other', GITHUB_EVENT_PATH: mine.GITHUB_EVENT_PATH });
    expect(core.info).not.toHaveBeenCalledWith('mode: process #5');
  });
  it('masks every secret and each GH_READ_TOKENS token', async () => {
    await run('process', {
      ...mine,
      CLAUDE_CODE_OAUTH_TOKEN: 'a',
      GOOGLE_CLIENT_ID: 'b',
      GOOGLE_CLIENT_SECRET: 'c',
      GOOGLE_REFRESH_TOKEN: 'd',
      GH_READ_TOKENS: '{"masnun-siam":"e","x":"f"}',
    });
    const masked = vi.mocked(core.setSecret).mock.calls.map((c) => c[0]);
    expect(masked).toEqual(expect.arrayContaining(['a', 'b', 'c', 'd', 'e', 'f']));
  });
});
