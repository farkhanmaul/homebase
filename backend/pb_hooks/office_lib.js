// Shared helpers for the /api/office/* routes.
//
// PocketBase runs every handler in an isolated JS runtime context, so the
// helpers below cannot be referenced directly from a handler. They are loaded
// with require(__hooks + "/office_lib.js") from inside each handler instead.
// Keep everything here stateless/pure: any mutable state must live in the DB.

// The production lease TTL is a fixed 90s. There is deliberately no env
// override: a deployment cannot silently extend or shorten how long a character
// stays claimed.
const DEFAULT_LEASE_MS = 90000;
// The test override is for integration tests only. It must be within these
// bounds to be considered at all, and is then combined with the fixed TTL using
// min() so it can only ever shorten a lease, never extend it.
const MIN_TEST_LEASE_MS = 200;
const MAX_TEST_LEASE_MS = 90000;

// Rate-limit rows untouched for this long are stale (every window is <= 60s) and
// are pruned so a client rotating IPs cannot grow office_limits without bound.
const RATE_PRUNE_MS = 10 * 60 * 1000;

const MAP_W = 1920;
const MAP_H = 960;
const MAX_TEXT = 500;
const MAX_STATUS = 80;
const KEEP_MESSAGES = 200;
const DIRECTIONS = ["up", "down", "left", "right"];
const DEFAULT_STATUS = "Available";

function intEnv(name, fallback) {
  const raw = $os.getenv(name);
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!isFinite(n) || n <= 0) return fallback;
  return n;
}

function leaseTtlMs() {
  const override = intEnv("OFFICE_TEST_LEASE_TTL_MS", 0);
  if (override >= MIN_TEST_LEASE_MS && override <= MAX_TEST_LEASE_MS) {
    return Math.min(DEFAULT_LEASE_MS, override);
  }
  return DEFAULT_LEASE_MS;
}

function rateConfig() {
  return {
    claim: { limit: intEnv("OFFICE_CLAIM_LIMIT", 60), window: intEnv("OFFICE_CLAIM_WINDOW_MS", 60000) },
    release: { limit: intEnv("OFFICE_RELEASE_LIMIT", 30), window: intEnv("OFFICE_RELEASE_WINDOW_MS", 10000) },
    // Buckets are keyed by IP, so this must clear normal polling for six users
    // sharing one address: 6 users x 5 beats / 10s = 30, plus generous headroom.
    heartbeat: { limit: intEnv("OFFICE_HEARTBEAT_LIMIT", 120), window: intEnv("OFFICE_HEARTBEAT_WINDOW_MS", 10000) },
    message: { limit: intEnv("OFFICE_MESSAGE_LIMIT", 12), window: intEnv("OFFICE_MESSAGE_WINDOW_MS", 10000) },
    // Anonymous reads are keyed by IP too, so they must also clear six users
    // polling every 2s (6 x 5 = 30 / 10s) with headroom. Read buckets are kept
    // separate from the message *write* bucket so POSTing cannot throttle reads
    // and vice versa.
    characters: { limit: intEnv("OFFICE_CHARACTERS_LIMIT", 120), window: intEnv("OFFICE_CHARACTERS_WINDOW_MS", 10000) },
    messageRead: { limit: intEnv("OFFICE_MESSAGES_READ_LIMIT", 120), window: intEnv("OFFICE_MESSAGES_READ_WINDOW_MS", 10000) },
  };
}

function body(e) {
  const info = e.requestInfo();
  return info.body || {};
}

function readToken(e) {
  const raw = e.request.header.get("X-Office-Session");
  return raw ? String(raw).trim() : "";
}

function parseCharacterId(value) {
  const id = typeof value === "number" ? value : Number(value);
  if (!isFinite(id) || Math.floor(id) !== id || id < 1 || id > 6) {
    throw new BadRequestError("Karakter tidak valid.");
  }
  return id;
}

function parseCoordinate(value, axis, max) {
  if (typeof value !== "number" || !isFinite(value)) {
    throw new BadRequestError("Koordinat " + axis + " harus berupa angka.");
  }
  if (value < 0 || value > max) {
    throw new BadRequestError("Koordinat " + axis + " di luar peta.");
  }
  return value;
}

function parseDirection(value) {
  if (typeof value !== "string" || DIRECTIONS.indexOf(value) < 0) {
    throw new BadRequestError("Arah tidak valid.");
  }
  return value;
}

function parseStatus(value) {
  if (value === undefined || value === null) return DEFAULT_STATUS;
  if (typeof value !== "string") throw new BadRequestError("Status tidak valid.");
  const status = value.trim();
  if (status.length > MAX_STATUS) throw new BadRequestError("Status terlalu panjang (maks 80).");
  return status.length ? status : DEFAULT_STATUS;
}

function parseText(value) {
  if (typeof value !== "string") throw new BadRequestError("Pesan tidak valid.");
  const text = value.trim();
  if (!text) throw new BadRequestError("Pesan tidak boleh kosong.");
  if (text.length > MAX_TEXT) throw new BadRequestError("Pesan terlalu panjang (maks 500).");
  return text;
}

// Validates the optional `afterSeq` query used for incremental message
// retrieval. An absent key means "full retained history" (cursor 0). A present
// key must be a non-negative base-10 integer; anything else, including an empty
// value, is rejected so a malformed cursor cannot silently return the wrong
// slice of history.
function parseAfterSeq(query) {
  if (!query || !Object.prototype.hasOwnProperty.call(query, "afterSeq")) return 0;
  const raw = query.afterSeq;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    throw new BadRequestError("afterSeq tidak valid.");
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new BadRequestError("afterSeq tidak valid.");
  }
  return value;
}

// Resolves the character bound to the X-Office-Session bearer token. Never
// trusts a client supplied character id/name/sprite. Throws 401 when the token
// is missing, unknown or expired.
function requireCharacter(app, e, now) {
  const token = readToken(e);
  if (!token) throw new UnauthorizedError("Sesi kantor tidak valid. Pilih karakter lagi.");
  const hash = $security.sha256(token);
  try {
    return app.findFirstRecordByFilter(
      "office_characters",
      "lease_token_hash = {:hash} && active = true && lease_expires > {:now}",
      { hash: hash, now: now },
    );
  } catch {
    throw new UnauthorizedError("Sesi kantor sudah berakhir. Pilih karakter lagi.");
  }
}

// Fixed-window counter stored in the DB so it is shared across the JS runtime
// pool and returns consistent 429s.
//
// This runs in its own committed transaction BEFORE any validation or business
// logic, so an attempt is always counted and persisted even when the request
// later fails with 400/401/409 (or is itself a 429). The counter transaction
// must never throw while it is open: the over-limit decision is recorded in a
// flag and surfaced only after the transaction has committed. Callers must use
// e.remoteIP() (not realIP) for the bucket key.
function consumeRate(app, bucket, limit, windowMs) {
  const now = Date.now();
  let exceeded = false;

  app.runInTransaction((tx) => {
    let record = null;
    try {
      record = tx.findFirstRecordByFilter("office_limits", "bucket = {:bucket}", { bucket: bucket });
    } catch {
      record = null;
    }

    let count;
    if (!record) {
      const collection = tx.findCollectionByNameOrId("office_limits");
      record = new Record(collection);
      record.set("bucket", bucket);
      record.set("window_start", now);
      count = 1;
    } else {
      const start = record.getInt("window_start");
      if (now - start >= windowMs) {
        record.set("window_start", now);
        count = 1;
      } else {
        count = record.getInt("count") + 1;
      }
    }
    record.set("count", count);
    tx.save(record);

    // Prune rows whose window has long expired so storage stays bounded.
    tx.db()
      .newQuery("DELETE FROM office_limits WHERE window_start < {:cutoff}")
      .bind({ cutoff: now - RATE_PRUNE_MS })
      .execute();

    exceeded = count > limit;
  });

  if (exceeded) throw new TooManyRequestsError("Terlalu banyak permintaan. Coba lagi sebentar lagi.");
}

// Allocates the next monotonic message sequence inside the caller's serialized
// transaction (PocketBase allows a single writer at a time, so MAX(seq)+1 never
// races). MAX instead of COUNT keeps the value strictly increasing even after
// retention deletes, because retention only ever removes the oldest rows, so the
// current maximum is preserved. Ordering by seq is therefore deterministic even
// when several messages land in the same millisecond.
function nextMessageSeq(tx) {
  const row = new DynamicModel({ n: 0 });
  tx.db().newQuery("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM office_messages").one(row);
  return row.n;
}

function characterPayload(record, now) {
  return {
    id: record.getInt("cid"),
    active: record.getBool("active") && record.getInt("lease_expires") > now,
    x: record.getFloat("x"),
    y: record.getFloat("y"),
    direction: record.getString("direction") || "down",
    status: record.getString("status") || DEFAULT_STATUS,
  };
}

function messagePayload(record) {
  return {
    id: record.id,
    seq: record.getInt("seq"),
    name: record.getString("name"),
    text: record.getString("text"),
    time: record.getString("time"),
    sprite: record.getInt("sprite"),
  };
}

// "HH:MM" in WIB (UTC+7) without relying on the host timezone.
function wibTime(ms) {
  const date = new Date(ms + 7 * 60 * 60 * 1000);
  const hours = ("0" + date.getUTCHours()).slice(-2);
  const minutes = ("0" + date.getUTCMinutes()).slice(-2);
  return hours + ":" + minutes;
}

module.exports = {
  DIRECTIONS: DIRECTIONS,
  DEFAULT_STATUS: DEFAULT_STATUS,
  MAP_W: MAP_W,
  MAP_H: MAP_H,
  KEEP_MESSAGES: KEEP_MESSAGES,
  leaseTtlMs: leaseTtlMs,
  rateConfig: rateConfig,
  body: body,
  readToken: readToken,
  parseCharacterId: parseCharacterId,
  parseCoordinate: parseCoordinate,
  parseDirection: parseDirection,
  parseStatus: parseStatus,
  parseText: parseText,
  parseAfterSeq: parseAfterSeq,
  requireCharacter: requireCharacter,
  consumeRate: consumeRate,
  nextMessageSeq: nextMessageSeq,
  characterPayload: characterPayload,
  messagePayload: messagePayload,
  wibTime: wibTime,
};
