#!/usr/bin/env bash
#
# Runs the pinned PocketBase executable against the local gitignored data dir
# with this repo's migrations and hooks.
#
# Environment overrides:
#   OFFICE_HTTP_ADDR        listen address        (default 127.0.0.1:8090)
#   OFFICE_ALLOWED_ORIGINS  CORS allowed origins  (default local dev origins)
#   POCKETBASE_DATA_DIR     PocketBase data dir   (default tools/pb_data)
#
# Security note: the server binds to loopback by default and CORS is limited to
# the origins below. PocketBase does not use cookies, so no credentialed
# wildcard is involved. Anyone who can reach the port can claim a free
# character; do not expose this directly to a public network.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$ROOT_DIR/tools/pocketbase"
DATA_DIR="${POCKETBASE_DATA_DIR:-$ROOT_DIR/tools/pb_data}"
HTTP_ADDR="${OFFICE_HTTP_ADDR:-127.0.0.1:8090}"
ORIGINS="${OFFICE_ALLOWED_ORIGINS:-http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000,http://localhost:4173,http://127.0.0.1:4173}"

if [ ! -x "$BIN" ]; then
  printf 'serve-pocketbase: error: %s not found. Run: npm run backend:setup\n' "$BIN" >&2
  exit 1
fi

printf 'serve-pocketbase: http %s\n' "$HTTP_ADDR" >&2
printf 'serve-pocketbase: data %s\n' "$DATA_DIR" >&2
printf 'serve-pocketbase: cors %s\n' "$ORIGINS" >&2

exec "$BIN" serve \
  --dir="$DATA_DIR" \
  --hooksDir="$ROOT_DIR/backend/pb_hooks" \
  --migrationsDir="$ROOT_DIR/backend/pb_migrations" \
  --http="$HTTP_ADDR" \
  --origins="$ORIGINS"
