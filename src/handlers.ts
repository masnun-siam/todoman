import type { ExternalReader } from './external.js';
import type { Issue, ProcessGh } from './github.js';
import type { ValidItem } from './validate.js';
import { taskHandler } from './handlers/task.js';
import { trackingHandler } from './handlers/tracking.js';

export interface ItemContext {
  gh: ProcessGh;
  /** Reads other repos' items; built on first use, so a bad GH_READ_TOKENS fails only tracking items. */
  external: () => ExternalReader;
  /** Data repo full name, `owner/repo`. */
  repo: string;
  owner: string;
  tz: string;
  dump: Issue;
  /** Code-assigned key for this item; its marker goes on whatever the handler creates. */
  key: string;
}

/** What a handler created, as the result comment lists it. */
export interface Created {
  title: string;
  url: string;
  /** Resolved details, e.g. 'Due: 2026-10-23' or who was invited. */
  details: string[];
}

/** Creates one item of `type`; throwing marks the item failed without undoing the others. */
export interface ItemHandler {
  type: ValidItem['type'];
  create(item: ValidItem, ctx: ItemContext): Promise<Created>;
}

/** Registered handlers; meeting (#14) adds its own here. */
export const HANDLERS: ItemHandler[] = [taskHandler, trackingHandler];
