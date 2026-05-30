#!/usr/bin/env bash
#
# Deploy GNRS (Go API + embedded React SPA, PostgreSQL) to a remote host.
#
# Strategy:
#   1. rsync the build context to the remote host over SSH.
#   2. On the remote, run a postgres:17 container and build/(re)start the
#      app container on a shared podman network.
#
# State lives in named podman volumes — the PostgreSQL data volume and the
# photos volume — so redeploys never touch existing data.
#
# Usage:
#   deploy/deploy.sh                 # deploy with the defaults below
#   HOST_PORT=9090 deploy/deploy.sh  # override any setting via env vars
#
set -euo pipefail

# --- Configuration (override via environment variables) ---------------------
REMOTE_HOST="${REMOTE_HOST:-loomino@10.8.0.1}"
REMOTE_DIR="${REMOTE_DIR:-~/gnrs-new}"   # leading ~ is expanded on the remote
HOST_PORT="${HOST_PORT:-8300}"           # host port; container always listens on 8080
IMAGE="${IMAGE:-gnrs-new:latest}"
CONTAINER="${CONTAINER:-gnrs-new}"
VOLUME="${VOLUME:-gnrs-new-data}"        # photos volume (/app/data)
DB_CONTAINER="${DB_CONTAINER:-gnrs-new-db}"
DB_VOLUME="${DB_VOLUME:-gnrs-new-db-data}"
NETWORK="${NETWORK:-gnrs-new-net}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "==> Deploying GNRS"
echo "    repo     : $REPO_ROOT"
echo "    target   : $REMOTE_HOST:$REMOTE_DIR"
echo "    image    : $IMAGE   container: $CONTAINER"
echo "    database : $DB_CONTAINER (postgres:17)   network: $NETWORK"
echo "    publish  : host ${HOST_PORT} -> container 8080"
echo

# --- 1. Sync the build context ----------------------------------------------
echo "==> Syncing source via rsync"
rsync -az --delete --human-readable \
  --exclude-from="$SCRIPT_DIR/rsync-exclude.txt" \
  -e ssh \
  "$REPO_ROOT/" "$REMOTE_HOST:$REMOTE_DIR/"

# --- 2. Build and run on the remote -----------------------------------------
echo "==> Building image and (re)starting containers on $REMOTE_HOST"
ssh "$REMOTE_HOST" 'bash -s' -- \
  "$REMOTE_DIR" "$HOST_PORT" "$IMAGE" "$CONTAINER" "$VOLUME" "$DB_CONTAINER" "$DB_VOLUME" "$NETWORK" <<'REMOTE'
set -euo pipefail
DIR="${1/#\~/$HOME}"   # expand a leading ~ to the remote $HOME
PORT="$2"; IMAGE="$3"; NAME="$4"; VOL="$5"; DB_NAME="$6"; DB_VOL="$7"; NET="$8"

cd "$DIR"

# PostgreSQL credentials — generated once and preserved across redeploys so
# the password keeps matching the existing data volume.
if [ ! -f .pgenv ]; then
  echo "    .pgenv not found — generating PostgreSQL credentials"
  PGPASS="$(openssl rand -hex 24)"
  cat > .pgenv <<EOF
POSTGRES_USER=gnrs
POSTGRES_PASSWORD=${PGPASS}
POSTGRES_DB=gnrs
EOF
fi
# shellcheck disable=SC1091
. ./.pgenv
DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${DB_NAME}:5432/${POSTGRES_DB}?sslmode=disable"

# Ensure a .env exists. Generated once with a fresh JWT secret and then
# preserved across redeploys so the signing key (and sessions) stay stable.
if [ ! -f .env ]; then
  echo "    .env not found — generating from .env.example"
  SECRET="$(openssl rand -hex 32)"
  sed -e "s|^JWT_SECRET=.*|JWT_SECRET=${SECRET}|" \
      -e "s|^PORT=.*|PORT=8080|" \
      .env.example > .env
  echo "    generated .env with a fresh 32-byte JWT_SECRET"
  echo "    NOTE: review SEED_ADMIN_* and COOKIE_SECURE in ${DIR}/.env"
else
  echo "    reusing existing .env"
fi
# Always point DATABASE_URL at the bundled postgres container.
if grep -q '^DATABASE_URL=' .env; then
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=${DATABASE_URL}|" .env
else
  echo "DATABASE_URL=${DATABASE_URL}" >> .env
fi

# Shared network so the app reaches PostgreSQL by container name.
podman network exists "$NET" || { echo "    creating network ${NET}"; podman network create "$NET" >/dev/null; }

# PostgreSQL container (data in its own volume).
podman volume exists "$DB_VOL" || { echo "    creating volume ${DB_VOL}"; podman volume create "$DB_VOL" >/dev/null; }
if ! podman ps --format '{{.Names}}' | grep -qx "$DB_NAME"; then
  echo "    starting postgres container ${DB_NAME}"
  podman rm -f "$DB_NAME" >/dev/null 2>&1 || true
  podman run -d --name "$DB_NAME" --network "$NET" \
    -e POSTGRES_USER="$POSTGRES_USER" \
    -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    -e POSTGRES_DB="$POSTGRES_DB" \
    -v "${DB_VOL}:/var/lib/postgresql/data" \
    --restart=unless-stopped \
    docker.io/library/postgres:17 >/dev/null
else
  echo "    postgres container ${DB_NAME} already running"
fi

echo "    waiting for postgres to accept connections"
for _ in $(seq 1 30); do
  if podman exec "$DB_NAME" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "    building image ${IMAGE} (podman build)"
podman build -t "$IMAGE" .

podman volume exists "$VOL" || { echo "    creating volume ${VOL}"; podman volume create "$VOL" >/dev/null; }

echo "    (re)starting container ${NAME}"
podman rm -f "$NAME" >/dev/null 2>&1 || true
podman run -d --name "$NAME" --network "$NET" \
  --env-file .env \
  -p "${PORT}:8080" \
  -v "${VOL}:/app/data" \
  --restart=unless-stopped \
  "$IMAGE" >/dev/null

echo "    container status:"
podman ps --filter "name=^${NAME}$" --filter "name=^${DB_NAME}$" \
  --format "      {{.Names}}  {{.Status}}  {{.Ports}}"
REMOTE

echo
echo "==> Done. App is published on ${REMOTE_HOST%@*}@... host port ${HOST_PORT}"
echo "    Reach it at http://<remote-host>:${HOST_PORT}/"
