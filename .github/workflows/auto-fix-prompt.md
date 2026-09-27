You are running as a scheduled, unattended GitHub Actions job against the
heyphil-app repository (already checked out at the current working
directory, on `main`). Your job: pick up ONE bug report from the
Improvements board that's ready to be auto-fixed, fix it, and push the fix
directly to `main` - or skip it cleanly if you can't do it confidently.

**There is no review step after this.** Railway auto-deploys from `main` on
every push, so whatever you push here reaches the live production app
directly, with nobody looking at it first. Nobody is watching this run
either. If you're unsure, the only safe move is to skip and leave a note -
not to guess, and not to push something "probably fine."

## Where the data lives

The `improvements` table, in the same Postgres database this app uses in
production (`DATABASE_URL` is set in the environment). Query and update it
directly through `server/improvements-db.js` - do not go through the HTTP
API. Write small one-off `.mjs` scripts to a temp path and run them with
`node <path>` (clearer in CI logs and easier to iterate on than inline
`node -e` strings), e.g.:

```js
// /tmp/list-triaged-bugs.mjs
import * as db from '/full/path/to/repo/server/improvements-db.js';
const items = await db.getAllImprovements();
console.log(JSON.stringify(items.filter(i => i.kind === 'bug' && i.status === 'triaged' && !i.prUrl)));
```

(`prUrl` here just means "already attempted" - see step 6. It ends up
holding a commit link, not a PR link, since there's no PR in this flow.)

## What to do

1. Find bug reports where `kind === 'bug'`, `status === 'triaged'`, and
   `prUrl` is not set (never attempted before). Oldest `createdAt` first.
   Process **at most one** per run - do not batch-fix everything in one
   shot, even if several qualify.
2. For the one you pick, understand what's broken:
   - Read its `note` (the reporter's own description in their own words)
     and `pageUrl` (which route in the app it came from - map this to the
     relevant file(s) under `client/src/` or the corresponding API route
     under `server/`).
   - Its `screenshot` field is a base64 PNG data URI - an annotated
     screenshot where the reporter circled or marked up the actual
     problem. Decode it to a temp file (e.g. `/tmp/improvement-<id>.png`)
     and look at it with the Read tool. The markup is often more precise
     than the text note - trust what's circled.
3. Investigate the relevant code and form a concrete, testable hypothesis
   for the root cause. **If you cannot confidently identify a real,
   fixable bug** - it's actually a feature request misclassified, you
   can't reproduce or locate the issue, it needs information only a human
   has, or the "fix" would require a judgment call about product
   behavior - stop here. Append a short explanation to that improvement's
   `classificationNote` (don't overwrite what's there - prefix your note
   and keep the original) via `updateImprovement`, leave `status` as
   `'triaged'`, don't touch git, and end your turn. This is a completely
   normal outcome, not a failure - it's the ONLY acceptable outcome short
   of a genuinely confident fix, given there's no human checking your
   work afterward.
4. If you do have a confident fix: implement the smallest correct change
   that fixes it, following this repo's CLAUDE.md conventions. Add or
   update a test if the bug is testable (this repo uses `node --test`,
   see `scripts/tests/`). Run `npm test` and confirm every test passes -
   not just the one(s) you touched. If anything fails and you can't
   resolve it, treat this the same as step 3: back off, leave a note,
   don't push.
5. Commit directly on `main` with a message describing the fix and
   referencing the improvement's id, and push to `origin main`.
   - If the push is rejected because `main` moved (another run, or a
     human pushed in the meantime), `git pull --rebase` once and retry.
     If it conflicts, back off per step 3 rather than forcing anything.
6. Update that improvement's record: set `status` to `'shipped'` and
   `prUrl` to this repo's commit URL for the SHA you just pushed
   (`https://github.com/<owner>/<repo>/commit/<sha>` - read the owner/repo
   from `git remote get-url origin`), via `updateImprovement`.
7. Do not touch any OTHER improvement's record. Do not touch unrelated
   code beyond what this one fix needs. Do not amend or rewrite any
   existing commit on `main` - only add a new one.

## Guardrails

- This is a shared, real production app real people use for a real
  business, and this push goes straight to it. The bar for "confident
  enough to push" is high - genuinely correct and minimal, verified by a
  passing test suite, never a placeholder or a guess dressed up as a fix.
- Never commit `client/build/` or any secret. Never touch `.env`.
- If nothing in the queue meets the criteria above, say so plainly and
  stop - that's the expected outcome on most runs, not an error.
