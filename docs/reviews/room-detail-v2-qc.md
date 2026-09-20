# Homebase Room-detail V2 — visual QC rubric

## Review scale

Each batch is scored at the same gameplay zoom as the Bilik benchmark. A batch passes visual QC only when every applicable category scores at least 3/4 and no hard blocker is present.

| Category | 1 — fail | 2 — weak | 3 — pass | 4 — benchmark |
|---|---|---|---|---|
| Furniture silhouette | Flat box/icon; kind is unclear | Kind is readable but generic | Kind, orientation and construction are readable | Room-specific construction is immediately readable |
| Depth/layering | No front/side face or contact | Inconsistent depth, floating edges | Coherent top/front/side/contact shadow | Layering matches Bilik density without clutter |
| Semantic props | Noise or repeated decorative pixels | Same generic kit everywhere | Props fit the room and approved furniture | Props create an inhabited but restrained room story |
| Material cohesion | Multiple unrelated floors/rugs | Similar colors, inconsistent rhythm | One building carpet with explicit exceptions | Seam/texture/transition rhythm is seamless at openings |
| Pixel discipline | Blurry, sub-pixel or gradient-like | Mixed pixel scale | Crisp integer-aligned clusters | Consistent 1–3 px vocabulary and controlled palette |
| Route clarity | Decorative element suggests a blocker | Narrow/ambiguous visual lane | Openings and walkways are visually clear | Structure, doorway and floor transition reinforce navigation |
| Repetition control | Copy-paste banks | Minor color-only changes | Deterministic meaningful variants | Variation is visible but still reads as one furniture system |

## Hard blockers

- Any change to `lib/office-map.json`, authoritative geometry, collision, seats, hotspots or furniture count/rect/solid flags.
- Any new collider or decorative operation consulted by movement.
- Any visible object occupying an approved opening or empty walk lane.
- Any debug text, ID, collision overlay, hotspot marker or review annotation in the game layer.
- Any Bilik raster/generator drift without explicit approval.
- Any changed door/fridge interaction behavior or actor layering.
- Any painted game-op total above 12,000.
- Any JS/CSS/artifact hard-budget breach.

## Automated evidence

- Explicit material-family enumeration for all 21 zones.
- Pixel/color probes for representative safe floor points in every material family.
- Deterministic op-list equality and preview regeneration.
- Map JSON and Bilik PNG SHA-256 lock.
- Furniture group/cardinality lock: 123 manifest items, one top-level group per approved item.
- Semantic detail presence per room profile and intended furniture group.
- Bounded detail operations inside approved rect plus existing <=2 px visual skirt.
- Opening/reachability/navigation regression suite.
- No game text/debug op.
- Painted-op, JS gzip, CSS gzip, initial transfer and Pages artifact measurements.

## Required visual artifacts

For each batch:

1. Full game map.
2. Batch crop at gameplay camera scale.
3. Bilik reference crop at matching display scale.
4. Before/after side-by-side or labeled contact sheet.
5. Browser screenshot after final integration.

## Reviewer questions

- Can an unfamiliar reviewer name the furniture kind without reading a label?
- Does this room tell a different functional story from adjacent rooms through approved furniture details, not invented objects?
- Does the common carpet feel continuous through openings?
- Are lobby/reception and toilet/wet exceptions deliberate rather than accidental?
- Do dense workstation banks vary meaningfully without becoming noisy?
- Are all routes and interactive objects visually obvious?
- Does the result feel as resolved as Bilik at gameplay zoom, not only at 4× inspection?
