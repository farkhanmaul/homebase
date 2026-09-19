// Global perspective + depth primitives.
//
// The approved manifest drives a second, purely-visual pass so the whole office
// reads like the Bilik Geng Kami raster instead of a flat top-down plan: every
// non-Bilik furniture group gets a depth kit (contact shadow, visible south
// front face, top lip, ground line), every wall gets a room-facing front face,
// every door/gap a frame and every window a sill. Everything is derived from the
// approved rects and stays inside a small skirt, so collision, footprints and
// the manifest are untouched and there is still exactly one Bilik image op.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BILIK_GENG_ZONE_ID, officeMap, type Furniture, type Rect, type Wall } from '../lib/office-map.ts';
import { flattenOps, type GroupOp, type Op, type PaintedOp } from '../lib/office-render-ops.ts';
import {
  FURNITURE_DEPTH,
  GAME_PALETTE,
  OPENING_FRAME,
  WALL_FACE_DEPTH,
  buildFurnitureGroup,
  buildGameWorldOps,
  furnitureDepthOps,
  openingFrameOps,
  wallFaceOps,
  windowSillOps,
} from '../lib/office-game-ops.ts';

const DEPTH_SEMANTIC = 'furniture:depth';
const SKIRT = 5;

function topGroups(ops: readonly Op[]): GroupOp[] {
  return ops.filter((op): op is GroupOp => op.t === 'group');
}

function walkGroups(ops: readonly Op[]): GroupOp[] {
  const out: GroupOp[] = [];
  for (const op of ops) {
    if (op.t !== 'group') continue;
    out.push(op, ...walkGroups(op.ops));
  }
  return out;
}

function rects(ops: readonly Op[]): Rect[] {
  return flattenOps(ops)
    .filter((op): op is Extract<PaintedOp, { t: 'rect' }> => op.t === 'rect')
    .map((op) => ({ x: op.x, y: op.y, w: op.w, h: op.h }));
}

function fills(ops: readonly Op[]): string[] {
  return flattenOps(ops).map((op) => ('fill' in op ? op.fill : ''));
}

function overlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function inWorld(box: Rect): boolean {
  return box.x >= -1 && box.y >= -1 && box.x + box.w <= officeMap.width + 1 && box.y + box.h <= officeMap.height + 1;
}

// ---------------------------------------------------------------------------
// Walls: a visible room-facing front face
// ---------------------------------------------------------------------------

void test('every wall exposes a front face on its room-facing side with a cap, baseboard and ground shadow', () => {
  for (const wall of officeMap.walls) {
    const ops = wallFaceOps(wall);
    const boxes = rects(ops);
    assert.ok(boxes.length >= 4, `${wall.id} has a layered face, got ${boxes.length}`);

    const horizontal = wall.rect.w >= wall.rect.h;
    const edgeX = Math.round(horizontal ? wall.rect.x : wall.rect.x + wall.rect.w);
    const edgeY = Math.round(horizontal ? wall.rect.y + wall.rect.h : wall.rect.y);

    // The face band starts exactly on the wall's south (horizontal) or east
    // (vertical) edge and is as deep as the shared wall depth.
    const band = boxes.find((box) =>
      box.x === edgeX && box.y === edgeY && (horizontal ? box.h === WALL_FACE_DEPTH : box.w === WALL_FACE_DEPTH));
    assert.ok(band, `${wall.id} has a ${horizontal ? 'south' : 'east'} face band at ${edgeX},${edgeY}`);
    assert.ok(WALL_FACE_DEPTH >= 4, 'the wall depth is a visible extrusion');
  }
});

void test('the wall face uses the wall material, a bright cap and the baseboard tone', () => {
  const wall: Wall = {
    id: 'face-probe',
    kind: 'full',
    rect: { x: 100, y: 100, w: 200, h: 6 },
  };
  const palette = new Set(fills(wallFaceOps(wall)));
  assert.ok(palette.has(GAME_PALETTE.wallFace), 'the full wall face uses the wall material');
  assert.ok(palette.has(GAME_PALETTE.wallCap), 'the wall face has a lit top cap');
  assert.ok(palette.has(GAME_PALETTE.shadow), 'the wall face grounds with a contact shadow');

  const partition: Wall = { id: 'partition-probe', kind: 'partition', rect: { x: 100, y: 100, w: 6, h: 200 } };
  assert.ok(new Set(fills(wallFaceOps(partition))).has(GAME_PALETTE.partitionFace), 'a partition face uses its own material');
});

void test('wall faces stay in the world and never move wall geometry', () => {
  const before = JSON.stringify(officeMap);
  for (const wall of officeMap.walls) {
    for (const box of rects(wallFaceOps(wall))) {
      assert.ok(Number.isFinite(box.x) && Number.isFinite(box.y), `${wall.id} face is finite`);
      assert.ok(box.w > 0 && box.h > 0, `${wall.id} face has positive size`);
      assert.ok(inWorld(box), `${wall.id} face ${JSON.stringify(box)} is in the world`);
    }
  }
  assert.equal(JSON.stringify(officeMap), before, 'wall geometry is untouched');
});

// ---------------------------------------------------------------------------
// Furniture: a per-kind depth kit
// ---------------------------------------------------------------------------

void test('every non-Bilik furniture group carries a furniture:depth kit with a south front face', () => {
  const byId = new Map(topGroups(buildGameWorldOps(officeMap)).map((group) => [group.sourceId, group]));
  let checked = 0;
  for (const item of officeMap.furniture) {
    if (item.zone === BILIK_GENG_ZONE_ID) continue;
    const group = byId.get(item.id);
    assert.ok(group, `${item.id} has a group`);

    const depth = walkGroups(group.ops).find((inner) => inner.semantic === DEPTH_SEMANTIC);
    assert.ok(depth, `${item.id} has a depth kit`);

    const boxes = rects(depth.ops);
    assert.ok(boxes.length >= 4, `${item.id} depth kit is layered, got ${boxes.length}`);

    const d = FURNITURE_DEPTH[item.kind];
    const bottom = Math.round(item.rect.y) + Math.max(1, Math.round(item.rect.y + item.rect.h) - Math.round(item.rect.y));
    const face = boxes.find((box) => box.h === d && box.y + box.h === bottom && box.w >= Math.max(1, item.rect.w * 0.5));
    assert.ok(face, `${item.id} (${item.kind}) has a ${d}px south front face ending at ${bottom}`);

    assert.ok(fills(depth.ops).includes(GAME_PALETTE.shadow), `${item.id} depth kit grounds with a contact shadow`);
    checked += 1;
  }
  assert.ok(checked >= 100, `checked the non-Bilik floor, got ${checked}`);
});

void test('the depth kit stays inside the approved footprint plus a small skirt, so collision is untouched', () => {
  const before = JSON.stringify(officeMap);
  for (const item of officeMap.furniture) {
    if (item.zone === BILIK_GENG_ZONE_ID) continue;
    for (const box of rects(furnitureDepthOps(item))) {
      assert.ok(box.x >= item.rect.x - SKIRT && box.y >= item.rect.y - SKIRT, `${item.id} depth starts inside (${JSON.stringify(box)})`);
      assert.ok(
        box.x + box.w <= item.rect.x + item.rect.w + SKIRT && box.y + box.h <= item.rect.y + item.rect.h + SKIRT,
        `${item.id} depth ends inside (${JSON.stringify(box)})`,
      );
      assert.ok(inWorld(box), `${item.id} depth ${JSON.stringify(box)} is in the world`);
    }
  }
  assert.equal(JSON.stringify(officeMap), before, 'furniture geometry is untouched');
});

void test('every furniture kind gets a depth kit, including kinds absent from this manifest', () => {
  const item: Furniture = { id: 'depth-probe', kind: 'desk', solid: true, zone: 'desk-collection', rect: { x: 900, y: 400, w: 60, h: 44 } };
  for (const kind of Object.keys(FURNITURE_DEPTH) as Array<keyof typeof FURNITURE_DEPTH>) {
    const ops = furnitureDepthOps({ ...item, kind });
    assert.ok(rects(ops).length >= 4, `${kind} depth kit is layered`);
    assert.ok(FURNITURE_DEPTH[kind] >= 2 && FURNITURE_DEPTH[kind] <= SKIRT, `${kind} depth is a visible but bounded extrusion`);
    const group = buildFurnitureGroup({ ...item, kind });
    assert.ok(walkGroups(group.ops).some((inner) => inner.semantic === DEPTH_SEMANTIC), `${kind} group carries the depth kit`);
  }
});

void test('Bilik Geng Kami furniture is skipped and the single raster op still paints last', () => {
  const byId = new Map(topGroups(buildGameWorldOps(officeMap)).map((group) => [group.sourceId, group]));
  const bilikFurniture = officeMap.furniture.filter((item) => item.zone === BILIK_GENG_ZONE_ID);
  assert.ok(bilikFurniture.length > 0, 'the Bilik zone has furniture to skip');
  for (const item of bilikFurniture) {
    const depth = walkGroups(byId.get(item.id)!.ops).find((inner) => inner.semantic === DEPTH_SEMANTIC);
    assert.equal(depth, undefined, `${item.id} keeps the raster-only look`);
  }

  const images = flattenOps(buildGameWorldOps(officeMap)).filter((op) => op.t === 'image');
  assert.equal(images.length, 1, 'still exactly one Bilik image op');
});

void test('the depth pass adds no top-level group: one group per furniture item is intact', () => {
  assert.equal(topGroups(buildGameWorldOps(officeMap)).length, officeMap.furniture.length);
  assert.equal(officeMap.furniture.length, 123, 'the approved inventory is untouched');
});

// ---------------------------------------------------------------------------
// Doors and windows: frames and sills
// ---------------------------------------------------------------------------

void test('every opening gets a door frame inside its approved gap', () => {
  for (const opening of officeMap.openings) {
    const ops = openingFrameOps(opening);
    const boxes = rects(ops);
    assert.ok(boxes.length >= 4, `${opening.id} has a framed gap, got ${boxes.length}`);
    const r = opening.rect;
    for (const box of boxes) {
      assert.ok(box.x >= r.x - 0.5 && box.y >= r.y - 0.5, `${opening.id} frame starts inside the gap`);
      assert.ok(box.x + box.w <= r.x + r.w + 0.5 && box.y + box.h <= r.y + r.h + 0.5, `${opening.id} frame ends inside the gap`);
      assert.ok(inWorld(box), `${opening.id} frame is in the world`);
    }
    const horizontal = opening.orientation === 'horizontal';
    const post = boxes.find((box) => (horizontal ? box.w === OPENING_FRAME : box.h === OPENING_FRAME));
    assert.ok(post, `${opening.id} has jambs of the shared frame width`);
  }
});

void test('every window gets a sill band on its room-facing side', () => {
  for (const win of officeMap.windows) {
    const boxes = rects(windowSillOps(win));
    assert.ok(boxes.length >= 3, `${win.id} sill is layered, got ${boxes.length}`);
    const r = win.rect;
    const band = boxes.find((box) => (win.side === 'top' || win.side === 'bottom' ? box.w >= r.w - 1 : box.h >= r.h - 1));
    assert.ok(band, `${win.id} has a sill as wide as the window`);
    // The sill sits on the room-facing side of the glass: below a top window,
    // above a bottom one, right of a right window and left of a left window.
    if (win.side === 'top') assert.ok(band!.y >= r.y + r.h, `${win.id} sill sits below the glass`);
    if (win.side === 'bottom') assert.ok(band!.y + band!.h <= r.y, `${win.id} sill sits above the glass`);
    if (win.side === 'right') assert.ok(band!.x >= r.x + r.w, `${win.id} sill sits to the right of the glass`);
    if (win.side === 'left') assert.ok(band!.x + band!.w <= r.x, `${win.id} sill sits to the left of the glass`);
    for (const box of boxes) assert.ok(inWorld(box), `${win.id} sill is in the world`);
  }
  assert.ok(officeMap.windows.length >= 3, 'the approved windows are present');
});

// ---------------------------------------------------------------------------
// Determinism, cleanliness and budget
// ---------------------------------------------------------------------------

void test('the perspective pass is deterministic', () => {
  assert.equal(JSON.stringify(buildGameWorldOps(officeMap)), JSON.stringify(buildGameWorldOps(officeMap)));
});

void test('the perspective pass paints no text and no debug colours', () => {
  const flat = flattenOps(buildGameWorldOps(officeMap));
  assert.equal(flat.filter((op) => op.t === 'text').length, 0, 'no text is painted');
  // The wall cap/partition tones are material colours, never the review palette.
  const debug = new Set(['#f6ca65', '#d9a441', '#0b1720', '#2a3340']);
  for (const op of flat) if ('fill' in op) assert.equal(debug.has(op.fill), false, `debug colour ${op.fill}`);
});

void test('the perspective pass keeps the game renderer under the 12000 painted-op budget', () => {
  const count = flattenOps(buildGameWorldOps(officeMap)).length;
  assert.ok(count <= 12000, `painted ops ${count} must stay within the 12000 budget`);
  assert.ok(count > 9832, 'the depth pass actually adds visible layers');
});

void test('wall faces never cover a door gap (openings paint after walls)', () => {
  const ops = buildGameWorldOps(officeMap);
  const flat = flattenOps(ops);
  // Every opening produces a saddle op; the last wall face op precedes it.
  for (const opening of officeMap.openings) {
    const saddleIdx = flat.findIndex((op) => op.t === 'rect' && op.fill === GAME_PALETTE.doorSaddle && overlap({ x: op.x, y: op.y, w: op.w, h: op.h }, opening.rect));
    assert.ok(saddleIdx >= 0, `${opening.id} has a saddle`);
  }
});
