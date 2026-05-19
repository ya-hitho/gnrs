# Promotion to `main` — the release workflow

> **TL;DR for the LLM agent.** Every other workflow in this repo
> targets `gnrs-evan`. **This** workflow is the *only* time you are
> allowed to open a PR against `main`. Do not invoke it unless the
> user has explicitly asked for it (see §1).

## 1. When to use this doc

Use this workflow **only** when the user explicitly asks to:

- "PR to `main`"
- "release to `main`"
- "promote `gnrs-evan` to `main`"
- or any obvious paraphrase of the above.

For everything else — feature work, bug fixes, docs, refactors —
follow `CLAUDE.md` and target `gnrs-evan`. Do **not** open a PR to
`main` on your own initiative just because a change "feels
release-shaped".

## 2. The transition-branch concept

`gnrs-evan` is the integration branch — it carries the full set of
LLM-agent rule/guide files (`CLAUDE.md`, `RULES.md`, `TEST.md`,
`CHROME_DEVTOOLS.md`, and this `RELEASE.md`). Those files describe
how *we* run the project: the worktree workflow, commit-message
style, the Chrome-DevTools test procedure, and this release
plumbing. None of that is relevant to someone who forks the repo
just to build and run the app.

A release snapshot on `main` should instead read as
**deploy-anywhere**: the application source plus the generic
container surface (`Dockerfile`, `docker-compose.yml`, the
`make docker` / `make docker-run` targets, `.env.example`, and
`PODMAN.md`) — and nothing agent-facing. Someone forking the repo
can build the image and run it under whatever orchestration they
prefer.

`gnrs` has no remote production deployment, no Cloudflare tunnel,
and no `deploy.sh`, so — unlike a typical promotion workflow —
there is **no prod-orchestration to strip**. The compose file,
Makefile, and `.env.example` here are already portable and stay on
`main` unchanged. The *only* thing the transition branch removes is
the LLM-agent doc set, plus any prose in `README.md` that points at
those now-deleted docs.

To do that you cut a short-lived **transition branch**
(`release/<slug>`) off `gnrs-evan`, apply the cleanup checklist
(§4) on the transition branch only, and PR *that* into `main`.
`gnrs-evan` keeps the full agent-doc set; `main` becomes the
portable snapshot.

The transition branch is single-use. After the PR merges (or is
abandoned), the branch is deleted and the next release cuts a
fresh one.

## 3. Step-by-step workflow

1. **Pull `gnrs-evan` first**, then cut the worktree:

       cd <repo root>
       git checkout gnrs-evan
       git pull --ff-only origin gnrs-evan
       git worktree add .claude/worktrees/release-<slug> \
         -b release/<slug> gnrs-evan
       cd .claude/worktrees/release-<slug>

   Pick `<slug>` so it is descriptive of the release window
   (e.g. `release/2026-05-19` or `release/q2-cleanup`). Slug
   only — no spaces, no slashes beyond the `release/` prefix.

   **If `main` does not exist yet** (the repo has never had a
   release), create it from the current integration tip before
   you can open a PR against it:

       git push origin gnrs-evan:main

   The transition branch's PR will then carry only the snapshot
   cleanup diff. On every subsequent release `main` already
   exists, so skip this.

2. **Apply the cleanup checklist in §4.** Touch only the files
   listed there. Do not pull in unrelated edits.

3. **Commit step-by-step**, one concern per commit, per `RULES.md`.
   Example sequence:

       chore(release): drop LLM-agent docs from main
       docs(readme): strip pointers to agent docs

   Conventional-commit subjects, imperative mood, ≤ 50 chars, no
   trailing punctuation. Order the deletes before the doc edits.

4. **Test (static checks)**:

       make test
       make typecheck

   These confirm the source carries over unchanged. A Chrome
   DevTools UI test pass against a dev build of the snapshot is
   **also** required — see step 7.

5. **Verification grep** — before opening the PR, from inside the
   worktree, confirm no surviving file still points at the
   deleted agent docs:

       git grep -nE 'CLAUDE\.md|RULES\.md|TEST\.md|CHROME_DEVTOOLS\.md|RELEASE\.md'

   Expect **zero hits** (the agent docs are all deleted on the
   transition branch by this point, so nothing should reference
   them). Paste the result into the PR's "Verification grep"
   block.

6. **Open the PR against `main`**:

       gh pr create --base main \
         --title 'release: deploy-anywhere snapshot (<slug>)' \
         --body "$(cat <<'EOF'
       <fill in the template from §5>
       EOF
       )"

   The PR's **Summary** block must be a feature list — what
   `main` *gains* if this PR merges, derived from
   `git log --oneline main..HEAD` and grouped by user-facing
   area. The cleanup mechanics (which files got deleted) live in
   a separate "Release-only cleanups" section lower down, not in
   the Summary. Keep `gnrs-evan` out of the title, Summary, and
   body. The template in §5 is already worded that way; follow
   it.

   This is the only sanctioned `--base main` PR in the repo's
   workflow. Every other PR still targets the integration branch.

7. **Build the snapshot in a local dev container and verify via
   Chrome DevTools.** This is the runtime smoke test that
   guarantees the cleanup did not break the deploy-anywhere path
   a fork would follow. Run it *after* `gh pr create`.

   The pattern matches the per-feature dev container in
   `CLAUDE.md` (namespaced container / volume / port, loopback
   bind), but built from this transition branch's source — which
   no longer contains the agent docs:

       # From inside the worktree. Pick a free local port in the
       # 18300–18999 range; check first:
       ss -tlnp | grep -E ":(18[3-9])[0-9][0-9]" \
         || echo "no collisions in range"

       podman build -t gnrs-release-<slug>:latest .
       podman volume create gnrs-data-release-<slug>
       podman rm -f gnrs-release-<slug> 2>/dev/null || true
       podman run -d --name gnrs-release-<slug> \
         --env-file .env -e PORT=8080 \
         -p 127.0.0.1:<port>:8080 \
         -v gnrs-data-release-<slug>:/app/data \
         gnrs-release-<slug>:latest
       podman logs --tail 50 gnrs-release-<slug>

   Container, volume, and image tag are all suffixed with the
   release slug so this stack cannot collide with any parallel
   agent's per-feature dev container. `docker` works identically.

   Then drive the full Chrome DevTools flow from `TEST.md`
   against `http://localhost:<port>`. `TEST.md` itself is deleted
   on the transition branch, but it still exists on `gnrs-evan` —
   read the procedure from your main checkout and apply it
   against the dev URL.

   **Pass criterion: feature parity with `gnrs-evan`.** Every
   user-facing capability listed in the Summary block of the PR
   body must work end-to-end on the snapshot, exactly as it does
   on `gnrs-evan`. Login, navigation, each bullet-listed feature,
   role-gated routes for `admin` vs `staff`, logout — all of it.
   If a feature regresses, the cleanup broke something — fix it
   on the transition branch, `git push` to update the PR, rebuild
   the container, and re-test.

   After the UI test passes, fill in the `Tested via Chrome
   DevTools` section in the PR body (the template in §5 covers
   the shape) — use `gh pr edit --body-file <path>` or the GH web
   editor. Capture the dev URL, the port, the user flow you
   exercised, screenshots, and the network / console excerpts.

   The dev container stays running until the post-merge cleanup
   in step 9 — keep it up while the user reviews so they can poke
   at it directly if they want.

8. **Do NOT auto-merge.** A PR to `main` is a release-readiness
   moment that the user owns. Wait for them to approve and merge
   it themselves.

   - If CI goes red, fix and push the resolution. Stay on the
     same transition branch — do **not** cut a new one. Rebuild
     the container and re-run the UI flow.
   - If `main` moves under you and the PR develops conflicts,
     resolve them in the worktree
     (`git fetch origin && git merge origin/main`), re-run the
     static tests in step 4 and the UI test in step 7, push the
     resolution.

9. **After merge, clean up — local refs *and* the dev container.**

       cd <repo root>
       git worktree remove .claude/worktrees/release-<slug>
       git branch -D release/<slug>
       # delete the remote ref if --delete-branch didn't catch it
       git ls-remote --heads origin release/<slug> \
         && git push origin --delete release/<slug>
       git fetch --prune origin

       # Tear down the dev container from step 7:
       podman rm -f gnrs-release-<slug>
       podman volume rm gnrs-data-release-<slug>
       podman rmi gnrs-release-<slug>:latest

10. **No prod deploy from this merge.** `gnrs` has no shared
    production deployment — merging the release PR ships the
    snapshot to `main` and nothing else. The dev container in
    step 7 was a verification stack; the teardown in step 9
    removes it.

## 4. Cleanup checklist

Each item below names a specific artefact that must be neutralized
before the transition branch can land on `main`. The deletes
(§4.1–§4.5) come first; the file-edit (§4.6) comes after.

`gnrs` has no prod-orchestration to remove — `docker-compose.yml`,
the `Makefile` targets, `.env.example`, and `PODMAN.md` are already
portable and **stay on `main` unchanged**. Only the LLM-agent docs
are integration-only.

### 4.1 `CLAUDE.md` — **delete**

`CLAUDE.md` is the instruction sheet for LLM agents working in
this repo (worktree workflow, per-session lifecycle, dev-container
rules, etc.). It is integration-branch-only — a fork has its own
contributor model and does not need ours. Delete the file:

    git rm CLAUDE.md

### 4.2 `RULES.md` — **delete**

`RULES.md` codifies our branch / PR / commit-message rules for
LLM agents. Same reasoning as §4.1 — useful to *us*, noise to a
fork. Delete the file:

    git rm RULES.md

### 4.3 `TEST.md` — **delete**

`TEST.md` is our Chrome-DevTools test procedure for LLM agents.
Not relevant to a fork. Delete the file:

    git rm TEST.md

### 4.4 `CHROME_DEVTOOLS.md` — **delete**

`CHROME_DEVTOOLS.md` covers how parallel agents share one headless
Chrome. Integration-only. Delete the file:

    git rm CHROME_DEVTOOLS.md

### 4.5 `RELEASE.md` — **delete**

This very document is the LLM-facing release workflow for
promoting `gnrs-evan` to `main`. On `main` itself, no agent needs
it — `main` is a one-way snapshot, not where the release workflow
runs. Delete the file:

    git rm RELEASE.md

The transition branch is cut from `gnrs-evan`, where `RELEASE.md`
still exists, so the agent driving the release still reads this
file normally — only the snapshot on `main` loses it.

### 4.6 `README.md`

Remove any prose pointing readers at `CLAUDE.md`, `RULES.md`,
`TEST.md`, `CHROME_DEVTOOLS.md`, or `RELEASE.md` — those files are
gone on `main`. In particular, drop the "Project rules" section
that links `RULES.md`.

Keep everything else: the stack overview, build/run instructions,
the Docker and Podman story, the env-var table, and the API
surface all describe the portable app and stay.

### 4.7 What stays on `main`

After §4.1–§4.6 land, `main` retains exactly the deploy-anywhere
surface a fork needs — and nothing else:

- `Dockerfile` — generic container build.
- `docker-compose.yml` — generic single-service stack
  (`gnrs:latest` image, named `gnrs-data` volume, no tunnel, no
  remote host).
- `Makefile` — `docker` / `docker-run` plus dev/test/typecheck
  helpers.
- `.env.example` — runtime env vars only.
- `README.md` — project overview, stack, build/run instructions,
  with the agent-doc pointers stripped.
- `PODMAN.md` — generic Podman how-to, useful to a fork.
- Application source (Go + React) — unchanged.

`gnrs-evan` continues to carry the full set of LLM-agent docs
(`CLAUDE.md`, `RULES.md`, `TEST.md`, `CHROME_DEVTOOLS.md`,
`RELEASE.md`) on top of that surface, because *that* branch is
where the project is actually developed.

## 5. PR message template

Use this template verbatim for the release PR body. Fill the
placeholders from the actual diff before calling `gh pr create`.
The template is deliberately framed around *what users gain by
merging this PR*. Two non-negotiables:

1. **The Summary block lists the features being added** —
   nothing else. No "we cut a snapshot" / "we dropped the agent
   docs" meta-bullets. A reviewer reading only the Summary should
   come away knowing which capabilities `main` is gaining.
2. **No mention of the integration branch by name** anywhere in
   the title, Summary, or body.

The cleanup mechanics still need to be documented — they live in
the "Release-only cleanups" section further down.

```markdown
## Summary

<Bulleted list of features being added to `main` by this PR,
derived from `git log --oneline main..HEAD` and grouped by
user-facing area. The reader should finish this section knowing
what new capabilities `main` will have after merge — *not* what
files this PR deleted (those go in "Release-only cleanups"
below).

Aim for ~5–10 bullets. Lead with the largest user-visible change;
group related commits under one bullet. Link the full log
(`main..HEAD`) at the end of the section if there is overflow.>

## Release-only cleanups

In addition to the features above, this transition branch applies
the deploy-anywhere cleanup so `main` reads as a portable
snapshot. None of these changes touch runtime code.

- **LLM-agent docs removals**:
  - Deleted `CLAUDE.md` — agent instructions, integration-only.
  - Deleted `RULES.md` — branch / PR / commit-message rules,
    integration-only.
  - Deleted `TEST.md` — Chrome-DevTools test procedure,
    integration-only.
  - Deleted `CHROME_DEVTOOLS.md` — shared-browser etiquette,
    integration-only.
  - Deleted `RELEASE.md` — this release workflow itself,
    integration-only.
- `README.md`: stripped the prose / "Project rules" section
  pointing readers at the now-deleted agent docs.

## What is NOT changing

- Runtime code authored on this transition branch — none. The
  feature commits in the Summary above came from the integration
  branch unchanged; this branch only deletes agent-doc files and
  edits `README.md`.
- The container surface — `Dockerfile`, `docker-compose.yml`, the
  `Makefile` targets, `.env.example`, and `PODMAN.md` are already
  portable and carry over unchanged.
- The development workflow itself — unchanged on the integration
  branch, where the agent docs continue to live.

## Cleanup checklist (per `RELEASE.md` §4)

- [ ] `CLAUDE.md` deleted (§4.1)
- [ ] `RULES.md` deleted (§4.2)
- [ ] `TEST.md` deleted (§4.3)
- [ ] `CHROME_DEVTOOLS.md` deleted (§4.4)
- [ ] `RELEASE.md` deleted (§4.5)
- [ ] `README.md` agent-doc pointers stripped (§4.6)

## Verification grep

\`\`\`
$ git grep -nE 'CLAUDE\.md|RULES\.md|TEST\.md|CHROME_DEVTOOLS\.md|RELEASE\.md'
<paste result — expect zero hits>
\`\`\`

## Tested via Chrome DevTools

<Fill in after `RELEASE.md` §3 step 7. The shape (per `TEST.md`):

- **Dev URL** — `http://localhost:<port>` (the snapshot, in its
  own container / volume / image, all suffixed with the release
  slug).
- **Build path** — `podman build` / `docker build` against this
  branch's `Dockerfile`. A green UI test here is also a green
  "fork can build and run this snapshot" signal.
- **User flow exercised** — login, navigation, each feature
  listed in the Summary above, role-gated routes for `admin`
  vs `staff`, logout. Drove both happy and at least one failure
  path per feature, per `TEST.md`.
- **Pass criterion met** — feature parity with the integration
  branch; every Summary bullet behaves identically on the
  snapshot.
- **Network / console excerpts** — paste the relevant
  `list_network_requests` rows; confirm `list_console_messages`
  reports no new errors introduced by the cleanup.
- **Screenshots** — attach `take_screenshot` output for each
  feature.>

## Test plan

- [x] `make test` — pass
- [x] `make typecheck` — pass
- [x] UI test pass — see "Tested via Chrome DevTools" above.
- [ ] Reviewer-confirmed: `main` after merge is buildable on a
      fresh host using `make docker && make docker-run` plus a
      filled-in `.env`.
```

## 6. Quick reference

| Step                    | Command / location                                  |
| ----------------------- | ---------------------------------------------------- |
| Cut transition branch   | `git worktree add … -b release/<slug> gnrs-evan`     |
| Create `main` (1st time)| `git push origin gnrs-evan:main`                     |
| Cleanup checklist       | §4 of this doc                                       |
| Tests (static)          | `make test`, `make typecheck`                        |
| Verification grep       | §3 step 5                                            |
| Open PR                 | `gh pr create --base main`                           |
| Dev build + UI test     | §3 step 7 — `http://localhost:<port>`, `TEST.md` flow|
| PR body                 | Template in §5 (fill UI section after dev build)     |
| Merge                   | **User-driven** — do not auto-merge                  |
| Prod deploy?            | No — `gnrs` has no shared production deployment      |
| Clean up after merge    | §3 step 9 — local refs + dev container               |
