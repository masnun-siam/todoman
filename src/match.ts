import type { CreatedItem } from './dump.js';
import type { ValidItem } from './validate.js';

/** Case, punctuation and spacing do not make a different title. */
export const normTitle = (t: string): string => t.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * FR-8 item matching: true when `item` repeats one already created for the dump.
 * Tasks match by type plus normalised title, meetings by start instant, tracking by reference; summary adds its key here.
 */
export function isCreated(item: ValidItem, created: CreatedItem[]): boolean {
  if (item.type === 'meeting') {
    const at = Date.parse(item.start);
    return created.some((c) => c.type === 'meeting' && c.start !== undefined && Date.parse(c.start) === at);
  }
  if (item.type === 'tracking') {
    const ref = item.ref.toLowerCase(); // owners and repos are case-insensitive
    return created.some((c) => c.type === 'tracking' && c.ref?.toLowerCase() === ref);
  }
  if (item.type !== 'task') return false;
  const title = normTitle(item.title);
  return created.some((c) => c.type === item.type && normTitle(c.title) === title);
}
