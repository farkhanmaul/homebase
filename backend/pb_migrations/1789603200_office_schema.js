// Creates the office collections and seeds the six fixed characters.
//
// All three collections are locked down (null API rules) so the default
// PocketBase Web API cannot list, create or update them. The office client
// only ever talks to the custom routes registered in pb_hooks/office.pb.js,
// which never serialize the lease token hash.
migrate(
  (app) => {
    const characters = new Collection({
      type: "base",
      name: "office_characters",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: "cid", type: "number", required: true, onlyInt: true, min: 1, max: 6 },
        { name: "name", type: "text", required: true, min: 1, max: 40 },
        { name: "sprite", type: "number", onlyInt: true, min: 0, max: 5 },
        { name: "x", type: "number", min: 0, max: 1920 },
        { name: "y", type: "number", min: 0, max: 960 },
        { name: "direction", type: "select", maxSelect: 1, values: ["up", "down", "left", "right"] },
        { name: "status", type: "text", max: 80 },
        { name: "active", type: "bool" },
        // Sensitive: sha256 hex of the bearer token. Hidden from serialization and
        // never returned by the custom routes (a hash is stored, not the token).
        { name: "lease_token_hash", type: "text", max: 64, hidden: true },
        { name: "lease_expires", type: "number", onlyInt: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_office_characters_cid ON office_characters (cid)",
        "CREATE INDEX idx_office_characters_token ON office_characters (lease_token_hash)",
      ],
    });
    app.save(characters);

    const messages = new Collection({
      type: "base",
      name: "office_messages",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        // v0.40 base collections only add an "id" system field automatically.
        // "created" is explicit metadata; "seq" is the monotonic insertion order
        // allocated inside the serialized write transaction, used for both
        // retention and retrieval so same-millisecond writes stay deterministic.
        { name: "created", type: "autodate", onCreate: true },
        { name: "seq", type: "number", required: true, onlyInt: true },
        { name: "character", type: "number", required: true, onlyInt: true, min: 1, max: 6 },
        { name: "name", type: "text", required: true, min: 1, max: 40 },
        { name: "sprite", type: "number", onlyInt: true, min: 0, max: 5 },
        { name: "text", type: "text", required: true, min: 1, max: 500 },
        { name: "time", type: "text", max: 5 },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_office_messages_seq ON office_messages (seq)"],
    });
    app.save(messages);

    const limits = new Collection({
      type: "base",
      name: "office_limits",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: "bucket", type: "text", required: true, max: 120 },
        { name: "window_start", type: "number", required: true, onlyInt: true },
        { name: "count", type: "number", required: true, onlyInt: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_office_limits_bucket ON office_limits (bucket)"],
    });
    app.save(limits);

    // Exactly six characters. cid/name/sprite/x/y/direction match the assigned
    // seats in lib/office-map.json (the single source of truth for the 1920x960
    // world), all inside Bilik Geng Kami. sprite is the app's cid-1 convention.
    const seats = [
      { cid: 1, name: "Farkhan", sprite: 0, x: 1542.5, y: 88.75, direction: "down" },
      { cid: 2, name: "Surya", sprite: 1, x: 1621.25, y: 88.75, direction: "down" },
      { cid: 3, name: "Imam", sprite: 2, x: 1542.5, y: 186.25, direction: "up" },
      { cid: 4, name: "Malla", sprite: 3, x: 1621.25, y: 186.25, direction: "up" },
      { cid: 5, name: "Siska", sprite: 4, x: 1697.5, y: 128.75, direction: "right" },
      { cid: 6, name: "Mona", sprite: 5, x: 1811.25, y: 128.75, direction: "left" },
    ];
    for (const seat of seats) {
      const record = new Record(characters);
      record.set("cid", seat.cid);
      record.set("name", seat.name);
      record.set("sprite", seat.sprite);
      record.set("x", seat.x);
      record.set("y", seat.y);
      record.set("direction", seat.direction);
      record.set("status", "Available");
      record.set("active", false);
      record.set("lease_token_hash", "");
      record.set("lease_expires", 0);
      app.save(record);
    }
  },
  (app) => {
    for (const name of ["office_limits", "office_messages", "office_characters"]) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        // already removed
      }
    }
  },
);
