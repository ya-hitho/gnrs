# PPG Dashboard

A small school dashboard with user auth and student records. Single-binary
Go backend embedding a React SPA, PostgreSQL for storage.

## Stack

- **Backend** – Go 1.22, [chi](https://github.com/go-chi/chi), PostgreSQL
  (`jackc/pgx/v5` via `database/sql`), embedded migrations (`golang-migrate`),
  JWT in an httpOnly cookie (`golang-jwt`), bcrypt, structured logs
  (`log/slog`). The store keeps SQLite-style `?` placeholders; a thin driver
  wrapper rewrites them to PostgreSQL `$n` ordinals.
- **Frontend** – Vite 5, React 18, TypeScript (strict), TanStack Router
  (file-based, type-safe), TanStack Query, Tailwind v3, React Hook Form
  + Zod, lucide-react.
- **Packaging** – Multi-stage Docker build, single static binary (pure Go,
  CGO disabled) with the SPA embedded via `go:embed`. Debian base.

## Layout

```
cmd/server/         entrypoint
internal/
  auth/             JWT issue/verify, middleware, role gates
  config/           env-var config
  handler/          HTTP handlers (auth, students)
  httpx/            JSON helpers
  model/            domain types (User, Student)
  store/            PostgreSQL queries + embedded migrations
web/
  app/              Vite + React SPA source
  dist/             SPA build output (generated; only .gitkeep tracked)
  embed.go          go:embed wrapper for the SPA
```

## Required toolchain

- **Local dev** – Go ≥ 1.22, Node ≥ 20, pnpm 9 (managed via corepack), and a
  reachable PostgreSQL (≥ 14). Point `DATABASE_URL` at it; the app creates its
  own schema on first boot via `golang-migrate`.
- **Docker only** – just Docker; the image builds Node + Go itself and the
  compose stack ships its own `postgres:17`.

## Quick start (Docker)

```bash
cp .env.example .env          # edit JWT_SECRET (≥ 32 chars), seed admin
docker compose up --build
# → http://localhost:8080
```

The compose stack runs a `postgres:17` service (data in the `gnrs-db`
volume); uploaded photos persist in the `gnrs-data` volume. `DATABASE_URL`
defaults to the bundled `db` service.

## Quick start (local dev)

```bash
# install frontend deps
pnpm --dir web/app install

# run API on :8080 and Vite on :5173 in parallel
make dev
# → SPA: http://localhost:5173 (proxies /api to :8080)
```

`DEV=1` makes the Go server skip the embedded SPA so Vite owns the
frontend.

## Building a single binary locally

```bash
make build         # builds SPA into web/dist/, then Go binary at ./server
JWT_SECRET=... ./server
```

## Tests

```bash
# DB-backed store/handler tests need a throwaway PostgreSQL; they create and
# drop an isolated schema per test and SKIP when TEST_DATABASE_URL is unset.
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/gnrs_test?sslmode=disable \
  go test ./...
pnpm --dir web/app typecheck  # frontend type-check
```

## Configuration

All runtime config is via env vars. See [`.env.example`](./.env.example).

| Variable               | Required | Default            | Notes                                                     |
| ---------------------- | -------- | ------------------ | --------------------------------------------------------- |
| `JWT_SECRET`           | yes      | —                  | HMAC secret, ≥ 32 bytes (`openssl rand -hex 32`)          |
| `JWT_TTL`              | no       | `24h`              | Go duration                                               |
| `COOKIE_SECURE`        | no       | `false`            | Set `true` behind HTTPS                                   |
| `DATABASE_URL`         | no       | `postgres://postgres:postgres@localhost:5432/gnrs?sslmode=disable` | PostgreSQL DSN |
| `DATA_DIR`             | no       | `./data`           | Base dir for uploaded photos (`$DATA_DIR/photos`)         |
| `PORT`                 | no       | `8080`             | HTTP listen port                                          |
| `DEV`                  | no       | `false`            | Skip serving the embedded SPA (Vite handles frontend)     |
| `SEED_ADMIN_EMAIL`     | no       | —                  | First-boot admin (created only if `users` is empty)       |
| `SEED_ADMIN_PASSWORD`  | no       | —                  | First-boot admin password                                 |

## API surface

```
POST   /api/auth/login        # body: {email, password}
POST   /api/auth/logout
GET    /api/auth/me

GET    /api/students          ?q=&limit=&offset=
POST   /api/students          (admin)
GET    /api/students/{id}
PATCH  /api/students/{id}     (admin)
DELETE /api/students/{id}     (admin)

GET    /healthz
```

Errors follow `{"error":{"code":"...","message":"..."}}`.

## Roles

- `admin` – full CRUD on students.
- `staff` – read-only.

Role is stored on the user row; the seed admin is created with `admin`.

## Notes

- `pnpm build` writes into `web/dist/`. That directory is gitignored
  (only `.gitkeep` is tracked) — don't commit build output.
- TanStack Router generates `web/app/src/routeTree.gen.ts` on `vite dev`
  / `vite build`. It's gitignored.
- The container runs as a non-root user (`app`, UID 1001). If you
  bind-mount `./data` into the container, chown the host directory
  to UID 1001 first; otherwise use the named volume in the compose
  file.

## Project rules

If you are an AI agent working in this repo, start with
[`CLAUDE.md`](./CLAUDE.md) — it is the entry point and links the rest:
[`RULES.md`](./RULES.md) (branch + worktree workflow, commit format),
[`TEST.md`](./TEST.md) (Chrome DevTools test pass),
[`CHROME_DEVTOOLS.md`](./CHROME_DEVTOOLS.md) (shared-browser etiquette),
and [`RELEASE.md`](./RELEASE.md) (promotion to `main`).
