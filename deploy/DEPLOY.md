# Deploying GNRS

`deploy/deploy.sh` ships this branch to the remote host as a single **podman
pod** managed by the systemd **user** manager via Quadlet. It **rsyncs** the
build context over SSH, builds the image with podman, writes Quadlet unit
files, and (re)starts the pod.

> Production / public access lives **only** on the `jalur-yasril` track. For
> local feature testing use the dev pod (`deploy/dev-pod.sh`, see
> [`PODMAN.md`](../PODMAN.md)) — it never starts a Cloudflare tunnel.

## The pod

Everything runs inside one pod (`gnrs-new`) whose containers share a single
network namespace, so they reach each other over `localhost`:

| Container             | Image                          | Role                                                        |
| --------------------- | ------------------------------ | ----------------------------------------------------------- |
| `gnrs-new-db`         | `postgres:17`                  | PostgreSQL; data in the `gnrs-new-db-data` volume.          |
| `gnrs-new-app`        | the gnrs image                 | Go API + embedded SPA; talks to postgres at `localhost:5432`. Photos in `gnrs-new-data`. |
| `gnrs-new-cloudflared`| `cloudflare/cloudflared:latest`| **Only when `CLOUDFLARE_TUNNEL_TOKEN` is set** — fronts public access; reaches the app at `localhost:8080`. |

Only the app port is published to the host (`127.0.0.1:8300` by default) for
VPN/debug access; PostgreSQL (`5432`) stays private to the pod. Public traffic
arrives through the Cloudflare Tunnel, not the published host port.

## What it does

1. `rsync -az --delete` the repo to `$REMOTE_DIR` (excludes secrets, deps,
   build outputs, local data — see `deploy/rsync-exclude.txt`).
2. On the **first** deploy, seed `$REMOTE_DIR/.env` from `.env.example` with a
   fresh `JWT_SECRET` and a fresh random `POSTGRES_PASSWORD`. An existing
   remote `.env` is never overwritten (unless `PUSH_ENV=1`), so the signing key
   and DB password stay stable across redeploys.
3. `podman build` the image from the `Dockerfile` (Node + Go multi-stage; the
   React SPA is embedded into the Go binary).
4. Tear down any prior deployment of this pod, plus legacy standalone
   containers / networks from older deploy paths.
5. Write Quadlet units (`<pod>.pod`, `<db>.container`, `<app>.container`, and
   `<cloudflared>.container` iff a token is set) into
   `~/.config/containers/systemd/`, `daemon-reload`, and (re)start the units.
6. Tail the new container logs so you can confirm boot.

Because the pod is owned by the systemd user manager (the deploy user has
lingering enabled), it survives reboots.

## Public access via Cloudflare Tunnel

The `cloudflared` sidecar runs **only** when `CLOUDFLARE_TUNNEL_TOKEN` is set in
the remote `.env`:

1. In the Cloudflare Zero Trust dashboard, _Networks → Tunnels → Create_.
2. Add a public hostname (e.g. `gnrs.example.com`) and point its service at
   `http://localhost:8080` (the app, reached over the shared pod namespace).
3. Copy the tunnel token into `CLOUDFLARE_TUNNEL_TOKEN` in the remote `.env`.
4. `COOKIE_SECURE` — leave it; `deploy.sh` auto-forces `COOKIE_SECURE=true`
   whenever a tunnel token is set (cookies are served over HTTPS through the
   tunnel). Set it explicitly only if you need to override.
5. Redeploy. With no token set, no tunnel is created and the app is reachable
   only over the VPN at the published host port.

## Defaults

| Setting        | Value                          | Override env var  |
| -------------- | ------------------------------ | ----------------- |
| Remote host    | `loomino@10.8.0.1`             | `REMOTE_HOST`     |
| Remote dir     | `/home/loomino/gnrs-new`       | `REMOTE_DIR`      |
| Pod            | `gnrs-new`                     | `POD_NAME`        |
| Host publish   | `127.0.0.1:8300` → app `8080`  | `HOST_BIND_IP`, `HOST_PORT` |
| App container  | `gnrs-new-app`                 | `APP_CT`          |
| DB container   | `gnrs-new-db` (postgres:17)    | `DB_CT`           |
| Tunnel container | `gnrs-new-cloudflared`       | `TUNNEL_CT`       |
| Photos volume  | `gnrs-new-data`                | `APP_VOLUME`      |
| DB volume      | `gnrs-new-db-data`             | `DB_VOLUME`       |
| Image          | `gnrs-new:latest`              | `IMAGE_TAG`       |

> The remote also hosts the unrelated `ppgus`/`ppg` deployment, so gnrs keeps
> its own `gnrs-new` pod, `~/gnrs-new` dir, and host port `8300`.

## Usage

```bash
# from the repo root, on this branch
deploy/deploy.sh

# override any setting
HOST_PORT=9090 deploy/deploy.sh
PUSH_ENV=1 deploy/deploy.sh        # also push the local .env (overwrites remote)
```

Requirements: local `ssh` + `rsync`; the remote needs `podman` **≥ 5.0** (the
`.pod` Quadlet unit type the pod is built from landed in podman 5.0; the script
preflights this and aborts early on an older podman), `rsync`, `openssl`, and a
systemd user manager with lingering enabled (`loginctl enable-linger loomino`).

## The remote `.env`

On the first deploy the script creates `<remote-dir>/.env` from `.env.example`
with a fresh `JWT_SECRET` and `POSTGRES_PASSWORD`. After that, edit it on the
remote and redeploy (or restart the unit) to apply:

- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` — bootstrap
  admin, seeded only while the users table is empty.
- `COOKIE_SECURE=true` — once served over HTTPS through the tunnel.
- `CLOUDFLARE_TUNNEL_TOKEN` — set to enable the public tunnel.

```bash
ssh loomino@10.8.0.1 'nano ~/gnrs-new/.env'
ssh loomino@10.8.0.1 'systemctl --user restart gnrs-new-app.service'
```

## Operating the deployment

The pod is a set of systemd **user** units. Over SSH, point `systemctl --user`
at the lingering manager first:

```bash
ssh loomino@10.8.0.1 '
  export XDG_RUNTIME_DIR=/run/user/$(id -u)
  systemctl --user list-units "gnrs-new*"              # unit status
  systemctl --user restart gnrs-new-app.service        # restart the app
  podman pod ps                                         # pod status
  podman ps --filter pod=gnrs-new                       # containers in the pod
  podman logs -f gnrs-new-app                           # app logs
'
```

To remove the deployment entirely (this **destroys the database**):

```bash
ssh loomino@10.8.0.1 '
  export XDG_RUNTIME_DIR=/run/user/$(id -u)
  systemctl --user stop gnrs-new-app.service gnrs-new-db.service \
    gnrs-new-cloudflared.service gnrs-new-pod.service || true
  rm -f ~/.config/containers/systemd/gnrs-new.pod \
        ~/.config/containers/systemd/gnrs-new-*.container
  systemctl --user daemon-reload
  podman pod rm -f gnrs-new || true
  podman volume rm gnrs-new-db-data gnrs-new-data || true   # DESTROYS data
'
```
