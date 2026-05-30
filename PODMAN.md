# Running GNRS with Podman

The `Dockerfile` and `docker-compose.yml` are Podman-compatible: Podman builds
the `Dockerfile` natively and `podman compose` reads `docker-compose.yml`
as-is. GNRS runs **all of its containers (postgres + app, + cloudflared in
prod) inside one podman pod** — `deploy/dev-pod.sh` for local feature testing,
`deploy/deploy.sh` for the production pod on the remote (see
[`deploy/DEPLOY.md`](./deploy/DEPLOY.md)). This guide covers the Podman-specific
setup and the pod/compose commands.

**Verified on this machine:** Podman 5.8.2, `podman-machine-default`
(WSL backend, running). `.env` is present and configured (host port `8300`).

## One-time setup — install a Compose provider

**✓ Already installed on this machine** — `docker-compose.exe` (the official
Docker Compose binary) is in Podman's program folder and `podman compose` uses
it automatically. The steps below are kept for reference and other machines.

`podman compose` is a thin wrapper; it needs an external Compose engine.
Install the Docker Compose v2 binary — a single self-contained `.exe`, no
Docker daemon and no Python — into Podman's program folder, which is already
on `PATH`:

```powershell
$dest = "$env:LOCALAPPDATA\Programs\Podman\docker-compose.exe"
Invoke-WebRequest `
  -Uri "https://github.com/docker/compose/releases/latest/download/docker-compose-windows-x86_64.exe" `
  -OutFile $dest
podman compose version    # should now print a version
```

`podman compose` automatically points this engine at the Podman socket — no
Docker Desktop required.

## Run it

From `d:\Podman\GNRS`:

```powershell
podman compose up --build -d     # build the image and start, detached
podman compose logs -f           # follow logs
```

Open **http://localhost:8300** (host port `8300` from `.env`, mapped to the
container's `8080`).

Public access (production-style) is an opt-in `tunnel` profile that adds a
`cloudflared` sidecar — see [`deploy/DEPLOY.md`](./deploy/DEPLOY.md). With a
`CLOUDFLARE_TUNNEL_TOKEN` in `.env`:

```powershell
podman compose --profile tunnel up --build -d
```

Stop / clean up:

```powershell
podman compose down              # stop; keep the gnrs-data / gnrs-db volumes
podman compose down -v           # stop and delete the photo + PostgreSQL volumes
```

## Run as a podman pod (the dev pod)

For feature testing, run everything in **one pod** so the app reaches postgres
over `localhost` exactly like production. The helper script does the whole
dance — build, pod, postgres, app, wait for health:

```bash
deploy/dev-pod.sh                 # build + (re)create pod gnrs-dev-<branch> on 127.0.0.1:18300
deploy/dev-pod.sh --down          # stop + remove the pod, volumes, and image
SLUG=myfeat PORT=18345 deploy/dev-pod.sh
```

It prints the URL (`http://127.0.0.1:18300`) and the seeded admin login. There
is **no cloudflared** in the dev pod — public access is production-only.

The raw `podman pod` commands the script runs, illustrated for branch slug
`<slug>` (the script suffixes every resource with the slug, and also seeds the
admin and waits for health — see `deploy/dev-pod.sh` for the exact, complete
form):

```bash
podman build -t gnrs-dev-<slug>:latest .
# only the app port is published; postgres 5432 stays private to the pod
podman pod create --name gnrs-dev-<slug> -p 127.0.0.1:18300:8080
podman run -d --pod gnrs-dev-<slug> --name gnrs-dev-<slug>-db \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=gnrs \
  -v gnrs-db-dev-<slug>:/var/lib/postgresql/data docker.io/library/postgres:17
podman run -d --pod gnrs-dev-<slug> --name gnrs-dev-<slug>-app \
  -e JWT_SECRET=dev-local-secret-key-at-least-32-bytes-long \
  -e DATABASE_URL="postgres://postgres:postgres@localhost:5432/gnrs?sslmode=disable" \
  -e DATA_DIR=/app/data -e PORT=8080 \
  -v gnrs-data-dev-<slug>:/app/data gnrs-dev-<slug>:latest
```

Pod members share one network namespace, so the app reaches postgres at
`localhost:5432` and only the app's `8080` is published — postgres stays
private to the pod.

## Notes

- **`.dockerignore` is honored** — Buildah checks `.containerignore` first, then
  falls back to `.dockerignore`. No rename needed. (`PODMAN.md` was added to it
  so this guide stays out of the build context.)
- The **`# syntax=docker/dockerfile:1.7`** line is a BuildKit directive that
  Buildah ignores. This Dockerfile uses no BuildKit-only features (no
  `RUN --mount`, no heredocs), so `podman build` produces an identical image.
- Runs fine **rootless** (the default): host port `8300` is above 1024, and the
  named volume `gnrs-data` is created and owned correctly for the container's
  non-root UID 1001 automatically — no host `chown` needed.
- **Drive location is not a problem here:** the build context is streamed to
  the Podman machine and storage is a named volume (not a host bind-mount), so
  running from `D:\` works without extra configuration.
