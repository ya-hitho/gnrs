# syntax=docker/dockerfile:1.7

# 1. Build the SPA bundle (Debian-based Node, not Alpine)
FROM node:20-bookworm-slim AS frontend
WORKDIR /web/app

COPY web/app/package.json web/app/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY web/app ./
RUN npm run build

# 2. Build the Go binary with the SPA embedded.
# pgx is pure Go, so the binary is built static (CGO disabled) — no sqlite
# toolchain needed anymore.
FROM golang:1.25-bookworm AS backend
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
COPY --from=frontend /web/dist ./web/dist

RUN CGO_ENABLED=0 GOOS=linux go build \
      -ldflags="-s -w" \
      -o /out/server ./cmd/server

# 3. Runtime image — Debian (full glibc base), not Alpine.
FROM debian:latest
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 1001 app \
 && useradd -u 1001 -g app -M -s /usr/sbin/nologin app

WORKDIR /app
COPY --from=backend --chown=app:app /out/server ./server
# /app/data holds uploaded photos (PHOTOS_DIR); the database now lives in
# PostgreSQL, configured via DATABASE_URL.
RUN mkdir -p /app/data && chown app:app /app/data

USER app
EXPOSE 8080
VOLUME ["/app/data"]

ENV PORT=8080 \
    DATA_DIR=/app/data

ENTRYPOINT ["/usr/bin/tini", "--", "./server"]
