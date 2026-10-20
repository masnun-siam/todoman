import { readFileSync } from 'node:fs';
import type { Env } from './config.js';

/** Actor of the event payload file (GITHUB_EVENT_PATH), never a shell-interpolated string. */
export function eventActor(env: Env): string | undefined {
  if (!env.GITHUB_EVENT_PATH) return undefined;
  const payload = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) as { sender?: { login?: string } };
  return payload.sender?.login;
}

export function isOwner(actor: string | undefined, owner: string): boolean {
  return actor === owner;
}
