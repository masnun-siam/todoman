const str = { type: 'string' };

/** JSON schema given to Claude for dump parsing. Claude returns no item keys; code assigns them. */
export const PARSER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'questions'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type'],
        properties: {
          type: { enum: ['task', 'meeting', 'tracking', 'summary'] },
          title: str,
          body: str,
          labels: { type: 'array', items: str },
          due: str, // YYYY-MM-DD
          start: str, // ISO date-time with offset
          durationMinutes: { type: 'integer' },
          attendees: { type: 'array', items: str }, // names only, never emails
          agenda: str,
          ref: str, // owner/repo#n
          note: str,
          from: str, // YYYY-MM-DD
          to: str, // YYYY-MM-DD
        },
      },
    },
    questions: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['about', 'question'], properties: { about: str, question: str } },
    },
  },
} as const;

const note = { type: 'object', additionalProperties: false, required: ['issue', 'note'], properties: { issue: { type: 'integer' }, note: str } };

/** JSON schema given to Claude for a summary (FR-10): condensed text per issue; code renders every section and link. */
export const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['done', 'meetings', 'tracked'],
  properties: {
    done: { type: 'array', items: note },
    meetings: { type: 'array', items: note },
    tracked: { type: 'array', items: note },
  },
} as const;
