// CI check: the pinned Claude CLI honours --tools "". Points it at a local fake API and asserts the request carries no tools.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bin = join(process.cwd(), 'node_modules/.bin/claude');
const bodies = [];
const server = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    if (req.url.startsWith('/v1/messages')) bodies.push(JSON.parse(b));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }),
    );
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const root = mkdtempSync(join(tmpdir(), 'claude-check-'));
const child = spawn(bin, ['-p', '--model', 'sonnet', '--tools', '', '--no-session-persistence', '--output-format', 'json', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'], {
  cwd: root,
  env: { PATH: process.env.PATH, HOME: root, CLAUDE_CODE_OAUTH_TOKEN: 'fake', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
  stdio: ['pipe', 'ignore', 'ignore'],
});
child.stdin.end('hi');
const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
await new Promise((r) => child.on('close', r));
clearTimeout(timer);
server.close();
if (bodies.length === 0) throw new Error('the CLI made no model request; cannot prove --tools ""');
const bad = bodies.filter((b) => (b.tools ?? []).length > 0);
if (bad.length) throw new Error(`request carried tools: ${bad[0].tools.map((t) => t.name).join(',')}`);
console.log(`ok: ${bodies.length} model request(s), none carried tools`);
