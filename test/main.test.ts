import { describe, expect, it } from 'vitest';
import { run } from '../src/main.js';

describe('run', () => {
  it.each(['process', 'summary', 'doctor'])('accepts %s', async (m) => {
    await expect(run(m)).resolves.toBeUndefined();
  });
  it('rejects an unknown mode', async () => {
    await expect(run('nope')).rejects.toThrow('unknown mode: nope');
  });
});
