import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DATA_NOTICE } from './prompts.js';

export interface ClaudeRequest {
  model: string;
  /** Task-specific system prompt; DATA_NOTICE is always prepended. */
  system: string;
  schema: object;
  input: string;
  /** Extra check on the parsed JSON (e.g. #8's validator); a false result counts as invalid output. */
  validate?: (value: unknown) => boolean;
}
export interface ClaudeOptions {
  token: string;
  bin?: string;
  timeoutMs?: number;
}

export type ClaudeErrorKind = 'timeout' | 'failed' | 'invalid';
/** Messages are fixed text: never the CLI's output, stderr or any secret. */
export class ClaudeError extends Error {
  constructor(readonly kind: ClaudeErrorKind) {
    super({ timeout: 'Claude timed out', failed: 'Claude failed to run', invalid: 'Claude returned invalid output' }[kind]);
  }
}

const FIVE_MIN = 5 * 60_000;

function args(r: ClaudeRequest): string[] {
  return [
    '-p', '--model', r.model, '--tools', '', '--output-format', 'json', '--json-schema', JSON.stringify(r.schema),
    '--no-session-persistence', '--system-prompt', `${DATA_NOTICE}\n\n${r.system}`,
    '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
  ];
}

function once(bin: string, r: ClaudeRequest, token: string, timeoutMs: number): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'todoman-claude-'));
  const cwd = join(root, 'work');
  const home = join(root, 'home');
  mkdirSync(cwd);
  mkdirSync(home);
  return new Promise<string>((resolve, reject) => {
    // ponytail: env is exactly PATH, temp HOME and the token; nothing else leaks in
    const child = spawn(bin, args(r), { cwd, env: { PATH: process.env.PATH, HOME: home, CLAUDE_CODE_OAUTH_TOKEN: token }, stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (c) => (out += c));
    child.on('error', () => reject(new ClaudeError('failed')));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new ClaudeError('timeout'));
      else if (code !== 0) reject(new ClaudeError('failed'));
      else resolve(out);
    });
    child.stdin.on('error', () => undefined); // child may exit before reading stdin
    child.stdin.end(r.input);
  }).finally(() => rmSync(root, { recursive: true, force: true }));
}

function extract(out: string): unknown {
  const res = JSON.parse(out) as { is_error?: boolean; structured_output?: unknown; result?: unknown };
  if (res.is_error) throw new Error('error result');
  if (res.structured_output !== undefined) return res.structured_output;
  return JSON.parse(String(res.result));
}

/** Runs Claude locked down and returns validated JSON; invalid output is retried once. */
export async function runClaude(r: ClaudeRequest, o: ClaudeOptions): Promise<unknown> {
  const bin = o.bin ?? 'claude';
  for (let attempt = 0; ; attempt++) {
    const out = await once(bin, r, o.token, o.timeoutMs ?? FIVE_MIN);
    try {
      const value = extract(out);
      if (!r.validate || r.validate(value)) return value;
    } catch {
      // fall through to retry / raise
    }
    if (attempt === 1) throw new ClaudeError('invalid');
  }
}
