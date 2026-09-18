# Office structure review v1 — notes

**Tahap 1 — Dinding, Sekat, Pintu/Celah (TANPA FURNITURE).**

This is a *structure-only* review artifact for user approval before any furniture
review. It shows room footprints/names, full walls, 160 cm partitions, hinged
doors + swing arcs, doorless gaps (*celah*), exterior/window edges, structural
columns, and lift shafts. It deliberately contains **no** desks, chairs,
cabinets, pantry appliances, dispensers, fridge, sink fixtures, hotspots,
avatars, collision markers, invented corridor zones, or game styling.

## Files

| Artifact | Path |
| --- | --- |
| Data source (single source of truth) | `docs/reviews/office-structure-review-v1.json` |
| Generator (deterministic) | `scripts/generate-structure-review.ts` |
| SVG | `docs/reviews/office-structure-review-v1.svg` |
| PNG | `docs/reviews/office-structure-review-v1.png` |
| These notes | `docs/reviews/office-structure-review-v1-notes.md` |

Regenerate:

```sh
node --experimental-strip-types scripts/generate-structure-review.ts
```

The SVG and PNG are both produced from the JSON (the PNG is a rasterization of
the generated SVG via a local `cairosvg`; no second drawing, no new npm/runtime
dependency, `package.json`/`package-lock.json` untouched). Deterministic:
fixed ordering, no timestamps, no randomness — reruns are byte-identical.

## Coordinate basis

Coordinates are **source-image pixels**, used directly so proportions match the
reference. Note: the authoritative PNG is actually **1516 x 808** (not 1484x807);
the supplied anchors (e.g. Meeting 1 left = 407, HRGA/others = 550, 691, 807,
923, 1038, 1156) were verified to land on the real wall pixels of that 1516x808
image, so the canvas is 1516x808 and the anchors are used as-is.

## Corrections honoured

- **No `Koridor Servis`** label/zone anywhere.
- **No `Koridor Bawah`** label/zone anywhere.
- The open circulation strip directly below the top office row (y≈190..244) is
  **unlabelled** open space.
- **Desk Collection** and **Tele / CS / CA** stop at **y = 501**, i.e. the same
  vertical level as the bottom of the Server/service block. They do **not**
  extend down beside the lobby.
- **Exactly 3 structural columns** are drawn: Meeting 1 upper-left; Komisaris
  boundary (x789..832); Bilik Geng Kami (x1334..1382). The blob previously read
  at x986..1029, y565..606 was the **legend sample swatch in the source image**,
  not an office column, and has been removed.
- **Resepsionis right wall (x405/406) is a full solid wall** — it is not a door.
  **D3** is a hinged door in the **top wall (y=189)** near the right corner
  (opening x367..407), hinged on the right, swinging **down / inside** into
  Resepsionis.
- **Lobby Besar alone** extends far down (to y = 761).
- **Pantry** and **Wastafel** are drawn as open areas — no invented rectangular
  enclosure.
- Columns are the black filled squares only; no furniture block was converted.

## Openings checklist

### Hinged doors (D)

| ID | Location | Drawn on wall | Swing |
| --- | --- | --- | --- |
| D1 | Ruang Meeting 1 | bottom wall (y=189), left | into room (up) |
| D2 | Ruangan HRGA | bottom wall (y=189), middle | into room (up) |
| D3 | Resepsionis | top wall (y=189), near right corner (x367..407) | hinge right, into Resepsionis (down) |
| D4 | Resepsionis → Lobby Besar | bottom wall (y=322) | double leaf, into lobby (down) |
| D5 | Ruang Meeting 2 | top wall (y=243), left | into room (down) |
| D6 | Ruang Server | right wall (x=695), lower | toward Desk Collection (right) |
| D7 | Gudang | top wall (y=389) | into Gudang (down) |
| D8 | Toilet Wanita | top wall (y=424) | into toilet (down) |
| D9 | Toilet Pria | top wall (y=415) | into toilet (down) |

### Doorless gaps / celah (C)

| ID | Location | Drawn on |
| --- | --- | --- |
| C1 | Bilik Komisaris | bottom partition (y=189) |
| C2 | Bilik Product Manager | bottom partition (y=189) |
| C3 | Bilik IT (right side) | bottom partition (y=189) |
| C4 | Bilik Direktur Finance (left side) | bottom partition (y=189) |
| C5 | Bilik Geng Kami (left side) | bottom partition (y=189) |
| C6 | Desk Collection (top-left) | top partition (y=244) |

## Ambiguitas untuk dikonfirmasi

These are **not** certain; please confirm or correct. (Column count and the
Resepsionis right wall / D3 are now **resolved** — see "Corrections honoured".)

1. **HRGA ↔ Komisaris divider (x=691).** The source draws it **dashed**, so it is
   rendered as a 160 cm partition, meaning HRGA's right side is a partition
   rather than a full wall. The brief lists HRGA as "full walls" — confirm.
2. **Top-right chamfer.** Modelled as a diagonal window edge from (1360,41) to
   (1465,146), then a right window edge down to y=501. Exact cut points uncertain.
3. **Door swings and hinge sides (D1, D2, D4–D9).** Directions are read from the
   swing arcs; exact hinge side and leaf length are approximate. (D3 is now
   confirmed: top-wall door, hinge right, swinging down into Resepsionis.)
4. **Celah positions/lengths (C1–C6).** The source draws these as breaks with
   paired short jamb marks; the exact centre and width are approximate.
5. **Lift shafts.** Boxes are x44..103 / x407..464 at y508..592 and y647..729,
   opening inward to the lobby. Opening side and exact shaft size to confirm.
6. **Service-cell doors (D7–D9).** Gudang / Toilet Wanita / Toilet Pria each read
   as having a door on the **top** face; swing directions are uncertain, and
   Wastafel is left open (no door).
7. **Open circulation strip.** Left unlabelled as instructed; it is not a room.
8. **Pantry boundaries.** Drawn open (top y=322 wall + shared side walls only),
   no invented enclosure.

## Validation performed

- JSON parses (18 rooms, 35 walls, 3 window edges, 9 doors, 6 gaps, 3 columns, 4 lifts).
- SVG parses as XML.
- PNG is 1516x808, RGB.
- Generator run twice → byte-identical SVG and PNG (sha256).
- `git diff --check` clean.
