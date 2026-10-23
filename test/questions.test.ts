import { describe, expect, it } from 'vitest';
import type { Issue } from '../src/github.js';
import { readMarker } from '../src/markers.js';
import { NOTHING_FOUND, nothingFound, questionBlock, TOO_LONG, TOO_MANY, tooLong } from '../src/questions.js';
import { resultComment } from '../src/result.js';

const issue = (title: string, body: string): Issue => ({ number: 5, title, body, url: 'u', author: 'o', state: 'open', labels: [], createdAt: '2026-10-21T05:00:00Z' });

describe('questions (FR-7)', () => {
  it('limits the dump text, title and body together, to 10,000 characters', () => {
    expect(tooLong(issue('a', 'b'.repeat(9_999)))).toBe(false);
    expect(tooLong(issue('ab', 'b'.repeat(9_999)))).toBe(true);
  });
  it('finds nothing only with no item, no question and nothing created before', () => {
    expect(nothingFound(0, 0, 0)).toBe(true);
    expect(nothingFound(1, 0, 0)).toBe(false);
    expect(nothingFound(0, 1, 0)).toBe(false);
    expect(nothingFound(0, 0, 1)).toBe(false); // e.g. "skip it" after the rest was created
  });
  it('uses the PRD wording for a dump with nothing actionable', () => {
    expect(questionBlock([NOTHING_FOUND])).toBe("I couldn't find a task, meeting or reference in this. Reply here to answer.");
  });
  it.each([TOO_LONG, TOO_MANY])('asks to split a dump over a limit', (q) => {
    expect(questionBlock([q])).toMatch(/^This dump .* so I created nothing\. Please split it .*\. Reply here to answer\.$/);
  });
  it('puts every item question in one list ending with "Reply here to answer."', () => {
    const block = questionBlock([{ about: 'Sync with asif', question: 'When is the meeting?' }, { about: 'Tax form', question: 'What is the due date (YYYY-MM-DD)?' }]);
    expect(block).toBe('Questions:\n- Sync with asif: When is the meeting?\n- Tax form: What is the due date (YYYY-MM-DD)?\n\nReply here to answer.');
  });
  it('keeps the read marker after the question in the comment', () => {
    expect(resultComment([], [NOTHING_FOUND], 'needs-info', 7)).toBe(`${questionBlock([NOTHING_FOUND])}\n\n${readMarker(7)}`);
  });
});
