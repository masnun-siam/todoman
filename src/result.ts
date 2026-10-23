import type { EndState } from './dump.js';
import { RETRY, STEPS } from './failure.js';
import type { Created } from './handlers.js';
import { readMarker } from './markers.js';
import { questionBlock } from './questions.js';
import type { Question } from './validate.js';

export type ItemResult = { type: string } & ({ ok: true; created: Created } | { ok: false; title: string; reason: string });

/** FR-6 order: any failed item, then any open question, else processed. */
export function endState(results: ItemResult[], questions: Question[]): EndState {
  if (results.some((r) => !r.ok)) return 'failed';
  return questions.length ? 'needs-info' : 'processed';
}

function line(r: ItemResult): string {
  if (!r.ok) return `- ${r.type}: ${r.title} — not created: ${r.reason}`;
  const details = r.created.details.length ? ` — ${r.created.details.join('; ')}` : '';
  return `- ${r.type}: [${r.created.title}](${r.created.url})${details}`;
}

/** The one result comment of a run; `read` is the newest comment id this run read. */
export function resultComment(results: ItemResult[], questions: Question[], state: EndState, read: number): string {
  const parts: string[] = [];
  if (results.length) parts.push(['Todoman created:', ...results.map(line)].join('\n'));
  if (questions.length) parts.push(questionBlock(questions));
  if (state === 'processed') parts.push('To change anything, open a new dump.');
  if (state === 'failed') parts.push(`Todoman failed while ${STEPS.create}. ${RETRY}`);
  parts.push(readMarker(read));
  return parts.join('\n\n');
}
