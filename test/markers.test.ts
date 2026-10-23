import { describe, expect, it } from 'vitest';
import { nextKey } from '../src/keys.js';
import { BOT, itemMarker, parseItemMarkers, parseRefMarkers, parseSummaryMarkers, refMarker, summaryMarker } from '../src/markers.js';
import { sanitize } from '../src/sanitize.js';

const bot = (body: string) => ({ author: BOT, body });
const item = { repo: 'masnun-siam/todo', dump: 7, key: 'i2' };

describe('sanitize', () => {
  it('strips forged markers, even spliced ones', () => {
    expect(sanitize('a <!-- todoman:item x --> b')).not.toContain('<!--');
    expect(sanitize('<<!---!-- x --->>')).not.toMatch(/<!--|-->/);
    expect(parseItemMarkers([bot(sanitize(`<!-- ${itemMarker(item).slice(5)}`))])).toEqual([]);
  });
  it('neutralises @mentions', () => {
    expect(sanitize('ping @octocat and @org/team')).not.toMatch(/@[A-Za-z]/);
  });
});

describe('markers', () => {
  it('round-trips every marker', () => {
    const ref = 'masnun-siam/todoman#12';
    const sum = { kind: 'weekly' as const, from: '2026-10-12T00:00:00Z', to: '2026-10-19T00:00:00Z' };
    expect(parseItemMarkers([bot(itemMarker(item)), bot(itemMarker({ ...item, key: 'i3', ref }))])).toEqual([item, { ...item, key: 'i3', ref }]);
    const start = '2026-10-26T05:00:00.000Z';
    expect(parseItemMarkers([bot(itemMarker({ ...item, start }))])).toEqual([{ ...item, start }]);
    expect(parseRefMarkers([bot(refMarker(ref))])).toEqual([ref]);
    expect(parseSummaryMarkers([bot(summaryMarker(sum))])).toEqual([sum]);
    expect(itemMarker(item)).toBe('<!-- todoman:item repo=masnun-siam/todo dump=7 key=i2 -->');
  });
  it('ignores markers not authored by the bot', () => {
    const human = { author: 'masnun-siam', body: itemMarker(item) + refMarker('a/b#1') + summaryMarker({ kind: 'on-demand', from: 'a', to: 'b' }) };
    expect(parseItemMarkers([human])).toEqual([]);
    expect(parseRefMarkers([human])).toEqual([]);
    expect(parseSummaryMarkers([human])).toEqual([]);
  });
});

describe('nextKey', () => {
  it('starts at i1, continues after the highest, never reuses a gap, scopes to the dump', () => {
    expect(nextKey([], 7)).toBe('i1');
    expect(nextKey([item, { ...item, key: 'i5' }], 7)).toBe('i6');
    expect(nextKey([{ ...item, key: 'i9' }], 8)).toBe('i1');
  });
});
