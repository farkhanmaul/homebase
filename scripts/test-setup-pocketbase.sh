#!/usr/bin/env bash
#
# Deterministic, offline verification of scripts/setup-pocketbase.sh.
#
# It proves the trust logic rejects a substituted cached executable that still
# reports the pinned version: a fake tools/pocketbase that prints 0.40.4 (so it
# passes a naive `--version` check) but whose SHA-256 does not match the recorded
# metadata must be re-fetched and replaced, and the replacement must be recorded.
#
# No network is used: a stub `curl` serves a locally built release archive and
# checksums.txt, and counts how often it is invoked.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP="$ROOT_DIR/scripts/setup-pocketbase.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FIXTURES="$WORK/fixtures"
STUB_BIN="$WORK/bin"
TOOLS="$WORK/tools"
mkdir -p "$FIXTURES" "$STUB_BIN" "$TOOLS"

CALLS1="$WORK/calls-1"
CALLS2="$WORK/calls-2"
CALLS3="$WORK/calls-3"

fail() { printf 'test-setup-pocketbase: FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf 'test-setup-pocketbase: ok: %s\n' "$*" >&2; }

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# --- build a fake release: archive + checksums --------------------------------
python3 - "$FIXTURES" <<'PY'
import hashlib
import os
import sys
import zipfile

fixtures = sys.argv[1]

# Payload used for the genuine release. It reports the pinned version, exactly
# like the real binary does ("pocketbase version 0.40.4").
genuine = "#!/usr/bin/env bash\nprintf 'pocketbase version 0.40.4\\n'\n"
with open(os.path.join(fixtures, "pocketbase"), "w", encoding="utf-8") as handle:
    handle.write(genuine)

archive = os.path.join(fixtures, "archive.zip")
with zipfile.ZipFile(archive, "w") as bundle:
    bundle.writestr("pocketbase", genuine)

digest = hashlib.sha256(open(archive, "rb").read()).hexdigest()

# One entry per platform so the test is architecture independent.
assets = [
    "pocketbase_0.40.4_linux_amd64.zip",
    "pocketbase_0.40.4_linux_arm64.zip",
    "pocketbase_0.40.4_linux_armv7.zip",
    "pocketbase_0.40.4_linux_ppc64le.zip",
    "pocketbase_0.40.4_linux_s390x.zip",
    "pocketbase_0.40.4_darwin_amd64.zip",
    "pocketbase_0.40.4_darwin_arm64.zip",
]
with open(os.path.join(fixtures, "checksums.txt"), "w", encoding="utf-8") as handle:
    for asset in assets:
        handle.write(f"{digest}  {asset}\n")
PY

# --- stub curl: serves fixtures and records every invocation ------------------
cat > "$STUB_BIN/curl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$STUB_CURL_CALLS"
out=""
url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o)
      out="$2"
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done
case "$url" in
  *checksums.txt) cp "$STUB_FIXTURES/checksums.txt" "$out" ;;
  *.zip) cp "$STUB_FIXTURES/archive.zip" "$out" ;;
  *)
    printf 'stub curl: unexpected url %s\n' "$url" >&2
    exit 22
    ;;
esac
STUB
chmod +x "$STUB_BIN/curl"

run_setup() {
  local calls="$1"
  shift
  : > "$calls"
  PATH="$STUB_BIN:$PATH" \
    POCKETBASE_TOOLS_DIR="$TOOLS" \
    STUB_FIXTURES="$FIXTURES" \
    STUB_CURL_CALLS="$calls" \
    bash "$SETUP" "$@"
}

GENUINE_SHA="$(sha256_of "$FIXTURES/pocketbase")"

# --- scenario 1: substituted executable that lies about its version -----------
cat > "$TOOLS/pocketbase" <<'EVIL'
#!/usr/bin/env bash
# Substituted executable: it prints the pinned version to defeat a naive
# `--version` check, but its contents differ from the authentic release.
printf 'pocketbase version 0.40.4\n'
EVIL
chmod +x "$TOOLS/pocketbase"
printf '0.40.4\n' > "$TOOLS/pocketbase.version"
# Metadata records the authentic executable's hash, i.e. the cache was tampered.
printf '%s\n' "$GENUINE_SHA" > "$TOOLS/pocketbase.sha256"

EVIL_SHA="$(sha256_of "$TOOLS/pocketbase")"
[ "$EVIL_SHA" != "$GENUINE_SHA" ] || fail "fixture setup: evil and genuine hashes must differ"

OUTPUT="$(run_setup "$CALLS1" 2>&1)" || fail "setup failed on tampered cache:\n$OUTPUT"
case "$OUTPUT" in
  *"reinstalling from the official release"*) ;;
  *) fail "tampered cache was not detected; output:\n$OUTPUT" ;;
esac

[ -s "$CALLS1" ] || fail "setup did not re-download after detecting the substituted binary"
AFTER_SHA="$(sha256_of "$TOOLS/pocketbase")"
[ "$AFTER_SHA" = "$GENUINE_SHA" ] || fail "substituted executable was not replaced (sha $AFTER_SHA)"
[ "$AFTER_SHA" != "$EVIL_SHA" ] || fail "substituted executable survived reinstall"
[ "$(cat "$TOOLS/pocketbase.sha256")" = "$GENUINE_SHA" ] || fail "recorded sha256 metadata is wrong"
[ "$(cat "$TOOLS/pocketbase.version")" = "0.40.4" ] || fail "version file is wrong"
pass "substituted 0.40.4 binary rejected and replaced from verified release"

# --- scenario 2: trusted cache is not re-downloaded ---------------------------
OUTPUT="$(run_setup "$CALLS2" 2>&1)" || fail "setup failed on trusted cache:\n$OUTPUT"
case "$OUTPUT" in
  *"already present and verified"*) ;;
  *) fail "trusted cache was not accepted; output:\n$OUTPUT" ;;
esac
[ ! -s "$CALLS2" ] || fail "trusted cache triggered a download: $(cat "$CALLS2")"
[ "$(sha256_of "$TOOLS/pocketbase")" = "$GENUINE_SHA" ] || fail "trusted binary changed unexpectedly"
pass "verified cache is reused without network access"

# --- scenario 3: tampered version file also forces a reinstall ----------------
printf '0.40.5\n' > "$TOOLS/pocketbase.version"
OUTPUT="$(run_setup "$CALLS3" 2>&1)" || fail "setup failed on tampered version file:\n$OUTPUT"
[ -s "$CALLS3" ] || fail "tampered version file did not trigger a reinstall"
[ "$(cat "$TOOLS/pocketbase.version")" = "0.40.4" ] || fail "version file was not repaired"
pass "tampered version file rejected and repaired"

printf 'test-setup-pocketbase: PASS\n' >&2
