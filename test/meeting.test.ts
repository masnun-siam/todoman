import { describe, expect, it } from 'vitest';
import { eventId } from '../src/eventId.js';
import type { Issue, ProcessGh } from '../src/github.js';
import type { Calendar, EventResult, NewEvent } from '../src/google.js';
import type { ItemContext } from '../src/handlers.js';
import { ItemError } from '../src/failure.js';
import { HANDLERS } from '../src/handlers.js';
import { meetingHandler, SUMMARY_PROMPT } from '../src/handlers/meeting.js';
import { BOT, parseItemMarkers } from '../src/markers.js';
import type { ValidItem } from '../src/validate.js';

type NewIssue = Parameters<ProcessGh['createIssue']>[0];
const asif = { name: 'Asif', aliases: ['asif'], email: 'asif@example.com' };
const START = '2026-10-26T11:00:00+06:00';
const MEETING: ValidItem = {
  type: 'meeting',
  title: 'PRD review with Asif',
  start: START,
  durationMinutes: 60,
  invitees: [asif],
  skipped: ['rafi — not in people.yml, invite manually'],
  agenda: 'Review the PRD',
};
const LIVE: EventResult = { status: 'created', meetLink: 'https://meet/x', eventLink: 'https://calendar/e' };

function ctx(opts: { event?: EventResult; failIssue?: boolean; failInsert?: boolean; failDescribe?: boolean } = {}) {
  const issues: NewIssue[] = [];
  const events: NewEvent[] = [];
  const described: [string, string][] = [];
  const calendar: Calendar = {
    insertEvent: async (e) => {
      if (opts.failInsert) throw new Error('google down');
      events.push(e);
      return opts.event ?? LIVE;
    },
    describeEvent: async (id, d) => {
      if (opts.failDescribe) throw new Error('google down');
      described.push([id, d]);
    },
  };
  const gh = {
    createIssue: async (i: NewIssue): Promise<Issue> => {
      if (opts.failIssue) throw new Error('boom');
      issues.push(i);
      return { number: 11, title: i.title, body: i.body, url: 'https://github.com/o/r/issues/11', author: BOT, state: 'open', labels: i.labels, createdAt: '' };
    },
  } as unknown as ProcessGh;
  const dump: Issue = { number: 5, title: 'd', body: '', url: 'https://github.com/o/r/issues/5', author: 'masnun-siam', state: 'open', labels: [], createdAt: '' };
  const c: ItemContext = { gh, calendar, external: () => { throw new Error('unused'); }, summarise: () => { throw new Error('unused'); }, repo: 'o/r', owner: 'masnun-siam', tz: 'Asia/Dhaka', dump, key: 'i2' };
  return { c, issues, events, described };
}

describe('meetingHandler (FR-4)', () => {
  it('is registered for meetings', () => {
    expect(HANDLERS.find((h) => h.type === 'meeting')).toBe(meetingHandler);
  });

  it('creates the event with the fixed id, tz, end, invitee emails and agenda only', async () => {
    const { c, events } = ctx();
    await meetingHandler.create(MEETING, c);
    expect(events).toEqual([
      {
        id: eventId('o/r', 5, START),
        title: 'PRD review with Asif',
        start: START,
        end: '2026-10-26T06:00:00.000Z',
        timeZone: 'Asia/Dhaka',
        invitees: ['asif@example.com'],
        description: 'Review the PRD',
      },
    ]);
  });

  it('creates the meeting issue, then links it from the event description', async () => {
    const { c, issues, described, events } = ctx();
    const got = await meetingHandler.create(MEETING, c);
    expect(issues).toHaveLength(1);
    const [i] = issues;
    expect(i.title).toBe('Meeting: PRD review with Asif');
    expect(i.labels).toEqual(['meeting']);
    expect(i.assignees).toEqual(['masnun-siam']);
    for (const line of [
      'Date: Mon 2026-10-26',
      'Time: 11:00–12:00 Asia/Dhaka',
      'Duration: 60 minutes',
      'Attendees: Asif',
      'Not invited: rafi — not in people.yml, invite manually',
      'Meet: https://meet/x',
      'Calendar event: https://calendar/e',
      'Agenda: Review the PRD',
      'Source dump: https://github.com/o/r/issues/5',
    ])
      expect(i.body).toContain(line);
    expect(i.body.endsWith(SUMMARY_PROMPT)).toBe(true);
    expect(i.body).not.toContain('asif@example.com');
    expect(parseItemMarkers([{ author: BOT, body: i.body }])).toEqual([{ repo: 'o/r', dump: 5, key: 'i2', start: '2026-10-26T05:00:00.000Z' }]);
    expect(described).toEqual([[events[0].id, 'Review the PRD\n\nMeeting issue: https://github.com/o/r/issues/11']]);
    expect(got).toEqual({
      title: 'Meeting: PRD review with Asif',
      url: 'https://github.com/o/r/issues/11',
      details: ['Mon 2026-10-26 11:00–12:00 Asia/Dhaka', '60 minutes', 'invited: Asif', 'rafi — not in people.yml, invite manually'],
      labels: ['meeting'],
    });
  });

  it('says nobody was invited, and handles a Meet link Google has not made yet', async () => {
    const { c, issues } = ctx({ event: { status: 'existing', eventLink: 'https://calendar/e' } });
    const got = await meetingHandler.create({ ...MEETING, invitees: [], skipped: [], agenda: '' } as ValidItem, c);
    expect(issues[0].body).toContain('Attendees: nobody');
    expect(issues[0].body).toContain('Meet: not ready yet; open the calendar event');
    expect(issues[0].body).not.toContain('Agenda:');
    expect(got.details).toContain('invited: nobody');
  });

  it('a deleted event is done: no issue, nothing recreated, and it says so', async () => {
    const { c, issues, described } = ctx({ event: { status: 'deleted' } });
    expect(await meetingHandler.create(MEETING, c)).toEqual({ title: 'Meeting: PRD review with Asif', details: ['the calendar event was deleted'], labels: [] });
    expect(issues).toEqual([]);
    expect(described).toEqual([]);
  });

  it('a retry after the issue failed reuses the same event id', async () => {
    const first = ctx({ failIssue: true });
    await expect(meetingHandler.create(MEETING, first.c)).rejects.toThrow('boom');
    const retry = ctx({ event: { ...LIVE, status: 'existing' } as EventResult });
    await meetingHandler.create(MEETING, retry.c);
    expect(retry.events[0].id).toBe(first.events[0].id);
    expect(retry.issues).toHaveLength(1);
  });

  it('a retry that finds the event and then fails the issue says the event exists and invites were sent', async () => {
    const retry = ctx({ failIssue: true, event: { ...LIVE, status: 'existing' } as EventResult });
    const err = await meetingHandler.create(MEETING, retry.c).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ItemError);
    expect((err as ItemError).note).toBe('The calendar event exists and invites were sent.');
    expect((err as ItemError).cause).toBeInstanceOf(Error);
  });

  it('creates no issue when the event fails, and reports a failed description link', async () => {
    const down = ctx({ failInsert: true });
    await expect(meetingHandler.create(MEETING, down.c)).rejects.toThrow();
    expect(down.issues).toEqual([]);
    const { c } = ctx({ failDescribe: true });
    expect((await meetingHandler.create(MEETING, c)).details).toContain('the calendar event does not link this issue');
  });

  it('rejects a non-meeting item', async () => {
    await expect(meetingHandler.create({ type: 'task', title: 'x', body: '', labels: [] }, ctx().c)).rejects.toThrow();
  });
});
