# Office work areas focus v2 (Panel C revision) — notes

**Review fokus — Desk Collection · Tele / CS / CA.**

This is a **focused, additive revision** of Panel C only. It does **not** replace
or regenerate any structure/furniture v1/v2 artifact; it only adds the four
files listed below and asserts the protected hashes are unchanged.

Authoritative source: `img_52d36a282d20.png` (1516 × 808). Focus crop
x≈686..1474, y≈186..510. Coordinates below are **source pixels** (same space as
structure v2).

## Files

| Artifact | Path | Dimensions |
| --- | --- | --- |
| Data source (single source of truth) | `docs/reviews/office-workareas-focus-v2.json` | — |
| Generator (deterministic) | `scripts/generate-workareas-focus-v2.ts` | — |
| SVG | `docs/reviews/office-workareas-focus-v2.svg` | 1600 × 918 |
| PNG | `docs/reviews/office-workareas-focus-v2.png` | 1600 × 918 |
| These notes | `docs/reviews/office-workareas-focus-v2-notes.md` | — |

Regenerate:

```sh
node --experimental-strip-types scripts/generate-workareas-focus-v2.ts
```

Deterministic: fixed ordering, rounded numbers, no timestamps, no randomness.
The PNG is a rasterization of the same generated SVG (no second drawing).
Rasterizer: `$WORKAREAS_FOCUS_REVIEW_PY`, `/tmp/homebase-svg-venv/bin/python3`,
or `python3` (must have `cairosvg`).

## User corrections applied (override prior artifacts)

### 1. Tele / CS / CA top is fully open to the corridor

The **top/north** side of Tele/CS/CA has **no partition/wall at all** — it opens
directly onto the main horizontal circulation. Exactly one segment of the
approved structure-v2 top partition is removed:

- Omitted: `x=1156..1465` at `y=244` (`OV-TOP-OPEN`, `type: partition`).
- Kept: Desk Collection top `x=695..1156` at `y=244`, **including** the existing
  gap `C6` (`x=704..728`), split into `W-DC-TOP-A` (`695..704`) and
  `W-DC-TOP-B` (`728..1156`).
- Kept: left separator `x=1156` (`y=244..501`), right exterior/window `x=1465`,
  bottom partition `y=501`, and the corridor-side wall `y=189` (structure v2).
- No corridor room and no corridor label are drawn. Openness is shown only by
  the **absent** partition, the callout `TERBUKA LANGSUNG KE LORONG`, and a
  subtle dashed blue open arrow (`x=1200`, upward) into the circulation band.
  Floors are left unshaded (white) on purpose so no tint edge at `y=244` can be
  misread as a false partition.

### 2. Wall-mounted board `BEST AGENT PERFORMANCE`

A board is mounted on the **east face** of the Meeting Room 2 wall (`x=695`),
facing **east into Desk Collection**:

- `F-WA-BOARD-BAP`, rect `x=699..714, y=270..345` (visibly on the Desk
  Collection side of the wall).
- Classified as **furniture / interactable** (`kind: furniture-interactable`,
  `structural: false`) — **not** a structural column. Drawn in an accent
  (amber) double-border style with two mounting ticks, distinct from every
  structural line.
- Does **not** replace or block the wall, the server door `D6` opening
  (`y=430..466`), or the Desk Collection top gap `C6`.
- Callout `CO-BOARD` (`BEST AGENT PERFORMANCE`) sits in the open band above and
  leads down through the `C6` gap to the board; the label text does not overlap
  any chair or desk.

### 3. Approved desks/chairs unchanged

All desks and chairs are inherited **data-identical** from furniture v1 (same
IDs, rects/points, w/h, facing, bank meta) and only re-placed on this crop:

| Room | Bank | Chairs | Chairs |
| --- | --- | --- | --- |
| Desk Collection | **2** (horizontal banks) | **34** visible | `F-DC-T-UP-1..8`, `F-DC-T-DN-1..8`, `F-DC-T-SIDE`, `F-DC-B-UP-1..8`, `F-DC-B-DN-1..8`, `F-DC-B-SIDE` |
| Tele / CS / CA | **2** (vertical banks) | **24** | `F-TC-L-L1..6`, `F-TC-L-R1..6`, `F-TC-R-L1..6`, `F-TC-R-R1..6` |

No other furniture or structure change.

## Explicit overrides (as encoded)

```jsonc
"overrides": {
  "structure": [
    { "id": "OV-TOP-OPEN", "action": "omit-segment",
      "axis": "h", "y": 244, "x1": 1156, "x2": 1465, "type": "partition" }
  ],
  "furniture": [
    { "id": "OV-ADD-BOARD", "action": "add", "ref": "F-WA-BOARD-BAP" }
  ]
}
```

Board reference:

```jsonc
"board": {
  "id": "F-WA-BOARD-BAP", "label": "BEST AGENT PERFORMANCE",
  "kind": "furniture-interactable", "structural": false, "interactable": true,
  "room": "desk-collection",
  "mount": { "wall": "meeting-2-east", "wallX": 695, "face": "east",
             "facesInto": "desk-collection" },
  "rect": { "x1": 699, "y1": 270, "x2": 714, "y2": 345 }
}
```

## Validation performed (asserted by the generator)

- **Base artifacts unchanged:** all 12 protected hashes (structure v1 + v2,
  furniture v1 full map + all three panels, SVG and PNG) match.
- **JSON parses; IDs unique** across rooms/walls/windows/doors/open-paths/
  furniture/callouts.
- **Exact group counts:** `dc-bank` 2, `dc-chair` 34, `tc-bank` 2, `tc-chair`
  24, `board` 1 (total 63 items).
- **Omission is exact:** no wall crosses `x=1156..1465` at `y=244`; the Desk
  Collection top covers exactly `695..1156` minus the `C6` gap and reaches the
  `x=1156` separator; structure v2 still contains the approved `695..1465`
  source segment that we omitted.
- **No other structure difference:** every drawn wall/window is a structure-v2
  wall/window (or a sub-segment of one, i.e. the `C6` split).
- **Open span clear:** no wall/window crosses the open span `x=1156..1465,
  y=189..244` or the open arrow.
- **Board:** east of `x=695`, mounted close to it, inside `desk-collection`,
  non-structural, does not overlap door `D6` or gap `C6`; the `BEST AGENT
  PERFORMANCE` callout leader lands **inside** the board.
- **Inherited furniture data-identical:** the id set for `desk-collection` +
  `tele-cs-ca` equals furniture v1's, and every inherited item's
  `type/room/shape/rect/point/w/h/facing/bank` equals furniture v1's; Desk 34
  and Tele 24 chair counts re-checked.
- **Presentation:** header band and legend band fully clear of the plan
  content with ≥12 px separation; header lines fit and don't collide; every
  legend swatch/label fits its column; callout text and room labels are clear of
  furniture and of each other.
- **SVG parses as XML; PNG is 1600 × 918** (read back from IHDR bytes).
- **Two consecutive generations are byte-identical.**
- `git diff --check` clean. No commit / push / deploy.

### Hashes (two runs byte-identical)

| Artifact | sha256 |
| --- | --- |
| `office-workareas-focus-v2.svg` | `b7013558f44ff63bad7999e811bb7369618e521c261817eb6f7e3d581bdee065` |
| `office-workareas-focus-v2.png` | `0ea562bf16ee090e11307ea7d0e86b3eae90c5af72fdecc3fcb88263af580d69` |

Protected hashes unchanged — structure v2 SVG
`4c6cb0c609198d3fa7ad19b9d6b3679b45f0e6265ba22a3813cdda3025462358`, v2 PNG
`0ff87dc0ba8ebbffc5068eb17f4ffa883f56063414bc672305eebd4bbc02fedf`; structure v1
SVG `b7b890697acafdc1413ddc97f1bb075e7f4d908563e7d00153e08cae0fbb1be2`, v1 PNG
`419a477955be2b380ed85665a3ff7403d8aa5aca15cee366adc49455329ceb9e`; furniture v1
SVG `d84f7ca2142d9febbc79244ea0f8699d0494b8f67efcae5369e5f1a43101838b`, v1 PNG
`e7091236024a209bd78c123976ab49ab8b77736e4e7698885f1077ab1bbdce41`, workareas
panel SVG `d458eaabfee747eee7a9ee9d6ad0663e7713d9315a57e363551053c1ecee2d8a` /
PNG `6aa105773a03d5c7419cc99633000a4f6745a738c32e06ccce680411e718adaf`.

## Ambiguities to confirm

1. **Board vs the left side chair.** The board `x=699..714, y=270..345` is
   mounted on the wall behind the left `F-DC-T-SIDE` chair (`x≈695..721,
   y≈299..323`). Chairs are drawn on top, so the chair reads as sitting in front
   of the wall board. The board is kept exactly where instructed; only the
   *label text* was moved clear (into the open band, led by a leader).
2. **Corridor representation.** The corridor is drawn as plain open space (no
   room, no fill, no label) with only the structure-v2 wall at `y=189` bounding
   it, per the instruction to avoid an artificial corridor room/label. If a
   light circulation tint is wanted, it can be added without touching any
   wall/furniture geometry.
3. **Board extents.** `x=699..714, y=270..345` follows the provided
   approximation; the exact source line-work was not re-measured.
