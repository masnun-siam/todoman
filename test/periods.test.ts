import { describe, expect, it } from 'vitest';
import type { DatedIssue } from '../src/github.js';
import { BOT, summaryMarker } from '../src/markers.js';
import { weeklyPeriod } from '../src/periods.js';

const summary = (n: number, body: string, author = BOT): DatedIssue => ({
  number: n, title: 's', body, url: 'u', author, state: 'open', labels: ['summary'], createdAt: '', updatedAt: '', closedAt: null,
});
const stub = (issues: DatedIssue[]) => ({ issuesLabelled: async () => issues });
const thu = (d: string) => new Date(`${d}T12:00:00Z`); // Thursday 18:00 Asia/Dhaka

describe('weeklyPeriod', () => {
  it('with no weekly summary covers the 7 days before the run', async () => {
    expect(await weeklyPeriod(stub([]), thu('2026-10-22'))).toEqual({ from: '2026-10-15T12:00:00.000Z', to: '2026-10-22T12:00:00.000Z' });
  });

  it('starts at the latest weekly marker to, ignoring on-demand and non-bot markers', async () => {
    const issues = [
      summary(1, summaryMarker({ kind: 'weekly', from: '2026-10-08T12:00:00.000Z', to: '2026-10-15T12:00:00.000Z' })),
      summary(2, summaryMarker({ kind: 'weekly', from: '2026-10-01T12:00:00.000Z', to: '2026-10-08T12:00:00.000Z' })),
      summary(3, summaryMarker({ kind: 'on-demand', from: '2026-10-16T00:00:00.000Z', to: '2026-10-17T00:00:00.000Z' })),
      summary(4, summaryMarker({ kind: 'weekly', from: '2026-10-16T00:00:00.000Z', to: '2026-10-20T00:00:00.000Z' }), 'masnun-siam'),
    ];
    expect((await weeklyPeriod(stub(issues), thu('2026-10-22'))).from).toBe('2026-10-15T12:00:00.000Z');
  });

  it('consecutive weekly periods are contiguous: a task closed Thursday 20:00 falls in the next one', async () => {
    const first = await weeklyPeriod(stub([]), thu('2026-10-22'));
    const second = await weeklyPeriod(stub([summary(1, summaryMarker({ kind: 'weekly', ...first }))]), thu('2026-10-29'));
    expect(second.from).toBe(first.to);
    const closed = Date.parse('2026-10-22T14:00:00Z'); // Thursday 20:00 Asia/Dhaka
    expect(closed >= Date.parse(first.to)).toBe(true);
    expect(closed >= Date.parse(second.from) && closed < Date.parse(second.to)).toBe(true);
  });
});
