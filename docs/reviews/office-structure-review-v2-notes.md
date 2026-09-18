# Office structure review v2 — notes

**Tahap 1 — Dinding, Sekat, Pintu/Celah (TANPA FURNITURE).**

v2 supersedes v1 (approved). The v1 files are preserved byte-identical; this
document and the v2 artifacts describe only the corrections below. Everything
else (footprints, walls, partitions, columns, lifts, window edges, celah) is
unchanged from v1.

## Files

| Artifact | Path |
| --- | --- |
| Data source (single source of truth) | `docs/reviews/office-structure-review-v2.json` |
| Generator (deterministic, version-aware) | `scripts/generate-structure-review.ts` |
| SVG | `docs/reviews/office-structure-review-v2.svg` |
| PNG | `docs/reviews/office-structure-review-v2.png` |
| These notes | `docs/reviews/office-structure-review-v2-notes.md` |

Regenerate (v2):

```sh
node --experimental-strip-types scripts/generate-structure-review.ts v2
```

The generator defaults to **v1** when given no argument, so the approved v1
artifacts regenerate byte-identically; `--input <file.json>` reads an explicit
file and writes the paired `.svg`/`.png`. Deterministic: fixed ordering, no
timestamps, no randomness — reruns are byte-identical.

## Changes from v1 (all three from the approved correction list)

1. **D3 Resepsionis → main circulation** is now a **right/east-wall** hinged door
   (`axis: v`, wall x=407) near the **top** of Resepsionis, at the **far-left end
   of the main horizontal circulation strip** (y≈196..228). It swings **east /
   right** into the strip. It is no longer drawn on the top wall.
2. **D8 Toilet Wanita** is now on the toilet's **right/east wall** (x=512),
   facing the central **Wastafel** area, swinging east.
3. **D9 Toilet Pria** is now on the toilet's **left/west wall** (x=554), facing
   the central **Wastafel** area, swinging west.
4. **D7 Gudang is locked** (`locked: true`): rendered with a compact padlock and
   a **TERKUNCI** annotation, listed as `D7 Gudang (TERKUNCI)` in the checklist,
   and explained by a new legend row plus a footnote in the checklist box.

Both toilet entrances now visibly face the wash area between the two toilets.

## Corrections carried over from v1

- **No `Koridor Servis`** and **no `Koridor Bawah`** label/zone anywhere.
- The open circulation strip below the top office row is **unlabelled**.
- **Desk Collection** and **Tele / CS / CA** stop at **y = 501** (level with the
  bottom of the Server/service block); they do not extend down beside the lobby.
  **Lobby Besar alone** runs down to y = 761.
- **Exactly 3 structural columns**: Meeting 1 upper-left; Komisaris boundary
  (x789..832); Bilik Geng Kami (x1334..1382). The old x986..1029, y565..606 blob
  was the source image's legend swatch, not a column.
- **Resepsionis right wall (x=407, y=189..322)** is a full solid wall carrying the
  hinged door **D3**; the wall is otherwise continuous.

## Openings checklist

### Hinged doors (D)

| ID | Location | Drawn on wall | Swing |
| --- | --- | --- | --- |
| D1 | Ruang Meeting 1 | bottom wall (y=189), left | into room (up) |
| D2 | Ruangan HRGA | bottom wall (y=189), middle | into room (up) |
| D3 | Resepsionis → circulation | **right wall (x=407), top (y≈196..228)** | east/right into strip |
| D4 | Resepsionis → Lobby Besar | bottom wall (y=322) | double leaf, into lobby (down) |
| D5 | Ruang Meeting 2 | top wall (y=243), left | into room (down) |
| D6 | Ruang Server | right wall (x=695), lower | toward Desk Collection (right) |
| D7 | Gudang — **TERKUNCI (locked)** | top wall (y=389) | into Gudang (down); locked |
| D8 | Toilet Wanita | **right/east wall (x=512)**, facing wastafel | east into wash area |
| D9 | Toilet Pria | **left/west wall (x=554)**, facing wastafel | west into wash area |

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

These are **not** certain; please confirm or correct.

1. **HRGA ↔ Komisaris divider (x=691).** The source draws it **dashed**, so it is
   rendered as a 160 cm partition (HRGA's right side is a partition, not a full
   wall), despite the brief's "full walls" wording for HRGA.
2. **Top-right chamfer.** Modelled as a diagonal window edge from (1360,41) to
   (1465,146), then a right window edge down to y=501. Exact cut points uncertain.
3. **Door swing/hinge details (D1, D2, D4–D9).** Positions come from the approved
   corrections; the exact hinge side, leaf length and swing of the remaining
   doors are read from the swing arcs and are approximate. In particular the
   **D8/D9 swing direction into the narrow wash area** is assumed (outward).
4. **Celah positions/lengths (C1–C6).** Breaks with paired short jamb marks; exact
   centre and width approximate.
5. **Lift shafts.** Boxes x44..103 / x407..464 at y508..592 and y647..729, opening
   inward to the lobby. Opening side and exact shaft size to confirm.
6. **D7 Gudang lock.** Rendered as a locked hinged door per instruction; whether
   the key/lock is a separate hardware item is not shown (no appliances/hardware).
7. **Open circulation strip.** Left unlabelled as instructed; it is not a room.
8. **Pantry boundaries.** Drawn open (top y=322 wall + shared side walls only),
   no invented enclosure.

## Validation performed

- v1 regeneration default → **byte-identical** to the approved v1 files:
  - SVG sha256 `b7b890697acafdc1413ddc97f1bb075e7f4d908563e7d00153e08cae0fbb1be2`
  - PNG sha256 `419a477955be2b380ed85665a3ff7403d8aa5aca15cee366adc49455329ceb9e`
- v2 JSON parses (18 rooms, 35 walls, 3 window edges, 9 doors — incl. 1 locked —
  6 gaps, 3 columns, 4 lifts).
- v2 SVG parses as XML; v2 PNG is 1516x808.
- v2 generated twice → byte-identical SVG and PNG:
  - SVG sha256 `4c6cb0c609198d3fa7ad19b9d6b3679b45f0e6265ba22a3813cdda3025462358`
  - PNG sha256 `0ff87dc0ba8ebbffc5068eb17f4ffa883f56063414bc672305eebd4bbc02fedf`
- v2 SVG contains no `Koridor Servis` / `Koridor Bawah` text.
- `git diff --check` clean.
