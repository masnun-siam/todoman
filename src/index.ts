import * as core from '@actions/core';
import { run } from './main.js';

run(core.getInput('mode', { required: true })).catch((e) => core.setFailed(e instanceof Error ? e.message : String(e)));
