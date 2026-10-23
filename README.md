# Todoman

Personal todo manager with GitHub as its only backend. Write a free-form "dump" as an issue in the private data repo `masnun-siam/todo`; a GitHub Action reads it with headless Claude and creates task, meeting (Google Calendar + Meet) and tracking issues, plus weekly summaries.

- Code: this repo (`masnun-siam/todoman`), shipped as one GitHub Action (`masnun-siam/todoman@v1`).
- Data: `masnun-siam/todo` (real), `masnun-siam/todo-sandbox` (tests).
- PRD: `docs/prds/dump-to-issues.md`.

## Setup

One-time, per data repo. Do it on `masnun-siam/todo-sandbox` first, then on `masnun-siam/todo`. Examples use `REPO=masnun-siam/todo-sandbox`; never paste a token into a file in a repo, an issue or a PR.

### 1. Let the data repos use the action

`todoman` is private, so its Actions setting must allow access from repositories owned by the user (Settings > Actions > General > Access):

```sh
gh api -X PUT repos/masnun-siam/todoman/actions/permissions/access -f access_level=user
```

### 2. Create the data repo and copy the templates

The two workflow files and `people.yml` come from `templates/` of the Todoman version `v1` points at (doctor checks the workflows still match it). The workflows run `masnun-siam/todoman@v1`, so the first time create the tag before this step ([Release](#release) step 1).

```sh
REPO=masnun-siam/todo-sandbox
gh repo create "$REPO" --private           # skip if it exists
gh repo clone "$REPO" /tmp/todo-data && cd /tmp/todo-data
mkdir -p .github/workflows
for f in process.yml summary.yml people.yml; do
  gh api "repos/masnun-siam/todoman/contents/templates/$f?ref=v1" -H 'Accept: application/vnd.github.raw' > "$f"
done
mv process.yml summary.yml .github/workflows/
git add . && git commit -m 'Add Todoman workflows and people.yml' && git push -u origin HEAD
```

Edit `people.yml`: one `{ name, aliases[], email }` entry per person who may be invited to a meeting. A person is invited only when their name or an alias is written in the dump. In the sandbox, list only your own addresses so no real person is emailed.

### 3. Get the credentials

**Claude** (`CLAUDE_CODE_OAUTH_TOKEN`): on your Mac, with the Claude subscription logged in, run `claude setup-token` and keep the token it prints.

**Google Calendar** (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`), in the [Google Cloud console](https://console.cloud.google.com/) with the account whose calendar Todoman writes to (use a separate test account for the sandbox):

1. Create a project and enable the **Google Calendar API**.
2. Configure the OAuth consent screen (Google Auth Platform). Audience: **Internal** if it is a Google Workspace account; otherwise **External**, then **Publish app** (In production). A refresh token of an app left in Testing expires after 7 days. Add the scope `https://www.googleapis.com/auth/calendar.events`.
3. Create an OAuth client of type **Desktop app**. Its client ID and secret are `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
4. Get a refresh token. Open this URL (with your client ID) in the browser, signed in as that account:

   ```text
   https://accounts.google.com/o/oauth2/v2/auth?client_id=YOUR_CLIENT_ID&redirect_uri=http://127.0.0.1:8765&response_type=code&access_type=offline&prompt=consent&scope=https://www.googleapis.com/auth/calendar.events
   ```

   Allow access (for an unverified External app: Advanced > Go to the app). The browser then fails to load `http://127.0.0.1:8765/?code=...`: copy the `code` value from the address bar and exchange it within a few minutes:

   ```sh
   read -r GID; read -rs GSECRET; read -rs GCODE   # paste client ID, secret, code
   curl -s https://oauth2.googleapis.com/token -d client_id="$GID" -d client_secret="$GSECRET" \
     --data-urlencode code="$GCODE" -d redirect_uri=http://127.0.0.1:8765 -d grant_type=authorization_code
   ```

   The `refresh_token` in the reply is `GOOGLE_REFRESH_TOKEN`.

**Other owners' issues** (`GH_READ_TOKENS`): for each owner (user or org) whose issues and PRs you will track, create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with that owner as resource owner, the repos to track, an expiry, and only **Issues: Read**, **Pull requests: Read** and **Metadata: Read**. An org may have to approve it. The secret is one JSON object mapping owner to token, `{}` if you track no other owners:

```json
{"masnun-siam": "github_pat_...", "some-org": "github_pat_..."}
```

### 4. Set the Actions secrets and variables

`gh secret set` prompts for the value, so it stays out of your shell history:

```sh
for s in CLAUDE_CODE_OAUTH_TOKEN GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REFRESH_TOKEN GH_READ_TOKENS; do
  gh secret set "$s" -R "$REPO"
done
```

Repository variables (all optional; unset means the default):

| Variable | Default | Meaning |
|---|---|---|
| `FEATURE_DUMP_TO_ISSUES` | off | `true` turns Todoman on; anything else leaves it off. Doctor runs either way. |
| `TODOMAN_TZ` | `Asia/Dhaka` | IANA zone for dates in dumps and summaries |
| `TODOMAN_OWNER` | `masnun-siam` | the only login whose issues and comments are processed |

```sh
gh variable set FEATURE_DUMP_TO_ISSUES -R "$REPO" --body true   # sandbox only; the real repo waits for the release
```

### 5. Run doctor

```sh
gh workflow run 'Todoman summary' -R "$REPO" -f mode=doctor
sleep 5   # let the run appear
gh run watch -R "$REPO" "$(gh run list -R "$REPO" -w 'Todoman summary' -L 1 --json databaseId -q '.[0].databaseId')"
```

Fix every `FAIL` it prints (see [Doctor](#doctor)) and run it again until all pass.

## Release

Merges to `main` reach no data repo until `v1` moves. With `main` green, `dist/` built, and the parser evals and sandbox checks in [`docs/e2e.md`](docs/e2e.md) passed:

1. Move the tag: `git fetch origin && git tag -f v1 origin/main && git push -f origin v1`.
2. If `templates/` changed, copy the new workflow files into both data repos (setup step 2).
3. Run doctor on `masnun-siam/todo` (setup step 5); it must pass before the flag is set.
4. Turn it on: `gh variable set FEATURE_DUMP_TO_ISSUES -R masnun-siam/todo --body true`.
5. Update the flag's status in `FLAGS.md` in a PR.

## Capture a dump

A dump is any issue you open in the data repo without a Todoman label; its title and body together are the text (up to 10,000 characters). Todoman replies on it; answer its questions with a comment on the same issue.

**GitHub web.** Open <https://github.com/masnun-siam/todo/issues/new>, write the dump as the title (and body if long), submit. Bookmark the URL.

**GitHub mobile app.** `masnun-siam/todo` > Issues > New issue, write it, Create. Add no labels.

**`gh` one-liner:**

```sh
gh issue create -R masnun-siam/todo --body '' --title 'call the bank tomorrow, and meeting with asif friday 3pm'
```

**`gh` alias**, then `gh dump call the bank tomorrow`:

```sh
gh alias set --shell dump 'gh issue create -R masnun-siam/todo --body "" --title "$*"'
```

**iOS Shortcut** (dictate, create the issue):

1. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new): resource owner `masnun-siam`, **Only select repositories** > `masnun-siam/todo`, an expiry, and only **Issues: Read and write** (Metadata: Read is added by GitHub). Nothing else.
2. In Shortcuts, new shortcut "Todo dump" with these actions:
   1. **Dictate Text** (Stop Listening: After Pause).
   2. **Get Contents of URL**: URL `https://api.github.com/repos/masnun-siam/todo/issues`, Method `POST`, Headers `Authorization` = `Bearer <token>`, `Accept` = `application/vnd.github+json`, Request Body `JSON` with one Text field `title` = *Dictated Text*.
   3. **Get Dictionary Value** `html_url` from *Contents of URL*, then **Show Notification** with it (optional, confirms the dump was created).
3. Add it to the Home Screen or Action button, or say "Hey Siri, Todo dump". Keep a dictation under 256 characters (GitHub's title limit). When the token expires, create a new one and replace it in the header.

## Summaries

A weekly `summary` issue opens every Thursday 18:00 Asia/Dhaka. For any other period (whole days, at most 31), dump `worklog for today` or `summary for last week`, or dispatch the summary workflow with dates; the run log prints the link:

```sh
gh workflow run 'Todoman summary' -R masnun-siam/todo -f mode=summary -f from=2026-10-12 -f to=2026-10-18
```

A summary for exactly that period that was created after the period ended is linked instead of opening a new one.

## Doctor

Run the `Todoman summary` workflow by hand with mode `doctor` (on the data repo). It creates any missing labels and prints `PASS` or `FAIL` plus the fix for each check, never a token or an error body:

- the data repo is private, its workflow files match `templates/`, and `people.yml` parses;
- the Claude login works (one tiny run with `CLAUDE_CODE_OAUTH_TOKEN`);
- the Google refresh token refreshes, its scopes include `calendar.events`, and the primary calendar can be read (nothing is written);
- each `GH_READ_TOKENS` entry can read at least one repo of its owner (set it to `{}` if you track no other owners).

A missing secret fails its check and names the secret.
