import { describe, expect, it } from 'vitest';
import { TOO_MANY } from '../src/questions.js';
import { validate, type ValidateContext } from '../src/validate.js';

const asif = { name: 'Asif', aliases: [], email: 'asif@example.com' };
const ctx: ValidateContext = {
  now: new Date('2026-10-21T10:00:00+06:00'),
  text: 'PRD review with Asif monday 11am, tax form by friday, see masnun-siam/meeting-manager#85',
  labels: ['finance', 'task', 'todoman:processing', 'repo:a/b'],
  people: [asif],
};
const meeting = { type: 'meeting', title: 'PRD review with Asif', start: '2026-10-26T11:00:00+06:00', durationMinutes: 60, attendees: ['asif'], agenda: 'Review' };
const one = (item: object, c = ctx) => validate({ items: [item], questions: [] }, c);

describe('validate', () => {
  it('accepts the PRD example items', () => {
    const r = validate(
      {
        items: [
          { type: 'task', title: 'File tax form', body: 'b', labels: ['finance', 'nope', 'task', 'todoman:processing', 'repo:a/b'], due: '2026-10-23' },
          meeting,
          { type: 'tracking', ref: 'masnun-siam/meeting-manager#85', note: 'n' },
          { type: 'summary', from: '2026-10-20', to: '2026-10-20' },
        ],
        questions: [{ about: 'x', question: 'y' }],
      },
      ctx,
    );
    expect(r.items).toHaveLength(4);
    expect(r.items[0]).toMatchObject({ labels: ['finance'], due: '2026-10-23' });
    expect(r.items[1]).toMatchObject({ invitees: [asif], skipped: [], durationMinutes: 60 });
    expect(r.questions).toEqual([{ about: 'x', question: 'y' }]);
  });
  it('turns a failing item into a question, keeping the good ones', () => {
    const r = validate({ items: [{ type: 'task', title: 'ok' }, { ...meeting, start: '2026-10-26T11:00:00' }], questions: [] }, ctx);
    expect(r.items).toHaveLength(1);
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0].about).toBe('PRD review with Asif');
  });
  it.each([
    ['empty title', { type: 'task', title: '' }],
    ['title over 120', { type: 'task', title: 'x'.repeat(121) }],
    ['bad due date', { type: 'task', title: 'a', due: '2026-02-30' }],
    ['past start', { ...meeting, start: '2026-10-20T11:00:00+06:00' }],
    ['start over a year out', { ...meeting, start: '2027-10-22T11:00:00+06:00' }],
    ['duration 4', { ...meeting, durationMinutes: 4 }],
    ['duration 481', { ...meeting, durationMinutes: 481 }],
    ['attendees not names', { ...meeting, attendees: [1] }],
    ['agenda over 500', { ...meeting, agenda: 'a '.repeat(300) }],
    ['ref not literal in text', { type: 'tracking', ref: 'a/b#1', note: 'n' }],
    ['malformed ref', { type: 'tracking', ref: 'https://github.com/a/b/issues/1', note: 'n' }],
    ['summary over 31 days', { type: 'summary', from: '2026-10-01', to: '2026-11-01' }],
    ['summary backwards', { type: 'summary', from: '2026-10-02', to: '2026-10-01' }],
    ['unknown type', { type: 'event', title: 'a' }],
  ])('asks about: %s', (_n, item) => {
    const r = one(item);
    expect(r.items).toEqual([]);
    expect(r.questions).toHaveLength(1);
  });
  it('accepts a 31 day summary and the boundary values', () => {
    expect(one({ type: 'summary', from: '2026-10-01', to: '2026-10-31' }).items).toHaveLength(1);
    expect(one({ ...meeting, durationMinutes: 5 }).items).toHaveLength(1);
    expect(one({ ...meeting, durationMinutes: 480 }).items).toHaveLength(1);
    expect(one({ type: 'task', title: 'x'.repeat(120) }).items).toHaveLength(1);
  });
  it('accepts a GitHub URL as the literal source of a ref', () => {
    const c = { ...ctx, text: 'check https://github.com/a/b/pull/7' };
    expect(one({ type: 'tracking', ref: 'a/b#7', note: 'n' }, c).items).toHaveLength(1);
  });
  it('does not accept a ref that is only part of a longer ref or host', () => {
    const t = (text: string, ref: string) => one({ type: 'tracking', ref, note: 'n' }, { ...ctx, text }).items;
    expect(t('see masnun-siam/todoman#12', 'siam/todoman#1')).toHaveLength(0);
    expect(t('see masnun-siam/todoman#1', 'siam/todoman#1')).toHaveLength(0);
    expect(t('https://notgithub.com/a/b/issues/1', 'a/b#1')).toHaveLength(0);
    expect(t('see a/b#1.', 'a/b#1')).toHaveLength(1);
  });
  it('matches labels case-insensitively and returns the repo spelling', () => {
    const r = one({ type: 'task', title: 'a', labels: ['finance'] }, { ...ctx, labels: ['Finance'] });
    expect(r.items[0]).toMatchObject({ labels: ['Finance'] });
  });
  it('rejects a second meeting at the same instant', () => {
    const r = validate({ items: [meeting, { ...meeting, title: 'other', start: '2026-10-26T05:00:00Z' }], questions: [] }, ctx);
    expect(r.items).toHaveLength(1);
    expect(r.questions).toHaveLength(1);
  });
  it('strips URLs from the agenda and comment delimiters from text', () => {
    const r = one({ ...meeting, title: 'a <!-- todoman:item --> b', agenda: 'see https://x.com/y now' });
    expect(r.items[0]).toMatchObject({ title: 'a  todoman:item  b', agenda: 'see now' });
  });
  it('more than 10 items creates nothing and asks only to split', () => {
    expect(validate({ items: [], questions: [] }, ctx)).toEqual({ items: [], questions: [] });
    const many = validate({ items: Array.from({ length: 11 }, () => ({ type: 'task', title: 'a' })), questions: [{ about: 'x', question: 'y' }] }, ctx);
    expect(many).toEqual({ items: [], questions: [TOO_MANY] });
  });
  it('never throws on garbage', () => {
    for (const g of [null, 'x', 3, {}, { items: 'x' }, { items: [null, 1, []] }]) expect(() => validate(g, ctx)).not.toThrow();
  });
  it('uses the injected clock: a retry later keeps working off the same now', () => {
    const later = { ...ctx, now: new Date('2026-10-27T10:00:00+06:00') };
    expect(one(meeting, later).items).toEqual([]);
    expect(one(meeting, ctx).items).toHaveLength(1);
  });
});
