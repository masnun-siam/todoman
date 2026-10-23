import type { Env } from './config.js';

export interface NewEvent {
  id: string;
  title: string;
  /** ISO date-times with offset. */
  start: string;
  end: string;
  timeZone: string;
  invitees: string[];
  description: string;
}
export type EventResult = { status: 'created' | 'existing'; meetLink?: string; eventLink: string } | { status: 'deleted' };

/** The slice of Google Calendar Todoman needs; tests pass a stub. */
export interface Calendar {
  /** Inserts the event; when its id already exists, reads it back instead and never recreates it. */
  insertEvent(e: NewEvent): Promise<EventResult>;
}

export type GoogleErrorKind = 'auth' | 'failed';
/** Messages are fixed text: never a Google error body or any secret. */
export class GoogleError extends Error {
  constructor(readonly kind: GoogleErrorKind) {
    super({
      auth: 'Google authorization failed; renew GOOGLE_REFRESH_TOKEN',
      failed: 'Google Calendar request failed',
    }[kind]);
  }
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

/** Exchanges the refresh token (scope calendar.events) for an access token. */
export async function refreshAccessToken(env: Env, fetchFn: typeof fetch = fetch): Promise<string> {
  const { GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret, GOOGLE_REFRESH_TOKEN: refresh } = env;
  if (!id || !secret || !refresh) throw new GoogleError('auth');
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }),
  }).catch(() => {
    throw new GoogleError('failed');
  });
  if (res.status === 400 || res.status === 401) throw new GoogleError('auth'); // invalid_grant: revoked or expired
  if (!res.ok) throw new GoogleError('failed');
  const token = ((await res.json().catch(() => ({}))) as { access_token?: unknown }).access_token;
  if (typeof token !== 'string' || !token) throw new GoogleError('failed');
  return token;
}

interface GEvent {
  status?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
}

function result(status: 'created' | 'existing', ev: GEvent): EventResult {
  if (ev.status === 'cancelled') return { status: 'deleted' };
  if (!ev.htmlLink) throw new GoogleError('failed');
  const meetLink = ev.hangoutLink ?? ev.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri;
  return { status, meetLink, eventLink: ev.htmlLink };
}

export function createCalendar(env: Env, fetchFn: typeof fetch = fetch): Calendar {
  let token: Promise<string> | undefined;
  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    token ??= refreshAccessToken(env, fetchFn);
    const headers = { authorization: `Bearer ${await token}`, 'content-type': 'application/json' };
    const res = await fetchFn(url, { ...init, headers }).catch(() => {
      throw new GoogleError('failed');
    });
    if (res.status === 401) throw new GoogleError('auth');
    return res;
  }
  const json = async (res: Response): Promise<GEvent> => (await res.json().catch(() => ({}))) as GEvent;

  async function getEvent(id: string): Promise<EventResult> {
    const res = await call(`${EVENTS_URL}/${encodeURIComponent(id)}`);
    if (res.status === 404 || res.status === 410) return { status: 'deleted' };
    if (!res.ok) throw new GoogleError('failed');
    return result('existing', await json(res));
  }

  return {
    async insertEvent(e) {
      const body = {
        id: e.id,
        summary: e.title,
        description: e.description,
        start: { dateTime: e.start, timeZone: e.timeZone },
        end: { dateTime: e.end, timeZone: e.timeZone },
        attendees: e.invitees.map((email) => ({ email })),
        conferenceData: { createRequest: { requestId: e.id, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
      };
      const res = await call(`${EVENTS_URL}?conferenceDataVersion=1&sendUpdates=all`, { method: 'POST', body: JSON.stringify(body) });
      if (res.status === 409) return getEvent(e.id); // id already exists: a retry, or Siam deleted it in Calendar
      if (!res.ok) throw new GoogleError('failed');
      return result('created', await json(res));
    },
  };
}
