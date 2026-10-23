import { describe, expect, it } from 'vitest';
import { MAX_INVITEES, parsePeople, resolveInvitees, type Person } from '../src/invitees.js';

const asif: Person = { name: 'Asif', aliases: ['ash'], email: 'asif@example.com' };
const bob: Person = { name: 'Bob', aliases: [], email: 'bob@example.com' };

describe('parsePeople', () => {
  it('accepts a valid file, including an empty aliases list', () => {
    expect(parsePeople('- name: Asif\n  aliases: [ash]\n  email: asif@example.com\n- name: Bob\n  aliases: []\n  email: bob@example.com\n')).toEqual([asif, bob]);
  });
  it('rejects an alias that is not a string', () => {
    for (const aliases of ['[123]', '[null]', '[[x]]']) {
      expect(parsePeople(`- name: A\n  aliases: ${aliases}\n  email: a@example.com\n`)).toBeNull();
    }
  });
});

describe('resolveInvitees', () => {
  it('invites only people named in the text', () => {
    const r = resolveInvitees(['asif', 'bob'], [asif, bob], 'PRD review with Asif monday');
    expect(r.invited).toEqual([asif]);
    expect(r.skipped).toEqual(['bob — not named in the dump, skipped']);
  });
  it('lists people missing from people.yml', () => {
    const r = resolveInvitees(['asif', 'rafi'], [asif], 'meeting with asif and rafi');
    expect(r.invited).toEqual([asif]);
    expect(r.skipped).toEqual(['rafi — not in people.yml, invite manually']);
  });
  it('matches whole words and aliases, case-insensitively', () => {
    expect(resolveInvitees(['asif'], [asif], 'with ASIFA').invited).toEqual([]);
    expect(resolveInvitees(['asif'], [asif], 'with Ash tomorrow').invited).toEqual([asif]);
  });
  it('never invites by an email Claude supplies', () => {
    const r = resolveInvitees(['asif@example.com', 'evil@x.com'], [asif], 'asif@example.com evil@x.com');
    expect(r.invited).toEqual([]);
    expect(r.skipped).toHaveLength(2);
  });
  it('invites each person once and at most 10', () => {
    expect(resolveInvitees(['asif', 'Ash'], [asif], 'asif').invited).toEqual([asif]);
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `P${i}`, aliases: [], email: `p${i}@x.com` }));
    const r = resolveInvitees(many.map((p) => p.name), many, many.map((p) => p.name).join(' '));
    expect(r.invited).toHaveLength(MAX_INVITEES);
    expect(r.skipped).toHaveLength(2);
  });
  it('lists an unknown name once', () => {
    expect(resolveInvitees(['bob', 'bob'], [], 'bob').skipped).toHaveLength(1);
  });
});
