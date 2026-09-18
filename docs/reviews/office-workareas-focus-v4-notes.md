# Office work areas focus v4 (Panel C revision 4) — notes

**Review fokus — Desk Collection · Tele / CS / CA.**

This is a **focused, additive revision of Panel C only**, created from the
approved v3 revision. It does **not** replace or regenerate any
structure/furniture v1/v2 artifact, nor the workareas **v2** or **v3**
artifacts; it only adds the four files listed below and asserts every protected
hash is unchanged.

Authoritative source: `img_52d36a282d20.png` (1516 × 808). Focus crop
x≈686..1474, y≈186..510. Coordinates below are **source pixels** (same space as
structure v2 / workareas v2–v3).

## Files

| Artifact | Path | Dimensions |
| --- | --- | --- |
| Data source (single source of truth) | `docs/reviews/office-workareas-focus-v4.json` | — |
| Generator (deterministic) | `scripts/generate-workareas-focus-v4.ts` | — |
| SVG | `docs/reviews/office-workareas-focus-v4.svg` | 1600 × 918 |
| PNG | `docs/reviews/office-workareas-focus-v4.png` | 1600 × 918 |
| These notes | `docs/reviews/office-workareas-focus-v4-notes.md` | — |

Regenerate:

```sh
node --experimental-strip-types scripts/generate-workareas-focus-v4.ts
```

Deterministic: fixed ordering, rounded numbers, no timestamps, no randomness.
The PNG is a rasterization of the same generated SVG (no second drawing).
Rasterizer: `$WORKAREAS_FOCUS_REVIEW_PY`, `/tmp/homebase-svg-venv/bin/python3`,
or `python3` (must have `cairosvg`).

## Why v4 exists (independent check finding)

The independent check found **v3 invalid for the actual app actor**:

- v3 put the two side-facing chairs at centre **x=722 → rect x=709..735**,
  leaving only **13 px** between the wall face and the chair.
- The real actor footprint is **WIDTH = 18 px** (lateral, x) and
  **DEPTH/HEIGHT = 12 px** (along travel, y) — **not** the 12 px width v3 assumed.
  13 px < 18 px, so the west lane was not passable for the real actor.

## v4 delta from v3 (only these)

### 1. Two side chairs shifted right to x=738 — left edge x=725

`F-DC-T-SIDE` and `F-DC-B-SIDE` moved **x 722 → 738 (+16 vs v3; +30 vs
furniture v1)**. Each chair:

- rect now **x=725..751** (`w=26`), facing right — left edge **725 ≥ 724** as
  required (recommended centre 738);
- is **tucked into the short desk cap** at the left end of its bank (reaches
  31 px into the bank, inside the 40 px cap-tuck allowance), so the desk end
  reads as a chair pushed into the desk;
- no longer pinches the lane: the lane's nearest obstruction at the side-chair
  bands is now the **bank end (x=720)**, not the chair.

Chair count is unchanged: **Desk Collection 34, Tele/CS/CA 24** (total 63).

### 2. Board unchanged

`F-WA-BOARD-BAP` is exactly **x=697..704, y=250..292** (slim, flush-mounted on
the east face of the Meeting-2 wall `x=695`, above the side chair), non-structural
furniture/interactable. The generator asserts the board geometry is identical to
v3.

### 3. accessAisle route/annotation updated

The reserved west lane is now a clean strip **x=696..720** (no detours — the
side chairs clear it), with the route and label updated:

```jsonc
"accessAisle": {
  "id": "AISLE-DC-EAST", "kind": "movement-annotation",
  "label": "AKSES KE DERET BAWAH & SERVER",
  "wallX": 695, "wallFaceSourcePx": 696,
  "lane": { "x1": 696, "y1": 248, "x2": 720, "y2": 491 },
  "detours": [],
  "actor": { "w": 18, "h": 12 },          // real app footprint
  "widths": { "openSourcePx": 37.56, "bankBandSourcePx": 24,
              "sideChairBandSourcePx": 24, "sideChairClearSourcePx": 29,
              "targetSourcePx": 34, "minSourcePx": 24 },
  "start": [712, 256], "goal": [706, 448],
  "route": [[712,256],[706,270],[706,448]]
}
```

Measured clear widths (wall **face x=696** → nearest obstruction):

| Band | Clear width | Bound by |
| --- | --- | --- |
| Open bands (above/below/between the banks) | **37.56 px** | first bank-row chair (`x=733.56`) |
| Bank bands (`y≈290..332`, `420..462`) | **24 px** | bank left end (`x=720`) |
| Side-chair bands (`y≈299..323`, `429..453`) | **24 px** (bank) / 29 px (chair) | bank `x=720`; chair `x=725` |

Minimum **24 px ≥ 24 px**; the 18 px-wide actor passes with **6 px** lateral spare.

### 4. Wall stroke 3 → 2 (supporting change)

The Meeting-2 east wall is drawn and modelled at **stroke 2**, so its face is
exactly **x=696** and the "≥ 24 px after wall stroke" requirement holds by the
drawn ink (24.0 px), the same convention v3 used for its lane (`lane.x1=696`,
bank band `720−696=24`). This is a rendering/movement parameter, not layout
geometry; everything else in `meta.stroke` and all `meta.colors` are unchanged.

### 5. Version metadata

`meta.id/version/subtitle` → v4, and `meta.protected` gains the v3 JSON/SVG/PNG
pins. Nothing else differs from v3 (rooms, walls, windows, doors, open paths,
room labels, callouts, legend, the board geometry, banks and every other chair,
and the Tele top-open correction are identical).

## Validation performed (asserted by the generator)

- **Base artifacts unchanged:** all **20 protected hashes** match — structure
  v1/v2 (+ v2 JSON), furniture v1 full map (+ JSON) and all three panels, and the
  workareas **v2** (`2d658e…`, `b70135…`, `0ea562…`) and **v3** (`56f928…`,
  `c4cb80…`, `43f118…`) JSON/SVG/PNG.
- **Delta vs v3 is exact:** compared against `office-workareas-focus-v3.json`,
  the only differences are the two side chairs (`point.x` +16, geometry otherwise
  identical), the accessAisle object, the wall stroke (3 → 2) and version
  metadata. The board geometry, `rooms`, `walls`, `windows`, `doors`,
  `openPaths`, `roomLabels`, `callouts`, `legend`, `overrides.structure`,
  `overrides.furniture[0]` and every other furniture item are **byte-identical**.
- **Tele top-open correction preserved:** `OV-TOP-OPEN` still omits exactly
  `x=1156..1465` at `y=244`; Desk Collection top still covers `695..1156` minus
  the `C6` gap; no wall crosses the open span.
- **Counts:** `dc-bank` 2, `dc-chair` 34, `tc-bank` 2, `tc-chair` 24, `board` 1.
- **Side chairs:** left edge **725 ≥ 724**, centre exactly **738**, `w/h/facing`
  unchanged, no collision with any other chair, tucked inside the 40 px cap.
- **Inherited furniture vs furniture v1:** only the two side chairs differ, and
  only by the **+30 px x** shift; all other geometry/placement identical.
- **Board:** exactly `x=697..704, y=250..292`; east of the wall face; 7 px deep;
  inside `desk-collection`; non-structural; no overlap with door `D6`, gap `C6`,
  either side chair, or either bank; `CO-BOARD` target inside the board.
- **West lane ≥ 24 px:** bank band 24.0 px and side-chair band 24.0 px, both
  ≥ 24 px; lane starts at the wall face `x=696`; no chair intrudes into the lane.
- **Movement model:** obstacles are **walls (with their stroke thickness) + desks
  + chairs**; the wall board is wall-mounted and therefore **non-solid** and
  excluded.
- **BFS passage:** a 4-connected grid BFS (0.5 source-px step) with the real
  **18 × 12 px** actor footprint proves the `C6`/top point `(712,256)` reaches
  `(706,448)` beside the Server door `D6` and the lower desk bank, without
  intersecting any wall/desk/chair. Start and goal cells are also checked
  individually for the actor footprint; the annotation route crosses no solid.
- **Presentation:** header/legend bands clear of content; legend (9 rows, incl.
  the aisle row) fits; callout text, room labels and the aisle label are clear
  of furniture and each other.
- **SVG parses as XML; PNG is 1600 × 918** (read back from IHDR bytes).
- **Two consecutive generations are byte-identical.**
- `git diff --check` clean. No commit / push / deploy.

### Hashes (two runs byte-identical)

| Artifact | sha256 |
| --- | --- |
| `office-workareas-focus-v4.json` | `fcd8f8e227e48ef573565154e011e4a7fdae1d81736fad55506d5f779a91401e` |
| `office-workareas-focus-v4.svg` | `59d7bd3ee0a2ab2ecbb1e9c714edba6b185b1bd2d6a41c2e7254bb91fb6ae86e` |
| `office-workareas-focus-v4.png` | `27454fe4b2efc7315e6940734bd4ac01636cac882031ad326fe0bb719fb6ce2e` |

Protected (unchanged): workareas v3 JSON `56f92844670bab4d70e80a8f8a6b177c4da4202e7ec8c2a5f96490a1d9c38d72`,
SVG `c4cb809cea9fa67b426cd837a74726ee0af271d5c0bf765d86bf1c7142330869`, PNG
`43f118081424c655567d16ea344795e204555c6b387de6b5c24ffa8c57dac2eb`; workareas v2
JSON `2d658e15bdf30005119fc10860a3079ddfe11ac2531131b441320e234ea433f1`, SVG
`b7013558f44ff63bad7999e811bb7369618e521c261817eb6f7e3d581bdee065`, PNG
`0ea562bf16ee090e11307ea7d0e86b3eae90c5af72fdecc3fcb88263af580d69`.

## Ambiguities / deviations to confirm

1. **Wall stroke 3 → 2.** Required so the drawn wall face is exactly `x=696`
   and "≥ 24 px after wall stroke" holds (24.0 px); at stroke 3 the half-stroke
   face would be `696.5` and the bank band would measure 23.5 px. The lane
   measurement convention (face = `wallX + stroke/2`) now matches v3's own
   `lane.x1 = 696` and the independent check's arithmetic (`709 − 696 = 13`).
2. **24 px is the geometric maximum at the bank bands.** The west strip is
   bounded by the wall (`x=695`) and the desk bank's left end (`x=720`), i.e.
   25 px centreline-to-bank. It cannot exceed 24 px after the wall stroke without
   moving a desk bank (out of scope). 24 px ≥ 24 px is met exactly, with 6 px
   lateral spare for the 18 px actor.
3. **Side chair tuck.** Moving the chairs to x=738 means each chair overlaps the
   left end of its desk bank (as a chair pushed into the desk); the v3 "no
   overlap beyond the cap" rule is relaxed to a 40 px cap-tuck allowance. This is
   the intended "tucked into/against the short desk cap" reading.
4. **Board extents** `x=697..704, y=250..292` unchanged from v3 (as instructed).
