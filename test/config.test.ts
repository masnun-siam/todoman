import { expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

it('defaults', () => {
  expect(loadConfig({})).toEqual({ tz: 'Asia/Dhaka', owner: 'masnun-siam', enabled: false });
});
it('reads env', () => {
  expect(loadConfig({ TODOMAN_TZ: 'UTC', TODOMAN_OWNER: 'x', FEATURE_DUMP_TO_ISSUES: 'true' })).toEqual({ tz: 'UTC', owner: 'x', enabled: true });
});
