// Custom office API consumed by lib/office-session.ts.
//
// Contract (all under /api/office/):
//   GET  characters -> {characters:[{id,active,x,y,direction,status}]}
//   POST claim      {id}                                  -> {token}
//   POST release                                           -> {ok}
//   POST heartbeat  {x,y,direction,status}                 -> {ok}
//   GET  messages   -> {messages:[{id,name,text,time,sprite}]}
//   POST messages   {text}                                 -> {ok}
//
// Every write except claim requires a valid X-Office-Session bearer token. The
// served character id/name/sprite always come from the token, never the body.

routerAdd("GET", "/api/office/characters", (e) => {
  const lib = require(__hooks + "/office_lib.js");
  const now = Date.now();
  const records = e.app.findRecordsByFilter("office_characters", "", "cid", 6, 0);
  const characters = [];
  for (const record of records) {
    characters.push(lib.characterPayload(record, now));
  }
  return e.json(200, { characters: characters });
});

routerAdd("POST", "/api/office/claim", (e) => {
  const lib = require(__hooks + "/office_lib.js");

  // Count the attempt first, in its own committed transaction, so invalid ids
  // (400) and conflicting claims (409) still consume the caller's budget.
  const claim = lib.rateConfig().claim;
  lib.consumeRate(e.app, "claim:" + (e.remoteIP() || "unknown"), claim.limit, claim.window);

  const id = lib.parseCharacterId(lib.body(e).id);
  const token = $security.randomString(48);
  const hash = $security.sha256(token);
  const ttl = lib.leaseTtlMs();

  // runInTransaction executes on PocketBase's single nonconcurrent DB connection,
  // so the free/expired check and the write below are atomic. Concurrent claims
  // for the same character therefore produce exactly one winner.
  e.app.runInTransaction((tx) => {
    let record;
    try {
      record = tx.findFirstRecordByFilter("office_characters", "cid = {:cid}", { cid: id });
    } catch {
      throw new NotFoundError("Karakter tidak ditemukan.");
    }

    const now = Date.now();
    if (record.getBool("active") && record.getInt("lease_expires") > now) {
      throw new ApiError(409, "Karakter baru saja dipakai. Pilih yang lain.");
    }

    record.set("active", true);
    record.set("lease_token_hash", hash);
    record.set("lease_expires", now + ttl);
    tx.save(record);
  });

  return e.json(200, { token: token });
});

routerAdd("POST", "/api/office/release", (e) => {
  const lib = require(__hooks + "/office_lib.js");

  // Counted before auth so unauthorized (401) release attempts consume budget too.
  const release = lib.rateConfig().release;
  lib.consumeRate(e.app, "release:" + (e.remoteIP() || "unknown"), release.limit, release.window);

  const now = Date.now();
  e.app.runInTransaction((tx) => {
    const record = lib.requireCharacter(tx, e, now);

    record.set("active", false);
    record.set("lease_token_hash", "");
    record.set("lease_expires", 0);
    tx.save(record);
  });

  return e.json(200, { ok: true });
});

routerAdd("POST", "/api/office/heartbeat", (e) => {
  const lib = require(__hooks + "/office_lib.js");

  // (1) Count the attempt in its own committed transaction first, so malformed
  // (400) and unauthorized (401) heartbeats still consume the IP budget.
  const heartbeat = lib.rateConfig().heartbeat;
  lib.consumeRate(e.app, "heartbeat:" + (e.remoteIP() || "unknown"), heartbeat.limit, heartbeat.window);

  // (2) Authenticate the bearer token BEFORE reading any route-specific body
  // field. An anonymous or forged request with a malformed body must be a 401,
  // never a 400 that leaks payload validation to unauthenticated callers.
  lib.requireCharacter(e.app, e, Date.now());

  // (3) Only now parse and validate the heartbeat payload.
  const data = lib.body(e);
  const x = lib.parseCoordinate(data.x, "x", lib.MAP_W);
  const y = lib.parseCoordinate(data.y, "y", lib.MAP_H);
  const direction = lib.parseDirection(data.direction);
  const status = lib.parseStatus(data.status);

  // (4) Re-resolve the character and re-check its lease inside the serialized
  // write transaction, closing the TOCTOU window between the pre-flight auth
  // above and the write (the lease could expire in between).
  e.app.runInTransaction((tx) => {
    const record = lib.requireCharacter(tx, e, Date.now());
    record.set("x", x);
    record.set("y", y);
    record.set("direction", direction);
    record.set("status", status);
    record.set("lease_expires", Date.now() + lib.leaseTtlMs());
    tx.save(record);
  });

  return e.json(200, { ok: true });
});

routerAdd("GET", "/api/office/messages", (e) => {
  const lib = require(__hooks + "/office_lib.js");
  const records = e.app.findRecordsByFilter("office_messages", "", "-seq", lib.KEEP_MESSAGES, 0);
  const messages = [];
  for (let i = records.length - 1; i >= 0; i--) {
    messages.push(lib.messagePayload(records[i]));
  }
  return e.json(200, { messages: messages });
});

routerAdd("POST", "/api/office/messages", (e) => {
  const lib = require(__hooks + "/office_lib.js");

  // (1) Count the attempt in its own committed transaction first, so empty
  // (400) and unauthorized (401) message attempts still consume the IP budget.
  const message = lib.rateConfig().message;
  lib.consumeRate(e.app, "message:" + (e.remoteIP() || "unknown"), message.limit, message.window);

  // (2) Authenticate the bearer token BEFORE reading the body, so an anonymous
  // or forged request with a malformed body is a 401, not a 400.
  lib.requireCharacter(e.app, e, Date.now());

  // (3) Only now parse and validate the message payload.
  const text = lib.parseText(lib.body(e).text);

  // (4) Re-resolve the character and re-check its lease inside the serialized
  // write transaction, closing the TOCTOU window between the pre-flight auth
  // above and the write (the lease could expire in between).
  e.app.runInTransaction((tx) => {
    const record = lib.requireCharacter(tx, e, Date.now());

    const collection = tx.findCollectionByNameOrId("office_messages");
    const entry = new Record(collection);
    entry.set("seq", lib.nextMessageSeq(tx));
    entry.set("character", record.getInt("cid"));
    entry.set("name", record.getString("name"));
    entry.set("sprite", record.getInt("sprite"));
    entry.set("text", text);
    entry.set("time", lib.wibTime(Date.now()));
    tx.save(entry);

    const total = tx.countRecords("office_messages");
    if (total > lib.KEEP_MESSAGES) {
      tx.db()
        .newQuery(
          "DELETE FROM office_messages WHERE id IN (SELECT id FROM office_messages ORDER BY seq ASC LIMIT {:n})",
        )
        .bind({ n: total - lib.KEEP_MESSAGES })
        .execute();
    }
  });

  return e.json(200, { ok: true });
});
