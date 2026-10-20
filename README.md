# Todoman

Personal todo manager with GitHub as its only backend. Write a free-form "dump" as an issue in the private data repo `masnun-siam/todo`; a GitHub Action reads it with headless Claude and creates task, meeting (Google Calendar + Meet) and tracking issues, plus weekly summaries.

- Code: this repo (`masnun-siam/todoman`), shipped as one GitHub Action (`masnun-siam/todoman@v1`).
- Data: `masnun-siam/todo` (real), `masnun-siam/todo-sandbox` (tests).
- PRD: `docs/prds/dump-to-issues.md`.

Setup and capture recipes are added by the epic's tasks (FR-13, FR-14).
