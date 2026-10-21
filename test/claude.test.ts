import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeError, runClaude } from '../src/claude.js';
import { DATA_NOTICE } from '../src/prompts.js';

const req = { model: 'sonnet', system: 'Parse.', schema: { type: 'object' }, input: 'dump text' };

/** A stub `claude` that logs each call and answers with the next mode: ok | garbage | exit | hang. */
function stub(modes: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'stub-'));
  const log = join(dir, 'log.jsonl');
  const bin = join(dir, 'claude');
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('node:fs');
let stdin = '';
process.stdin.on('data', (c) => (stdin += c));
process.stdin.on('end', () => {
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), env: process.env, cwd: process.cwd(), entries: fs.readdirSync('.'), stdin }) + '\\n');
  const modes = ${JSON.stringify(modes)};
  const n = fs.readFileSync(${JSON.stringify(log)}, 'utf8').trim().split('\\n').length - 1;
  const m = modes[Math.min(n, modes.length - 1)];
  if (m === 'hang') setInterval(() => {}, 1000);
  else if (m === 'exit') { console.error('SECRET-IN-STDERR'); process.exit(3); }
  else if (m === 'garbage') console.log('not json');
  else console.log(JSON.stringify({ type: 'result', is_error: false, structured_output: { ok: true } }));
});
`,
  );
  chmodSync(bin, 0o755);
  const calls = () => readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return { bin, calls };
}

describe('runClaude', () => {
  it('runs locked down: argv, env, cwd, stdin', async () => {
    process.env.GITHUB_TOKEN = 'leak-me';
    const s = stub(['ok']);
    const out = await runClaude(req, { token: 'tok-123', bin: s.bin });
    delete process.env.GITHUB_TOKEN;
    expect(out).toEqual({ ok: true });
    const [c] = s.calls();
    const a: string[] = c.argv;
    expect(a).toEqual(expect.arrayContaining(['-p', '--no-session-persistence', '--strict-mcp-config']));
    const val = (f: string) => a[a.indexOf(f) + 1];
    expect(val('--model')).toBe('sonnet');
    expect(val('--tools')).toBe('');
    expect(val('--output-format')).toBe('json');
    expect(JSON.parse(val('--json-schema'))).toEqual({ type: 'object' });
    expect(val('--setting-sources')).toBe('');
    expect(JSON.parse(val('--mcp-config'))).toEqual({ mcpServers: {} });
    expect(val('--system-prompt')).toContain(DATA_NOTICE);
    expect(val('--system-prompt')).toContain('Parse.');
    expect(Object.keys(c.env).filter((k) => !k.startsWith('__')).sort()).toEqual(['CLAUDE_CODE_OAUTH_TOKEN', 'HOME', 'PATH']);
    expect(c.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('tok-123');
    expect(c.env.HOME).toContain('todoman-claude-');
    expect(c.cwd).toContain('todoman-claude-');
    expect(c.entries).toEqual([]);
    expect(c.stdin).toBe('dump text');
  });
  it('retries invalid output once, then succeeds', async () => {
    const s = stub(['garbage', 'ok']);
    await expect(runClaude(req, { token: 't', bin: s.bin })).resolves.toEqual({ ok: true });
    expect(s.calls()).toHaveLength(2);
  });
  it('raises a typed error after the retry fails, also when validate rejects', async () => {
    const s = stub(['garbage']);
    await expect(runClaude(req, { token: 't', bin: s.bin })).rejects.toMatchObject({ kind: 'invalid' });
    expect(s.calls()).toHaveLength(2);
    const v = stub(['ok']);
    await expect(runClaude({ ...req, validate: () => false }, { token: 't', bin: v.bin })).rejects.toBeInstanceOf(ClaudeError);
  });
  it('never puts the token or CLI output in an error', async () => {
    const s = stub(['exit']);
    const e = await runClaude(req, { token: 'tok-SECRET', bin: s.bin }).catch((x: Error) => x);
    expect(e).toMatchObject({ kind: 'failed' });
    expect((e as Error).message).not.toMatch(/SECRET/);
  });
  it('kills a hang at the timeout', async () => {
    const s = stub(['hang']);
    await expect(runClaude(req, { token: 't', bin: s.bin, timeoutMs: 300 })).rejects.toMatchObject({ kind: 'timeout' });
  });
});
