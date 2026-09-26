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
- Optional: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (chat notifications), `DEBUG_SQL` (logs every query), `ANTHROPIC_API_KEY` (Improvements board auto-triage sweep - classifies new reports as bug/feature every 3h; no-ops without it)

`client/.env`: `REACT_APP_API_URL` (localhost:3002 in dev; api.heyphil.bot in the production env file)

## Conventions

- ESM throughout (`"type": "module"`) — use `import`, not `require`, everywhere including server code.
- **Primary datastore is Postgres**, via `server/db.js` + `board-db.js` / `orgchart-db.js`. README.md and CONTEXT.md both describe Google Sheets as "the database" — that's stale. Sheets/`googleapis` code (`server/index-sheets-backup.js`, `setup-*.js`, the `__OLD_SHEETS` route) is legacy/setup-only, not on the live data path.
- Realtime updates go over Socket.io from `server/index.js`, not polling.
- Deploy: push to `main` → Railway auto-deploys the backend; Cloudflare Pages builds `client/` separately from the same repo (build command `cd client && npm install && npm run build`, output `client/build`).

## Gotchas

- **Never commit `client/build/` or `static/`.** They're gitignored on purpose — a committed build directory silently overrides Railway's fresh build, so deploys report success but serve stale code.
- Cloudflare sits in front of Railway and caches aggressively (up to 1–4h). After a deploy, compare the live bundle hash (`curl -s https://heyphil.bot | grep 'main\.[a-z0-9]*\.js'`) against the local build before assuming a deploy failed; purge the Cloudflare cache if it's stale after 5+ minutes.
- Startup failures are asymmetric: a bad/missing `DATABASE_URL` fails silently (`autoMigrate()` catches and just logs a warning — the server still boots). A missing `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` crashes the process immediately, since `passport-google-oauth20`'s Strategy constructor throws synchronously. If the server won't start, check OAuth env vars first.

## Workflow

- Verify before claiming a task is done: run the actual verification command and show its output.
- If a change touches more than two files, or the approach is uncertain, plan first and get approval before editing.
- Write a failing test that reproduces a bug before fixing it, when the bug is testable.
- After any non-trivial change, run `/code-review` on the diff and report correctness gaps only.
- Ask before installing dependencies, changing schema, or touching `.env` or `service-account.json`.
