import type { Period } from './external.js';
import type { SummaryGh } from './github.js';
import { parseSummaryMarkers } from './markers.js';

const WEEK_MS = 7 * 86_400_000;

/**
 * FR-10: the weekly period starts at the latest weekly summary marker's `to` (or 7 days before `now`
 * when there is none) and ends at `now`, so consecutive weekly periods are contiguous.
 */
export async function weeklyPeriod(gh: Pick<SummaryGh, 'issuesLabelled'>, now: Date): Promise<Period> {
  const summaries = await gh.issuesLabelled('summary', 'all');
  const tos = parseSummaryMarkers(summaries)
    .filter((m) => m.kind === 'weekly' && !Number.isNaN(Date.parse(m.to)))
    .map((m) => m.to);
  const last = tos.reduce<string | undefined>((a, b) => (a && Date.parse(a) >= Date.parse(b) ? a : b), undefined);
  return { from: last ?? new Date(now.getTime() - WEEK_MS).toISOString(), to: now.toISOString() };
}
