import type { Env } from './config.js';

const NAMES = ['CLAUDE_CODE_OAUTH_TOKEN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'];

/** Register every secret value (and each token in GH_READ_TOKENS) as masked. */
export function maskSecrets(env: Env, setSecret: (v: string) => void): void {
  for (const n of NAMES) if (env[n]) setSecret(env[n]);
  if (env.GH_READ_TOKENS) {
    setSecret(env.GH_READ_TOKENS);
    try {
      for (const t of Object.values(JSON.parse(env.GH_READ_TOKENS) as Record<string, unknown>)) {
        if (typeof t === 'string' && t) setSecret(t);
      }
    } catch {
      // not valid JSON: the whole value is already masked
    }
  }
}
