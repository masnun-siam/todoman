import * as core from '@actions/core';
import { run } from './main.js';

async function main(): Promise<void> {
  await run(core.getInput('mode', { required: true }));
}

main().catch((e) => core.setFailed(e instanceof Error ? e.message : String(e)));
