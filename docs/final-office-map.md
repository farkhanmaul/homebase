# Final office map

Data-driven, hybrid pixel-art office world for the Homebase / "Nongkrong Kantor"
preview. This document covers the **final generated manifest** (builder phase),
the geometry helpers + tests, the in-app canvas renderer + interactions, and the
backend bounds.

## Why

The previous build drew a single 960x540 room from a 1.5 MB raster
(`public/room/bilik-geng-v4.png`), with seats, walls and collision hardcoded in
`app/page.tsx`. The goal is a 1920x960 world with the lobby and the office
seamless in one space, faithful to the approved floor plan, with no heavy
runtime graphics dependency and no new framework.

## Approved sources + generator

`lib/office-map.json` is **generated**, not hand-edited. It is consolidated from
four approved, read-only review artifacts, using a single uniform transform:

| Role | Approved artifact |
| --- | --- |
| Base structure (walls, partitions, columns, lifts, doors, gaps) | `docs/reviews/office-structure-review-v2.json` |
| Top-row rooms + Reception + general furniture | `docs/reviews/office-furniture-review-v1.json` |
| Pantry / toilet / service corrections + extra furniture | `docs/reviews/office-pantry-service-focus-v1.json` |
| Desk Collection / Tele corrections, Best Agent board, open Tele top, 18x12 aisle | `docs/reviews/office-workareas-focus-v4.json` |

The selection (paths + current SHA256 + superseded versions) is recorded in
`docs/reviews/approved-map-selection.json`. History that is **not** used:
structure v1, workareas v2, workareas v3 (v4 wins). Pantry-focus v1 wins for the
service core; workareas v4 wins for the work areas.

Regenerate:

```sh
node --experimental-strip-types scripts/build-approved-office-map.ts
```

The generator:

- verifies the SHA256 of each selected source (and rejects drift),
- applies only the approved overrides (open Tele top `OV-TOP-OPEN`; pantry back
  wall stops at `x=512`; Desk Collection top split at the v4 C6 gap `x704..728`;
  the two side chairs shifted to `x=738`; the wall-mounted Best Agent board),
- checks every final wall is an approved source sub-segment,
- asserts the exact per-room furniture counts, three columns, six Bilik Geng Kami
  seats, the open Tele top, the open Wastafel path, the forbidden names, the
  board/certificate hotspots and no invented Meeting-2 screen,
- writes `lib/office-map.json` with 2-space JSON deterministically (two runs are
  byte-identical).

### Coordinate transform

```
worldX = 60 + (sourceX - 44) * 1.25
worldY = 40 + (sourceY - 41) * 1.25
```

Source extents `x44..1465, y41..761` map into `x60..1836.25, y40..940` inside the
1920x960 world. The scale is uniform (1.25 on both axes — no non-uniform
stretch). Every transformed coordinate is rounded **half-up to 2 decimals**, with
rect extents derived from the transformed endpoints so no gaps appear.

## Single source of truth

| Piece | Path | Role |
| --- | --- | --- |
| Generator | `scripts/build-approved-office-map.ts` | Approved sources → final manifest. |
| Selection | `docs/reviews/approved-map-selection.json` | Selected sources + hashes + superseded history. |
| Manifest | `lib/office-map.json` | **The only place world coordinates exist.** Generated. |
| Helpers | `lib/office-map.ts` | Types, strict validation, pure geometry. Imports the JSON and validates it at import time. |
| Review draw list | `lib/office-render-ops.ts` | Manifest → labelled technical-review ops, including QA markers and legend. Never used by the runtime canvas. |
| Game draw list | `lib/office-game-ops.ts` | Manifest → layered pixel-art ops plus one local Bilik image op. Contains no room labels, seat numbers, hotspot initials or internal ids. |
| Bilik zone art | `public/room/bilik-geng-zone.png` | Deterministic 386x185 derivative of approved V1 art; vector art remains the load-failure fallback. |
| Canvas | `lib/office-renderer.ts` | Builds the vector world immediately, rebuilds it once after the local Bilik image loads, then only blits the camera crop and draws actors per frame. |
| Camera | `lib/office-camera.ts`, `lib/office-viewport.ts` | Closer gameplay view and desktop room framing; mobile keeps the actor-follow view. |
| Input | `lib/office-interaction.ts` | Pure pointer→world mapping, avatar hit test, and the hotspot interaction reducer. |
| Spawn policy | `lib/office-spawn.ts` | Manifest-seat reset and active-only remote position merge; stale inactive coordinates are ignored. |
| Page | `app/page.tsx` | Wires the manifest into the existing UI. No map coordinates. |
| Tests | `tests/office-map.test.ts`, `tests/office-map-sources.test.ts`, `tests/office-interaction.test.ts`, `tests/office-render-game.test.ts`, `tests/office-render-ops.test.ts`, `tests/office-renderer.test.ts`, `tests/office-spawn.test.ts`, `tests/office-viewport.test.ts` | Geometry, source/generator, interaction, game/review separation, spawn recovery and preview invariants. |
| Preview | `scripts/generate-map-preview.ts` | Deterministic technical-review and game-art SVG/PNG artifacts from their respective op lists. |

Nothing else may declare map coordinates. Both render modes consume `officeMap`;
the game canvas and game-art preview consume the exact same game op list, while the
technical preview remains deliberately separate. A geometry edit therefore cannot
drift from either artifact. `lib/office-map.json` is 52,510 bytes (4,983 bytes gzip).

## World

- `width` 1920, `height` 960, `margin` 40, `wallThickness` 6.25, `partitionThickness` 3.75
  (5 and 3 source px × 1.25).
- Actor footprint: `halfWidth` 9, `feet` 12 — an **18 wide × 12 deep** foot box.
- Spawn is the assigned seat of character 1 (seat-1), inside Bilik Geng Kami.
- A successful claim always resets that character to its assigned manifest seat
  and immediately heartbeats the reset position. Inactive availability rows never
  overwrite a seat; active remote rows still update normally. `Reset posisi` and
  the `R` shortcut share the same reset path and immediately persist it.
- The building footprint is L-shaped: the notch left of the top row and above the
  lobby is *outside* the leased office, rendered as background and kept
  non-walkable by `void` blocks.

Counts: 21 zones, 35 walls, 3 columns, 17 blocks (9 void + 8 sealed),
123 furniture pieces (89 chairs), 16 openings, 3 windows, 22 surfaces,
21 hotspots, 6 seats.

### Zones

| Zone id | Label | Kind | Rect |
| --- | --- | --- | --- |
| `meeting-1` | Ruang Meeting 1 | room | 513.75,40 178.75x185 |
| `hrga` | Ruangan HRGA | room | 692.5,40 176.25x185 |
| `komisaris` | Bilik Komisaris | room | 868.75,40 145x185 |
| `product-manager` | Bilik Product Manager | room | 1013.75,40 145x185 |
| `it` | Bilik IT | room | 1158.75,40 143.75x185 |
| `direktur-finance` | Bilik Direktur Finance | room | 1302.5,40 147.5x185 |
| `bilik-geng-kami` | Bilik Geng Kami | room | 1450,40 386.25x185 |
| `resepsionis` | Resepsionis | room | 342.5,225 171.25x166.25 |
| `lobby-besar` | Lobby Besar | lobby | 133.75,391.25 380x548.75 |
| `lorong-utama` | Lorong Utama | corridor | 513.75,225 1322.5x68.75 |
| `sirkulasi` | Sirkulasi | corridor | 513.75,293.75 131.25x97.5 |
| `jalur-terbuka` | Jalur Terbuka | corridor | 645,293.75 52.5x290 |
| `pantry` | Pantry | open | 513.75,391.25 131.25x83.75 |
| `gudang` | Gudang | service | 513.75,475 76.25x140 |
| `toilet-wanita` | Toilet Wanita | service | 590,518.75 55x96.25 |
| `wastafel` | Wastafel | open | 645,583.75 52.5x31.25 |
| `toilet-pria` | Toilet Pria | service | 697.5,507.5 46.25x107.5 |
| `meeting-2` | Ruang Meeting 2 | room | 697.5,292.5 176.25x172.5 |
| `server` | Ruang Server | service | 743.75,465 130x150 |
| `desk-collection` | Desk Collection | open | 873.75,293.75 576.25x321.25 |
| `tele-cs-ca` | Tele / CS / CA | open | 1450,293.75 386.25x321.25 |

There is **no** `Koridor Servis` and **no** `Koridor Bawah` zone, label or
collider. The main horizontal circulation is `lorong-utama`; the open vertical
strip above the Wastafel is `jalur-terbuka` (unobstructed up to the main
circulation); `sirkulasi` is the open pocket in front of the Pantry. Surfaces map
each zone to a floor material (`lobby`, `office`, `corridor`, `service`, `rug`);
one extra `rug` patch is layered inside the lobby.

### Seats (fixed six, all inside Bilik Geng Kami)

The six characters map 1:1 to the six approved Bilik Geng Kami chairs
(`F-GENG-C1`..`C6`).

| Seat | Character | x,y | Facing | Chair |
| --- | --- | --- | --- | --- |
| seat-1 | Farkhan | 1542.5,88.75 | down | F-GENG-C1 |
| seat-2 | Surya | 1621.25,88.75 | down | F-GENG-C2 |
| seat-3 | Imam | 1542.5,186.25 | up | F-GENG-C3 |
| seat-4 | Malla | 1621.25,186.25 | up | F-GENG-C4 |
| seat-5 | Siska | 1697.5,128.75 | right | F-GENG-C5 |
| seat-6 | Mona | 1811.25,128.75 | left | F-GENG-C6 |

## Topology

- **Lobby Besar** dominates the lower-left. Four lift shafts sit in the lobby's
  left and right wall banks (two per side), opening inward. A double door
  (`op-recep-lobby`) connects the lobby up into the reception.
- **Resepsionis** sits above the lobby. Its **right/east** door
  (`op-recep-corridor`) opens onto the far-left end of the main circulation.
- **lorong-utama** runs under the whole top row, with a door/gap aligned to each
  room (D1 Meeting 1, D2 HRGA, celah C1–C5 for Komisaris/Product/IT/Finance/Geng).
- **Top row** left→right: Meeting 1, HRGA, Komisaris, Product Manager, IT,
  Direktur Finance, Bilik Geng Kami (largest, with the right window bay).
- **Service core** (`x 407..695`): the Pantry sits on top; beneath it the four
  tall cells read left→right **Gudang, Toilet Wanita, Wastafel, Toilet Pria**
  (`y 389..501`). Gudang and both toilets are sealed; the **Wastafel** cell is
  entered from the open strip through `op-wastafel`. Meeting Room 2 stays to the
  right of the row and the Server sits below it.
- **Lower block**: Meeting 2 (full walls, corridor door), Server (sealed,
  restricted, door on the Desk Collection side only), and the open Desk
  Collection and Tele/CS/CA work areas. Desk Collection is entered from the
  corridor through the C6 gap and connects to Tele/CS/CA past the `x=1156`
  separator; the **Tele/CS/CA top edge is open** to the main circulation. Both
  work areas stop at the `y=501` service block — they do not extend downward.
- **Windows** run along the top and right perimeter as cool-blue rects.
- **Columns** are solid collision blocks: exactly three — Meeting 1,
  Komisaris boundary, Bilik Geng Kami.

## Collision model

```
colliders = walls ∪ columns ∪ blocks ∪ furniture where solid
```

- `isBlocked(manifest, x, y, actor?)` builds the actor's **foot box**
  (`x ± halfWidth`, `y - feet .. y`) and is blocked when the box is outside the
  world or overlaps a collider that a **door opening** does not fully cover.
- Openings (`op-*`) are walkable gaps carved into walls. Coverage is exact: an
  actor may stand in the doorway, but the moment its foot box touches wall
  material outside the opening it is blocked.
- `blocks` are the sealed interiors (Gudang, both toilets, Server and the four
  lift shafts) and the **void** blocks covering the outside notch; the void
  blocks keep the outside region non-walkable.
- Chairs, sofas and the wall-mounted Best Agent **board** are decorative
  (`solid: false`) so seats, aisles and the west lane stay walkable; desks,
  tables, counters, cabinets, banks, dispensers, fridges and sinks are solid.

## Helper API (`lib/office-map.ts`)

Pure and dependency-free (runs under `node --experimental-strip-types` and in the
browser bundle):

- Primitives: `rectArea`, `rectContainsPoint`, `rectContainsRect`, `intersectRect`.
- `actorFootBox(x, y, actor)`.
- `isBlocked`, `isWalkable`.
- `zoneAt` (smallest matching zone wins), `zoneById`, `seatFor`.
- `nearestHotspot(manifest, x, y, { maxDistance?, kinds? })` → `{ hotspot, distance } | null`.
- `clampCamera(manifest, view, target)` → clamped top-left camera position.
- `validateManifest(manifest)` → throws `MapValidationError`.
- `officeMap` (the validated manifest) plus `BILIK_GENG_ZONE_ID` and
  `DEFAULT_HOTSPOT_RANGE` (72).

`FurnitureKind` gained `board`; `HotspotKind` gained `board` and
`certificate-table`. `lib/office-render-ops.ts` gained a `board` fill.

### Validation rules (fail clearly)

Non-positive world or actor, duplicate ids across **all** collections, any rect
that is not positive or leaves the world, openings with a bad orientation, seats
outside Bilik Geng Kami or not walkable, an unreachable spawn, hotspot/surface
references to unknown zones, and a missing "Bilik Geng Kami" zone. The manifest is
validated when the module is imported, so an invalid map aborts the import rather
than rendering wrongly.

### Hotspots

Six assigned seats, four lifts, locked Gudang, pantry fridge + pantry/HR/IT/Finance
dispensers, the Best Agent board, the certificate table, the restricted Server,
Reception and the exit. There is **no** Meeting-2 screen hotspot (and no screen
furniture anywhere) — the Meeting-2 south object is only the wired external table,
and the board is the distinct `board` furniture type.

## Frontend integration (slice B)

`app/page.tsx` hardcodes no geometry. What it does:

- **Initial state**: the six characters' positions, sprite index and facing come
  from `officeMap.seats`; `SEATS`, `BLOCKS`, `NAMES` and the `inWall` helper are
  gone, as is the `room/bilik-geng-v4.png` raster.
- **Rendering**: `createWorldCanvas(officeMap)` paints the whole static world once
  into an offscreen 1920x960 canvas (via the shared op list). Each animation frame
  calls `drawWorldCrop` then `drawActors`; room geometry is never rebuilt per frame.
- **Collision**: `isBlocked(officeMap, x, y)` with the manifest's foot-box actor.
- **Camera**: `clampCamera(officeMap, view, {x, y})` — see "Viewport sizing".
- **Zone caption**: `zoneAt(officeMap, x, y)?.name` in the caption and an
  `aria-live` sr-only mirror.
- **Interactions (E/X)**: `resolveInteraction(officeMap, {cid, x, y, sitting})`
  returns a pure outcome. Your own seat toggles sit/stand; another character's
  seat refuses to seat you; the exit hotspot sets `Pulang` via the normal
  heartbeat; lifts, Gudang, fridge, dispensers, the board, the certificate table,
  the server notice and reception show their manifest message. All outcomes are
  local — no new tables or endpoints.
- **Click-to-profile**: `screenToWorld(...)` inverts the letterbox/scale and the
  camera, then `playerAtPoint` hit-tests the avatar body box.

### Viewport sizing (letterboxing fix)

`lib/office-viewport.ts` derives the camera view from the **real container aspect
ratio** while keeping a controlled world scale: desktop anchors on a 960
world-unit width and derives the height; mobile anchors on a 600 world-unit
height and derives the width. Both axes are clamped to the world and always
positive, so the backing ratio matches the CSS box and no letterboxing occurs.

| Container box | Mode | View (backing) | Box aspect → view aspect |
| --- | --- | --- | --- |
| 1072x778 | desktop | 960x697 | 1.3779 → 1.3773 |
| 368x603 | mobile | 366x600 | 0.6103 → 0.6100 |
| 1440x700 | desktop | 960x467 | 2.0571 → 2.0557 |
| 414x720 | mobile | 345x600 | 0.5750 → 0.5750 |

`app/page.tsx` reads the canvas box through a `ResizeObserver` into a ref and only
recomputes the view when the box (or the desktop/mobile mode) changes, so the
animation frame never reads layout and never touches React state.

## Backend bounds (slice C)

The world is 1920x960 on the server too, enforced in three places:

- **`backend/pb_hooks/office_lib.js`** — `MAP_W`/`MAP_H` are 1920/960, so
  `parseCoordinate` accepts the whole world and rejects anything outside it.
- **`backend/pb_migrations/1789603200_office_schema.js`** (the original, already
  applied elsewhere) — updated *for fresh installs only*: `office_characters.x`
  max 1920, `y` max 960, and the six seeded characters now use the generated
  manifest's seats exactly (`cid`/`name`/`sprite`/`x`/`y`/`direction`, sprite =
  `cid - 1`). The filename and the `down` migration are untouched.
- **`backend/pb_migrations/1789689600_office_map_bounds.js`** — widens the `x`/`y`
  field constraints on databases that already exist, because editing an applied
  migration never re-runs it. It is deliberately **bounds-only**: it moves no rows.

### Seat sync migration (existing databases)

**`backend/pb_migrations/1789776000_office_map_seats.js`** is a new forward
migration, explicitly map-versioned (`MAP_VERSION = "homebase-office/2026-09-18"`),
that brings an existing database to the same seats as a fresh install:

- it updates **`x`/`y`/`direction` only**, keyed by `cid`, and **only for
  `active = false` rows**. An active row is a live lease — moving it would
  teleport a player mid-session — so it is skipped and the updated client's next
  heartbeat moves it instead. `name`, `sprite`, `status`, `active`,
  `lease_token_hash` and `lease_expires` are never touched.
- the `down` migration is an honest **no-op** with a comment: the previous
  coordinates of each inactive row are not recoverable, so rollback never guesses
  a position.

Applying it is idempotent and restart-safe (PocketBase records the applied file,
so a restart does not re-run it, and re-running would set identical values).

### Backend tests

`backend/tests/test_office_api.py` has 58 tests. The backend suite covers the
enlarged bounds (fresh schema, world corners, just-outside rejects), the exact
seed contract against the generated manifest, and realistic upgrade migrations
that run the real forward files against the pre-change schema and assert: bounds
enlarged; inactive legacy rows moved to the manifest seats; every other field
preserved; an active row's `x`/`y`/`direction` and lease fields untouched; and
idempotent/restart-safe behaviour.

## Preview generator

```
npm run preview:map
```

- Technical review: `docs/previews/final-office-map.svg` and `.png` (1920x1052),
  with room labels, markers and legend for geometry QA only.
- Runtime game art: `docs/previews/final-office-game.svg` and `.png` (1920x960),
  generated from the same `buildGameWorldOps()` used by the canvas. It has layered
  pixel-art surfaces, walls, windows and furniture, but no debug labels, codes,
  hotspot badges or seat numbers.
- PNG artifacts are produced when a rasterizer is
  available: first a real SVG rasterizer (`rsvg-convert`, `resvg`, `inkscape`,
  ImageMagick), otherwise the bundled Pillow backend
  `scripts/rasterize-map-preview.py`, which paints the **exact same op list** the
  SVG serializer consumes. It is a second *backend*, not a second map.
- Deterministic: fixed ordering, no timestamps, no randomness. Re-running produces
  byte-identical files (verified by sha256 below).

### Label placement

The following label rules apply only to the technical review artifact. Labels are
never painted into the runtime game world; the DOM caption and aria-live output
report the active zone instead. Review labels are drawn last, in warm off-white
(`#f4efdf`) at 16 px on an opaque dark
band (`#0b1720`, warm border). A band goes in the first clear corner of the room.
The obstacle test now treats a hotspot marker as an obstacle when its box
**overlaps** the room (not only when its centre is inside), so a door marker that
straddles a room edge can no longer be painted over. Tall/narrow cells
(`w < 90 && h >= w * 1.8`) get a single **rotated (-90°)** label; all three
backends honour the op's `rotate`. Visual inspection of the generated preview
confirmed every label is legible and clear of desks, chairs and hotspot dots, no
label is clipped, and the tall service cells carry rotated labels.

A zone may opt out of being painted with `showLabel: false` (default `true`): the
name still resolves through `zoneAt` for the UI caption, but the renderer emits no
label band for it. The source-unlabelled transit zones `sirkulasi` and
`jalur-terbuka` and the tiny `wastafel` cell (whose 16px label spilled over the
two toilet labels) are set unlabelled; every real room keeps its label.

## Design decisions / documented deviations

- **Proportional, not architectural.** Rects preserve the plan's topology and
  routes; they are not measured building dimensions.
- **Uniform wall thickness.** Walls are drawn at the base structure's stroke
  (5 source px for full, 3 for partitions) × 1.25, rather than the v4 panel's
  stroke-2 movement convention. The west lane still comes out wider than the real
  18-wide actor, so the v4 clearance holds.
- **Approximate celah C1/C2 moved clear of the approved desks.** Structure v2's
  "celah" positions are documented as approximate, and the approved Komisaris /
  Product desks sit flush on the bottom wall at exactly the structural centres
  (`x738` / `x862`) — which would seal both rooms behind a solid desk. The two
  gaps are moved onto the clear segment of the same bottom partition so the
  approved rooms stay enterable. This is recorded in the generator.
- **Chamfer approximated.** The top-right window chamfer is a diagonal in the
  source; the shared renderer is axis-aligned, so it is represented by
  axis-aligned window rects (`win-top`, `win-chamfer`, `win-right`).
- **Lifts are non-transition hotspots** that report "Lift/transisi belum aktif di
  preview."
- **Sealed interiors.** Gudang, both toilets and the Server are sealed collision
  blocks, but game art does not cover them with an opaque debug overlay;
  their doors are hotspots/thresholds only, and there is no invented furniture in
  them. Gudang stays locked; the Server is restricted and reached from the Desk
  Collection side.
- **Reception vs exit.** The Resepsionis hotspot is informational; only `hs-exit`
  (lobby) sets the status to "Pulang".
- **Seat density is visual.** Desk Collection shows two banks + 34 chairs and
  Tele/CS/CA two banks + 24 chairs; only the six characters have interactive
  seats.

## RED / GREEN evidence

Builder phase A1/A2 (this phase). RED — before the new tests were rewritten, the
old topology tests ran against the newly generated manifest:

```
$ npm run test:frontend
not ok 22 - walls, columns and solid furniture block movement
not ok 26 - walkable spots across the map are reported as free
not ok 27 - zoneAt resolves the containing zone, preferring the smallest match
not ok 30 - the manifest carries the required data-driven hotspots
not ok 32 - every required area is reachable from the lobby entrance
not ok 34 - the service core is a horizontal row beneath the pantry
not ok 35 - the wash path in front of the service doors stays walkable and reachable
not ok 37 - no label band overlaps a hotspot or seat marker
# tests 76  # pass 68  # fail 8
```

GREEN:

```
npm run test:frontend  ->  # tests 102  # pass 102  # fail 0
npm run lint           ->  Found 0 warnings and 0 errors
npx tsc --noEmit       ->  (no output, exit 0)
npm run preview:map    ->  svg 1920x1052 (two runs byte-identical)
npm run build:pages    ->  built
git diff --check       ->  clean
```

The map suite (`tests/office-map.test.ts`) covers the geometry primitives, the
strict validation failures, the approved inventory counts, the open Tele top, the
open Wastafel path, the sealed/“door approach walkable” semantics, the Best Agent
board/certificate hotspots (and the absence of an invented Meeting-2 screen), the
v4 west-lane clearance, and a grid BFS at step 6 with the real 18x12 actor from
the lobby entrance to Reception, the main circulation, every top-row room, the six
seats, Meeting 2, Pantry/Wastafel, the Desk lower bank, Tele/CS/CA and the Server
door approach. The generator suite (`tests/office-map-sources.test.ts`) covers the
transform anchors/extents, source-hash selection and drift rejection,
determinism, and that the shipped manifest is exactly the generated output.

Quality-pass RED reproduced the production bug exactly: an inactive Farkhan row at
`139,211` replaced the manifest seat at `1542.5,88.75`; the first policy tests also
failed because the runtime draw list still contained review labels/markers and each
furniture item was one flat rectangle. GREEN after the split and recovery fix:

```
npm run test:frontend  ->  # tests 125  # pass 125  # fail 0
npm run backend:test   ->  # tests 58   # pass 58   # fail 0
npm run backend:setup:test -> PASS
npm run lint           ->  Found 0 warnings and 0 errors
npx tsc --noEmit       ->  (no output, exit 0)
npm run build:pages    ->  built
git diff --check       ->  clean
```

Browser tests at 1440x1000, 320x480, 368x603 and 414x720 inject the stale
`139,211` coordinate, assert the first claim heartbeat is the manifest seat, and
assert `Reset posisi` sends an immediate second heartbeat to that same seat.

### V1-detail art pass

The room art pass keeps `lib/office-map.json`, collision, seats, backend and the
dependency set byte-identical. It adds workstation detail, a closer camera, desktop
room framing and one compact local Bilik raster derived deterministically from
`public/room/bilik-geng-v4.png`. The raster is loaded once; if it fails, the vector
scene remains visible. Actor sprites, labels and rings use world-pixels-per-CSS-pixel
scaling, so room zoom does not enlarge them or move their feet off the manifest seat.

```
npm run test:frontend      ->  # tests 181  # pass 181  # fail 0
npm run backend:test       ->  # tests 58   # pass 58   # fail 0
npm run backend:setup:test ->  PASS
npm run lint               ->  Found 0 warnings and 0 errors
npx tsc --noEmit           ->  exit 0
npm run build:pages        ->  built
git diff --check           ->  clean
```

The final game layer contains 7,925 painted ops (budget 9,000). Gameplay-camera
previews are `v1-detail-bilik`, `v1-detail-workareas` and `v1-detail-pantry` under
`docs/previews/`. Image ops are embedded into SVG artifacts as deterministic data
URIs and are also supported by the Pillow fallback rasterizer.

Earlier slices (unchanged behaviour): slice A/B/C RED/GREEN evidence and the
viewport/rotation fixes are recorded in git history of this file.

## Artifacts

| Artifact | Dimensions | Bytes | sha256 |
| --- | --- | --- | --- |
| `docs/previews/final-office-map.svg` | 1920x1052 | 33,576 | `23db5827…e2743d29` |
| `docs/previews/final-office-map.png` | 1920x1052 | 73,637 | `5d749c6b…df4b0dc9` |
| `docs/previews/final-office-game.svg` | 1920x960 | 732,711 | `02214cdf…068cb211` |
| `docs/previews/final-office-game.png` | 1920x960 | 168,834 | `36889760…58dbb312` |
| `docs/previews/v1-detail-bilik.png` | 934x648 | 139,628 | `11e3a6b5…55b98e9a` |
| `public/room/bilik-geng-zone.png` | 386x185 | 105,793 | `aa5874c5…a67fdb57` |
| `lib/office-map.json` | — | 52,510 (4,983 gzip) | `28f553ed…54db90d9` |

## Bundle budget

`npm run build:pages` (manifest + renderer + interactions in the app bundle):

- JS: 333.51 kB raw / **103.81 kB gzip** (budget 115 kB).
- CSS: 172.17 kB raw / **30.39 kB gzip** (budget 35 kB).

Both remain within budget. The 105,793-byte Bilik zone PNG is a separately cached
static asset; preview artifacts are not runtime assets.

The quality pass adds `lib/office-game-ops.ts`, `lib/office-spawn.ts`, their tests,
the game-art preview, runtime renderer separation, and accessible reset controls.
The later V1-detail pass adds the deterministic Bilik zone asset, image-op fallback,
room camera, CSS-sized actor presentation and crop previews. Neither pass changes
approved geometry, backend hooks, migrations or dependencies.

## Changed files (builder phase)

- Added `scripts/build-approved-office-map.ts`, `docs/reviews/approved-map-selection.json`,
  `tests/office-map-sources.test.ts`.
- Rewrote the generated `lib/office-map.json`, the map tests
  (`tests/office-map.test.ts`), and this document.
- `lib/office-map.ts` (+`board` furniture kind; +`board`/`certificate-table`
  hotspot kinds), `lib/office-render-ops.ts` (`board` fill; label obstacle test
  uses box overlap; unused import removed).
- Regenerated `docs/previews/final-office-map.{svg,png}`.
- Lint/TS cleanup in the review generators: `scripts/generate-workareas-focus-v2.ts`,
  `scripts/generate-workareas-focus-v3.ts`, `scripts/generate-workareas-focus-v4.ts`
  (explicit `any` → real types, `number[][]` → `[number, number][]`, comparators
  for `.sort()`), `scripts/generate-pantry-service-focus.ts` (unused helper, typed
  raw furniture), `scripts/generate-furniture-review.ts` (typed template literal).

- Phase B (integration) — `backend/pb_migrations/1789603200_office_schema.js`
  (fresh seeds = generated manifest seats), new
  `backend/pb_migrations/1789776000_office_map_seats.js` (inactive-only seat sync,
  no-op down), `backend/tests/test_office_api.py` (seed name/sprite + five upgrade
  tests), `app/page.tsx` (hint/button copy only: `WASD / panah · E untuk
  interaksi`, `Interaksi <kbd>E</kbd>`), `tests/office-interaction.test.ts` (board
  + certificate-table messages, no-screen assertion).

## Still outstanding

- Serve the manifest to the client instead of bundling it (saves ~5 kB gzip).
- Realtime movement (the client still polls every 2 s).
- Browser QA on a real physical phone (the automated 320/368/414 px passes are complete).

## Blockers

- A PNG needs either an SVG rasterizer or `python3` + Pillow on the machine. Both
  are auto-detected; on a machine with neither, only the SVG is written and the
  generator says so.
