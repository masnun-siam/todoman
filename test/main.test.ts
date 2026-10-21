import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '@actions/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/main.js';

vi.mock('@actions/core');
vi.mock('../src/github.js', () => ({ createGh: () => ({}) }));
vi.mock('../src/doctor.js', () => ({ runDoctor: async (_gh: unknown, log: (l: string) => void) => log('mode: doctor') }));

function event(login: string): string {
  const p = join(tmpdir(), `todoman-event-${login}.json`);
  writeFileSync(p, JSON.stringify({ sender: { login } }));
  return p;
}
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
    expect(core.info).toHaveBeenCalledWith('mode: process');
    expect(core.info).toHaveBeenCalledWith('mode: summary');
  });
  it('ignores a foreign author before reading any secret', async () => {
    await run('process', { ...on, GITHUB_EVENT_PATH: event('mallory'), CLAUDE_CODE_OAUTH_TOKEN: 's' });
    expect(core.info).not.toHaveBeenCalledWith('mode: process');
    expect(core.setSecret).not.toHaveBeenCalled();
  });
  it('honours TODOMAN_OWNER', async () => {
    await run('process', { ...on, TODOMAN_OWNER: 'other', GITHUB_EVENT_PATH: mine.GITHUB_EVENT_PATH });
    expect(core.info).not.toHaveBeenCalledWith('mode: process');
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
