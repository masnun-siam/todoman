import { describe, expect, it } from 'vitest';
import { isCreated, normTitle } from '../src/match.js';
import type { ValidItem } from '../src/validate.js';

const task = (title: string): ValidItem => ({ type: 'task', title, body: '', labels: [] });
const made = [{ key: 'i1', type: 'task', title: 'Buy milk', url: 'u' }];

describe('normTitle', () => {
  it('ignores case, punctuation and spacing', () => {
    expect(normTitle('  Buy   MILK!! ')).toBe('buy milk');
    expect(normTitle('Call the bank — today')).toBe('call the bank today');
    expect(normTitle('Ｂｕｙ milk')).toBe('buy milk');
  });
});

describe('isCreated (FR-8 matching)', () => {
  it('matches a task by type plus normalised title', () => {
    expect(isCreated(task('buy milk.'), made)).toBe(true);
    expect(isCreated(task('Buy oat milk'), made)).toBe(false);
  });
  it('never matches across types', () => {
    expect(isCreated(task('Buy milk'), [{ ...made[0], type: 'meeting' }])).toBe(false);
    expect(isCreated({ type: 'summary', from: '2026-10-01', to: '2026-10-07' }, made)).toBe(false);
  });
  it('matches a meeting by start instant, whatever its title or offset', () => {
    const meeting = (start: string): ValidItem => ({ type: 'meeting', title: 'Other', start, durationMinutes: 30, invitees: [], skipped: [], agenda: '' });
    const made = [{ key: 'i1', type: 'meeting', title: 'Meeting: Sync', url: 'u', start: '2026-10-26T05:00:00.000Z' }];
    expect(isCreated(meeting('2026-10-26T11:00:00+06:00'), made)).toBe(true);
    expect(isCreated(meeting('2026-10-26T11:30:00+06:00'), made)).toBe(false);
    expect(isCreated(meeting('2026-10-26T11:00:00+06:00'), [{ ...made[0], start: undefined }])).toBe(false);
  });
  it('matches nothing when nothing was created', () => {
    expect(isCreated(task('Buy milk'), [])).toBe(false);
  });
});
