# Instructions for Claude (and other LLM agents)

If you are an AI working in this repository, you **must** read and
follow the documents below before doing anything else:

1. [`RULES.md`](./RULES.md) — branch + worktree workflow, PR target,
   commit message format. The non-negotiable parts:
   - Never commit to `gnrs-evan`, `main`, or another agent's feature
     branch.
   - Branch from `gnrs-evan` into your own worktree under
     `.claude/worktrees/<short-task-name>` and do all editing there.
   - Open PRs against `gnrs-evan`, not `main` (see
     [`RELEASE.md`](./RELEASE.md) for the one sanctioned exception:
     promoting a release snapshot to `main`).
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

For per-feature work, `gnrs` behaves as **local-only**: every
agent tests against its **own** local container (see *Dev
deployment* below), there is no shared public production
deployment, and there is no Cloudflare tunnel. `gnrs-evan` is the
integration branch — merging a PR into it is what completes a
feature.

A separate, **operator-invoked** remote deploy does exist:
`deploy/deploy.sh` rsyncs the current branch to a personal
WireGuard-only host and runs it under `podman` there (see
[`deploy/DEPLOY.md`](./deploy/DEPLOY.md)). It is **not** part of
the per-feature loop — agents do not run it on every PR — and the
target is reachable only over the operator's VPN, not from the
public internet. Run it only when the user explicitly asks
(e.g. "deploy", "ship it").

## Per-session lifecycle (mandatory loop)

Every LLM session that touches the code **must** run the full loop
below, in this order, end-to-end — no skipping steps, no parking a
feature half-done for a future session:

1. **Worktree** — create `.claude/worktrees/<name>` off `gnrs-evan`
   on a fresh `feat/<name>` branch, and `cd` into it. All editing
   happens inside that worktree.
2. **Step-by-step commits** — split the work into the smallest
   meaningful logical units and commit each one separately with a
   conventional-commit subject. Do not batch unrelated changes
   into one mega-commit.
3. **Test** — run `make test` and `make typecheck`, then the full
   Chrome DevTools flow from `TEST.md` against your own local dev
   container (see *Dev deployment* below). If the UI test pass is
   impossible, say so explicitly in the PR — do not silently skip
   it.
4. **PR** — push the branch and open a PR targeting `gnrs-evan`
   (never `main` — unless you are explicitly running the release
   promotion in [`RELEASE.md`](./RELEASE.md), which is the only
   sanctioned `--base main` flow) with the "Tested via Chrome
   DevTools" section filled in.
5. **Merge** — once CI is green (if the repo has CI) and the test
   pass has no errors, auto-merge with `gh pr merge <num> --squash
   --delete-branch` (or `--merge --delete-branch`, matching repo
   history). **If the PR has merge conflicts with `gnrs-evan`,
   resolve them in the worktree** (`git fetch origin && git merge
   origin/gnrs-evan`, fix the conflicts, re-run tests, push the
   resolution, wait for CI to go green again, then merge). Do not
   leave a conflicting PR sitting open for another session to deal
   with.
6. **Clean up** — immediately after the merge (or after deciding to
   abandon the PR), remove the worktree, delete the local and
   remote feature branches, prune stale tracking refs, and tear
   down your local dev container. See the cleanup checklist below
   for the exact commands. A session is **not finished** until the
   worktree directory is gone, the branch refs are gone, and the
   dev container is removed.

There is **no per-feature "deploy to prod" step** — merging into
`gnrs-evan` is the end state of the feature loop. The optional
remote deploy (`deploy/deploy.sh`) is operator-invoked and
orthogonal to this loop; do not run it as part of finishing a
feature unless the user explicitly asks.

If the session ends before the loop completes (context limit,
user interrupts, etc.), state in plain text which step you're on
and what's left, so the next session can pick up from there
without re-deriving the state.

## Quick checklist for a new task

Before you write code:

- [ ] Create a worktree off `gnrs-evan`
      (`git worktree add .claude/worktrees/<name> -b feat/<name> gnrs-evan`).
- [ ] `cd` into the worktree.
- [ ] Make sure the worktree has a usable `.env` — `.env` is
      gitignored, so a fresh worktree has none. Copy the repo
      root's `.env` into the worktree, or `cp .env.example .env`
      and fill in `JWT_SECRET` and the `SEED_ADMIN_*` values.

While you work:

- [ ] Follow the existing coding style (see `README.md` for the
      stack: Go + chi + SQLite, Vite + React 18 + TanStack Router,
      Tailwind v3).
- [ ] Don't break working code; run `make test` and
      `make typecheck` before pushing.

Before you mark the task done:

- [ ] Run the full Chrome DevTools flow from `TEST.md` against your
      local dev container. If you cannot build or run that
      container, say so explicitly instead of claiming the feature
      is browser-tested.
- [ ] Open a PR targeting `gnrs-evan` whose description includes
      the "Tested via Chrome DevTools" section described in
      `TEST.md`.
- [ ] **Auto-merge once green.** If the PR is fully tested via the
      Chrome DevTools flow with no errors, and CI (if any) is
      passing, merge it into `gnrs-evan` yourself (`gh pr merge
      <num> --squash --delete-branch` or `--merge --delete-branch`,
      whichever matches the existing history) without waiting for
      the user to ask. Always pass `--delete-branch` so the remote
      feature branch is removed as part of the merge. **If GitHub
      reports merge conflicts**, resolve them in your worktree
      (`git fetch origin && git merge origin/gnrs-evan`, fix the
      conflicts commit-by-commit, re-run `make test`,
      `make typecheck`, and the relevant parts of the Chrome
      DevTools flow, then push the resolution); wait for CI to go
      green again before merging. Do **not** auto-merge if any
      check is red, the test pass was skipped, conflicts are
      unresolved, or a reviewer has requested changes — fix the
      issue and re-test before merging.
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
      5. Tear down this branch's local dev container (see the
         "Cleanup" bullet under *Dev deployment* below).
      A merged branch that still has a worktree directory, a
      worktree-list entry, a local ref, a remote ref, or a running
      dev container counts as **not cleaned up** — finish all five
      before starting new work or closing the session. Before
      opening a new feature, run `git worktree list` and
      `podman ps -a --filter name=gnrs-dev-` and confirm there are
      no leftovers from already-merged branches; if there are,
      clean them up first.

## Dev deployment (parallel agents)

`gnrs` has **no shared or public deployment** — multiple agents work
in parallel, each in its own worktree, and each tests against its
**own local container**. There is nothing to clobber on a remote,
but two agents running containers with the same name, port, or
volume on the local machine *would* collide, so every dev container
is namespaced by branch slug.

Rules:

- **Source = your worktree**, not the repo root and not `gnrs-evan`.
  Build the image from `.claude/worktrees/<name>/`, with the
  worktree checked out at the feature branch you are actively
  committing to, so the image contains the in-progress code
  (including uncommitted edits you want to smoke-test).
- **Namespacing**: derive the container, image, and volume names
  from your worktree's branch slug so two agents never collide. For
  branch `feat/<slug>`:
  - container: `gnrs-dev-<slug>`
  - image:     `gnrs-dev-<slug>:latest`
  - volume:    `gnrs-data-dev-<slug>` (separate from the default
    compose volume `gnrs-data`)
- **Port**: pick a free **local** port that no other dev container
  and no local prod-style run is using. Check first
  (`ss -tlnp | grep -E ":(18[3-9])[0-9][0-9]"` or similar) and pick
  a free port in the `18300`–`18999` range. Record the port you
  chose in the PR description.
- **Bind to loopback** (`127.0.0.1:<port>`). The shared headless
  Chrome runs on the same machine, so loopback is reachable — and
  `localhost`/`127.0.0.1` is exempt from Chrome's HTTPS-First
  upgrade, so plain HTTP just works (see `CHROME_DEVTOOLS.md`).

Typical invocation from inside your worktree:

    podman build -t gnrs-dev-<slug>:latest .
    podman volume create gnrs-data-dev-<slug>
    podman run -d --name gnrs-dev-<slug> \
      --env-file .env -e PORT=8080 \
      -p 127.0.0.1:<your-port>:8080 \
      -v gnrs-data-dev-<slug>:/app/data \
      gnrs-dev-<slug>:latest
    podman logs --tail 50 gnrs-dev-<slug>

`docker` works identically — the `Dockerfile` and `docker-compose.yml`
are Podman-compatible (see [`PODMAN.md`](./PODMAN.md)). The explicit
`-e PORT=8080` overrides whatever `PORT` your `.env` sets so the
in-container listen port is always `8080` and the `-p …:8080`
mapping is deterministic.

To pick up new commits or edits, rebuild and recreate the
container:

    podman build -t gnrs-dev-<slug>:latest .
    podman rm -f gnrs-dev-<slug>
    # then re-run the `podman run …` above

- **Cleanup**: when the PR is merged or abandoned, tear the dev
  container down in the same step you remove the local worktree:

      podman rm -f gnrs-dev-<slug>
      podman volume rm gnrs-data-dev-<slug>
      podman rmi gnrs-dev-<slug>:latest

For the test flow itself (steps to drive through the UI, what to
capture for the PR), follow `TEST.md` against your dev URL
(`http://localhost:<your-port>`). If you cannot build or run the
dev container, say so explicitly instead of claiming the feature
is browser-tested.

## What lives where

| Concern                            | File                                |
| ---------------------------------- | ----------------------------------- |
| Branch / PR / commit-message rules | [`RULES.md`](./RULES.md)            |
| Feature test procedure             | [`TEST.md`](./TEST.md)              |
| Chrome DevTools (parallel agents)  | [`CHROME_DEVTOOLS.md`](./CHROME_DEVTOOLS.md) |
| Promotion / PR to `main` workflow  | [`RELEASE.md`](./RELEASE.md)        |
| Remote deploy (operator-invoked)   | [`deploy/DEPLOY.md`](./deploy/DEPLOY.md) |
| Stack, layout, env vars, API       | [`README.md`](./README.md)          |
| Running under Podman               | [`PODMAN.md`](./PODMAN.md)          |

When `RULES.md` or `TEST.md` conflict with assumptions baked into
your general training, the files in this repository win.
