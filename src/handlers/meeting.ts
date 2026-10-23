import { localDate, localTime } from '../dates.js';
import { eventId } from '../eventId.js';
import { ItemError } from '../failure.js';
import type { ItemHandler } from '../handlers.js';
import { itemMarker } from '../markers.js';

const EVENT_EXISTS = 'the calendar event exists and invites were sent';
export const SUMMARY_PROMPT = 'Add the meeting summary as a comment';

/**
 * FR-4: the event first (its id is fixed, so a retry reads it back and never invites twice), then the
 * `meeting` issue, then the event description gains the issue link. Issue first would leave a marked
 * issue with no event if Google failed, and FR-8 matching would then never create the event.
 */
export const meetingHandler: ItemHandler = {
  type: 'meeting',
  async create(item, ctx) {
    if (item.type !== 'meeting') throw new Error('not a meeting');
    // title, agenda (plain, URLs removed, <= 500) and invitees were checked by validate()
    const start = new Date(item.start);
    const end = new Date(start.getTime() + item.durationMinutes * 60_000);
    const id = eventId(ctx.repo, ctx.dump.number, item.start);
    const ev = await ctx.calendar.insertEvent({
      id,
      title: item.title,
      start: item.start,
      end: end.toISOString(),
      timeZone: ctx.tz,
      invitees: item.invitees.map((p) => p.email),
      description: item.agenda,
    });
    const title = `Meeting: ${item.title}`;
    if (ev.status === 'deleted') return { title, details: ['the calendar event was deleted'], labels: [] }; // done; never recreated

    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: ctx.tz, weekday: 'short' }).format(start);
    const date = `${weekday} ${localDate(start, ctx.tz)}`;
    const time = `${localTime(start, ctx.tz)}–${localTime(end, ctx.tz)} ${ctx.tz}`;
    const duration = `${item.durationMinutes} minutes`;
    const invited = item.invitees.map((p) => p.name).join(', ') || 'nobody';
    const body = [
      `Date: ${date}`,
      `Time: ${time}`,
      `Duration: ${duration}`,
      `Attendees: ${invited}`,
      ...item.skipped.map((s) => `Not invited: ${s}`),
      `Meet: ${ev.meetLink ?? 'not ready yet; open the calendar event'}`,
      `Calendar event: ${ev.eventLink}`,
      item.agenda && `Agenda: ${item.agenda}`,
      `Source dump: ${ctx.dump.url}`,
      itemMarker({ repo: ctx.repo, dump: ctx.dump.number, key: ctx.key, start: start.toISOString() }),
      SUMMARY_PROMPT,
    ]
      .filter(Boolean)
      .join('\n\n');
    const issue = await ctx.gh.createIssue({ title, body, labels: ['meeting'], assignees: [ctx.owner] }).catch((e: unknown) => {
      throw ev.status === 'existing' ? new ItemError(e, EVENT_EXISTS) : e;
    });

    const details = [`${date} ${time}`, duration, `invited: ${invited}`, ...item.skipped];
    // ponytail: the issue exists now, so a failed link is reported, not retried; FR-8 would skip the item
    await ctx.calendar.describeEvent(id, [item.agenda, `Meeting issue: ${issue.url}`].filter(Boolean).join('\n\n')).catch(() => {
      details.push('the calendar event does not link this issue');
    });
    return { title: issue.title, url: issue.url, details, labels: issue.labels };
  },
};
