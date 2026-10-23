import type { ItemHandler } from '../handlers.js';
import { itemMarker } from '../markers.js';

/** FR-3: a task becomes a `task` issue assigned to the owner, linking its dump and carrying its item marker. */
export const taskHandler: ItemHandler = {
  type: 'task',
  async create(item, ctx) {
    if (item.type !== 'task') throw new Error('not a task');
    // title, body and labels were sanitised and checked by validate(); due is a checked YYYY-MM-DD
    const due = item.due ? `Due: ${item.due}` : '';
    const body = [item.body, due, `Source dump: ${ctx.dump.url}`, itemMarker({ repo: ctx.repo, dump: ctx.dump.number, key: ctx.key })]
      .filter(Boolean)
      .join('\n\n');
    const issue = await ctx.gh.createIssue({ title: item.title, body, labels: ['task', ...item.labels], assignees: [ctx.owner] });
    return { title: issue.title, url: issue.url, details: due ? [due] : [], labels: issue.labels };
  },
};
