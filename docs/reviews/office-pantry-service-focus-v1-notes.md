# Office Pantry / service focus v1 — notes

**Review fokus — Pantry · Toilet Wanita · Wastafel · Toilet Pria · Meeting 2 · Server.**

This is a **focused, additive review** of one small area of the office plan. It
does not replace or regenerate any structure/furniture v1/v2 artifact; it only
adds the files listed below and asserts the protected hashes are unchanged.

Authoritative source: `img_52d36a282d20.png` (1516 × 808). Focus crop
x≈390..735, y≈170..520. Coordinates below are **source pixels** (same space as
structure v2).

## Files

| Artifact | Path | Dimensions |
| --- | --- | --- |
| Data source (single source of truth) | `docs/reviews/office-pantry-service-focus-v1.json` | — |
| Generator (deterministic) | `scripts/generate-pantry-service-focus.ts` | — |
| SVG | `docs/reviews/office-pantry-service-focus-v1.svg` | 1300 × 1720 |
| PNG | `docs/reviews/office-pantry-service-focus-v1.png` | 1300 × 1720 |
| These notes | `docs/reviews/office-pantry-service-focus-v1-notes.md` | — |

Regenerate:

```sh
node --experimental-strip-types scripts/generate-pantry-service-focus.ts
```

Deterministic: fixed ordering, rounded numbers, no timestamps, no randomness.
The PNG is a rasterization of the same generated SVG (no second drawing).
Rasterizer: `$PANTRY_FOCUS_REVIEW_PY`, `/tmp/homebase-svg-venv/bin/python3`, or
`python3` (must have `cairosvg`).

## User corrections applied (override prior artifacts)

### Structure / doors

1. **Toilet Wanita door — east wall, upper, inward.** On the toilet's
   **right/east** wall `x=512`, opening `y=424..460` (upper part), facing the
   Wastafel. It swings **inward, west** into Toilet Wanita
   (`D8: axis=v, x=512, y=442, len=36, hinge=start, swing=left, inward`).
2. **Toilet Pria door — west wall, upper, inward.** On the toilet's
   **left/west** wall `x=554`, opening `y=415..452` (upper part), facing the
   Wastafel. It swings **inward, east** into Toilet Pria
   (`D9: axis=v, x=554, y=433.5, len=37, hinge=start, swing=right, inward`).
3. **Open strip above the Wastafel.** The vertical strip between the two toilets
   (`x≈512..554`) is **open continuously north to the main horizontal
   circulation**. The pantry back wall stops at `x=512` (it is **not** drawn
   across the strip), there is **no transverse/full wall** across the strip, and
   **no invented corridor label** is drawn. Only the adjacent rooms' side
   boundaries (the `x=512` and `x=554` walls) remain.
4. **Gudang stays locked** (`D7`, padlock + `TERKUNCI` callout `Gudang terkunci`).
5. **Meeting 2 / Server walls and doors preserved** from the source
   (`D5` Meeting 2, `D6` Server); no unrelated structure was changed.

### Furniture / objects

6. The tall white rectangle above Toilet Pria and left of Meeting 2
   (`x≈557..590, y≈288..378`) is an **external table** (`F-PS-EXT-TABLE`),
   **not** a Meeting 2 board/screen. No board classification or legend remains.
7. Long horizontal **certificate table** on the back/upper side of the Pantry
   wall (`F-PS-CERT-TABLE`, `x410..522, y286..321`) — callout `Meja sertifikat`.
8. Above that table, a small lounge arrangement **two chairs + one small table**
   (`F-PS-LOUNGE-C1`, `F-PS-LOUNGE-T`, `F-PS-LOUNGE-C2`) — callout
   `Area santai` / note `2 kursi + 1 meja kecil`.
9. Pantry row left→right: counter, blue dispenser, green fridge
   (`y=323..347`).
10. Meeting 2 keeps only its central large table + 6 chairs from the prior
    review — no left-side board/screen.
11. No invented fixtures inside Toilet Wanita, Wastafel, Toilet Pria, Server or
    Gudang.

## Exact object counts (asserted)

| Group | Count | IDs |
| --- | --- | --- |
| Lounge chair | **2** | `F-PS-LOUNGE-C1`, `F-PS-LOUNGE-C2` |
| Lounge small table | **1** | `F-PS-LOUNGE-T` |
| Certificate table | **1** | `F-PS-CERT-TABLE` |
| External table (`Meja luar`) | **1** | `F-PS-EXT-TABLE` |
| Pantry counter | **1** | `F-PS-PANTRY-COUNTER` |
| Pantry dispenser (blue) | **1** | `F-PS-PANTRY-DISPENSER` |
| Pantry fridge (green) | **1** | `F-PS-PANTRY-FRIDGE` |
| Meeting 2 table | **1** | `F-PS-MTG2-TABLE` |
| Meeting 2 chair | **6** | `F-PS-MTG2-C1`..`C6` |
| **Board / screen** | **0** | — |
| **Total items** | **15** | |

## Door / path assertions (validated by the generator)

- `D8` sits on `x=512`, opening exactly `y=424..460` (upper), `swing=left`
  (inward-west); its swing region lies fully **inside** Toilet Wanita.
- `D9` sits on `x=554`, opening exactly `y=415..452` (upper), `swing=right`
  (inward-east); its swing region lies fully **inside** Toilet Pria.
- `D7` Gudang remains `locked`.
- **Open path** `P1` (`x524..550, y232..470`) is the open wash strip: the
  generator fails if **any wall segment crosses its interior**. The blue dashed
  arrow (`x=537`, up to `y=238`) shows the unobstructed route to the main
  circulation; there is no crossing wall and no invented corridor label.
- No furniture overlaps the sealed interiors of Gudang, Toilet Wanita,
  Wastafel, Toilet Pria or Server.
- The `Meja luar` leader terminates **inside** the external table (checked in
  code), not on the Meeting 2 door.

## Presentation (this revision)

- Header reorganized into three non-overlapping lines (title / subtitle /
  scale note) with the header band fully clear of the plan content.
- Legend reorganized into 3 columns × 3 rows; every swatch and label fits
  inside the band with ≥12 px separation.
- Canvas grew to 1300 × 1720 to give the header and legend room; the validated
  door / object / open-path coordinates are unchanged from the passing revision.

## Validation performed

- JSON parses; unique IDs across rooms/walls/doors/paths/furniture/callouts.
- Exact group counts asserted (lounge 2 chairs + 1 small table; 1 certificate
  table; 1 external table; pantry 1 counter / 1 dispenser / 1 fridge; Meeting 2
  1 table + 6 chairs); **no `board` item** exists and no legend text mentions a
  board/screen.
- Meeting 2 table + 6 chairs byte-equal the prior furniture review coordinates.
- Door checks: `D8`/`D9` on the inner walls, upper part, swinging inward; swing
  regions contained in the toilets; `D7` locked.
- Open path `P1`: no wall crosses its interior.
- Presentation: header/legend fit the bands, ≥12 px separation, callout text
  clear of furniture, room labels and each other; `Meja luar` target inside the
  external table.
- SVG parses as XML; PNG is 1300 × 1720 (read back from IHDR).
- Two consecutive generations are **byte-identical** (sha256 below).
- Protected artifacts asserted unchanged: structure v1 + v2 and furniture v1
  (full map + all three panels), SVG and PNG.
- `git diff --check` clean. No commit / push / deploy.

### Hashes (two runs byte-identical)

| Artifact | sha256 |
| --- | --- |
| `office-pantry-service-focus-v1.svg` | `3f88c51441eb6b475883883523ccef780c1349d6262128f54095feddbd27fab2` |
| `office-pantry-service-focus-v1.png` | `565a3bf8c2fac9e24b44ecdc5516e9d3d5f1cbbdbaa42828470eb6e057111ff3` |

Protected hashes unchanged — structure v2 SVG
`4c6cb0c609198d3fa7ad19b9d6b3679b45f0e6265ba22a3813cdda3025462358`, v2 PNG
`0ff87dc0ba8ebbffc5068eb17f4ffa883f56063414bc672305eebd4bbc02fedf`; structure v1
SVG `b7b890697acafdc1413ddc97f1bb075e7f4d908563e7d00153e08cae0fbb1be2`, v1 PNG
`419a477955be2b380ed85665a3ff7403d8aa5aca15cee366adc49455329ceb9e`; furniture v1
SVG `d84f7ca2142d9febbc79244ea0f8699d0494b8f67efcae5369e5f1a43101838b`, v1 PNG
`e7091236024a209bd78c123976ab49ab8b77736e4e7698885f1077ab1bbdce41`, plus the
three furniture panels.

## Ambiguities to confirm

1. **External table vs board.** The source object at `x≈554..590, y≈286..380`
   reads like a tall board to a naïve viewer; per instruction it is encoded as an
   **external table** (`Meja luar`). Confirm it is a table.
2. **Certificate table extents.** Encoded at `x410..522, y286..321` (user
   approx.); the source line-work suggests the panel is nearer `y287..311`.
3. **Lounge chair facing.** Both lounge chairs are drawn facing down (backs to
   the north); the exact facing is not certain.
4. **Pantry back wall x-limit.** The wall is truncated at `x=512` so the strip is
   open; the exact source stop point is `x≈512..513`.
