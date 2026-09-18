// Forward migration: sync office_characters to the generated map's seats.
//
// Map version: "homebase-office/2026-09-18" — the seat layout produced by
// scripts/build-approved-office-map.ts after the 1920x960 consolidation. The
// original migration (1789603200_office_schema.js) was already applied on
// deployed databases, so editing it only helps fresh installs; this forward
// migration brings EXISTING databases to the same seats.
//
// Safety rules (deliberate):
//   * Only INACTIVE rows are moved, and only x/y/direction. An active row is a
//     live lease — moving it would teleport a player mid-session — so it is
//     skipped; the updated client's next heartbeat moves it instead.
//   * name, sprite, status, active, lease_token_hash and lease_expires are never
//     touched. Claim leases, tokens and status are preserved exactly.
//   * The down migration is an honest no-op: the previous x/y/direction of each
//     inactive row is not recoverable here, so rollback does not guess a
//     position and never mutates the rows back.

const MAP_VERSION = "homebase-office/2026-09-18";

// x/y/direction only — matches the six seats in lib/office-map.json and the
// fresh-install seeds in 1789603200_office_schema.js.
const SEATS = [
  { cid: 1, x: 1542.5, y: 88.75, direction: "down" },
  { cid: 2, x: 1621.25, y: 88.75, direction: "down" },
  { cid: 3, x: 1542.5, y: 186.25, direction: "up" },
  { cid: 4, x: 1621.25, y: 186.25, direction: "up" },
  { cid: 5, x: 1697.5, y: 128.75, direction: "right" },
  { cid: 6, x: 1811.25, y: 128.75, direction: "left" },
];

migrate(
  (app) => {
    console.log("office seat sync -> " + MAP_VERSION);
    for (const seat of SEATS) {
      let record = null;
      try {
        record = app.findFirstRecordByFilter("office_characters", "cid = {:cid}", { cid: seat.cid });
      } catch {
        continue; // character row is absent (unexpected): nothing to move
      }
      if (!record) continue;
      if (record.getBool("active")) continue; // live lease: never teleport
      record.set("x", seat.x);
      record.set("y", seat.y);
      record.set("direction", seat.direction);
      app.save(record);
    }
  },
  () => {
    // Honest no-op: see the note above — the prior positions are not
    // recoverable, so rollback deliberately changes nothing.
  },
);
