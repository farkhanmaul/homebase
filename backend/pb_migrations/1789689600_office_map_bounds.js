// Forward migration: enlarge the office world from 960x540 to 1920x960.
//
// The original migration (1789603200_office_schema.js) was already applied on
// deployed databases, so editing it only helps fresh installs. This forward
// migration widens the office_characters x/y field constraints on databases that
// already exist. It is bounds-only on purpose:
//
//   * No rows are moved or deleted. Every previously persisted coordinate is
//     still inside the enlarged world, so existing positions remain valid and a
//     character mid-session is never teleported by a deploy.
//   * The down migration restores the old 960x540 limits. It only succeeds while
//     no row sits outside them, which is the honest behaviour for a rollback.
//
// office_lib.js must be updated alongside this file: it validates heartbeat
// coordinates against the 1920x960 world.

migrate(
  (app) => {
    const characters = app.findCollectionByNameOrId("office_characters");

    const x = characters.fields.getByName("x");
    if (x) x.max = 1920;
    const y = characters.fields.getByName("y");
    if (y) y.max = 960;

    app.save(characters);
  },
  (app) => {
    const characters = app.findCollectionByNameOrId("office_characters");

    const x = characters.fields.getByName("x");
    if (x) x.max = 960;
    const y = characters.fields.getByName("y");
    if (y) y.max = 540;

    app.save(characters);
  },
);
