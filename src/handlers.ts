import type { Issue, ProcessGh } from './github.js';
import type { Calendar } from './google.js';
import type { ValidItem } from './validate.js';
import { meetingHandler } from './handlers/meeting.js';
import { taskHandler } from './handlers/task.js';

export interface ItemContext {
  gh: ProcessGh;
  calendar: Calendar;
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
}

/** Creates one item of `type`; throwing marks the item failed without undoing the others. */
export interface ItemHandler {
  type: ValidItem['type'];
  create(item: ValidItem, ctx: ItemContext): Promise<Created>;
}

/** Registered handlers; tracking (#16) adds its own here. */
export const HANDLERS: ItemHandler[] = [taskHandler, meetingHandler];
