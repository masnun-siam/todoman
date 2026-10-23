import type { ItemHandler } from '../handlers.js';
import { itemMarker } from '../markers.js';

/** FR-11: a summary item links the summary for its period, reusing one created after the period ended. */
export const summaryHandler: ItemHandler = {
  type: 'summary',
  async create(item, ctx) {
    if (item.type !== 'summary') throw new Error('not a summary');
    // from and to are checked whole days, at most 31 (validate()); the item marker makes a retry find it (FR-8)
    const { issue, reused } = await ctx.summarise(item.from, item.to, itemMarker({ repo: ctx.repo, dump: ctx.dump.number, key: ctx.key }));
    return { title: issue.title, url: issue.url, details: reused ? [`existing #${issue.number}`] : [], labels: issue.labels };
  },
};
