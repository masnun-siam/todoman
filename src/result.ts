import type { EndState } from './dump.js';
import { RETRY, STEPS } from './failure.js';
import type { Created } from './handlers.js';
import { readMarker } from './markers.js';
import { questionBlock } from './questions.js';
import type { Question } from './validate.js';

export type ItemResult = { type: string } & ({ ok: true; created: Created } | { ok: false; title: string; reason: string; note?: string });

/** FR-6 order: any failed item, then any open question, else processed. */
export function endState(results: ItemResult[], questions: Question[]): EndState {
  if (results.some((r) => !r.ok)) return 'failed';
  return questions.length ? 'needs-info' : 'processed';
}

/** One single-line table cell: line breaks become spaces; `|`, `[` and `]` are escaped, and `\` so a trailing one cannot eat them. */
const cell = (s: string): string => s.replace(/\s*[\r\n]+\s*/g, ' ').replace(/[\\|[\]]/g, (c) => `\\${c}`);
const codes = (labels: string[]): string => labels.map((l) => (l.includes('`') ? cell(l) : `\`${l.replace(/\|/g, "\\|")}\``)).join(' ') || '—';

function row(r: ItemResult): string {
  if (!r.ok) {
    const details = [`not created: ${r.reason}`, r.note].filter(Boolean).join('; ');
    return `| ${cell(r.type)} | ${cell(r.title)} | — | ${cell(details)} |`;
  }
  const c = r.created;
  const title = c.url ? `[${cell(c.title)}](${c.url})` : cell(c.title);
  return `| ${cell(r.type)} | ${title} | ${codes(c.labels)} | ${cell(c.details.join('; ')) || '—'} |`;
}

const table = (results: ItemResult[]): string => ['| Type | Item | Labels | Details |', '| --- | --- | --- | --- |', ...results.map(row)].join('\n');

/** The one result comment of a run; `read` is the newest comment id this run read. */
export function resultComment(results: ItemResult[], questions: Question[], state: EndState, read: number): string {
  const parts: string[] = [];
  if (results.length) parts.push(table(results));
  if (questions.length) parts.push(questionBlock(questions));
  if (state === 'processed') parts.push('To change anything, open a new dump.');
  if (state === 'failed') parts.push(`Todoman failed while ${STEPS.create}. ${RETRY}`);
  parts.push(readMarker(read));
  return parts.join('\n\n');
}
