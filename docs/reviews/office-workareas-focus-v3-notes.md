# Office work areas focus v3 (Panel C revision 3) — notes

**Review fokus — Desk Collection · Tele / CS / CA.**

This is a **focused, additive revision of Panel C only**, created from the
approved v2 revision. It does **not** replace or regenerate any
structure/furniture v1/v2 artifact **or the workareas-v2 artifact**; it only adds
the files listed below and asserts every protected hash is unchanged.

Authoritative source: `img_52d36a282d20.png` (1516 × 808). Focus crop
x≈686..1474, y≈186..510. Coordinates below are **source pixels** (same space as
structure v2 / workareas v2).

## Files

| Artifact | Path | Dimensions |
| --- | --- | --- |
| Data source (single source of truth) | `docs/reviews/office-workareas-focus-v3.json` | — |
| Generator (deterministic) | `scripts/generate-workareas-focus-v3.ts` | — |
| SVG | `docs/reviews/office-workareas-focus-v3.svg` | 1600 × 918 |
| PNG | `docs/reviews/office-workareas-focus-v3.png` | 1600 × 918 |
| These notes | `docs/reviews/office-workareas-focus-v3-notes.md` | — |

Regenerate:

```sh
node --experimental-strip-types scripts/generate-workareas-focus-v3.ts
```

Deterministic: fixed ordering, rounded numbers, no timestamps, no randomness.
The PNG is a rasterization of the same generated SVG (no second drawing).
Rasterizer: `$WORKAREAS_FOCUS_REVIEW_PY`, `/tmp/homebase-svg-venv/bin/python3`,
or `python3` (must have `cairosvg`).

## User corrections applied (v3)

### 1. Board `BEST AGENT PERFORMANCE` — slim, flush, moved clear of the side chair

The board was too close to the far-left side chair: v2 `x=699..714, y=270..345`
sat directly behind `F-DC-T-SIDE` (`x≈695..721, y≈299..323`), which was drawn on
top of it. It is now:

- `F-WA-BOARD-BAP`, rect **`x=697..704`** (7 px deep, was 13) — visually slim and
  flush-mounted on the east face of the Meeting Room 2 wall (`x=695`, 2 px gap).
- **`y=250..292`** — in the upper wall segment, entirely **above** the top desk
  bank (`y=290..332`) and above the side chair (`y=299..323`); board bottom
  `292 < 299`, so it no longer competes with any chair.
- Still **faces east** into Desk Collection (`mount.face: "east"`), still
  classified **furniture / interactable** (`structural: false`), still labelled
  and called out `BEST AGENT PERFORMANCE` (`CO-BOARD`, leader re-pointed through
  the C6 entrance gap to a target inside the new rect).
- Does **not** replace or block the wall, the Server door `D6` opening
  (`y=430..466`), or the Desk Collection top gap `C6` (`x=704..728`).

### 2. Two far-left side-facing chairs shifted right (+14 px)

`F-DC-T-SIDE` and `F-DC-B-SIDE` (one per bank, facing right) moved
**x 708 → 722 (+14 px)** so they tuck toward their bank's short left cap and
leave the wall strip clear. Nothing else moved:

- bounds now `x=709..735` (top: `y=299..323`, bottom: `y=429..453`);
- Chair count is **unchanged: Desk Collection 34, Tele/CS/CA 24** (total 63).
- The bank's short end-cap zone is `x=720..735` (15 px); the tucked chair stays
  inside it and **never overlaps the usable desk surface** beyond the cap
  (checked against `bank.x1 + 15`). No other chair or bank is touched.

### 3. Reserved / annotated access aisle along the Meeting-2 east wall

A continuous walkable vertical aisle is reserved between the Meeting Room 2 /
Server wall (`x=695`) and the leftmost furniture, from the top entrance `C6`
down to the lower desk bank and the Server door. It is declared as an
`accessAisle` object and drawn as a **subtle dashed blue lane outline + dashed
route arrow**, labelled `AKSES KE DERET BAWAH & SERVER`. It is explicitly a
**movement annotation — NOT a room and NOT a corridor** (no room, no floor tint,
no room label added).

```jsonc
"accessAisle": {
  "id": "AISLE-DC-EAST", "kind": "movement-annotation",
  "label": "AKSES KE DERET BAWAH & SERVER",
  "wallX": 695,
  "lane":   { "x1": 696, "y1": 248, "x2": 719, "y2": 491 },
  "detours": [
    { "id": "DET-TOP",    "around": "F-DC-T-SIDE", "x2": 709, "y1": 294, "y2": 328, "clearWidthSourcePx": 13 },
    { "id": "DET-BOTTOM", "around": "F-DC-B-SIDE", "x2": 709, "y1": 424, "y2": 458, "clearWidthSourcePx": 13 }
  ],
  "actor": { "w": 12, "h": 18 },
  "widths": { "openSourcePx": 37.56, "bankBandSourcePx": 24, "detourSourcePx": 13, "targetSourcePx": 34 },
  "start": [712, 256], "goal": [703, 448],
  "route": [[712,248],[712,289],[702,289],[702,447]],
  "labelAt": { "x": 726, "y": 380, "size": 7.4, "anchor": "start" }
}
```

Measured clear widths (wall face `x=695`/`696` to the nearest obstruction):

| Segment | Clear width | Bound by |
| --- | --- | --- |
| Open bands (above/below/between the banks) | **37.56 px** | first bank-row chair (`x=733.56`) |
| Bank bands (`y≈290..332`, `420..462`) | **24 px** | bank left end (`x=720`) |
| The two side-chair detours | **13 px** | tucked side chair (`x=709`) |

## Validation performed (asserted by the generator)

- **Base artifacts unchanged:** all **17 protected hashes** match — structure v1/v2
  (+ v2 JSON), furniture v1 full map (+ JSON) and all three panels, and the
  workareas **v2** JSON/SVG/PNG (`b70135…`, `0ea562…`, `2d658e…`).
- **Delta vs workareas v2 is exact:** the generator diffs v3 against v2 and fails
  unless the *only* changes are the board, the two side chairs, the aisle
  annotation and version metadata. `rooms`, `walls`, `windows`, `doors`,
  `openPaths`, `roomLabels`, `overrides.structure`, the first 8 legend rows and
  every other furniture item are **identical**; `legend` gains exactly one aisle
  row; `overrides.furniture` gains exactly one `shift` row.
- **Tele top-open correction preserved:** `OV-TOP-OPEN` still omits exactly
  `x=1156..1465` at `y=244`; Desk Collection top still covers `695..1156` minus
  the `C6` gap; no wall crosses the open span.
- **Counts:** `dc-bank` 2, `dc-chair` 34, `tc-bank` 2, `tc-chair` 24, `board` 1.
- **Board:** exactly `x=697..704, y=250..292`; flush (2 px from the wall); 7 px
  deep; east of `x=695`; inside `desk-collection`; non-structural; no overlap with
  door `D6`, gap `C6`, either side chair, or either bank; `CO-BOARD` target inside
  the board.
- **Side chairs:** only `F-DC-T-SIDE`/`F-DC-B-SIDE` differ from furniture v1, and
  only by a **+14 px x** shift (all other geometry identical); each stays within
  its bank's short cap (no overlap with the desk surface beyond `bank.x1 + 15`).
- **Aisle:** lane inside `desk-collection` and east of the wall; detours clear
  exactly to the shifted chair edges; every detour is at least the actor width;
  the route never enters a solid (board excluded); label clear of all furniture,
  room labels and callouts.
- **BFS passage:** a 4-connected grid BFS (0.5 source-px step) using the
  18 × 12 px actor footprint (12 px lateral × 18 px along travel) proves the
  `C6`/top point `(712, 256)` reaches a point beside the Server door / lower bank
  `(703, 448)` without intersecting any **desk or chair**. The board is
  wall-mounted and **non-solid** for movement (excluded from the obstacle set);
  the floor lane is nonetheless drawn visibly clear.
- **Presentation:** header and legend bands clear of content; every legend swatch
  and label fits; callout text and room labels clear of furniture and of each
  other; the aisle label does not overlap anything.
- **SVG parses as XML; PNG is 1600 × 918** (read back from the IHDR bytes).
- **Two consecutive generations are byte-identical.**
- `git diff --check` clean. No commit / push / deploy.

### Hashes (two runs byte-identical)

| Artifact | sha256 |
| --- | --- |
| `office-workareas-focus-v3.json` | `56f92844670bab4d70e80a8f8a6b177c4da4202e7ec8c2a5f96490a1d9c38d72` |
| `office-workareas-focus-v3.svg` | `c4cb809cea9fa67b426cd837a74726ee0af271d5c0bf765d86bf1c7142330869` |
| `office-workareas-focus-v3.png` | `43f118081424c655567d16ea344795e204555c6b387de6b5c24ffa8c57dac2eb` |

Protected (unchanged): workareas v2 SVG
`b7013558f44ff63bad7999e811bb7369618e521c261817eb6f7e3d581bdee065`, v2 PNG
`0ea562bf16ee090e11307ea7d0e86b3eae90c5af72fdecc3fcb88263af580d69`, v2 JSON
`2d658e15bdf30005119fc10860a3079ddfe11ac2531131b441320e234ea433f1`.

## Ambiguities / deviations to confirm

1. **"At least 34 source pixels wide" is not continuously achievable at the
   detours or bank bands — and cannot be, without moving a desk bank.** The west
   strip is bounded by the wall (`x=695`) and the desk bank's left end
   (`x=720`, → 24 px), and the 26 px side chair can only be tucked so far. A
   *continuous* 34 px lane is geometrically impossible here; 34 px **is** met in
   the open bands (37.56 px). What is guaranteed instead is a **BFS-proven
   continuous route** (12 px lateral actor) with 13 px clear at the two
   side-chair detours. If a literal 34 px continuous lane is required, the
   leftmost ~14 px of both desk banks would have to move east, which changes
   desk geometry (out of the stated scope).
2. **Chair shift magnitude.** The request allowed `+10..14 px`; `+14` (the upper
   bound) was chosen because it is the largest shift that still keeps the chair
   inside the bank's short cap while leaving the widest possible detour. A smaller
   shift narrows the detour toward the 12 px actor width.
3. **Aisle extent.** The suggestion `x=708..770` was adjusted to the **actually
   clear** strip `x=696..719`; `x≥720` is the desk bank itself and is not
   walkable. The `accessAisle` object documents the real reserved strip and
   explicitly flags that `x=708..770` is not usable.
4. **Board extents.** `x=697..704, y=250..292` follows the provided
   approximation; the exact source line-work was not re-measured.
5. **Version metadata.** `meta.id/version/subtitle`, the added
   `meta.stroke.aisle` / `meta.colors.aisle` and the extra `protected` entries are
   version/traceability metadata, not geometry; they are the only non-board,
   non-chair, non-aisle changes and are asserted by the delta check.
