export interface LabelSpec {
  name: string;
  color: string;
  description: string;
}

export const LABELS: LabelSpec[] = [
  { name: 'task', color: '0e8a16', description: 'Todoman: a task created from a dump' },
  { name: 'meeting', color: '1d76db', description: 'Todoman: a meeting created from a dump' },
  { name: 'tracking', color: '5319e7', description: 'Todoman: tracks an existing issue or PR' },
  { name: 'summary', color: 'fbca04', description: 'Todoman: a generated summary' },
  { name: 'todoman:processing', color: 'bfdadc', description: 'Todoman is processing this dump' },
  { name: 'processed', color: '0e8a16', description: 'Todoman processed this dump' },
  { name: 'needs-info', color: 'd93f0b', description: 'Todoman needs an answer to continue' },
  { name: 'failed', color: 'b60205', description: 'Todoman failed on this dump; comment to retry' },
];

/** GitHub label names are case-insensitive and come back in the repo's spelling; Todoman's names are lowercase. */
export const labelIn = (label: string, names: readonly string[]): boolean => names.includes(label.toLowerCase());
export const hasLabel = (labels: string[], name: string): boolean => labels.some((l) => l.toLowerCase() === name);
const TODOMAN_LABELS = LABELS.map((l) => l.name);
export const isTodomanLabel = (label: string): boolean => labelIn(label, TODOMAN_LABELS);
