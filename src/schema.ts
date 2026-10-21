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
