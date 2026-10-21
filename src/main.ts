import * as core from '@actions/core';
import { loadConfig, type Env } from './config.js';
import { eventActor, isOwner } from './gate.js';
import { runDoctor } from './doctor.js';
import { createGh } from './github.js';
import { maskSecrets } from './secrets.js';

export const MODES = ['process', 'summary', 'doctor'] as const;
export type Mode = (typeof MODES)[number];

const handlers: Record<Mode, (env: Env) => Promise<void> | void> = {
  process: () => core.info('mode: process'),
  summary: () => core.info('mode: summary'),
  doctor: (env) => runDoctor(createGh(env), core.info),
};

export async function run(mode: string, env: Env = process.env): Promise<void> {
  if (!(MODES as readonly string[]).includes(mode)) {
    throw new Error(`unknown mode: ${mode}`);
  }
  const cfg = loadConfig(env);
  if (mode !== 'doctor' && !cfg.enabled) {
    core.info('Todoman disabled');
    return;
  }
  if (mode === 'process' && !isOwner(eventActor(env), cfg.owner)) {
    core.info('Ignoring event from a non-owner');
    return;
  }
  maskSecrets(env, core.setSecret);
  await handlers[mode as Mode](env);
}
