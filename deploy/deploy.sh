#!/usr/bin/env bash
#
# Deploy GNRS (Go API + embedded React SPA + PostgreSQL) to a remote host that
# already has podman, as a single **podman pod** managed by the systemd user
# manager via Quadlet.
#
# The pod groups three containers that share one network namespace (so they
# reach each other over `localhost`):
#   - <pod>-db          postgres:17        (data in a named volume)
#   - <pod>-app         the gnrs image     (talks to postgres at localhost:5432)
#   - <pod>-cloudflared cloudflare tunnel  (ONLY when CLOUDFLARE_TUNNEL_TOKEN is
#                                           set in the remote .env — public access)
#
# What it does:
#   1. rsync the project source to $REMOTE_DIR (excluding secrets, build
#      artefacts, .git, local data — see deploy/rsync-exclude.txt).
#   2. Seed $REMOTE_DIR/.env from .env.example on first deploy (fresh JWT_SECRET
#      + fresh POSTGRES_PASSWORD); never overwrites an existing remote .env.
#   3. `podman build` the image on the remote.
#   4. Tear down any prior deployment of this pod (and legacy standalone
#      containers / networks from older deploy paths).
#   5. Write Quadlet units for the pod + db + app (+ cloudflared iff a token is
#      set) into the remote user's ~/.config/containers/systemd/, reload the
#      systemd user manager, and (re)start the services.
#   6. Tail the new container logs so you can confirm boot.
#
# The deployment is owned by the systemd **user** manager (the deploy user has
# lingering enabled), so the pod survives reboots. Drive it with:
#   systemctl --user {status,restart,stop} gnrs-new-app.service
#
# Usage:
#   deploy/deploy.sh                          # prod deploy to the default host
#   PORT=9090 deploy/deploy.sh                # change the host port
#   PUSH_ENV=1 deploy/deploy.sh               # also sync local .env (overwrites remote)
#   REMOTE_HOST=user@host deploy/deploy.sh
#
# Requirements: local ssh + rsync; remote podman (>= 5.0 — the `.pod` Quadlet
#   unit type landed in podman 5.0), rsync, openssl, and a systemd user manager
#   with lingering enabled.
set -euo pipefail

# --- Configuration (override via environment variables) ---------------------
REMOTE_HOST="${REMOTE_HOST:-loomino@10.8.0.1}"
REMOTE_DIR="${REMOTE_DIR:-/home/loomino/gnrs-new}"
HOST_PORT="${HOST_PORT:-8300}"            # host port → app's container port 8080
HOST_BIND_IP="${HOST_BIND_IP:-127.0.0.1}" # publish on loopback; public access is via cloudflared
POD_NAME="${POD_NAME:-gnrs-new}"
APP_CT="${APP_CT:-${POD_NAME}-app}"
DB_CT="${DB_CT:-${POD_NAME}-db}"
TUNNEL_CT="${TUNNEL_CT:-${POD_NAME}-cloudflared}"
APP_VOLUME="${APP_VOLUME:-gnrs-new-data}"     # uploaded photos (/app/data)
DB_VOLUME="${DB_VOLUME:-gnrs-new-db-data}"    # postgres data
IMAGE_TAG="${IMAGE_TAG:-gnrs-new:latest}"
PUSH_ENV="${PUSH_ENV:-0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }

say "Target: $REMOTE_HOST  ($REMOTE_DIR)"
say "Pod:    $POD_NAME  →  $HOST_BIND_IP:$HOST_PORT  (db: $DB_CT, app: $APP_CT, image: $IMAGE_TAG)"

# 1. Pre-flight: ssh reachable + podman >= 5.0 (the `.pod` Quadlet unit type
#    used below was introduced in podman 5.0; fail fast with a clear message
#    instead of a downstream "unit not found").
ssh -o BatchMode=yes -o ConnectTimeout=5 "$REMOTE_HOST" bash -s <<'PRE' \
  || { echo "Pre-flight failed on $REMOTE_HOST (ssh down, podman missing, or podman < 5.0)."; exit 1; }
set -e
command -v podman >/dev/null
ver="$(podman version --format '{{.Client.Version}}' 2>/dev/null || true)"
[ -n "$ver" ] || ver="$(podman --version 2>/dev/null | awk '{print $3}')"
major="${ver%%.*}"
case "$major" in ''|*[!0-9]*) echo "could not parse podman version ('$ver')"; exit 1;; esac
[ "$major" -ge 5 ] || { echo "podman $ver found; >= 5.0 required for .pod Quadlet units"; exit 1; }
PRE

# 2. Sync source.
say "Syncing source → $REMOTE_HOST:$REMOTE_DIR"
ssh "$REMOTE_HOST" "mkdir -p '$REMOTE_DIR'"
# rsync filter rules are first-match-wins, so a '+ /.env' include must come
# BEFORE the exclude-from file (which lists .env) for PUSH_ENV=1 to send it.
RSYNC_FILTER=()
[[ "$PUSH_ENV" == "1" ]] && RSYNC_FILTER+=(--filter='+ /.env')
rsync -az --delete --human-readable \
  "${RSYNC_FILTER[@]+"${RSYNC_FILTER[@]}"}" --exclude-from="$SCRIPT_DIR/rsync-exclude.txt" \
  -e ssh "$REPO_ROOT/" "$REMOTE_HOST:$REMOTE_DIR/"

# 3. Build + (re)install the Quadlet units on the remote.
say "Building image and (re)installing Quadlet units on $REMOTE_HOST"
ssh "$REMOTE_HOST" \
  REMOTE_DIR="$REMOTE_DIR" \
  HOST_PORT="$HOST_PORT" \
  HOST_BIND_IP="$HOST_BIND_IP" \
  POD_NAME="$POD_NAME" \
  APP_CT="$APP_CT" \
  DB_CT="$DB_CT" \
  TUNNEL_CT="$TUNNEL_CT" \
  APP_VOLUME="$APP_VOLUME" \
  DB_VOLUME="$DB_VOLUME" \
  IMAGE_TAG="$IMAGE_TAG" \
  bash -s <<'REMOTE'
set -euo pipefail
cd "$REMOTE_DIR"
# Secret-bearing files below (.env, the Quadlet units) must be born 0600, not
# created world-readable and chmod'd afterward (closes the TOCTOU window).
umask 077

# --- .env: seed once with a fresh JWT secret + postgres password ------------
if [[ ! -f .env ]]; then
  [[ -f .env.example ]] || { echo "no .env and no .env.example to seed from" >&2; exit 1; }
  SECRET="$(openssl rand -hex 32)"
  PGPASS="$(openssl rand -hex 24)"
  sed -e "s|^JWT_SECRET=.*|JWT_SECRET=${SECRET}|" \
      -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PGPASS}|" \
      -e "s|^PORT=.*|PORT=8080|" \
      .env.example > .env
  chmod 600 .env
  echo "Created $REMOTE_DIR/.env (fresh JWT_SECRET + POSTGRES_PASSWORD). Review SEED_ADMIN_*, COOKIE_SECURE, CLOUDFLARE_TUNNEL_TOKEN."
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

[[ -n "${JWT_SECRET:-}" ]] || { echo "JWT_SECRET empty in $REMOTE_DIR/.env — refusing to deploy." >&2; exit 1; }
PG_USER="${POSTGRES_USER:-postgres}"
PG_PASS="${POSTGRES_PASSWORD:-postgres}"
PG_DB="${POSTGRES_DB:-gnrs}"
# Inside the pod every container shares localhost, so the app reaches postgres
# at localhost:5432 regardless of what DATABASE_URL says in .env.
DATABASE_URL="postgres://${PG_USER}:${PG_PASS}@localhost:5432/${PG_DB}?sslmode=disable"

# Secure-by-default: a public Cloudflare tunnel serves HTTPS, so force the
# session cookie's Secure attribute on whenever a tunnel token is configured
# (unless the operator already set COOKIE_SECURE=true explicitly).
if [[ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" && "${COOKIE_SECURE:-false}" != "true" ]]; then
  echo "CLOUDFLARE_TUNNEL_TOKEN set → forcing COOKIE_SECURE=true for the public HTTPS endpoint."
  COOKIE_SECURE=true
fi

# Build the app image from the synced source.
podman build -t "$IMAGE_TAG" .

# Named volumes for postgres data + uploaded photos.
podman volume exists "$DB_VOLUME"  || podman volume create "$DB_VOLUME"  >/dev/null
podman volume exists "$APP_VOLUME" || podman volume create "$APP_VOLUME" >/dev/null

# --- systemd user manager wiring -------------------------------------------
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"
systemctl --user show-environment >/dev/null 2>&1 \
  || { echo "systemd user manager unreachable for $(id -un); enable lingering: loginctl enable-linger $(id -un)" >&2; exit 1; }

QUADLET_DIR="$HOME/.config/containers/systemd"
mkdir -p "$QUADLET_DIR"
chmod 700 "$QUADLET_DIR"   # keep the secret-bearing unit files non-traversable
POD_UNIT="${POD_NAME}-pod.service"
DB_UNIT="${DB_CT}.service"
APP_UNIT="${APP_CT}.service"
TUNNEL_UNIT="${TUNNEL_CT}.service"

# Stop any prior deployment of this pod, then drop its Quadlet sources.
for unit in "$APP_UNIT" "$TUNNEL_UNIT" "$DB_UNIT" "$POD_UNIT"; do
  systemctl --user stop "$unit" >/dev/null 2>&1 || true
done
rm -f "$QUADLET_DIR/${POD_NAME}.pod" \
      "$QUADLET_DIR/${DB_CT}.container" \
      "$QUADLET_DIR/${APP_CT}.container" \
      "$QUADLET_DIR/${TUNNEL_CT}.container"
systemctl --user daemon-reload
podman pod exists "$POD_NAME" && podman pod rm -f "$POD_NAME" >/dev/null || true

# Legacy cleanup: earlier deploy paths used standalone containers + a network.
for legacy in "$APP_CT" "$DB_CT" gnrs-new gnrs-new-db; do
  podman container exists "$legacy" && podman rm -f "$legacy" >/dev/null || true
done
podman network exists gnrs-new-net && podman network rm -f gnrs-new-net >/dev/null || true

# --- write the Quadlet units ------------------------------------------------
# <name>.pod → <name>-pod.service ; <name>.container → <name>.service
cat > "$QUADLET_DIR/${POD_NAME}.pod" <<EOF
# Managed by deploy/deploy.sh — regenerated on every deploy.
[Unit]
Description=GNRS pod (${POD_NAME})

[Pod]
PodName=${POD_NAME}
# Only the app port is published; postgres (5432) stays private to the pod.
PublishPort=${HOST_BIND_IP}:${HOST_PORT}:8080
# Keep the infra container alive when a member exits so each member's
# Restart=always can recreate just that container in place.
PodmanArgs=--exit-policy=continue

[Install]
WantedBy=default.target
EOF

cat > "$QUADLET_DIR/${DB_CT}.container" <<EOF
# Managed by deploy/deploy.sh — regenerated on every deploy.
[Unit]
Description=GNRS postgres (${DB_CT})

[Container]
ContainerName=${DB_CT}
Image=docker.io/library/postgres:17
Pod=${POD_NAME}.pod
Volume=${DB_VOLUME}:/var/lib/postgresql/data
Environment="POSTGRES_USER=${PG_USER}"
Environment="POSTGRES_PASSWORD=${PG_PASS}"
Environment="POSTGRES_DB=${PG_DB}"
HealthCmd=pg_isready -U ${PG_USER} -d ${PG_DB}
HealthStartPeriod=30s

[Service]
Restart=always

[Install]
WantedBy=default.target
EOF
chmod 600 "$QUADLET_DIR/${DB_CT}.container"

cat > "$QUADLET_DIR/${APP_CT}.container" <<EOF
# Managed by deploy/deploy.sh — regenerated on every deploy.
[Unit]
Description=GNRS app (${APP_CT})
After=${DB_UNIT}
Wants=${DB_UNIT}

[Container]
ContainerName=${APP_CT}
Image=localhost/${IMAGE_TAG}
Pod=${POD_NAME}.pod
Volume=${APP_VOLUME}:/app/data
Environment="JWT_SECRET=${JWT_SECRET}"
Environment="JWT_TTL=${JWT_TTL:-24h}"
Environment="COOKIE_SECURE=${COOKIE_SECURE:-false}"
Environment="DATABASE_URL=${DATABASE_URL}"
Environment="DATA_DIR=/app/data"
Environment="SEED_ADMIN_EMAIL=${SEED_ADMIN_EMAIL:-}"
Environment="SEED_ADMIN_USERNAME=${SEED_ADMIN_USERNAME:-}"
Environment="SEED_ADMIN_PASSWORD=${SEED_ADMIN_PASSWORD:-}"

[Service]
# The app pings postgres at boot; if it isn't ready yet the container exits
# and is restarted until the db health check passes (a few seconds).
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
chmod 600 "$QUADLET_DIR/${APP_CT}.container"

# Cloudflared sidecar — joins the pod ONLY when a token is configured (prod).
# From inside the pod it reaches the app at localhost:8080, so the Cloudflare
# public hostname should target http://localhost:8080.
if [[ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_TUNNEL_TOKEN present → cloudflared sidecar will run (public access)."
  cat > "$QUADLET_DIR/${TUNNEL_CT}.container" <<EOF
# Managed by deploy/deploy.sh — regenerated on every deploy.
[Unit]
Description=cloudflared tunnel for GNRS (${TUNNEL_CT})
After=${APP_UNIT}
Wants=${APP_UNIT}

[Container]
ContainerName=${TUNNEL_CT}
Image=docker.io/cloudflare/cloudflared:latest
Pod=${POD_NAME}.pod
Environment="TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}"
Exec=tunnel --no-autoupdate run

[Service]
Restart=always

[Install]
WantedBy=default.target
EOF
  chmod 600 "$QUADLET_DIR/${TUNNEL_CT}.container"
else
  echo "No CLOUDFLARE_TUNNEL_TOKEN set — skipping cloudflared (no public tunnel; reach the app over the VPN at ${HOST_BIND_IP}:${HOST_PORT})."
fi

# --- (re)start via the systemd user manager --------------------------------
systemctl --user daemon-reload
systemctl --user restart "$DB_UNIT"
systemctl --user restart "$APP_UNIT"
[[ -f "$QUADLET_DIR/${TUNNEL_CT}.container" ]] && systemctl --user restart "$TUNNEL_UNIT" || true

sleep 4
echo
echo '=== pod ==='
podman pod ps --filter "name=^${POD_NAME}\$" --format 'table {{.Name}}\t{{.Status}}\t{{.NumberOfContainers}}'
echo
echo '=== containers ==='
podman ps --filter "pod=${POD_NAME}" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
echo
echo "--- ${APP_CT} logs ---"; podman logs --tail 20 "$APP_CT" 2>&1 || true
if podman container exists "$TUNNEL_CT"; then
  echo "--- ${TUNNEL_CT} logs ---"; podman logs --tail 10 "$TUNNEL_CT" 2>&1 || true
fi
REMOTE

say "Done. Pod ${POD_NAME} is managed by the systemd user manager (restarts on boot)."
say "VPN/debug: http://${HOST_BIND_IP}:${HOST_PORT}  |  public: via the Cloudflare Tunnel when the token is set."
