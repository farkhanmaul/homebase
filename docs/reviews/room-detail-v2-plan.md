# Homebase Room-detail V2 — coverage and release plan

Baseline: `e630d2620019e87bf01e35ff51b0b4106b7db025`

## Objective

Bring every non-Bilik area to Bilik-level perceived detail using deterministic, footprint-bound pixel art. Geometry, collision, openings, seats, hotspots, interaction behavior, backend and dependencies remain authoritative and unchanged.

## Baseline measurements

- Zones: 21
- Manifest furniture: 123
- Painted game ops: 10,631 / 12,000
- Runtime room image ops: 1 (Bilik)
- Production game text/debug ops: 0
- Frontend tests: 227/227
- Bilik benchmark: `public/room/bilik-geng-v4.png` and `public/room/bilik-geng-zone.png`

## Material contract

- `building-carpet`: every indoor area except the explicit families below. It inherits the warm, granular Bilik floor palette/rhythm and replaces per-room colored rugs.
- `front-of-house`: Reception and Large Lobby.
- `toilet-wet`: Women's Toilet, Men's Toilet and Washbasin area.
- Outside remains outside.

No unapproved room-specific rug, corridor grid, pantry/service tile, or hidden material exception.

## Sequential batches

### Batch 0 — material foundation

Coverage:
- All 21 zones through one tested material classification.

Deliverables:
- Common building carpet renderer.
- Front-of-house and toilet/wet exceptions.
- Removal of furniture-centred colored rugs.
- Determinism, complete-zone enumeration, manifest lock and op-budget tests.
- Full-map and existing crop regeneration.

Stop condition:
- Focused tests green.
- Map JSON and Bilik raster unchanged.
- Painted ops <= 12,000.
- Visual review confirms one building material language.

### Batch 1 — top-room furniture

Coverage:
- `meeting-1`
- `hrga`
- `komisaris`
- `product-manager`
- `it`
- `direktur-finance`

Furniture:
- Meeting table and six chairs.
- Department desks/workstations and chairs.
- HRGA cabinet and dispenser.
- Finance counter.

Detail targets:
- Room-aware workstation prop palettes/sets.
- Meeting stationery and drink rhythm.
- Cabinet doors/shelves/binders/handles.
- Executive versus task-desk joinery.
- Coherent chair silhouette and room-appropriate upholstery.

Artifacts:
- `v2-detail-top-rooms` crop.
- Individual room crops/contact strip if the combined crop hides detail.

### Batch 2 — dense open work areas

Coverage:
- `desk-collection`
- `tele-cs-ca`

Furniture:
- Four long desk banks, 58 visible chairs, performance board.

Detail targets:
- Partition hardware and cable troughs.
- Deterministic occupied/clean workstation rhythm.
- Zone-aware phones, files, headsets, mugs, notepads and plants.
- Cabinet/end-pedestal cues inside existing bank footprints.
- Break copy-paste repetition without visual clutter.

Artifacts:
- Separate Desk Collection and Tele crops at identical scale.
- Dense-area semantic-variant coverage report.

### Batch 3 — front-of-house and circulation

Coverage:
- `resepsionis`
- `lobby-besar`
- `lorong-utama`
- `sirkulasi`
- `jalur-terbuka`
- Four lift blocks and exit approach as visible structural elements.

Furniture:
- Reception counter/chair.
- Four sofas.
- Circulation tables/chairs.
- Two corridor dispensers.

Detail targets:
- Reception counter front, monitor, bell and file cues.
- Sofa seams/cushions/feet.
- Front-of-house material identity.
- Cleaner wall/baseboard/opening transitions.
- Keep every route visually and physically open.

Artifacts:
- Reception/lobby crop.
- Circulation/opening crop.

### Batch 4 — service core

Coverage:
- `pantry`
- `gudang`
- `toilet-wanita`
- `wastafel`
- `toilet-pria`
- `meeting-2`
- `server`

Furniture:
- Pantry counter, dispenser and fridge.
- Meeting 2 tables/chairs.
- Existing service-room structures only.

Detail targets:
- Counter doors/worktop/appliance cues.
- Fridge panels, handle and hinge details compatible with open/closed overlay.
- Dispenser bottle, tap and tray.
- Toilet/wet material consistency.
- Door/jamb/service-wall clarity without implying new collision or interaction.
- Gudang, toilets and Server remain sealed.

Artifacts:
- Service-core crop.
- Pantry close-up.
- Door-state screenshot around interactive appliance/door.

### Batch 5 — integration and visual approval

Coverage:
- Full 1,920 x 960 world.
- Bilik benchmark and all batches side by side.

Deliverables:
- Updated full game preview.
- Baseline-versus-V2 contact sheet.
- Desktop/mobile browser screenshots.
- Automated gates and independent visual review.

Stop condition:
- User explicitly approves the visual result.
- No deployment from this branch.

## Global quality gates

- `lib/office-map.json` byte/hash unchanged.
- No backend/dependency changes.
- Every opening and required route remains reachable.
- Decorative details never become colliders.
- Furniture art remains in its approved footprint plus existing bounded depth skirt.
- All render ops deterministic and finite.
- Game layer contains no debug text/markers.
- Painted game ops <= 12,000.
- JS gzip <= 115 KiB; CSS gzip <= 35 KiB.
- Initial transfer <= 2.5 MiB target / 3 MiB hard limit.
- Pages artifact <= 5 MiB.
- Full frontend, backend, lint, TypeScript, build and browser QA pass before release review.

## Workflow

Use one sequential implementation worktree because all batches touch shared render order, palette and preview artifacts. Each batch follows RED → GREEN → preview → visual QC. Production `main` remains untouched until final visual approval and a separate production-deploy authorization.
