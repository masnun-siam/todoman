# Todoman

- Base branch and production branch: `main`. PRs go into `main`. No staging branch.
- Stack: TypeScript, one JavaScript GitHub Action on the `node24` runtime (modes `process`, `summary`, `doctor`); Claude Code CLI pinned in the lockfile.
- Verify (CI runs the same): `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` then check `dist/` is up to date (`git diff --exit-code dist`).
- Every user-visible change ships behind `FEATURE_DUMP_TO_ISSUES` (repo variable on the data repo), default off; track it in `FLAGS.md`.
- PRD: `docs/prds/dump-to-issues.md`. Claude calls use no tools and a fixed JSON schema; Todoman's code does every write.
- Never put secrets in the repo, comments or PRs.
