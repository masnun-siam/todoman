import type { ItemMarker } from './markers.js';

/** Next item key for a dump: one past the highest already used, so a gap never reuses a key. */
export function nextKey(markers: ItemMarker[], dump: number): string {
  const used = markers.filter((m) => m.dump === dump).map((m) => Number(m.key.slice(1)));
  return `i${Math.max(0, ...used) + 1}`;
}
