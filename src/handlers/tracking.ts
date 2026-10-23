import { parseRef, refString, type ExternalRef } from '../external.js';
import type { Issue } from '../github.js';
import type { Created, ItemContext, ItemHandler } from '../handlers.js';
import { itemMarker, parseItemMarkers, parseRefMarkers, refMarker } from '../markers.js';

const LABEL_MAX = 50; // GitHub's label name limit
const TITLE_MAX = 256; // GitHub's issue title limit; a long external title must not fail the item
const sameRef = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase(); // owners and repos are case-insensitive

/** Oldest open, bot-authored `tracking` issue whose body carries the ref marker (the dedupe key; the repo label is not). */
async function existing(ctx: ItemContext, ref: string): Promise<Issue | undefined> {
  const open = await ctx.gh.openIssues('tracking');
  return open
    .filter((i) => parseRefMarkers([{ author: i.author, body: i.body }]).some((r) => sameRef(r, ref)))
    .sort((a, b) => a.number - b.number)[0];
}

/** Comments the note on `issue` unless a bot comment there already holds it for this dump and ref, so a retry never posts twice. */
async function addNote(ctx: ItemContext, issue: Issue, ref: string, note: string): Promise<Created> {
  const posted = parseItemMarkers(await ctx.gh.listComments(issue.number)).some(
    (m) => m.repo === ctx.repo && m.dump === ctx.dump.number && m.ref !== undefined && sameRef(m.ref, ref),
  );
  if (!posted) {
    const marker = itemMarker({ repo: ctx.repo, dump: ctx.dump.number, key: ctx.key, ref });
    await ctx.gh.comment(issue.number, [note, `Source dump: ${ctx.dump.url}`, marker].join('\n\n'));
  }
  return { title: issue.title, url: issue.url, details: [`added note to existing #${issue.number}`] };
}

/** Best effort: the `repo:` label when it exists or can be created, else none. */
async function repoLabel(ctx: ItemContext, r: ExternalRef): Promise<string[]> {
  const name = `repo:${r.owner}/${r.repo}`.slice(0, LABEL_MAX);
  const found = (await ctx.gh.labelNames()).find((l) => l.toLowerCase() === name.toLowerCase());
  if (found) return [found];
  try {
    await ctx.gh.createLabel(name, 'c5def5', 'Todoman: tracks items in this repo');
    return [name];
  } catch {
    return []; // ponytail: label is best effort (PRD Data); the issue matters, not its label
  }
}

/** FR-5: a reference becomes a `tracking` issue, or a note on the open one that already tracks it. */
export const trackingHandler: ItemHandler = {
  type: 'tracking',
  async create(item, ctx) {
    if (item.type !== 'tracking') throw new Error('not a tracking item');
    // validate() checked the ref's shape and that it appears literally in Siam's text; note is sanitised
    const r = parseRef(item.ref);
    if (!r) throw new Error('not a reference');
    const ref = refString(r);
    const open = await existing(ctx, ref);
    if (open) return addNote(ctx, open, ref, item.note);

    const ext = await ctx.external().readExternal(r);
    const title = (ext.access ? `${ref}: ${ext.title}` : ref).slice(0, TITLE_MAX);
    const body = [
      `Tracks https://github.com/${r.owner}/${r.repo}/issues/${r.number}`,
      ext.access ? `State: ${ext.state}` : '',
      item.note,
      `Source dump: ${ctx.dump.url}`,
      refMarker(ref),
      itemMarker({ repo: ctx.repo, dump: ctx.dump.number, key: ctx.key }),
    ]
      .filter(Boolean)
      .join('\n\n');
    const labels = ['tracking', ...(await repoLabel(ctx, r))];
    const issue = await ctx.gh.createIssue({ title, body, labels, assignees: [ctx.owner] });
    const access = ext.access ? [] : [`access missing: no read token for ${r.owner} can read ${ref}, so only the reference is shown`];
    return { title: issue.title, url: issue.url, details: access };
  },
};
