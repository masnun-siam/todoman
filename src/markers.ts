export const BOT = 'github-actions[bot]';

export interface ItemMarker {
  repo: string;
  dump: number;
  key: string;
  ref?: string; // owner/repo#n, set on tracking notes
}
export interface SummaryMarker {
  kind: 'weekly' | 'on-demand';
  from: string;
  to: string;
}
/** A comment or issue as listed from GitHub. */
export interface Authored {
  author: string;
  body: string;
}

const REPO = '[\\w.-]+/[\\w.-]+';
const REF = `${REPO}#\\d+`;
const TS = '[\\w:.+-]+';

export const itemMarker = (m: ItemMarker): string =>
  `<!-- todoman:item repo=${m.repo} dump=${m.dump} key=${m.key}${m.ref ? ` ref=${m.ref}` : ''} -->`;
export const refMarker = (ref: string): string => `<!-- todoman:ref ${ref} -->`;
export const summaryMarker = (m: SummaryMarker): string =>
  `<!-- todoman:summary kind=${m.kind} from=${m.from} to=${m.to} -->`;

/** Bodies of the sources the Actions bot wrote; markers elsewhere do not count. */
const botBodies = (items: Authored[]): string[] => items.filter((i) => i.author === BOT).map((i) => i.body);

export function parseItemMarkers(items: Authored[]): ItemMarker[] {
  const re = new RegExp(`<!-- todoman:item repo=(${REPO}) dump=(\\d+) key=(i\\d+)(?: ref=(${REF}))? -->`, 'g');
  return botBodies(items).flatMap((b) =>
    [...b.matchAll(re)].map(([, repo, dump, key, ref]) => ({ repo, dump: Number(dump), key, ...(ref ? { ref } : {}) })),
  );
}

export function parseRefMarkers(items: Authored[]): string[] {
  const re = new RegExp(`<!-- todoman:ref (${REF}) -->`, 'g');
  return botBodies(items).flatMap((b) => [...b.matchAll(re)].map((m) => m[1]));
}

export function parseSummaryMarkers(items: Authored[]): SummaryMarker[] {
  const re = new RegExp(`<!-- todoman:summary kind=(weekly|on-demand) from=(${TS}) to=(${TS}) -->`, 'g');
  return botBodies(items).flatMap((b) => [...b.matchAll(re)].map(([, kind, from, to]) => ({ kind: kind as SummaryMarker['kind'], from, to })));
}
