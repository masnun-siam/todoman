# Release checks

Two manual checks run before a release; neither runs in CI, since both use the Claude subscription. Run both before moving `v1`, and the parser evals again after any change to the parser prompt (`src/prompts.ts`) or schema (`src/schema.ts`).

## Parser evals

```sh
CLAUDE_CODE_OAUTH_TOKEN=... npm run eval   # token from `claude setup-token`
```

Each fixture in `eval/fixtures/` goes through the real prompt, the pinned CLI and the validator 3 times. It passes only if every run gives exactly the expected items (types plus key fields: dates, times, durations, refs, invitees) and, where set, the expected question or none. An extra item fails the run, so an injection fixture fails if any run creates an item or invitee the pasted text asks for. The command exits non-zero unless every fixture passes 3 of 3, and prints why each failing run failed.

A fixture is one JSON file: `name`, `now` (the run's clock), `dump` `{title, body, at}`, optional `people` and `labels`, and `expect` `{items, question?}`. Each expected item is `{type, ...fields}`; `null` means the field must be absent, `start` compares the instant, `invitees` compares names case-insensitively.

## End to end (sandbox)

On `masnun-siam/todo-sandbox`, set up as the README says, with:

- `FEATURE_DUMP_TO_ISSUES=true` on the sandbox only; the real data repo's flag stays off until release;
- the Google secrets of a separate test account, so events land on its calendar;
- a `people.yml` listing only Siam's own addresses (for example `Asif` → a `+asif` alias of Siam's address), so no real person is emailed.

Open each dump with `gh issue create -R masnun-siam/todo-sandbox --body '' --title '...'` unless the step says otherwise. Tick a line only when the result matches it exactly.

| FR | Check | Expected |
|---|---|---|
| 13 | Run doctor (`gh workflow run 'Todoman summary' -R masnun-siam/todo-sandbox -f mode=doctor`) | Every check `PASS`; Todoman's labels exist. Unset one secret and re-run: that check `FAIL`s naming the secret, no token or error body in the log. Restore it. |
| 12 | Set the flag to `false`, open a dump and run a summary | Both runs log `Todoman disabled`; no comment, label, issue or event. Doctor still runs. Set it back to `true`. |
| 1 | Open a dump from a second account (or comment on a dump from one) | Ignored: the run is skipped before any secret is used; nothing posted. |
| 1, 7 | Open a dump over 10,000 characters | Nothing created; `needs-info`, asking to split it. |
| 2, 3 | `buy milk by friday` | One `task` issue with `Due:` the coming Friday and a link to the dump; result comment lists it; dump `processed` and closed, comment ends "To change anything, open a new dump." |
| 3 | A task naming an existing non-Todoman label, and one naming a label that does not exist | The existing label is applied; no new label is created. |
| 4 | `have a meeting with asif about prd review on monday 11 am for 1 hour` | Event "PRD review with Asif" on the test calendar, Monday 11:00–12:00 in `TODOMAN_TZ`, with a Meet link, Asif's sandbox address invited; a `meeting` issue `Meeting: …` with date, time, duration, attendees, Meet and event links and agenda, ending "Add the meeting summary as a comment". Result comment gives start–end with timezone and who was invited. |
| 4 | A meeting with no duration | 30-minute event. |
| 4a | A meeting naming `asif` and `rafi` (Rafi not in `people.yml`) | Asif invited; comment lists "rafi — not in people.yml, invite manually". |
| 5 | `track masnun-siam/todoman#1` (a readable ref), then the same ref again in a new dump | First: a `tracking` issue `masnun-siam/todoman#1: <title>` with `tracking` and `repo:masnun-siam/todoman`, linking the item and holding the note, title and state only. Second: "added note to existing #n", no new issue. |
| 5 | A ref to an owner with no token in `GH_READ_TOKENS` | Tracking issue titled with the ref alone; the result comment says access is missing. |
| 6, 7 | `meeting with asif about the roadmap` (no date or time), plus `call the bank` in the same dump | The task is created; the meeting is asked about ("Reply here to answer."); dump `needs-info`, open. |
| 7, 8 | Reply `tuesday 3pm` on that dump | Reprocessed with the thread: the meeting is created, the task is not created again; dump `processed`. |
| 7 | Reply `skip it` on a `needs-info` dump | The item is dropped; nothing created for it. |
| 7 | `meeting with asif` (no time), then reply `skip it` | Nothing created; result comment ends "To change anything, open a new dump."; dump `processed` and closed. |
| 7 | A dump with nothing actionable (`hello`) | Nothing created; `needs-info` with "I couldn't find a task, meeting or reference in this." |
| 8 | Re-run a finished process run from the Actions tab | Exits without calling Claude; no second issue, event or result comment. |
| 8, 9 | Open a dump with a task and a meeting, and cancel the run mid-way, after the task issue appears but before the result comment (`gh run cancel <id> -R masnun-siam/todo-sandbox`) | The dump ends `failed`, open, with a comment naming the step and ending "Comment `retry` (or any reply) to try again." Comment `retry`: only the missing items are created, each once; one event on the calendar. |
| 9 | Revoke or break the Google refresh token, open a meeting dump, then restore it and comment `retry` | First run: `failed` with the step and a fixed message, no error body or token in the comment. Retry: the meeting is created once. |
| 9 | A dump stuck in `todoman:processing` for over 15 minutes (label it by hand), then comment | The comment reprocesses it. |
| 10 | Run the weekly summary (`gh workflow run 'Todoman summary' -R masnun-siam/todo-sandbox`) | A `summary` issue "Weekly summary: <from> – <to>": headline, Done, Open (overdue first), Meetings (summary comments condensed or "no summary added"), Tracked, Next 7 days; empty sections say "Nothing this week."; every line links its issue; dumps and earlier summaries are not counted. |
| 10 | Re-run that schedule run from the Actions tab (and dispatch it again) within 24 hours | No second summary issue. The next week's run starts where this period ended. |
| 11 | `worklog for today` and `summary for last week` as dumps; then dispatch `-f from=YYYY-MM-DD -f to=YYYY-MM-DD` | Each gives a summary for that period, linked in the result comment or the run log; a span over 31 days or one that has not started yet asks instead. Asking again for a period whose summary was created after it ended links the existing one. |
| — | After all checks | No real person received an invite; every comment and log is free of tokens. |
