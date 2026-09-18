# Office furniture review v1 — notes

**Tahap 2 — Meja, Kursi, Lemari, Dispenser & Kulkas.**

Furniture is layered on the approved **structure review v2** (reused exactly: the
walls, partitions, doors, celah, columns, lifts, window edges and the locked
Gudang are *not* re-authored here). This review adds only furniture, plus a
dedicated generator and its artifacts. No structure file, app, backend, lib,
test, package or config file was touched.

Authoritative source: `img_52d36a282d20.png` (1516 × 808). Coordinates below are
**source pixels** in the same space as structure v2.

## Files

| Artifact | Path | Dimensions |
| --- | --- | --- |
| Data source (single source of truth) | `docs/reviews/office-furniture-review-v1.json` | — |
| Generator (deterministic) | `scripts/generate-furniture-review.ts` | — |
| Full map | `docs/reviews/office-furniture-review-v1.svg` / `.png` | 1516 × 808 |
| Panel A — top row | `docs/reviews/office-furniture-review-v1-top-row.svg` / `.png` | 2220 × 452 |
| Panel B — left/middle | `docs/reviews/office-furniture-review-v1-left-middle.svg` / `.png` | 920 × 720 |
| Panel C — work areas | `docs/reviews/office-furniture-review-v1-workareas.svg` / `.png` | 1600 × 610 |
| These notes | `docs/reviews/office-furniture-review-v1-notes.md` | — |

Regenerate:

```sh
node --experimental-strip-types scripts/generate-furniture-review.ts
```

The generator reads the furniture JSON, cross-checks it against
`office-structure-review-v2.json`, asserts the protected structure v1/v2 hashes,
validates, then writes the full map and all three panels (SVG always; PNG via
`cairosvg` — `$FURNITURE_REVIEW_PY`, `/tmp/homebase-svg-venv/bin/python3`, or
`python3`). Deterministic: fixed ordering, rounded numbers, no timestamps, no
randomness.

## Visual rules

- Structure (walls, partitions, doors, columns, lifts, windows) is drawn
  **de-emphasized light gray**, so furniture (solid black/white) dominates.
- Dispensers are **light blue**; the fridge is **light green**.
- Furniture IDs are omitted from the drawing; counts are in this document and in
  the full-map box.
- Room-name tags are **compact and placed in clear top/empty areas** (data-driven
  `roomLabels` in the JSON). The inherited structure-v2 centred labels are
  suppressed in this layer, and the generator **fails** if any tag box overlaps
  any furniture. Narrow service cells keep a rotated tag.
- No game hotspots, avatars, collision boxes or invented objects.

## Per-room inventory (exact)

| Room | Furniture |
| --- | --- |
| Ruang Meeting 1 | 1 table (x455..546, y96..140) · 6 chairs (3 above, 3 below) |
| Ruangan HRGA | 2 desks (x568..632 and x634..689, y104..129) · 4 chairs (1 above + 1 below each) · 1 cabinet (x634..690, y165..189) · **1 dispenser (light-blue, x564..596, y165..189)** |
| Bilik Komisaris | 1 desk (x716..760, y149..189) · 1 chair above (x717..743, y109..135) |
| Bilik Product Manager | 1 desk (x851..921, y151..189) · 1 chair above (x873..899, y112..138) |
| Bilik IT | 2 desks (horizontal x932..1004, y103..128; vertical x930..954, y135..189) · 2 chairs · + **1 corridor-side dispenser (x956..988, y190..215)** |
| Bilik Direktur Finance | 2 desks (vertical x1039..1065, y81..115; horizontal x1123..1154, y115..140) · 1 counter/table segment (x1076..1122, y115..140) · 2 chairs · + **1 corridor-side dispenser (x1122..1156, y190..215)** |
| Bilik Geng Kami | 1 central bank (x1194..1329, y94..144; 3 columns × 2 rows = 6 desk cells) · 6 chairs (2 above + 2 below the bank, plus 2 side-facing flanking the extra desk) · 1 extra vertical desk (x1395..1420, y83..133) · 1 cabinet (x1359..1465, y165..189) |
| Resepsionis | 1 work chair (x306..332, y210..236) · 1 long reception counter (x270..351, y236..254) · 4 waiting seats (2 on the left wall, 2 on the right wall, y257..316) |
| Lobby Besar | none |
| Pantry | 1 counter (x410..440) · 1 dispenser (x446..477) · 1 fridge (x478..509) — all y332..366, left→right |
| Gudang (locked) | none (structure v2 door D7 stays locked) |
| Toilet Wanita | none |
| Wastafel | none |
| Toilet Pria | none |
| Ruang Meeting 2 | 1 table (x602..692, y297..339) · 6 chairs (3 above, 3 below) · 1 board/screen on the **left** (x555..590, y286..380) |
| Ruang Server | none |
| Desk Collection | 2 horizontal double-sided banks (top y290..332, bottom y420..462) · **34 chairs** (per bank: 8 upper + 8 lower + 1 side-facing at the far left) |
| Tele / CS / CA | 2 vertical double-sided banks · **24 chairs** (6 left + 6 right per bank) |

## Source-visible totals

| Type | Count |
| --- | --- |
| Chair | 87 |
| Waiting seat | 4 |
| Desk | 9 |
| Table (rapat) | 2 |
| Counter / long table | 3 |
| Bank meja (opposed) | 5 |
| Cabinet (lemari) | 2 |
| Dispenser (light blue) | 4 |
| Fridge (kulkas, light green) | 1 |
| Board / screen | 1 |
| **Total items** | **118** |

Chair totals per room: Meeting 1 = 6, HRGA = 4, Komisaris = 1, Product Manager = 1,
IT = 2, Finance = 2, Geng Kami = 6, Resepsionis = 1 (+4 waiting), Meeting 2 = 6,
Desk Collection = 34, Tele/CS/CA = 24.

## Ambiguities to confirm

1. **Desk Collection — 34 visible vs prior 36.** The source shows **17 visible
   chairs per bank** (8 upper + 8 lower + 1 side-facing at the far left) × 2 banks
   = **34**. A previous verbal expectation was **36** (18 per bank, i.e. two extra
   chairs). The two extra chairs are **not** silently added — the JSON encodes the
   34 that are visible. Please confirm whether the intended count is 34 or 36.
2. **Finance object interpretation.** The long horizontal run `x1076..1154` is
   split into a white **counter/table segment** (`x1076..1122`) plus a **desk**
   (`x1123..1154`) because the brief describes both a horizontal desk and an
   adjacent white counter at the same x-range. The source may instead show a
   single desk `x1076..1154`; the second chair (`x1102..1127`, `y151..177`) sits
   under the counter portion. Confirm the exact split (or a single desk).
3. **Bilik Geng Kami side-facing chair orientation.** The two chairs flanking the
   extra vertical desk (`x1341..1367` and `x1432..1458`) are drawn **side-facing**
   (right and left respectively) at `y112`. Their exact facing, and whether they
   belong to the extra desk rather than the central bank, is uncertain.
4. **Bilik Geng Kami bounds / chamfer bay.** The extra desk, its right chair and
   the cabinet sit at `x > 1388`, in the chamfered bay that structure v2 clips to
   the room rect `x1156..1388`. To keep them valid and inside the building, the
   JSON adds a `roomBoundsOverride` extending `geng-kami` to `x2 = 1465`
   (structure v2 itself is unchanged). The extra desk `y83..133` also reaches
   above the source's diagonal window edge, so its top-right corner may sit on the
   chamfer line — confirm the desk's real position.
5. **HRGA twin desks.** The two desks are ~2 px apart in the source, so at drawing
   scale they nearly touch and can read as one long desk; they are encoded as two
   separate desks. Confirm.
6. **Corridor-side dispensers.** The IT and Finance dispensers sit **below** the
   top-row rooms (y190..215), in the open circulation strip, so they are tagged
   `corridor-side` rather than belonging to a room. Confirm they are freestanding.
7. **No fixtures drawn in the service core.** Gudang, Toilet Wanita, Wastafel,
   Toilet Pria and Ruang Server are left **empty** (labels/doors only) — no
   invented toilets, sinks or racks, per the brief.

## Validation performed

- JSON parses; all four SVGs parse as XML (`xml.etree.ElementTree`); all four PNGs
  have the expected dimensions read back from the IHDR chunk.
- Unique furniture IDs; valid type; valid room id (or `corridor-side`); positive
  rect/point; every item inside its room (with the documented `geng-kami`
  override) or explicitly `corridor-side`.
- **No furniture overlaps** the locked Gudang / both toilets / Server interiors.
- Exact per-room inventory asserted, plus type totals (87 chairs, 4 seats, 9
  desks, 2 tables, 3 counters, 2 cabinets, 4 dispensers, 1 fridge, 1 board,
  5 banks).
- Every structure room has exactly one label tag; **no label box overlaps any
  furniture**.
- Structure v2 invariants asserted: `D7` locked, `D8` on `x=512` facing the
  Wastafel, `D9` on `x=554` facing the Wastafel.
- Structure review v1/v2 SVG+PNG hashes asserted unchanged.
- Two consecutive generations are **byte-identical** (sha256 below).
- `git diff --check` clean.

### Hashes (two runs byte-identical)

| Artifact | sha256 |
| --- | --- |
| `office-furniture-review-v1.svg` | `d84f7ca2142d9febbc79244ea0f8699d0494b8f67efcae5369e5f1a43101838b` |
| `office-furniture-review-v1.png` | `e7091236024a209bd78c123976ab49ab8b77736e4e7698885f1077ab1bbdce41` |
| `...-top-row.svg` | `198b0e376876bcbbde858c6f482feab3d68802f71f2550b7016273ea34515fa4` |
| `...-top-row.png` | `f3febc56a18889b34a1257f55d7b074b273d3b7a300b8e9fdc02e158ad28da7e` |
| `...-left-middle.svg` | `8972115192688141aaa1d7579f9b33f052f669f4558e766f926500ddf30c1813` |
| `...-left-middle.png` | `ce5c1c6ca9e9821482faab1ae66ff5539b8de090dbe7f61a4bd45a94dd3dad98` |
| `...-workareas.svg` | `d458eaabfee747eee7a9ee9d6ad0663e7713d9315a57e363551053c1ecee2d8a` |
| `...-workareas.png` | `6aa105773a03d5c7419cc99633000a4f6745a738c32e06ccce680411e718adaf` |

Protected structure hashes (unchanged): v2 SVG
`4c6cb0c609198d3fa7ad19b9d6b3679b45f0e6265ba22a3813cdda3025462358`, v2 PNG
`0ff87dc0ba8ebbffc5068eb17f4ffa883f56063414bc672305eebd4bbc02fedf`; v1 SVG
`b7b890697acafdc1413ddc97f1bb075e7f4d908563e7d00153e08cae0fbb1be2`, v1 PNG
`419a477955be2b380ed85665a3ff7403d8aa5aca15cee366adc49455329ceb9e`.
