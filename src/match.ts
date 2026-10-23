import type { CreatedItem } from './dump.js';
import type { ValidItem } from './validate.js';

/** Case, punctuation and spacing do not make a different title. */
export const normTitle = (t: string): string => t.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * FR-8 item matching: true when `item` repeats one already created for the dump.
 * Tasks match by type plus normalised title, tracking by reference; meeting (#14) and summary add their keys here.
 */
export function isCreated(item: ValidItem, created: CreatedItem[]): boolean {
  if (item.type === 'tracking') {
    const ref = item.ref.toLowerCase(); // owners and repos are case-insensitive
    return created.some((c) => c.type === 'tracking' && c.ref?.toLowerCase() === ref);
  }
  if (item.type !== 'task') return false;
  const title = normTitle(item.title);
  return created.some((c) => c.type === item.type && normTitle(c.title) === title);
}
