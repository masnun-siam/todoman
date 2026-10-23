import { describe, expect, it } from 'vitest';
import { ClaudeError } from '../src/claude.js';
import { CANCELLED, failureComment, failureMessage, RETRY, STEPS } from '../src/failure.js';
import { READ_TOKENS_ERROR } from '../src/external.js';
import { GoogleError } from '../src/google.js';
import { readMarker } from '../src/markers.js';

const SECRET = 'ghp_SECRET123';

describe('failureMessage (FR-9)', () => {
  it.each([
    [new ClaudeError('timeout'), 'Claude timed out.'],
    [new ClaudeError('failed'), 'CLAUDE_CODE_OAUTH_TOKEN'],
    [new ClaudeError('invalid'), 'invalid output twice'],
    [new ClaudeError('install'), 'Claude CLI could not be installed'],
    [new GoogleError('auth'), 'the Google authorization must be renewed: create a new refresh token and save it as the GOOGLE_REFRESH_TOKEN secret.'],
    [new GoogleError('failed'), 'Google Calendar request failed'],
    [Object.assign(new Error(`Bad credentials ${SECRET}`), { status: 401 }), 'a GitHub request failed'],
    [new Error(READ_TOKENS_ERROR), 'GH_READ_TOKENS must be a JSON object'],
    [new Error(`boom ${SECRET}`), 'an unexpected error occurred'],
    [`raw ${SECRET}`, 'an unexpected error occurred'],
    [null, 'an unexpected error occurred'],
  ])('%#', (e, want) => {
    const msg = failureMessage(e);
    expect(msg).toContain(want);
    expect(msg).not.toContain(SECRET);
  });
});

describe('failureComment', () => {
  it('names the step, gives the message and ends with the retry line before the read marker', () => {
    expect(failureComment(STEPS.parse, 'Claude timed out.', 7)).toBe(`Todoman failed while parsing it with Claude: Claude timed out.\n\n${RETRY}\n\n${readMarker(7)}`);
  });
  it('the cancel step carries no read marker', () => {
    expect(failureComment(STEPS.run, CANCELLED)).toBe(`Todoman failed while running the workflow: ${CANCELLED}\n\n${RETRY}`);
  });
});
