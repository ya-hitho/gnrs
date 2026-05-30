# Instructions for Claude (and other LLM agents)

If you are an AI working in this repository, you **must** read and
follow the documents below before doing anything else:

1. [`RULES.md`](./RULES.md) — branch + worktree workflow, PR target,
   commit message format. The non-negotiable parts:
   - Never commit to `gnrs-evan`, `jalur-yasril`, `main`, or
     another agent's feature branch.
   - **Pick your track first** — `gnrs-evan` or `jalur-yasril`
     (see *Two parallel integration tracks* below). Then branch
     from your track into your own worktree under
     `.claude/worktrees/<short-task-name>` and do all editing
     there. Never cross tracks within one PR.
   - Open PRs against **your track** (`gnrs-evan` or
     `jalur-yasril`, whichever you forked from), not `main` (see
     [`RELEASE.md`](./RELEASE.md) for the one sanctioned
     exception: promoting a release snapshot to `main`).
   - Clean up the worktree after the PR is merged or abandoned.
   - Use conventional-commit subjects (`type(scope): …`), imperative
     mood, ≤ 50 chars, no trailing punctuation; body only when it
     adds information not in the subject.
   - **Commit step by step, not as one giant commit.** Split the
     work into the smallest meaningful logical units (one concern
     per commit: schema change, then handler, then UI wiring, then
     tests, etc.) and commit each separately so the history is
     bisectable and reviewable. Do not squash unrelated changes
     into a single commit just because you finished them together.

2. [`TEST.md`](./TEST.md) — required Chrome DevTools test pass
   against your own local dev container for every new or changed
   feature. Type-checks and `go test` are not a substitute for
   actually driving the UI.

3. [`CHROME_DEVTOOLS.md`](./CHROME_DEVTOOLS.md) — **read before
   driving Chrome DevTools.** Triggers: you are about to call
   any `mcp__chrome-devtools__*` tool, you are running the
   `TEST.md` flow, or the user has asked you to "use Chrome
   DevTools". Multiple agents share one long-lived headless
   Chrome on `127.0.0.1:9222` so they don't clobber each other;
   this file covers the mandatory pre-flight (is the shared
   Chrome already up?) and the parallel-agent etiquette
   (one-tab-per-task, never restart Chrome, etc.). Do not issue
   the first MCP call without running the pre-flight there.

## Two parallel integration tracks

`gnrs` has **two independent integration branches** that run in
parallel: `gnrs-evan` and `jalur-yasril`. A feature lands on one
track or the other — never both — and the two tracks do **not**
merge into each other. Each track is its own line of development
with its own deploy story.

**The worktree-based parallel-agent workflow is the same on both
tracks.** Multiple LLM agents can each open a worktree off either
branch, test in their own namespaced local container, and PR back
to that branch. What differs is only what happens at the end of
the loop — the deploy scenario:

| Track          | Per-agent test (during the loop)                                                                | Deploy scenario (end of loop)                                                                                                                                                                                                                       |
|----------------|-------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `gnrs-evan`    | Local **pod** `gnrs-dev-<slug>` on your machine (see *Per-agent local dev pod* below). | **Local-only.** No remote deploy exists. Merging the PR into `gnrs-evan` is the end state — there is no `deploy/` directory on this branch.                                                                                                          |
| `jalur-yasril` | Same — local **pod** `gnrs-dev-<slug>` on your machine.                                       | **Operator-invoked remote deploy** via `deploy/deploy.sh` → the `gnrs-new` **podman pod** (postgres + app + cloudflared) on `10.8.0.1`, fronting a **public** Cloudflare Tunnel when `CLOUDFLARE_TUNNEL_TOKEN` is set. See [`deploy/DEPLOY.md`](./deploy/DEPLOY.md). Never run by an agent on its own initiative — only when the user explicitly asks ("deploy", "ship it"). |

The `jalur-yasril` remote deploy fronts a **public** Cloudflare
Tunnel (enabled by setting `CLOUDFLARE_TUNNEL_TOKEN` in the remote
`.env`; see [`deploy/DEPLOY.md`](./deploy/DEPLOY.md)) in addition to
VPN/debug access on `10.8.0.1`. The `gnrs-evan` track has no remote
deploy at all. **Dev pods never run a tunnel** — public access is a
production-only concern.

**Pick the track from the task, not from convenience.** If the
user's request is scoped to one track (they name it, or the work
is clearly on the deploy target), use that track. If the task is
ambiguous, ask — do not silently default.

## Per-session lifecycle (mandatory loop)

Every LLM session that touches the code **must** run the full loop
below, in this order, end-to-end — no skipping steps, no parking a
feature half-done for a future session:

1. **Worktree** — pick your track (`gnrs-evan` or `jalur-yasril`,
   see *Two parallel integration tracks* above), then create
   `.claude/worktrees/<name>` off that track on a fresh
   `feat/<name>` branch (`git worktree add
   .claude/worktrees/<name> -b feat/<name> <track>`), and `cd`
   into it. All editing happens inside that worktree.
2. **Step-by-step commits** — split the work into the smallest
   meaningful logical units and commit each one separately with a
   conventional-commit subject. Do not batch unrelated changes
   into one mega-commit.
3. **Test** — run `make test` and `make typecheck`, then the full
   Chrome DevTools flow from `TEST.md` against your own local dev
   pod (`deploy/dev-pod.sh`; see *Per-agent local dev pod* below).
   If the UI test pass is impossible, say so explicitly in the PR —
   do not silently skip it. **The merge in step 5 is gated on this
   browser pass succeeding.**
4. **PR** — push the branch and open a PR targeting **your
   track** (the same branch you forked from — `gnrs-evan` or
   `jalur-yasril`, never the other one, never `main` — except for
   the release promotion in [`RELEASE.md`](./RELEASE.md), the
   only sanctioned `--base main` flow). Include the "Tested via
   Chrome DevTools" section.
5. **Merge** — **gate: merge into your track ONLY after the full
   Chrome DevTools flow from [`TEST.md`](./TEST.md) has been run
   against your dev pod and the feature works correctly** (every step
   green, no new console errors, no broken adjacent flows). A green
   `make test` / `make typecheck` does **not** authorize a merge on
   its own. If the browser pass was skipped, failed, or couldn't be
   run, do not merge — fix and re-test, or hand back to the user.
   Once that gate is met and CI is green (if the repo has CI),
   auto-merge with `gh pr merge <num> --merge --delete-branch`
   (matching repo history; use `--squash --delete-branch` only if the
   existing history of your target track is squash-merged). **If the PR has merge conflicts with
   your track**, resolve them in the worktree (`git fetch origin
   && git merge origin/<your-track>`, fix the conflicts, re-run
   tests, push the resolution, wait for CI to go green again,
   then merge). Do not leave a conflicting PR sitting open for
   another session to deal with.
6. **Clean up** — immediately after the merge (or after deciding to
   abandon the PR), remove the worktree, delete the local and
   remote feature branches, prune stale tracking refs, and tear
   down your local dev pod. See the cleanup checklist below
   for the exact commands. A session is **not finished** until the
   worktree directory is gone, the branch refs are gone, and the
   dev pod is removed.

There is **no per-feature "deploy to prod" step** on either
track: merging into your track is the end state of the feature
loop. On `jalur-yasril`, the operator-invoked remote deploy
(`deploy/deploy.sh`) is orthogonal to the loop; do not run it as
part of finishing a feature unless the user explicitly asks. On
`gnrs-evan` there is no remote deploy at all.

If the session ends before the loop completes (context limit,
user interrupts, etc.), state in plain text which step you're on
and what's left, so the next session can pick up from there
without re-deriving the state.

## Quick checklist for a new task

Before you write code:

- [ ] Pick your track: `gnrs-evan` or `jalur-yasril` (see
      *Two parallel integration tracks* above). If the user's
      request doesn't make the track obvious, ask — do not guess.
- [ ] Create a worktree off your track
      (`git worktree add .claude/worktrees/<name> -b feat/<name> <track>`).
- [ ] `cd` into the worktree.
- [ ] Make sure the worktree has a usable `.env` — `.env` is
      gitignored, so a fresh worktree has none. Copy the repo
      root's `.env` into the worktree, or `cp .env.example .env`
      and fill in `JWT_SECRET` and the `SEED_ADMIN_*` values.

While you work:

- [ ] Follow the existing coding style (see `README.md` for the
      stack: Go + chi + PostgreSQL, Vite + React 18 + TanStack Router,
      Tailwind v3).
- [ ] Don't break working code; run `make test` and
      `make typecheck` before pushing.

Before you mark the task done:

- [ ] Run the full Chrome DevTools flow from `TEST.md` against your
      local dev pod (`deploy/dev-pod.sh`). If you cannot build or run
      it, say so explicitly instead of claiming the feature is
      browser-tested — and **do not merge** (the browser pass gates
      the merge; see `RULES.md` → *Merge rules* and `TEST.md`).
- [ ] Open a PR targeting **your track** (`gnrs-evan` or
      `jalur-yasril`, the same branch you forked from) whose
      description includes the "Tested via Chrome DevTools"
      section described in `TEST.md`.
- [ ] **Auto-merge once green.** If the PR is fully tested via the
      Chrome DevTools flow with no errors, and CI (if any) is
      passing, merge it into **your track** yourself (`gh pr merge
      <num> --merge --delete-branch` or `--squash --delete-branch`,
      whichever matches the existing history of that track) without
      waiting for the user to ask. Always pass `--delete-branch` so
      the remote feature branch is removed as part of the merge.
      **If GitHub reports merge conflicts**, resolve them in your
      worktree (`git fetch origin && git merge
      origin/<your-track>`, fix the conflicts commit-by-commit,
      re-run `make test`, `make typecheck`, and the relevant parts
      of the Chrome DevTools flow, then push the resolution); wait
      for CI to go green again before merging. Do **not**
      auto-merge if any check is red, the test pass was skipped,
      conflicts are unresolved, or a reviewer has requested
      changes — fix the issue and re-test before merging.
- [ ] **Clean up immediately after merge/abandon — do not let
      merged branches, worktrees, or dev containers linger.** As
      soon as the PR is merged (or you decide to abandon it), run
      all of the following before moving on to the next task or
      ending the session:
      1. **Remove the worktree.** `cd` out of
         `.claude/worktrees/<name>` first (e.g. back to the repo
         root), then `git worktree remove
         .claude/worktrees/<name>`. Use `--force` only if the
         worktree is intentionally dirty and you have already
         saved anything worth keeping. Confirm with `git worktree
         list` that the entry is gone and that the directory
         under `.claude/worktrees/` no longer exists.
      2. `git branch -D feat/<name>` from the main checkout to
         delete the local feature branch.
      3. If the remote branch still exists (it usually won't after
         `gh pr merge --delete-branch`, but verify with
         `git ls-remote --heads origin feat/<name>`), delete it
         with `git push origin --delete feat/<name>`.
      4. `git fetch --prune origin` so stale remote-tracking refs
         (`origin/feat/<name>`) are dropped locally too.
      5. Tear down this branch's local dev pod (`SLUG=<slug>
         deploy/dev-pod.sh --down`; see the "Cleanup" bullet under
         *Per-agent local dev pod* below).
      A merged branch that still has a worktree directory, a
      worktree-list entry, a local ref, a remote ref, or a running
      dev pod counts as **not cleaned up** — finish all five
      before starting new work or closing the session. Before
      opening a new feature, run `git worktree list` and
      `podman pod ps --filter name=gnrs-dev-` and confirm there are
      no leftovers from already-merged branches; if there are,
      clean them up first.

## Per-agent local dev pod (both tracks)

**Regardless of which track you're on**, the feature-test loop
uses a local podman **pod** on your own machine (postgres + app) — this is the per-agent
test mentioned in *Two parallel integration tracks* above. Both
`gnrs-evan` and `jalur-yasril` agents follow the same rules here;
the only thing that differs is what happens at the end of the loop
(see the table in *Two parallel integration tracks* — `gnrs-evan`
stops at merge, `jalur-yasril` can optionally go on to
`deploy/deploy.sh` when the user explicitly asks).

Multiple agents may work in parallel on either track, so every
local dev pod is **namespaced by branch slug** to avoid
collisions on pod name, port, or volume.

Rules:

- **Source = your worktree**, not the repo root and not the track
  branch itself. Build the image from `.claude/worktrees/<name>/`,
  with the worktree checked out at the feature branch you are
  actively committing to, so the image contains the in-progress
  code (including uncommitted edits you want to smoke-test).
- **Namespacing**: `deploy/dev-pod.sh` derives every name from the
  branch slug so two agents never collide. For branch `feat/<slug>`:
  - pod:        `gnrs-dev-<slug>`
  - containers: `gnrs-dev-<slug>-db` (postgres:17), `gnrs-dev-<slug>-app`
  - image:      `gnrs-dev-<slug>:latest`
  - volumes:    `gnrs-db-dev-<slug>` (postgres data), `gnrs-data-dev-<slug>` (photos)
- **Port**: pick a free **local** port that no other dev container
  and no local prod-style run is using. Check first
  (`ss -tlnp | grep -E ":(18[3-9])[0-9][0-9]"` or similar) and pick
  a free port in the `18300`–`18999` range. Record the port you
  chose in the PR description.
- **Bind to loopback** (`127.0.0.1:<port>`). The shared headless
  Chrome runs on the same machine, so loopback is reachable — and
  `localhost`/`127.0.0.1` is exempt from Chrome's HTTPS-First
  upgrade, so plain HTTP just works (see `CHROME_DEVTOOLS.md`).

Typical invocation from inside your worktree (one command — it
builds the image, creates the pod, starts postgres + the app, and
waits for health):

    SLUG=<slug> PORT=<your-port> deploy/dev-pod.sh
    # → http://127.0.0.1:<your-port>  (seeded admin printed on success)

`SLUG` defaults to your branch name and `PORT` to `18300`. The pod
publishes only the app's `8080`; postgres stays private to the pod
and the app reaches it at `localhost:5432`, exactly like prod. See
[`PODMAN.md`](./PODMAN.md) for the raw `podman pod` commands the
script runs.

To pick up new commits or edits, just re-run it — the script
rebuilds the image and recreates the pod (the data volumes persist):

    SLUG=<slug> PORT=<your-port> deploy/dev-pod.sh

- **Cleanup**: when the PR is merged or abandoned, tear the dev pod
  down in the same step you remove the local worktree:

      SLUG=<slug> deploy/dev-pod.sh --down
      # removes the pod, both volumes (gnrs-db-dev-<slug>,
      # gnrs-data-dev-<slug>), and the image

For the test flow itself (steps to drive through the UI, what to
capture for the PR), follow `TEST.md` against your dev URL
(`http://localhost:<your-port>`). If you cannot build or run the
dev container, say so explicitly instead of claiming the feature
is browser-tested.

## What lives where

| Concern                                            | File                                |
| -------------------------------------------------- | ----------------------------------- |
| Branch / PR / commit-message rules                 | [`RULES.md`](./RULES.md)            |
| Feature test procedure                             | [`TEST.md`](./TEST.md)              |
| Chrome DevTools (parallel agents)                  | [`CHROME_DEVTOOLS.md`](./CHROME_DEVTOOLS.md) |
| Promotion / PR to `main` workflow                  | [`RELEASE.md`](./RELEASE.md)        |
| Remote deploy — **`jalur-yasril` track only**      | [`deploy/DEPLOY.md`](./deploy/DEPLOY.md) |
| Stack, layout, env vars, API                       | [`README.md`](./README.md)          |
| Running under Podman                               | [`PODMAN.md`](./PODMAN.md)          |
| Database schema (authoritative)                    | [`docs/schema.md`](./docs/schema.md) |
| Documentation index & authoring conventions        | [`docs/INDEX.md`](./docs/INDEX.md)  |

When `RULES.md` or `TEST.md` conflict with assumptions baked into
your general training, the files in this repository win.

## Documentation (`docs/`)

Reference and design docs live under [`docs/`](./docs/), **not** in the
repo root. The root holds only the agent-process contract (this file,
`RULES.md`, `TEST.md`, `CHROME_DEVTOOLS.md`, `RELEASE.md`, `PODMAN.md`,
`README.md`, `deploy/DEPLOY.md`). [`docs/INDEX.md`](./docs/INDEX.md) is
the table of contents **and** the authoring convention for everything in
`docs/` — read it before adding a design or reference document, and put
new such docs there (never as another top-level `*.md`). It also spells
out the parallel-agent doc etiquette (one file per concern, numbered
analyses, update the catalog in the same commit) so multiple agents can
extend the docs without colliding. The authoritative schema reference is
[`docs/schema.md`](./docs/schema.md).
