# `docs/` — Documentation Index & Authoring Convention

> **Audience:** Maintainers of `gnrs` — human and LLM agents.
> **Purpose:** Define *where* documentation lives, *how* it is organized, and
> *how multiple agents working in parallel* add to it without colliding. This
> file is both the **table of contents** for `docs/` and the **style guide** for
> anything written into it.

`gnrs` keeps two distinct kinds of Markdown, in two distinct places. Knowing
which is which is the whole "tidy" rule:

| Kind | Lives at | Examples | Who reads it |
|---|---|---|---|
| **Operational / agent-process docs** | **repo root** | [`CLAUDE.md`](../CLAUDE.md), [`RULES.md`](../RULES.md), [`TEST.md`](../TEST.md), [`CHROME_DEVTOOLS.md`](../CHROME_DEVTOOLS.md), [`RELEASE.md`](../RELEASE.md), [`PODMAN.md`](../PODMAN.md), [`README.md`](../README.md), [`deploy/DEPLOY.md`](../deploy/DEPLOY.md) | An agent at the start of a task |
| **Reference / design docs** | **`docs/`** (this tree) | [`schema.md`](./schema.md) | An agent implementing or changing a feature |

The root stays small and is *only* the workflow contract (how to branch, test,
PR, deploy). Everything that explains *the system itself* — schema, design
notes, deep-dives, multi-file feature analyses — goes under `docs/`. Do **not**
add a new design or reference document to the repo root; add it here and link it
from the catalog below.

---

## File catalog

### Reference docs (flat files in `docs/`)

- [`schema.md`](./schema.md) — Authoritative PostgreSQL schema reference. Reconstructs
  the live schema after the most recent migration from the files in
  [`internal/store/migrations/`](../internal/store/migrations/), which are the
  source of truth. Covers the unified `users` table, the Generus/Pengajar
  projection model, attendance, classes & sessions, curriculum, content
  libraries, achievements, settings, the enum catalog, and the full migration
  timeline.

### Design analyses (numbered subdirectories)

_None yet._ When a topic needs more than one file (a multi-part feature design,
a migration plan, a subsystem deep-dive), create a **numbered subdirectory**
with its own `00-INDEX.md`, following *How to read a numbered analysis* below.
Register the subdirectory here when you create it.

---

## How `docs/` is organized

Two shapes, pick the smaller one that fits:

1. **A single reference file** — `docs/<topic>.md` (e.g. `schema.md`,
   `architecture.md`). Use this for one self-contained subject.
2. **A numbered analysis directory** — `docs/<topic>/NN-*.md` with a
   `00-INDEX.md` master file. Use this when one subject needs several files
   that build on each other (a feature design split into domain model, API,
   frontend, migration, rollout, etc.).

### How to read a numbered analysis

Numbered directories are partitioned into **phases** by the tens digit, so the
file list sorts into a reading order and leaves room to insert later:

| Numbers | Phase | Typical content |
|---|---|---|
| `00`–`02` | Framing | INDEX, overview, comparison matrix |
| `10`–`19` | Foundational | identity, data model, core invariants |
| `20`–`29` | Core features | the primary capabilities |
| `30`–`39` | Engagement / secondary features | real-time, notifications, files |
| `40`–`49` | Advanced domain | deeper domain rules |
| `50`–`59` | Cross-cutting | security, frontend evolution, i18n |
| `60`–`69` | Operations | testing, migration, rollout |
| `90` | Roadmap | phased delivery plan |
| `99` | Glossary | terminology (Indonesian ↔ English) and acronyms |

Read top-to-bottom for a full tour, or jump to one number for one capability.
Gaps between numbers are intentional — they leave space to slot a new file in
without renumbering siblings.

---

## Authoring conventions

Every document under `docs/` follows these so the corpus reads as one voice and
stays machine-navigable for the next agent:

- **TL;DR first.** Lead each substantial doc with a one-paragraph summary plus a
  short bullet checklist of what it covers.
- **LLM frontmatter** on each file in a numbered analysis: a leading block
  listing `topic`, `depends-on`, `enables`, and `key-concepts` so an agent can
  plan its reads without opening every file.
- **Current state vs Target state.** Design docs separate what `gnrs` does today
  from what is proposed. Never blur the two — a reader must be able to tell
  shipped behavior from a plan.
- **Code-grounded, not invented.** Document what the code/SQL actually does.
  Reconstruct schema from the real migrations; cite the file and symbol
  (`internal/store/users.go`, `model.User`). Flag anything you could not verify
  rather than guessing.
- **Data model** changes are shown as SQL DDL **and** the matching Go struct.
- **API contract** uses the existing JSON envelope: the resource on success,
  `{"error":{"code":"...","message":"..."}}` on failure.
- **Stack-accurate examples.** Backend examples target the real stack (Go + chi
  + PostgreSQL via `jackc/pgx/v5`, `golang-migrate`, `golang-jwt`, ULIDs,
  `log/slog`); frontend examples target React 18 + TypeScript + Vite + TanStack
  Router/Query + Tailwind v3 in `web/app/`. New dependencies are flagged
  explicitly with rationale.
- **Migrations** follow the existing `internal/store/migrations/NNN_*.{up,down}.sql`
  pattern and the next sequential number. When you change the schema, update
  [`schema.md`](./schema.md) in the same PR.
- **Cross-references are relative links:** `[schema](./schema.md)`,
  `[migrations](../internal/store/migrations/)`. Never hard-code absolute paths
  or a contributor's machine layout.

---

## Parallel-agent etiquette for docs

`gnrs` is worked by **multiple agents in parallel**, each in its own git
worktree on one of the two integration tracks (`gnrs-evan` / `jalur-yasril` —
see [`CLAUDE.md`](../CLAUDE.md)). The same discipline that keeps code merges
clean keeps docs clean:

- **One file per concern.** Prefer many small, focused files over one giant doc.
  Two agents editing two different files never conflict; two agents editing the
  same file do. This is why analyses are split into numbered files.
- **Claim a number, leave gaps.** When adding a file to a numbered analysis,
  pick the next free number in its phase band and leave gaps — don't renumber a
  sibling another agent may be editing.
- **Update this catalog in the same commit** that adds a doc, so the index never
  drifts from reality. The catalog is the one shared file; keep its edits small
  and append-only (add your row) to minimize conflicts.
- **Don't edit another agent's in-flight doc.** If your change needs theirs,
  cross-link and note the dependency rather than reaching into their file.
- **Keep the root clean.** New design/reference material goes under `docs/`,
  never as another top-level `*.md` — that keeps the entrypoint set stable for
  every agent that starts a task.
- **A doc change is still a normal task:** worktree → step-by-step commits → PR
  to your track. A docs-only PR has no Chrome DevTools pass to run; say so
  explicitly in the PR instead of leaving the test section blank.

---

## Adding a document — checklist

1. Decide the shape: a flat `docs/<topic>.md`, or a numbered `docs/<topic>/`
   directory with a `00-INDEX.md`.
2. Write it following *Authoring conventions* above (TL;DR, current vs target,
   code-grounded, relative links).
3. Add a row to the **File catalog** in this file pointing at the new doc.
4. If it documents a schema change, update [`schema.md`](./schema.md) too.
5. Commit the doc and the catalog update together; open the PR against your
   track per [`RULES.md`](../RULES.md).
