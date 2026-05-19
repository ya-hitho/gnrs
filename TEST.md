# FEATURE TEST RULES

_If you are an AI (not human) reading this, follow these rules every
time you build, change, or fix a feature in this repository._

## TL;DR

After implementing a feature, **you must exercise it through Chrome
DevTools against your own local dev container** before you mark the
work done, open a PR, or hand back to the user. Type-checking and
`go test` confirm code correctness, not feature correctness.

The Chrome DevTools MCP server is available — use the
`mcp__chrome-devtools__*` tools. `gnrs` has no shared or public
deployment, so you test against the namespaced local container you
built from your worktree (see `CLAUDE.md` → *Dev deployment*), not
against a long-running shared instance another agent might be using.

## Test target

Your dev container, built from your worktree and published on a
loopback port you chose (see `CLAUDE.md` → *Dev deployment*):

| Field        | Value                                  |
| ------------ | -------------------------------------- |
| Base URL     | `http://localhost:<your-port>`         |
| Login page   | `http://localhost:<your-port>/login`   |
| API base     | `http://localhost:<your-port>/api`     |
| Health probe | `http://localhost:<your-port>/healthz` |

The container runs the same single-binary image documented in
`README.md`, built from your worktree's source — so it reflects your
in-progress code, including uncommitted edits you want to smoke-test.

## Required test flow for any new / changed feature

Run these steps with the Chrome DevTools MCP tools. Do **not** skip
steps — a green typecheck is not a substitute for actually clicking
through the feature.

1. **Open a page** at `http://localhost:<your-port>` (`new_page` or
   `navigate_page`).
2. **Confirm the page rendered** with `take_snapshot` (DOM) or
   `take_screenshot` (visual). Note the title and that the SPA bundle
   loaded.
3. **Sign in** through the form using `fill_form` / `click`. Use the
   seed admin credentials from your worktree's `.env`
   (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`);
   never paste secrets into source files or commits.
4. **Drive the feature end-to-end** — navigate to the route it lives
   on, fill its inputs, submit, paginate, etc. — using `click`,
   `fill`, `type_text`, `press_key`, `hover`, `wait_for` as needed.
   Exercise both the happy path and at least one failure path
   (validation error, 4xx response, empty state, …).
5. **Watch the network**: call `list_network_requests` and
   `get_network_request` for the API calls the feature triggers.
   Verify status codes, that the response shape matches what the SPA
   expects, and that requests go to the right `apiBase` (`/api/...`).
6. **Watch the console**: `list_console_messages` must contain no
   new errors or unhandled-promise warnings introduced by the
   change. Capture any noise that pre-existed.
7. **Check for regressions** in adjacent flows you might have
   touched (login, students list, role-gated routes for `admin` vs
   `staff`). One quick sweep through neighbouring screens is enough.
8. **Sign out** with the logout control and confirm the session
   cookie is cleared (re-hitting a protected route should redirect
   to `/login`).

If any step fails, fix the code, rebuild the dev container, and
rerun the flow from step 1. Do not paper over errors with retries
or `wait_for` loops.

## When you cannot build or run the dev container

If you cannot stand up your local dev container (image build
failure, `podman`/`docker` unavailable, an unresolvable port
conflict, or the MCP tool is unavailable):

- **Do not claim the feature is browser-verified.**
- Say so explicitly in your end-of-turn summary: "couldn't run a
  dev container, feature is not browser-tested."
- Still run `make test` and `make typecheck`, and report those
  results separately.
- The user decides whether to proceed without a browser test.

## What to include in the PR description

For every PR that changes user-visible behaviour, the description
must include:

- A short "Tested via Chrome DevTools" section.
- The dev URL and port you used (`http://localhost:<your-port>`).
- The user flow you exercised (bullet list of clicks/inputs).
- Any screenshots or network/console excerpts that prove the
  feature works — `take_screenshot` output and copy-paste from
  `list_network_requests` is fine.
- An explicit note if a step was skipped and why.

Backend-only changes that do not affect the UI (e.g. a new
migration that nothing reads yet) are exempt, but say so in the PR.
