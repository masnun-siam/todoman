import { describe, expect, it } from 'vitest';
import { createCalendar, GoogleError, refreshAccessToken, type NewEvent } from '../src/google.js';

const ENV = { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csecret', GOOGLE_REFRESH_TOKEN: 'rtoken' };
const SECRET_BODY = '{"error":"boom","leak":"csecret rtoken"}';
const EVENT: NewEvent = {
  id: 'abc123',
  title: 'Sync',
  start: '2026-10-30T11:00:00+06:00',
  end: '2026-10-30T11:30:00+06:00',
  timeZone: 'Asia/Dhaka',
  invitees: ['a@example.com'],
  description: 'Agenda',
};
const LIVE = { status: 'confirmed', htmlLink: 'https://calendar/e', hangoutLink: 'https://meet/x' };

type Reply = { status: number; body?: unknown };
function stubFetch(given: Record<string, Reply[]>) {
  const routes = Object.fromEntries(Object.entries(given).map(([k, v]) => [k, [...v]]));
  const calls: { method: string; url: string; init?: RequestInit }[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url, init });
    const key = `${method} ${url.split('?')[0].replace(/^https:\/\/[^/]+/, '')}`;
    const r = routes[key]?.shift();
    if (!r) throw new Error(`unexpected ${key}`);
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {}), { status: r.status });
  }) as typeof fetch;
  return { fetchFn, calls };
}
const TOKEN = { 'POST /token': [{ status: 200, body: { access_token: 'at' } }] };
const INSERT = 'POST /calendar/v3/calendars/primary/events';
const GET = 'GET /calendar/v3/calendars/primary/events/abc123';

describe('refreshAccessToken', () => {
  it('posts the refresh grant and returns the access token', async () => {
    const { fetchFn, calls } = stubFetch(TOKEN);
    expect(await refreshAccessToken(ENV, fetchFn)).toBe('at');
    const sent = new URLSearchParams(String(calls[0].init?.body));
    expect(Object.fromEntries(sent)).toEqual({ client_id: 'cid', client_secret: 'csecret', refresh_token: 'rtoken', grant_type: 'refresh_token' });
  });
  it('reports a revoked token or missing secrets as an auth error, without the body', async () => {
    const { fetchFn } = stubFetch({ 'POST /token': [{ status: 400, body: SECRET_BODY }] });
    const err = await refreshAccessToken(ENV, fetchFn).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleError);
    expect((err as GoogleError).kind).toBe('auth');
    expect((err as Error).message).not.toMatch(/boom|csecret|rtoken/);
    await expect(refreshAccessToken({}, fetchFn)).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('insertEvent', () => {
  it('creates the event with Meet, sendUpdates=all and the given id', async () => {
    const { fetchFn, calls } = stubFetch({ ...TOKEN, [INSERT]: [{ status: 200, body: LIVE }] });
    expect(await createCalendar(ENV, fetchFn).insertEvent(EVENT)).toEqual({ status: 'created', meetLink: 'https://meet/x', eventLink: 'https://calendar/e' });
    const insert = calls[1];
    const q = new URL(insert.url).searchParams;
    expect(q.get('sendUpdates')).toBe('all');
    expect(q.get('conferenceDataVersion')).toBe('1');
    expect((insert.init?.headers as Record<string, string>).authorization).toBe('Bearer at');
    expect(JSON.parse(String(insert.init?.body))).toEqual({
      id: 'abc123',
      summary: 'Sync',
      description: 'Agenda',
      start: { dateTime: EVENT.start, timeZone: 'Asia/Dhaka' },
      end: { dateTime: EVENT.end, timeZone: 'Asia/Dhaka' },
      attendees: [{ email: 'a@example.com' }],
      conferenceData: { createRequest: { requestId: 'abc123', conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    });
  });
  it('on 409 reads back a live event and returns its links, with no second insert', async () => {
    const { fetchFn, calls } = stubFetch({ ...TOKEN, [INSERT]: [{ status: 409 }], [GET]: [{ status: 200, body: LIVE }] });
    expect(await createCalendar(ENV, fetchFn).insertEvent(EVENT)).toEqual({ status: 'existing', meetLink: 'https://meet/x', eventLink: 'https://calendar/e' });
    expect(calls.filter((c) => c.method === 'POST' && c.url.includes('/events'))).toHaveLength(1);
  });
  it('on 409 reports a cancelled or gone event as deleted and never recreates it', async () => {
    for (const reply of [{ status: 200, body: { status: 'cancelled' } }, { status: 404 }, { status: 410 }]) {
      const { fetchFn, calls } = stubFetch({ ...TOKEN, [INSERT]: [{ status: 409 }], [GET]: [reply] });
      expect(await createCalendar(ENV, fetchFn).insertEvent(EVENT)).toEqual({ status: 'deleted' });
      expect(calls.filter((c) => c.method === 'POST' && c.url.includes('/events'))).toHaveLength(1);
    }
  });
  it('falls back to the conference video entry point for the Meet link', async () => {
    const body = { htmlLink: 'https://calendar/e', conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:1' }, { entryPointType: 'video', uri: 'https://meet/y' }] } };
    const { fetchFn } = stubFetch({ ...TOKEN, [INSERT]: [{ status: 200, body }] });
    expect(await createCalendar(ENV, fetchFn).insertEvent(EVENT)).toMatchObject({ meetLink: 'https://meet/y' });
  });
  it('treats a reply without an event link as a failure', async () => {
    const { fetchFn } = stubFetch({ ...TOKEN, [INSERT]: [{ status: 200, body: { hangoutLink: 'https://meet/x' } }] });
    await expect(createCalendar(ENV, fetchFn).insertEvent(EVENT)).rejects.toMatchObject({ kind: 'failed' });
  });
  it('raises fixed errors that never carry a Google body', async () => {
    for (const [status, kind] of [[500, 'failed'], [403, 'failed'], [401, 'auth']] as const) {
      const { fetchFn } = stubFetch({ ...TOKEN, [INSERT]: [{ status, body: SECRET_BODY }] });
      const err = (await createCalendar(ENV, fetchFn).insertEvent(EVENT).catch((e: unknown) => e)) as GoogleError;
      expect(err).toBeInstanceOf(GoogleError);
      expect(err.kind).toBe(kind);
      expect(err.message).not.toMatch(/boom|csecret|rtoken/);
    }
  });
  it('maps a network failure to a fixed error', async () => {
    const fetchFn = (async () => {
      throw new Error('ECONNRESET csecret');
    }) as typeof fetch;
    await expect(createCalendar(ENV, fetchFn).insertEvent(EVENT)).rejects.toMatchObject({ kind: 'failed', message: 'Google Calendar request failed' });
  });
});
