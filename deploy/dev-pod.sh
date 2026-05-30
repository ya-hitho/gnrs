#!/usr/bin/env bash
#
# Spin up a LOCAL per-agent development pod for feature testing before prod.
#
# Runs all of GNRS inside one podman pod on your own machine:
#   - gnrs-dev-<slug>-db    postgres:17  (data in a named volume)
#   - gnrs-dev-<slug>-app   the gnrs image, talking to postgres at localhost:5432
#
# There is NO cloudflared here — public access (the Cloudflare Tunnel) is a
# production-only concern handled by deploy/deploy.sh on the jalur-yasril host.
# The dev pod binds to loopback so the shared headless Chrome can drive it
# (see CHROME_DEVTOOLS.md / TEST.md).
#
# Usage (from inside your worktree):
#   deploy/dev-pod.sh            # build + (re)create the pod, then print the URL
#   deploy/dev-pod.sh --down     # stop and remove the pod, its volumes, the image
#   SLUG=myfeat PORT=18345 deploy/dev-pod.sh
#
# Defaults: SLUG is derived from the current branch; PORT is 18300.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

slug_from_branch() {
  git rev-parse --abbrev-ref HEAD 2>/dev/null | sed 's|.*/||; s|[^a-zA-Z0-9]\+|-|g; s|^-\+||; s|-\+$||'
}
SLUG="${SLUG:-$(slug_from_branch)}"
SLUG="${SLUG:-local}"
PORT="${PORT:-18300}"
HOST_BIND_IP="${HOST_BIND_IP:-127.0.0.1}"

POD="gnrs-dev-${SLUG}"
DB_CT="${POD}-db"
APP_CT="${POD}-app"
IMAGE="${IMAGE:-${POD}:latest}"
DB_VOL="gnrs-db-dev-${SLUG}"
DATA_VOL="gnrs-data-dev-${SLUG}"

say() { printf '\033[1;35m[dev-pod]\033[0m %s\n' "$*"; }

down() {
  say "Tearing down ${POD}"
  podman pod rm -f "$POD" >/dev/null 2>&1 || true
  podman volume rm "$DB_VOL" "$DATA_VOL" >/dev/null 2>&1 || true
  podman rmi "$IMAGE" >/dev/null 2>&1 || true
  say "Removed pod, volumes (${DB_VOL}, ${DATA_VOL}) and image ${IMAGE}."
}

if [[ "${1:-}" == "--down" || "${1:-}" == "down" ]]; then
  down
  exit 0
fi

# Credentials / app config. Reuse the worktree .env if present (for JWT_SECRET,
# SEED_ADMIN_*, COOKIE_SECURE); otherwise fall back to throwaway dev values.
if [[ -f .env ]]; then
  set -a; # shellcheck disable=SC1091
  source .env; set +a
fi
JWT_SECRET="${JWT_SECRET:-dev-local-secret-key-at-least-32-bytes-long}"
SEED_ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@example.com}"
SEED_ADMIN_USERNAME="${SEED_ADMIN_USERNAME:-admin}"
SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-password123}"
COOKIE_SECURE="${COOKIE_SECURE:-false}"
PG_USER=postgres PG_PASS=postgres PG_DB=gnrs

say "Building image ${IMAGE}"
podman build -t "$IMAGE" .

say "(Re)creating pod ${POD} → ${HOST_BIND_IP}:${PORT}"
podman pod rm -f "$POD" >/dev/null 2>&1 || true
podman volume exists "$DB_VOL"   || podman volume create "$DB_VOL"   >/dev/null
podman volume exists "$DATA_VOL" || podman volume create "$DATA_VOL" >/dev/null
# Only the app port is published; postgres (5432) stays private to the pod.
podman pod create --name "$POD" -p "${HOST_BIND_IP}:${PORT}:8080" >/dev/null

say "Starting postgres (${DB_CT})"
podman run -d --pod "$POD" --name "$DB_CT" \
  -e POSTGRES_USER="$PG_USER" -e POSTGRES_PASSWORD="$PG_PASS" -e POSTGRES_DB="$PG_DB" \
  -v "${DB_VOL}:/var/lib/postgresql/data" \
  docker.io/library/postgres:17 >/dev/null

say "Waiting for postgres to accept connections"
for _ in $(seq 1 30); do
  podman exec "$DB_CT" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1 && break
  sleep 1
done

say "Starting app (${APP_CT})"
podman run -d --pod "$POD" --name "$APP_CT" \
  -e JWT_SECRET="$JWT_SECRET" \
  -e DATABASE_URL="postgres://${PG_USER}:${PG_PASS}@localhost:5432/${PG_DB}?sslmode=disable" \
  -e DATA_DIR=/app/data \
  -e COOKIE_SECURE="$COOKIE_SECURE" \
  -e SEED_ADMIN_EMAIL="$SEED_ADMIN_EMAIL" \
  -e SEED_ADMIN_USERNAME="$SEED_ADMIN_USERNAME" \
  -e SEED_ADMIN_PASSWORD="$SEED_ADMIN_PASSWORD" \
  -e PORT=8080 \
  -v "${DATA_VOL}:/app/data" \
  "$IMAGE" >/dev/null

say "Waiting for the app to come up"
for _ in $(seq 1 60); do
  if curl -fsS "http://${HOST_BIND_IP}:${PORT}/healthz" >/dev/null 2>&1; then
    say "Up → http://${HOST_BIND_IP}:${PORT}  (admin user: ${SEED_ADMIN_USERNAME}; password = SEED_ADMIN_PASSWORD from .env, or the dev default)"
    podman ps --filter "pod=${POD}" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
    exit 0
  fi
  sleep 1
done

say "App did not become healthy in time — last logs:"
podman logs --tail 30 "$APP_CT" 2>&1 || true
exit 1
