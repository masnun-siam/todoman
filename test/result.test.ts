import { describe, expect, it } from 'vitest';
import { RETRY } from '../src/failure.js';
import { resultComment, type ItemResult } from '../src/result.js';

const made = (title: string, labels: string[], details: string[] = [], url = 'https://github.com/o/r/1'): ItemResult => ({
  type: 'task',
  ok: true,
  created: { title, url, details, labels },
});
const q = [{ about: 'the meeting', question: 'When is it?' }];

describe('resultComment table (FR-2)', () => {
  it('renders labels as code spans, — for empty cells, and the title as a link', () => {
    const c = resultComment([made('Buy milk', ['task', 'area:home'], ['Due: 2026-10-22']), made('Bare', [])], [], 'processed', 3);
    expect(c).toContain('| Type | Item | Labels | Details |\n| --- | --- | --- | --- |\n');
    expect(c).toContain('| task | [Buy milk](https://github.com/o/r/1) | `task` `area:home` | Due: 2026-10-22 |');
    expect(c).toContain('| task | [Bare](https://github.com/o/r/1) | — | — |');
  });

  it('keeps a title with a pipe in one row and escapes brackets', () => {
    const c = resultComment([made('a | b [x]', [])], [], 'processed', 0);
    expect(c).toContain('[a \\| b \\[x\\]](https://github.com/o/r/1)');
  });

  it('escapes a trailing backslash so the link stays intact', () => {
    expect(resultComment([made('dir\\', [])], [], 'processed', 0)).toContain('[dir\\\\](https://github.com/o/r/1)');
  });

  it('makes every cell a single line and shows a backtick label without a code span', () => {
    const c = resultComment([made('two\nlines', ['we`ird', 'p|q'], ['x\r\ny'])], [], 'processed', 0);
    expect(c).toContain('| task | [two lines](https://github.com/o/r/1) | we`ird `p\\|q` | x y |');
  });

  it('shows a deleted event as plain title with no labels', () => {
    const c = resultComment([made('Meeting: Sync', [], ['the calendar event was deleted'], '')], [], 'processed', 0);
    expect(c).toContain('| task | Meeting: Sync | — | the calendar event was deleted |');
  });

  it('shows a failed item as plain title with the step, and the event note', () => {
    const r: ItemResult = { type: 'meeting', ok: false, title: 'Sync', reason: 'failed while creating items: boom.', note: 'The calendar event exists and invites were sent.' };
    expect(resultComment([r], [], 'failed', 0)).toContain(
      '| meeting | Sync | — | not created: failed while creating items: boom. The calendar event exists and invites were sent. |',
    );
  });

  it('orders table, questions, failure line, then closing line', () => {
    const bad: ItemResult = { type: 'task', ok: false, title: 't', reason: 'r' };
    const failed = resultComment([made('A', []), bad], q, 'failed', 0);
    expect(failed.indexOf('| Type')).toBeLessThan(failed.indexOf('When is it?'));
    expect(failed.indexOf('When is it?')).toBeLessThan(failed.indexOf('Todoman failed while creating items.'));
    expect(failed).toContain(RETRY);
    const done = resultComment([made('A', [])], [], 'processed', 0);
    expect(done.indexOf('| Type')).toBeLessThan(done.indexOf('To change anything, open a new dump.'));
  });

  it('posts no table when no item was handled', () => {
    expect(resultComment([], q, 'needs-info', 0)).not.toContain('| Type');
  });
});
