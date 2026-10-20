import * as core from '@actions/core';

export const MODES = ['process', 'summary', 'doctor'] as const;
export type Mode = (typeof MODES)[number];

const handlers: Record<Mode, () => Promise<void> | void> = {
  process: () => core.info('mode: process'),
  summary: () => core.info('mode: summary'),
  doctor: () => core.info('mode: doctor'),
};

export async function run(mode: string): Promise<void> {
  if (!(MODES as readonly string[]).includes(mode)) {
    throw new Error(`unknown mode: ${mode}`);
  }
  await handlers[mode as Mode]();
}
