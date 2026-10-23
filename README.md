# Todoman

Personal todo manager with GitHub as its only backend. Write a free-form "dump" as an issue in the private data repo `masnun-siam/todo`; a GitHub Action reads it with headless Claude and creates task, meeting (Google Calendar + Meet) and tracking issues, plus weekly summaries.

- Code: this repo (`masnun-siam/todoman`), shipped as one GitHub Action (`masnun-siam/todoman@v1`).
- Data: `masnun-siam/todo` (real), `masnun-siam/todo-sandbox` (tests).
- PRD: `docs/prds/dump-to-issues.md`.

Setup and capture recipes are added by the epic's tasks (FR-13, FR-14).

## Doctor

Run the `Todoman summary` workflow by hand with mode `doctor` (on the data repo). It creates any missing labels and prints `PASS` or `FAIL` plus the fix for each check, never a token or an error body:

- the data repo is private, its workflow files match `templates/`, and `people.yml` parses;
- the Claude login works (one tiny run with `CLAUDE_CODE_OAUTH_TOKEN`);
- the Google refresh token refreshes, its scopes include `calendar.events`, and the primary calendar can be read (nothing is written);
- each `GH_READ_TOKENS` entry can read its owner (set it to `{}` if you track no other owners).

A missing secret fails its check and names the secret.
