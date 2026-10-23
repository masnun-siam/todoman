import { readFileSync } from 'node:fs';
import type { Env } from './config.js';

interface EventPayload {
  sender?: { login?: string };
  issue?: { number?: number };
  inputs?: { from?: string; to?: string };
}

/** The event payload file (GITHUB_EVENT_PATH), never a shell-interpolated string. */
function readEvent(env: Env): EventPayload {
  return env.GITHUB_EVENT_PATH ? (JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) as EventPayload) : {};
}

export function eventActor(env: Env): string | undefined {
  return readEvent(env).sender?.login;
}

export function eventIssue(env: Env): number | undefined {
  return readEvent(env).issue?.number;
}

/** workflow_dispatch `from`/`to` inputs; empty when not given. */
export function eventDates(env: Env): { from: string; to: string } {
  const i = readEvent(env).inputs;
  return { from: i?.from?.trim() ?? '', to: i?.to?.trim() ?? '' };
}

export function isOwner(actor: string | undefined, owner: string): boolean {
  return actor === owner;
}
