# HeyPhil App

Project management app for Chad's team (Kanban board, timeline, org charts).

## Commands

- `npm run setup` — install deps (root + client)
- `npm run dev` — run server (:3002) + client (:3000) concurrently
- `npm run server` / `npm run client` — run one side only
- `npm run build` — production build of client (runs `npm install` itself)
- `npm run migrate:deleted-at` — one-off DB migration (adds soft-delete column)
- `npm run smoke` — boots the server and checks `/health`, **including DB reachability**; today's only pass/fail signal. Fails without a working `DATABASE_URL` — there's no offline fallback (unlike the OAuth env vars, which get placeholders).

## Environment variables

Root `.env` (copy from `.env.example` — **but the example is missing `DATABASE_URL`**, which `server/db.js` requires):
- `PORT`, `NODE_ENV`, `API_URL`, `APP_URL`
- `DATABASE_URL` — Postgres connection string (not in `.env.example`)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`
- `ORIGINATION_SHEET_ID` — only used by legacy/setup scripts, not the running app
- Optional: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (chat notifications), `DEBUG_SQL` (logs every query)

`client/.env`: `REACT_APP_API_URL` (localhost:3002 in dev; api.heyphil.bot in the production env file)

### Improvements board (Labs → Improvements)

A floating 📸 button on every page renders the visible page to an image (html2canvas - no screen-share prompt; falls back to a note-only report if capture fails), lets you mark it up (Pen / Box / Arrow / **Redact** a private detail / Undo), pick a hint ("Something is broken / Idea or request / Not sure"), add a note, and creates a card in **Intake**. Each report also records the window size, browser, the deployed commit, and the last 20 JavaScript errors. From there, sorting and fixing is deliberately interactive, not automated — say these to a live Claude Code session (an earlier version had an automatic classify sweep and a scheduled GitHub Actions auto-fix pipeline; both were removed as unnecessary and costly - see git history).

**Use the CLI for every board read/write** - `npm run improvements -- <command>` (`scripts/improvements.js`, goes through `server/improvements-db.js` so the board's validation and `resolved_at` rules apply), not ad-hoc queries:
- `list [open|all|<status>]` - open (default) = not Shipped/Abandoned.
- `show <N>` - every field, the report context (window, browser, build commit, JS errors), and the screenshot written to a temp file whose path it prints - Read that file to see it.
- `move <N> <status|-> [--kind bug|feature|none] [--priority high|normal|low] [--note "..."] [--commit <sha|url>] [--duplicate-of <N|none>]` - statuses `intake`, `bugs`/`triaged-bugs`, `features`/`triaged-features`, `shipped`, `abandoned`; `-` keeps the status. It writes the database directly, so an open board needs a refresh.

What to say:
- **"Triage"** — `list intake`, then `show` each card (note + screenshot + page + context; the reporter's hint is a hint, not the answer). For each: decide bug vs feature, set a **priority** (high = broken for people now / blocks work; low = cosmetic or nice-to-have; else normal), and check for **duplicates** of open or recently shipped cards - a duplicate goes to Abandoned with `--duplicate-of <N>` and a note, not into a Triaged column. Then `move` it to Triaged - Bugs or Triaged - Features with `--kind`, `--priority` and a `--note` saying why. THEN AUTOMATICALLY fix every bug just sorted, highest priority first (full rigor below) - features are never auto-implemented, only sorted. Report both: what got fixed, and the numbered feature list (with priorities) waiting on "implement feature N".
- **"Implement feature 1,2,4"** / **"fix bug N"** — each card has a stable `#N` (`seqNum`, shown on the card and in its modal) that N refers to, not a position in whatever list was last given - `show N`, implement each with full rigor, then `move N shipped --commit <sha> --note "..."`. Each triaged card also has a 📋 button that copies its exact prompt (`fix bug N` / `implement feature N`) to the clipboard.
- **Full rigor** (applies to both auto-fixed bugs and explicitly-requested features): investigate, implement, add/update tests, run the full suite, make sure the client compiles (no local browser verification - see Workflow), commit, push straight to `main` (justified here since it's an explicit human go-ahead in the same interactive session, not an unattended job), move to **Shipped** with the commit link. If a triaged bug turns out not to be confidently fixable (e.g. a platform limitation, not enough info), leave it in Triaged - Bugs with a `--note` explaining why rather than forcing a fix.

Columns (`IMPROVEMENT_COLUMNS` in `server/improvement-rules.js`): `intake`, `triaged-bugs`, `triaged-features`, `shipped`, `abandoned`. No forward-only restriction, same as the origination board. `resolved_at` is set on moving into Shipped/Abandoned and cleared if a card is reopened. On the board, moving/editing/deleting cards is admin-only (reporting is open to everyone who can sign in); the CLI writes the database directly.

## Conventions

- ESM throughout (`"type": "module"`) — use `import`, not `require`, everywhere including server code.
- **Primary datastore is Postgres**, via `server/db.js` + `board-db.js` / `orgchart-db.js`. README.md and CONTEXT.md both describe Google Sheets as "the database" — that's stale. Sheets/`googleapis` code (`setup-*.js`, the `__OLD_SHEETS` route) is legacy/setup-only, not on the live data path. (`server/index-sheets-backup.js` was dead code and has been removed.) `googleapis` is also used, read-only, by `server/drive.js` for the Project Folder picker.
- Realtime updates go over Socket.io from `server/index.js`, not polling.
- Deploy: push to `main` → Railway auto-deploys the backend; Cloudflare Pages builds `client/` separately from the same repo (build command `cd client && npm install && npm run build`, output `client/build`).

## Gotchas

- **Never commit `client/build/` or `static/`.** They're gitignored on purpose — a committed build directory silently overrides Railway's fresh build, so deploys report success but serve stale code.
- Cloudflare sits in front of Railway and caches aggressively (up to 1–4h). After a deploy, compare the live bundle hash (`curl -s https://heyphil.bot | grep 'main\.[a-z0-9]*\.js'`) against the local build before assuming a deploy failed; purge the Cloudflare cache if it's stale after 5+ minutes.
- Startup failures are asymmetric: a bad/missing `DATABASE_URL` fails silently (`autoMigrate()` catches and just logs a warning — the server still boots). A missing `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` crashes the process immediately, since `passport-google-oauth20`'s Strategy constructor throws synchronously. If the server won't start, check OAuth env vars first.
- In production (`NODE_ENV=production` or running on Railway) the server also refuses to start without a real `SESSION_SECRET` (it signs every login token, and this repo is public) - `server/auth-middleware.js`.

## Workflow

- Verify before claiming a task is done: run the actual verification command and show its output.
- Don't start the local server (`npm run dev`/`server`/`client` - it points at the live database) or do browser verification unless asked.
- Before pushing: make sure it compiles (`cd client && CI=false npx react-scripts build`) and `npm test` passes.
- After every push: wait for the Railway deploy to finish, confirm it succeeded, check the deploy/runtime logs for errors, and confirm the production sign-in page loads. If anything fails, stop and report it immediately - don't push further fixes without saying so first.
- Any database schema change, migration, or script that modifies existing data: stop and get explicit approval before running it - there is only one live database.
  - Exception: moving an Improvements card and setting its kind / priority / duplicate-of / triage note / commit link (`npm run improvements -- move ...`) is part of "triage" / "implement feature N" / "fix bug N" and doesn't need separate approval.
- Finish with one line saying what to click on in production to confirm the change.
- If a change touches more than two files, or the approach is uncertain, plan first and get approval before editing.
- Write a failing test that reproduces a bug before fixing it, when the bug is testable.
- After any non-trivial change, run `/code-review` on the diff and report correctness gaps only.
- Ask before installing dependencies, changing schema, or touching `.env` or `service-account.json`.
