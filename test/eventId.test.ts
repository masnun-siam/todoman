import { describe, expect, it } from 'vitest';
import { eventId } from '../src/eventId.js';

describe('eventId', () => {
  it('is deterministic and keyed on the start instant in UTC', () => {
    const a = eventId('masnun-siam/todo', 7, '2026-10-30T11:00:00+06:00');
    expect(eventId('masnun-siam/todo', 7, '2026-10-30T05:00:00Z')).toBe(a);
    expect(a).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(eventId('masnun-siam/todo', 7, '2026-10-30T05:00:00Z')).toBe('6kqgdh3bg3hkmgm79u5uq86o9r2aqsiq41f8jqc0nnr015u87qhg'); // pinned: a change would break retries across versions
  });
  it('differs by repo, dump and start', () => {
    const a = eventId('masnun-siam/todo', 7, '2026-10-30T05:00:00Z');
    expect(eventId('masnun-siam/todo-sandbox', 7, '2026-10-30T05:00:00Z')).not.toBe(a);
    expect(eventId('masnun-siam/todo', 8, '2026-10-30T05:00:00Z')).not.toBe(a);
    expect(eventId('masnun-siam/todo', 7, '2026-10-30T05:30:00Z')).not.toBe(a);
    expect(eventId('a/b1', 2, '2026-10-30T05:00:00Z')).not.toBe(eventId('a/b', 12, '2026-10-30T05:00:00Z'));
  });
});
