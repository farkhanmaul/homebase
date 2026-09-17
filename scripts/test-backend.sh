#!/usr/bin/env bash
#
# Ensures the pinned PocketBase executable is present, then runs the Python
# stdlib integration tests against a real PocketBase process.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -x "$ROOT_DIR/tools/pocketbase" ]; then
  printf 'test-backend: PocketBase missing, running setup\n' >&2
  bash "$ROOT_DIR/scripts/setup-pocketbase.sh"
fi

cd "$ROOT_DIR"
exec python3 -m unittest discover -s backend/tests -p 'test_*.py' -v
