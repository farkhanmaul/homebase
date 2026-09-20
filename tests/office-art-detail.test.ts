// V2 art-direction acceptance tests.
//
// These quantify the jump from "dark floor plan with primitive furniture" to the
// dense V1 detail density, structurally rather than by subjective snapshot:
//
//   a) every work desk associated with chairs carries per-chair workstation kits
//      (monitor + keyboard + one small prop),
//   b) long Desk Collection / Tele banks repeat one kit per nearby chair rhythm,
//   c) every furniture kind clears a meaningful layered-op minimum,
//   d) game ops stay free of diagnostic text/markers,
//   e) the decoration pass is deterministic, in bounds and clears openings,
//   f) the gameplay camera is closer than the old 960 world-px view and still
//      letterbox-free and clamped,
//   g) no geometry / manifest / backend / package change rides along.
//
// The association rule (a chair belongs to the nearest solid furniture) is
// recomputed here from the manifest, independently of the renderer, so the tests
// cannot be satisfied by a tautological re-export.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { officeMap, type Furniture, type FurnitureKind, type OfficeManifest, type Rect } from '../lib/office-map.ts';
import { PREVIEW_COLORS, flattenOps, type GroupOp, type Op, type PaintedOp } from '../lib/office-render-ops.ts';
import { buildDecorationOps, buildFurnitureGroup, buildGameWorldOps, chairFacingFor } from '../lib/office-game-ops.ts';
import { MOBILE_WORLD_HEIGHT, DESKTOP_WORLD_WIDTH, computeViewport, defaultViewport } from '../lib/office-viewport.ts';
import { cropPreviewOps } from '../lib/office-crop.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALL_KINDS: FurnitureKind[] = ['desk', 'table', 'counter', 'cabinet', 'chair', 'fridge', 'dispenser', 'screen', 'sink', 'sofa', 'board'];

// Per-kind layered-op minimums. A "workstation sub-element" (monitor bezel,
// screen, stand, keyboard rows, mouse, prop) is several painted ops, so reaching
// these floors means the sprite reads as layered art, never one flat rectangle.
const MIN_LAYERED_OPS: Record<FurnitureKind, number> = {
  desk: 22,
  table: 14,
  counter: 14,
  cabinet: 12,
  chair: 14,
  fridge: 12,
  dispenser: 14,
  screen: 8,
  sink: 10,
  sofa: 12,
  board: 10,
};

// The exact asset that must not drift during an art-only pass.
const MAP_SHA256 = '0eeec47926eef3f099292c8de2b52266a576683c410727d8f387a602092153c5';

function topGroups(ops: readonly Op[]): GroupOp[] {
  return ops.filter((op): op is GroupOp => op.t === 'group');
}

function walkGroups(ops: readonly Op[]): GroupOp[] {
  const out: GroupOp[] = [];
  for (const op of ops) {
    if (op.t !== 'group') continue;
    out.push(op);
    out.push(...walkGroups(op.ops));
  }
  return out;
}

function painted(ops: readonly Op[]) {
  return flattenOps(ops);
}

function opBounds(op: PaintedOp): Rect {
  if (op.t === 'rect') return { x: op.x, y: op.y, w: op.w, h: op.h };
  if (op.t === 'circle') return { x: op.cx - op.r, y: op.cy - op.r, w: op.r * 2, h: op.r * 2 };
  if (op.t === 'image') return { x: op.x, y: op.y, w: op.w, h: op.h };
  return { x: op.x, y: op.y, w: 0, h: 0 };
}

function groupBounds(group: GroupOp): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const op of painted(group.ops)) {
    const box = opBounds(op);
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// A chair belongs to the nearest solid furniture (desk/table/counter). This is
// the same pure-geometry rule documented in the renderer, recomputed here.
function nearestSolid(manifest: OfficeManifest, chair: Furniture): Furniture | null {
  const cx = chair.rect.x + chair.rect.w / 2;
  const cy = chair.rect.y + chair.rect.h / 2;
  let best: Furniture | null = null;
  let bestDistance = Infinity;
  for (const solid of manifest.furniture) {
    if (!solid.solid) continue;
    const dx = solid.rect.x + solid.rect.w / 2 - cx;
    const dy = solid.rect.y + solid.rect.h / 2 - cy;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = solid;
    }
  }
  return best;
}

function chairsFor(manifest: OfficeManifest, desk: Furniture): Furniture[] {
  return manifest.furniture.filter((item) => item.kind === 'chair' && nearestSolid(manifest, item)?.id === desk.id);
}

// ---------------------------------------------------------------------------
// (a) Workstation kits per chair
// ---------------------------------------------------------------------------

void test('every work desk associated with chairs carries monitor+keyboard+prop kits, one per chair', () => {
  const byId = new Map(topGroups(buildGameWorldOps(officeMap)).map((group) => [group.sourceId, group]));
  const desks = officeMap.furniture.filter((item) => item.kind === 'desk');
  let checked = 0;
  let kitTotal = 0;

  for (const desk of desks) {
    const chairs = chairsFor(officeMap, desk);
    if (!chairs.length) continue;
    checked += 1;
    const group = byId.get(desk.id);
    assert.ok(group, `${desk.id} has a group`);

    const kits = walkGroups(group.ops).filter((inner) => inner.semantic === 'workstation:kit');
    assert.equal(kits.length, chairs.length, `${desk.id} has one kit per associated chair`);
    kitTotal += kits.length;

    for (const kit of kits) {
      const semantics = new Set(walkGroups(kit.ops).map((inner) => inner.semantic));
      assert.ok(semantics.has('workstation:monitor'), `${desk.id}/${kit.sourceId} has a monitor group`);
      assert.ok(semantics.has('workstation:keyboard'), `${desk.id}/${kit.sourceId} has a keyboard group`);
      assert.ok(semantics.has('workstation:prop'), `${desk.id}/${kit.sourceId} has a prop group`);
      // A V1 workstation is 5-10 sub-elements, i.e. clearly layered.
      assert.ok(painted(kit.ops).length >= 10, `${desk.id}/${kit.sourceId} kit is layered, got ${painted(kit.ops).length}`);
    }
  }

  assert.ok(checked >= 8, `expected most desks to be staffed, checked ${checked}`);
  assert.ok(kitTotal >= 40, `expected a dense floor of kits, got ${kitTotal}`);
});

void test('every chair on a desk maps to exactly one kit and no kit is invented without a chair', () => {
  const byId = new Map(topGroups(buildGameWorldOps(officeMap)).map((group) => [group.sourceId, group]));
  const deskChairs = officeMap.furniture.filter((item) => item.kind === 'chair' && nearestSolid(officeMap, item)?.kind === 'desk');
  const kitCount = officeMap.furniture
    .filter((item) => item.kind === 'desk')
    .reduce((sum, desk) => sum + walkGroups(byId.get(desk.id)!.ops).filter((inner) => inner.semantic === 'workstation:kit').length, 0);
  assert.equal(kitCount, deskChairs.length, 'one kit per desk-associated chair, no orphan kits');

  const sourceIds = officeMap.furniture
    .filter((item) => item.kind === 'desk')
    .flatMap((desk) => walkGroups(byId.get(desk.id)!.ops).filter((inner) => inner.semantic === 'workstation:kit').map((inner) => inner.sourceId));
  assert.equal(new Set(sourceIds).size, sourceIds.length, 'kit ids are unique');
});

// ---------------------------------------------------------------------------
// (b) Long bank rhythm
// ---------------------------------------------------------------------------

void test('long Desk Collection banks repeat one workstation kit per nearby chair rhythm', () => {
  const byId = new Map(topGroups(buildGameWorldOps(officeMap)).map((group) => [group.sourceId, group]));
  // The approved association (nearest solid) staffs the two Desk Collection
  // banks with 9 and 12 chairs; 9 per bank is the honest floor and the two banks
  // together always exceed 18.
  let banked = 0;
  for (const id of ['F-DC-BANK-TOP', 'F-DC-BANK-BOTTOM']) {
    const desk = officeMap.furniture.find((item) => item.id === id)!;
    const chairs = chairsFor(officeMap, desk);
    const kits = walkGroups(byId.get(id)!.ops).filter((inner) => inner.semantic === 'workstation:kit');
    assert.equal(kits.length, chairs.length, `${id} mirrors its chair rhythm`);
    assert.ok(kits.length >= 9, `${id} is a long bank, got ${kits.length} kits`);
    banked += kits.length;

    // Map every kit back to the exact chair it serves via the kit's own
    // sourceId (`${deskId}#${chairId}@${facing}`). This is the structural,
    // one-kit-per-chair contract: a bounding-box centre comparison is unreliable
    // because the asymmetric prop art shifts a kit's centre off its chair
    // column, even when the kit count already equals the chair count.
    const kitChairIds = kits.map((kit) => {
      const match = /#([^@#]+)@/.exec(kit.sourceId);
      assert.ok(match, `${kit.sourceId} encodes the chair it serves`);
      return match[1]!;
    });
    assert.equal(new Set(kitChairIds).size, kits.length, `${id} staffs each chair with exactly one kit`);
    assert.deepEqual([...kitChairIds].sort(), chairs.map((chair) => chair.id).sort(), `${id} kits map exactly onto its associated chairs`);

    // Both sides of the bank are staffed and face inward.
    const facings = new Set(kits.map((kit) => kit.sourceId.split('@')[1]));
    assert.ok(facings.has('north') && facings.has('south'), `${id} has chairs on both long sides (${[...facings].join(',')})`);
  }
  assert.ok(banked >= 18, `the two Desk Collection banks staff at least 18 chairs, got ${banked}`);
});

void test('workstation kits never spill past their desk footprint', () => {
  const byId = new Map(topGroups(buildGameWorldOps(officeMap)).map((group) => [group.sourceId, group]));
  let checked = 0;
  for (const desk of officeMap.furniture.filter((item) => item.kind === 'desk')) {
    const group = byId.get(desk.id)!;
    const pad = 2;
    for (const kit of walkGroups(group.ops).filter((inner) => inner.semantic === 'workstation:kit')) {
      const box = groupBounds(kit);
      assert.ok(box.x >= desk.rect.x - pad && box.y >= desk.rect.y - pad, `${kit.sourceId} starts inside ${desk.id} (${JSON.stringify(box)} vs ${JSON.stringify(desk.rect)})`);
      assert.ok(box.x + box.w <= desk.rect.x + desk.rect.w + pad && box.y + box.h <= desk.rect.y + desk.rect.h + pad, `${kit.sourceId} ends inside ${desk.id} (${JSON.stringify(box)} vs ${JSON.stringify(desk.rect)})`);
      checked += 1;
    }
  }
  assert.ok(checked >= 40, `checked a dense floor of kits, got ${checked}`);
});

void test('no furniture layer, circle or dash leaks into the empty floor', () => {
  const byId = new Map(topGroups(buildGameWorldOps(officeMap)).map((group) => [group.sourceId, group]));
  const pad = 6;
  for (const item of officeMap.furniture) {
    const group = byId.get(item.id)!;
    for (const box of painted(group.ops).map(opBounds)) {
      assert.ok(box.x >= item.rect.x - pad && box.y >= item.rect.y - pad, `${item.id} layer ${JSON.stringify(box)} starts inside ${JSON.stringify(item.rect)}`);
      assert.ok(box.x + box.w <= item.rect.x + item.rect.w + pad && box.y + box.h <= item.rect.y + item.rect.h + pad, `${item.id} layer ${JSON.stringify(box)} ends inside ${JSON.stringify(item.rect)}`);
    }
  }
});

// ---------------------------------------------------------------------------
// (b2) Chair silhouette
// ---------------------------------------------------------------------------

const CHAIR_PARTS = ['chair:base', 'chair:seat', 'chair:backrest'] as const;

void test('every chair is a layered black armless silhouette with an oriented backrest, cushion and base', () => {
  const byId = new Map(topGroups(buildGameWorldOps(officeMap)).map((group) => [group.sourceId, group]));
  const solids = officeMap.furniture.filter((item) => item.solid);
  const chairs = officeMap.furniture.filter((item) => item.kind === 'chair');
  assert.ok(chairs.length >= 40, `expected a floor of chairs, got ${chairs.length}`);

  for (const chair of chairs) {
    const group = byId.get(chair.id)!;
    const nested = walkGroups(group.ops);
    const parts = new Set(nested.map((inner) => inner.semantic));
    for (const part of CHAIR_PARTS) assert.ok(parts.has(part), `${chair.id} has ${part}`);
    assert.equal(parts.has('chair:armrest'), false, `${chair.id} has no armrest`);
    assert.ok(painted(group.ops).length >= MIN_LAYERED_OPS.chair, `${chair.id} clears the chair op floor`);

    // V1 chairs are stepped rectangles, not circle-dominant schematic symbols:
    // no cushion-sized disc may remain.
    const maxDisc = Math.min(chair.rect.w, chair.rect.h) * 0.35;
    const bigDiscs = painted(group.ops).filter((op) => op.t === 'circle' && op.r >= maxDisc);
    assert.equal(bigDiscs.length, 0, `${chair.id} has an oversized cushion disc`);

    // Orientation is legible: the backrest sits on the side the chair belongs to.
    const facing = chairFacingFor(chair, solids);
    const back = nested.find((inner) => inner.semantic === 'chair:backrest')!;
    const bb = groupBounds(back);
    const cx = chair.rect.x + chair.rect.w / 2;
    const cy = chair.rect.y + chair.rect.h / 2;
    if (facing === 'north') assert.ok(bb.y + bb.h / 2 < cy, `${chair.id} backrest faces north`);
    else if (facing === 'south') assert.ok(bb.y + bb.h / 2 > cy, `${chair.id} backrest faces south`);
    else if (facing === 'west') assert.ok(bb.x + bb.w / 2 < cx, `${chair.id} backrest faces west`);
    else assert.ok(bb.x + bb.w / 2 > cx, `${chair.id} backrest faces east`);
  }
});

// ---------------------------------------------------------------------------
// (b3) Bilik cubicle cluster
// ---------------------------------------------------------------------------

void test('the Bilik banks read as cubicle clusters: central spine, bay dividers and a kit per chair', () => {
  const byId = new Map(topGroups(buildGameWorldOps(officeMap)).map((group) => [group.sourceId, group]));

  const bank = officeMap.furniture.find((item) => item.id === 'F-GENG-BANK')!;
  const bankGroup = byId.get('F-GENG-BANK')!;
  assert.equal(chairsFor(officeMap, bank).length, 4, 'the Bilik bank seats four');
  const bankSemantics = walkGroups(bankGroup.ops).map((inner) => inner.semantic);
  assert.ok(bankSemantics.includes('desk:spine'), 'F-GENG-BANK has a central divider');
  assert.ok(bankSemantics.includes('desk:divider'), 'F-GENG-BANK has cross-bay dividers');
  const bankKits = walkGroups(bankGroup.ops).filter((inner) => inner.semantic === 'workstation:kit');
  assert.equal(bankKits.length, 4, 'one kit per Bilik chair');
  for (const kit of bankKits) {
    const semantics = new Set(walkGroups(kit.ops).map((inner) => inner.semantic));
    assert.ok(semantics.has('workstation:monitor'), `${kit.sourceId} has a monitor`);
    assert.ok(semantics.has('workstation:keyboard'), `${kit.sourceId} has a keyboard`);
    assert.ok(semantics.has('workstation:prop'), `${kit.sourceId} has a prop`);
  }

  const vertical = officeMap.furniture.find((item) => item.id === 'F-GENG-DESK-V')!;
  const verticalGroup = byId.get('F-GENG-DESK-V')!;
  const verticalKits = walkGroups(verticalGroup.ops).filter((inner) => inner.semantic === 'workstation:kit');
  assert.equal(verticalKits.length, chairsFor(officeMap, vertical).length, 'the vertical Bilik desk kits match its chairs');
  assert.ok(verticalKits.length >= 2, 'the vertical Bilik desk supports its two side chairs');
  const verticalSemantics = new Set(walkGroups(verticalGroup.ops).map((inner) => inner.semantic));
  assert.ok(verticalSemantics.has('desk:spine'), 'the vertical Bilik desk has a central spine');
  const verticalFacings = new Set(verticalKits.map((kit) => kit.sourceId.split('@')[1]));
  assert.ok(verticalFacings.has('east') && verticalFacings.has('west'), 'the vertical desk staffs both sides');
});

void test('the vertical Tele banks staff both faces of the desk', () => {
  const byId = new Map(topGroups(buildGameWorldOps(officeMap)).map((group) => [group.sourceId, group]));
  for (const id of ['F-TC-BANK-L', 'F-TC-BANK-R']) {
    const kits = walkGroups(byId.get(id)!.ops).filter((inner) => inner.semantic === 'workstation:kit');
    assert.ok(kits.length >= 12, `${id} staffs its 12 chairs`);
    const facings = new Set(kits.map((kit) => kit.sourceId.split('@')[1]));
    assert.ok(facings.has('east') && facings.has('west'), `${id} has chairs on both long sides (${[...facings].join(',')})`);
  }
});

// ---------------------------------------------------------------------------
// (c) Layered-op minimums
// ---------------------------------------------------------------------------

void test('every approved furniture group clears its per-kind layered-op minimum', () => {
  const byId = new Map(topGroups(buildGameWorldOps(officeMap)).map((group) => [group.sourceId, group]));
  for (const item of officeMap.furniture) {
    const group = byId.get(item.id)!;
    const count = painted(group.ops).length;
    assert.ok(count >= MIN_LAYERED_OPS[item.kind], `${item.id} (${item.kind}) has ${count} painted ops, need ${MIN_LAYERED_OPS[item.kind]}`);
  }
});

void test('every furniture kind clears its minimum even on a small generic fixture', () => {
  for (const kind of ALL_KINDS) {
    const item: Furniture = { id: `fixture-${kind}`, kind, solid: true, zone: 'desk-collection', rect: { x: 900, y: 400, w: 60, h: 44 } };
    const group = buildFurnitureGroup(item);
    const count = painted(group.ops).length;
    assert.ok(count >= MIN_LAYERED_OPS[kind], `${kind} fixture has ${count} painted ops, need ${MIN_LAYERED_OPS[kind]}`);
  }
});

// ---------------------------------------------------------------------------
// (d) Game ops stay clean
// ---------------------------------------------------------------------------

void test('game ops paint no diagnostic text, bands or markers', () => {
  const ops = buildGameWorldOps(officeMap);
  const flat = painted(ops);
  const texts = flat.filter((op) => op.t === 'text');
  assert.equal(texts.length, 0, `game ops must not draw text: ${JSON.stringify(texts.map((op) => (op as { text: string }).text))}`);

  const debugFills = new Set<string>([PREVIEW_COLORS.hotspot, PREVIEW_COLORS.threshold, PREVIEW_COLORS.labelBand, PREVIEW_COLORS.sealed]);
  for (const op of flat) {
    if ('fill' in op) assert.equal(debugFills.has(op.fill), false, `debug colour ${op.fill} must not appear`);
    if (op.t === 'circle') assert.notEqual(op.fill, PREVIEW_COLORS.hotspot, 'no hotspot markers');
  }
});

// ---------------------------------------------------------------------------
// (e) Decoration pass
// ---------------------------------------------------------------------------

void test('the decoration pass is deterministic, bounded and free of groups', () => {
  const first = buildDecorationOps(officeMap);
  const second = buildDecorationOps(officeMap);
  assert.ok(first.length > 0, 'the office is decorated');
  assert.equal(JSON.stringify(first), JSON.stringify(second), 'decorations are deterministic');
  // Decorations are pure paint: the one-group-per-furniture contract is intact.
  assert.equal(topGroups(buildGameWorldOps(officeMap)).length, officeMap.furniture.length, 'decorations never add a top-level group');
  assert.ok(first.length <= 900, `decorations stay bounded, got ${first.length}`);
});

void test('every decoration is finite, in bounds and clear of openings, furniture and seats', () => {
  const decos = buildDecorationOps(officeMap).map(opBounds);
  const openings = officeMap.openings.map((opening) => opening.rect);
  const solids = officeMap.furniture.filter((item) => item.solid).map((item) => item.rect);
  const seats = officeMap.furniture.filter((item) => item.kind === 'chair').map((item) => item.rect);

  for (const box of decos) {
    for (const value of [box.x, box.y, box.w, box.h]) assert.ok(Number.isFinite(value), 'decoration is finite');
    assert.ok(box.w > 0 && box.h > 0, 'decoration has positive size');
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= officeMap.width && box.y + box.h <= officeMap.height, `decoration ${JSON.stringify(box)} is in bounds`);
    for (const opening of openings) assert.equal(overlaps(box, opening), false, `decoration ${JSON.stringify(box)} covers opening ${JSON.stringify(opening)}`);
    for (const solid of solids) assert.equal(overlaps(box, solid), false, `decoration ${JSON.stringify(box)} overlaps solid furniture ${JSON.stringify(solid)}`);
    for (const seat of seats) assert.equal(overlaps(box, seat), false, `decoration ${JSON.stringify(box)} overlaps a chair`);
  }
});

void test('plant decorations sit in the zone perimeter, never across a room interior', () => {
  // The outer 24px ring of every decorated zone is safe from the main routes; a
  // decoration deeper than that would visually block an actor path.
  const decos = buildDecorationOps(officeMap).map(opBounds);
  for (const zone of officeMap.zones) {
    if (zone.kind === 'service' || zone.kind === 'corridor') continue;
    const inner: Rect = { x: zone.rect.x + 24, y: zone.rect.y + 24, w: zone.rect.w - 48, h: zone.rect.h - 48 };
    if (inner.w <= 0 || inner.h <= 0) continue;
    for (const box of decos) {
      // Only decorations genuinely inside this zone are constrained by it.
      if (!overlaps(box, zone.rect)) continue;
      assert.equal(overlaps(box, inner), false, `decoration ${JSON.stringify(box)} blocks the interior of ${zone.id}`);
    }
  }
});

void test('the decoration pass adds no collider and no manifest furniture', () => {
  assert.equal(officeMap.furniture.length, 124, 'the approved furniture inventory is untouched');
  assert.equal(officeMap.blocks.length, 17, 'the approved block list is untouched');
  assert.equal(officeMap.blocks.filter((block) => block.kind === 'sealed').length, 8, 'sealed blocks untouched');
  // Decorations are pure paint: nothing about them reaches collision.
  const before = JSON.stringify(officeMap);
  void buildDecorationOps(officeMap);
  assert.equal(JSON.stringify(officeMap), before, 'building decorations never mutates the manifest');
});

// ---------------------------------------------------------------------------
// (f) Gameplay camera
// ---------------------------------------------------------------------------

void test('the desktop gameplay camera is closer than the old 960 world-px view', () => {
  assert.ok(DESKTOP_WORLD_WIDTH >= 600 && DESKTOP_WORLD_WIDTH <= 720, `desktop world width ${DESKTOP_WORLD_WIDTH} is in the readable band`);
  assert.ok(DESKTOP_WORLD_WIDTH < 960, 'desktop view is closer than the rejected 960 crop');

  const view = computeViewport({ width: 1440, height: 1000 }, 'desktop');
  assert.equal(view.w, 680, 'a 1440x1000 desktop resolves to a pinned 680-wide crop');
  assert.equal(view.h, 472, 'the height follows the container aspect');
  assert.ok(view.w < 960, 'the representative desktop view is closer than before');
});

void test('the mobile gameplay camera is closer than the old 600 world-px view', () => {
  assert.ok(MOBILE_WORLD_HEIGHT < 600, 'mobile view is closer than the rejected 600 crop');
  const phone = computeViewport({ width: 414, height: 720 }, 'mobile');
  const small = computeViewport({ width: 320, height: 480 }, 'mobile');
  assert.equal(phone.h, 440);
  assert.equal(phone.w, 253);
  assert.equal(small.w, 293);
  assert.ok(phone.h < 600 && small.h < 600);
});

void test('the closer camera stays letterbox-free and clamped across representative boxes', () => {
  const boxes: Array<{ width: number; height: number }> = [
    { width: 1440, height: 1000 },
    { width: 1072, height: 778 },
    { width: 1920, height: 1080 },
    { width: 320, height: 480 },
    { width: 414, height: 720 },
    { width: 368, height: 603 },
  ];
  for (const box of boxes) {
    for (const mode of ['desktop', 'mobile'] as const) {
      const view = computeViewport(box, mode);
      assert.ok(view.w >= 1 && view.h >= 1);
      assert.ok(view.w <= officeMap.width && view.h <= officeMap.height, `${mode} ${view.w}x${view.h} is clamped to the world`);
      const viewAspect = view.w / view.h;
      const boxAspect = box.width / box.height;
      assert.ok(Math.abs(viewAspect - boxAspect) <= 0.02 * Math.max(viewAspect, boxAspect), `${mode} ${box.width}x${box.height} keeps the container aspect (no letterbox)`);
      assert.ok(view.w < 960, `${mode} view is closer than the old 960-wide crop`);
    }
  }
  assert.equal(defaultViewport('desktop').w, DESKTOP_WORLD_WIDTH);
});

// ---------------------------------------------------------------------------
// (g) Art-only change: no geometry, backend or package drift
// ---------------------------------------------------------------------------

void test('lib/office-map.json is byte-identical to the approved manifest', () => {
  const bytes = readFileSync(resolve(ROOT, 'lib', 'office-map.json'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), MAP_SHA256, 'the approved geometry must not change in an art pass');
});

void test('the dependency set is unchanged (zero new packages)', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), [
    '@base-ui/react', '@shadcn/react', 'class-variance-authority', 'clsx', 'cmdk', 'date-fns', 'embla-carousel-react',
    'input-otp', 'lucide-react', 'react', 'react-day-picker', 'react-dom', 'react-resizable-panels',
    'react-server-dom-webpack', 'recharts', 'shadcn', 'tailwind-merge', 'tw-animate-css', 'vinext',
  ]);
  assert.deepEqual(Object.keys(pkg.devDependencies).sort(), [
    '@cloudflare/vite-plugin', '@cloudflare/workers-types', '@openai/sites-vite-plugin', '@tailwindcss/postcss',
    '@types/node', '@types/react', '@types/react-dom', '@vitejs/plugin-react', '@vitejs/plugin-rsc',
    'oxfmt', 'oxlint', 'oxlint-tsgolint', 'tailwindcss', 'typescript', 'vite', 'wrangler',
  ]);
});

void test('the game renderer paints under the 12000 painted-op budget with fast generation', () => {
  const ops = buildGameWorldOps(officeMap);
  const count = painted(ops).length;
  assert.ok(count <= 12000, `painted ops ${count} must stay within the 12000 budget`);

  const start = performance.now();
  for (let i = 0; i < 20; i += 1) buildGameWorldOps(officeMap);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 4000, `20 world builds took ${Math.round(elapsed)}ms`);
});

// ---------------------------------------------------------------------------
// Crop previews consume the same game ops
// ---------------------------------------------------------------------------

void test('cropPreviewOps slices the game ops into a deterministic gameplay view', () => {
  const full = { width: officeMap.width, height: officeMap.height, ops: buildGameWorldOps(officeMap) };
  const camera = { x: 1380, y: 40 };
  const view = { w: 680, h: 472 };
  const first = cropPreviewOps(full, camera, view, 2);
  const second = cropPreviewOps(full, camera, view, 2);

  assert.equal(first.width, 1360);
  assert.equal(first.height, 944);
  assert.equal(JSON.stringify(first), JSON.stringify(second), 'crops are deterministic');
  assert.ok(first.ops.length > 0, 'the crop paints something');

  for (const op of flattenOps(first.ops)) {
    const box = opBounds(op);
    assert.ok(Number.isFinite(box.x) && Number.isFinite(box.y), 'crop ops are finite');
    assert.ok(box.x + box.w > 0 && box.y + box.h > 0 && box.x < first.width && box.y < first.height, `crop op ${JSON.stringify(box)} intersects the crop`);
  }
});
