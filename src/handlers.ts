import type { ExternalReader } from './external.js';
import type { Issue, ProcessGh } from './github.js';
import type { Calendar } from './google.js';
import type { ValidItem } from './validate.js';
import { meetingHandler } from './handlers/meeting.js';
import { taskHandler } from './handlers/task.js';
import { trackingHandler } from './handlers/tracking.js';

export interface ItemContext {
  gh: ProcessGh;
  calendar: Calendar;
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
  /** Absent when nothing was created, e.g. a meeting whose event Siam deleted. */
  url?: string;
  /** Resolved details, e.g. 'Due: 2026-10-23' or who was invited. */
  details: string[];
  /** Labels on that issue as GitHub reported them after the write; empty when nothing was created. */
  labels: string[];
}

/** Creates one item of `type`; throwing marks the item failed without undoing the others. */
export interface ItemHandler {
  type: ValidItem['type'];
  create(item: ValidItem, ctx: ItemContext): Promise<Created>;
}

/** Registered handlers, one per item type the code can create. */
export const HANDLERS: ItemHandler[] = [taskHandler, meetingHandler, trackingHandler];
