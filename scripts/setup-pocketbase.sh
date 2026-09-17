#!/usr/bin/env bash
#
# Downloads and verifies a pinned PocketBase release into a gitignored tools/
# directory. Safe to run repeatedly: a cached executable is trusted only when it
# still matches the recorded version and SHA-256; otherwise it is re-fetched and
# re-verified from the official release.
#
# The version is hardcoded on purpose. There is deliberately no env override, so
# a caller cannot substitute an arbitrary PocketBase build.
#
# Verified against the official release assets for v0.40.4, which ship a
# `checksums.txt` (sha256) alongside the platform archives.

set -euo pipefail

PB_VERSION="0.40.4"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="${POCKETBASE_TOOLS_DIR:-$ROOT_DIR/tools}"
DOWNLOAD_DIR="$TOOLS_DIR/.download"
BIN="$TOOLS_DIR/pocketbase"
VERSION_FILE="$TOOLS_DIR/pocketbase.version"
HASH_FILE="$TOOLS_DIR/pocketbase.sha256"
LICENSE_FILE="$TOOLS_DIR/LICENSE-pocketbase.md"

log() { printf 'setup-pocketbase: %s\n' "$*" >&2; }
die() { printf 'setup-pocketbase: error: %s\n' "$*" >&2; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

# --- checksum helper (sha256sum on Linux, shasum on macOS) -------------------
sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    die "no sha256 tool available (need sha256sum or shasum)"
  fi
}

# Version reported by the executable itself, normalised to the bare semver.
installed_version() {
  "$BIN" --version 2>/dev/null | awk '{print $NF}'
}

# A cached executable is trusted only when every one of these agrees with the
# hardcoded pin: the version file, the recorded executable hash, and the version
# the binary actually reports. A substituted binary that merely prints 0.40.4 is
# therefore still rejected because its SHA-256 no longer matches the metadata.
cached_is_trusted() {
  [ -x "$BIN" ] || return 1
  [ -f "$VERSION_FILE" ] || return 1
  [ -f "$HASH_FILE" ] || return 1
  [ "$(cat "$VERSION_FILE")" = "$PB_VERSION" ] || return 1
  [ "$(cat "$HASH_FILE")" = "$(sha256_file "$BIN")" ] || return 1
  [ "$(installed_version)" = "$PB_VERSION" ] || return 1
  return 0
}

# --- resolve the pinned platform archive -------------------------------------
detect_platform() {
  local os arch
  case "$(uname -s)" in
    Linux) os="linux" ;;
    Darwin) os="darwin" ;;
    *) die "unsupported operating system: $(uname -s)" ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch="amd64" ;;
    arm64 | aarch64) arch="arm64" ;;
    armv7l | armv7) arch="armv7" ;;
    ppc64le) arch="ppc64le" ;;
    s390x) arch="s390x" ;;
    *) die "unsupported machine architecture: $(uname -m)" ;;
  esac
  if [ "$os" = "linux" ] && [ "$arch" = "arm64" ]; then
    printf '%s_%s' "$os" "$arch"
  elif [ "$os" = "linux" ]; then
    case "$arch" in
      amd64 | armv7 | ppc64le | s390x) printf '%s_%s' "$os" "$arch" ;;
      *) die "unsupported linux architecture: $arch" ;;
    esac
  elif [ "$os" = "darwin" ]; then
    case "$arch" in
      amd64 | arm64) printf '%s_%s' "$os" "$arch" ;;
      *) die "unsupported darwin architecture: $arch" ;;
    esac
  fi
}

# --- idempotency check --------------------------------------------------------
if cached_is_trusted; then
  log "PocketBase $PB_VERSION already present and verified at $BIN"
  exit 0
fi

if [ -e "$BIN" ]; then
  log "cached PocketBase failed verification; reinstalling from the official release"
fi

require curl
PLATFORM="$(detect_platform)"
ASSET="pocketbase_${PB_VERSION}_${PLATFORM}.zip"
BASE_URL="https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}"

mkdir -p "$DOWNLOAD_DIR"

log "fetching official checksums for v$PB_VERSION"
curl -fsSL "$BASE_URL/checksums.txt" -o "$DOWNLOAD_DIR/checksums.txt" \
  || die "could not download checksums.txt"

EXPECTED="$(awk -v a="$ASSET" '$2 == a { print $1 }' "$DOWNLOAD_DIR/checksums.txt")"
[ -n "$EXPECTED" ] || die "checksums.txt has no entry for $ASSET"

log "downloading $ASSET"
curl -fsSL "$BASE_URL/$ASSET" -o "$DOWNLOAD_DIR/$ASSET" \
  || die "could not download $ASSET"

ACTUAL="$(sha256_file "$DOWNLOAD_DIR/$ASSET")"
if [ "$ACTUAL" != "$EXPECTED" ]; then
  rm -f "$DOWNLOAD_DIR/$ASSET"
  die "checksum mismatch for $ASSET (expected $EXPECTED, got $ACTUAL)"
fi
log "checksum verified for $ASSET"

# --- extract without depending on a system unzip -----------------------------
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if command -v unzip >/dev/null 2>&1; then
  unzip -q -o "$DOWNLOAD_DIR/$ASSET" -d "$TMP_DIR"
else
  require python3
  python3 - "$DOWNLOAD_DIR/$ASSET" "$TMP_DIR" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    z.extractall(sys.argv[2])
PY
fi

[ -f "$TMP_DIR/pocketbase" ] || die "archive did not contain a pocketbase executable"

install -m 0755 "$TMP_DIR/pocketbase" "$BIN"
if [ -f "$TMP_DIR/LICENSE.md" ]; then
  cp "$TMP_DIR/LICENSE.md" "$LICENSE_FILE"
fi

# Validate the freshly installed executable before recording any trust metadata,
# so a broken download can never be cached as trusted.
REPORTED="$(installed_version)"
[ "$REPORTED" = "$PB_VERSION" ] || die "installed executable reports '$REPORTED', expected '$PB_VERSION'"

printf '%s\n' "$PB_VERSION" > "$VERSION_FILE"
sha256_file "$BIN" > "$HASH_FILE"

log "installed PocketBase $PB_VERSION -> $BIN"
log "recorded executable sha256 in $HASH_FILE"
"$BIN" --version 2>/dev/null | sed 's/^/setup-pocketbase: /' >&2 || true
