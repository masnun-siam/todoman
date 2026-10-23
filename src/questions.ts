import type { Issue } from './github.js';
import type { Question } from './validate.js';

export const MAX_ITEMS = 10;
export const MAX_DUMP_CHARS = 10_000;
export const REPLY = 'Reply here to answer.';

/** Questions on the dump as a whole (FR-7): no `about`, posted on their own and nothing is created. */
const whole = (question: string): Question => ({ about: '', question });
export const TOO_LONG = whole(`This dump is over ${MAX_DUMP_CHARS.toLocaleString('en-US')} characters, so I created nothing. Please split it into smaller dumps.`);
export const TOO_MANY = whole(`This dump has more than ${MAX_ITEMS} items, so I created nothing. Please split it into dumps of ${MAX_ITEMS} items or fewer.`);
export const NOTHING_FOUND = whole("I couldn't find a task, meeting or reference in this.");

/** FR-1 limit on the dump text (title and body), checked before Claude is called. */
export const tooLong = (issue: Issue): boolean => issue.title.length + issue.body.length > MAX_DUMP_CHARS;

/** Nothing new, nothing to ask and nothing created before: the dump has no actionable content. */
export const nothingFound = (items: number, questions: number, created: number): boolean => items + questions + created === 0;

/** The questions part of a comment; always ends with "Reply here to answer." */
export function questionBlock(questions: Question[]): string {
  if (questions.length === 1 && !questions[0].about) return `${questions[0].question} ${REPLY}`;
  return ['Questions:', ...questions.map((q) => `- ${q.about ? `${q.about}: ` : ''}${q.question}`), '', REPLY].join('\n');
}
