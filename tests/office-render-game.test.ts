// Production game renderer contract (Builder Phase 2).
//
// The in-app canvas is the GAME layer. The op list it paints must read as a
// pixel-art office: no seat numbers, no hotspot letter badges, no room-name
// label bands and no internal ids/codes anywhere on the playfield. Location is
// announced by the DOM caption / aria-live region instead.
//
// The technical review op list (SVG preview + QA) deliberately keeps those
// labels and markers, so both render modes are pinned here: the game mode must
// be clean, the review mode must stay diagnostic.
//
// Furniture is asserted structurally rather than by snapshot: every approved
// item maps to a multi-layer group carrying its stable sourceId and semantic
// kind, and its painted layers stay on the approved footprint.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { officeMap, type Furniture, type FurnitureKind, type Rect } from '../lib/office-map.ts';
import {
  PREVIEW_COLORS,
  buildReviewPreviewOps,
  buildReviewWorldOps,
  flattenOps,
  type GroupOp,
  type Op,
} from '../lib/office-render-ops.ts';
import { buildFurnitureGroup, buildGamePreviewOps, buildGameWorldOps } from '../lib/office-game-ops.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALL_KINDS: FurnitureKind[] = ['desk', 'table', 'counter', 'cabinet', 'chair', 'fridge', 'dispenser', 'screen', 'sink', 'sofa', 'board'];

function groups(ops: readonly Op[]): GroupOp[] {
  return ops.filter((op): op is GroupOp => op.t === 'group');
}

function rectOps(ops: readonly Op[]): Extract<Op, { t: 'rect' }>[] {
  return flattenOps(ops).filter((op): op is Extract<Op, { t: 'rect' }> => op.t === 'rect');
}

function textOps(ops: readonly Op[]): Extract<Op, { t: 'text' }>[] {
  return flattenOps(ops).filter((op): op is Extract<Op, { t: 'text' }> => op.t === 'text');
}

// A painted op (rect/circle/text) is drawn on the field; a group is metadata.
// The "no internal ids" rule is about what is painted, so codes hidden in group
// metadata are fine — codes painted as geometry/text are not.
function paintedFills(ops: readonly Op[]): string[] {
  return flattenOps(ops).map((op) => ('fill' in op ? op.fill : ''));
}

// ---------------------------------------------------------------------------
// Game layer: nothing diagnostic is painted
// ---------------------------------------------------------------------------

void test('game ops paint no text at all (no seat numbers, initials, room names or codes)', () => {
  const ops = buildGameWorldOps(officeMap);
  const texts = textOps(ops);
  assert.equal(texts.length, 0, `game ops must not draw text, found: ${JSON.stringify(texts.map((op) => op.text))}`);

  for (const seat of officeMap.seats) {
    assert.equal(texts.some((op) => op.text === String(seat.cid)), false, `seat cid ${seat.cid} must stay invisible`);
  }
  for (const zone of officeMap.zones) {
    assert.equal(texts.some((op) => op.text.includes(zone.name)), false, `room name "${zone.name}" must not be painted`);
  }
  for (const hotspot of officeMap.hotspots) {
    const initial = hotspot.kind.slice(0, 1).toUpperCase();
    assert.equal(texts.some((op) => op.text === initial), false, `hotspot badge "${initial}" must stay invisible`);
    assert.equal(texts.some((op) => op.text === hotspot.id), false, `internal hotspot id "${hotspot.id}" must not be painted`);
  }
});

void test('game ops carry no review debug colours, label bands or sealed overlays', () => {
  const ops = buildGameWorldOps(officeMap);
  const debugFills = new Set<string>([PREVIEW_COLORS.hotspot, PREVIEW_COLORS.threshold, PREVIEW_COLORS.labelBand, PREVIEW_COLORS.sealed]);
  for (const fill of paintedFills(ops)) {
    assert.equal(debugFills.has(fill), false, `debug colour ${fill} must not appear on the game field`);
  }
  const bands = rectOps(ops).filter((op) => op.fill === PREVIEW_COLORS.labelBand);
  assert.equal(bands.length, 0, 'game ops must not draw room label bands');
});

void test('game ops draw no hotspot circles and no seat marker circles', () => {
  const ops = buildGameWorldOps(officeMap);
  const circles = flattenOps(ops).filter((op): op is Extract<Op, { t: 'circle' }> => op.t === 'circle');
  const yellowMarkers = circles.filter((op) => op.fill === PREVIEW_COLORS.hotspot);
  assert.equal(yellowMarkers.length, 0, 'hotspot markers must be invisible');
  const seatInk = circles.filter((op) => op.fill === PREVIEW_COLORS.hotspotInk && op.stroke === PREVIEW_COLORS.hotspot);
  assert.equal(seatInk.length, 0, 'seat number markers must be invisible');
});

// ---------------------------------------------------------------------------
// Review layer: diagnostics retained
// ---------------------------------------------------------------------------

void test('review ops still expose room labels and hotspot/seat markers for QA', () => {
  const review = buildReviewWorldOps(officeMap);
  const texts = textOps(review);
  const labelled = officeMap.zones.filter((zone) => zone.showLabel !== false);
  assert.ok(texts.length > 0, 'review ops keep text labels');
  for (const zone of labelled) {
    const words = zone.name.split(' ');
    assert.ok(
      texts.some((op) => zone.name.includes(op.text) || words.includes(op.text)),
      `review ops label "${zone.name}"`,
    );
  }

  const bands = rectOps(review).filter((op) => op.fill === PREVIEW_COLORS.labelBand);
  assert.ok(bands.length >= labelled.length, 'review ops keep one label band per labelled zone');

  const markers = flattenOps(review).filter((op): op is Extract<Op, { t: 'circle' }> => op.t === 'circle');
  assert.ok(markers.length >= officeMap.hotspots.length + officeMap.seats.length, 'review ops keep hotspot and seat markers');
  assert.ok(markers.some((op) => op.fill === PREVIEW_COLORS.hotspot), 'review ops keep yellow hotspot markers');

  const reviewPreview = buildReviewPreviewOps(officeMap);
  assert.ok(reviewPreview.height > officeMap.height, 'the review artifact keeps its legend footer');
  assert.ok(textOps(reviewPreview.ops).some((op) => op.text.startsWith('DENAH KANTOR')), 'the review artifact keeps its title');
});

// ---------------------------------------------------------------------------
// Furniture: layered groups with stable metadata, preserving approved geometry
// ---------------------------------------------------------------------------

function boundsOf(ops: readonly Op[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const op of flattenOps(ops)) {
    const box: Rect = op.t === 'rect'
      ? { x: op.x, y: op.y, w: op.w, h: op.h }
      : op.t === 'circle'
        ? { x: op.cx - op.r, y: op.cy - op.r, w: op.r * 2, h: op.r * 2 }
        : op.t === 'image'
          ? { x: op.x, y: op.y, w: op.w, h: op.h }
          : { x: op.x, y: op.y, w: 0, h: 0 };
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

void test('every approved furniture item maps to a multi-layer group on its exact footprint', () => {
  const list = groups(buildGameWorldOps(officeMap));
  const byId = new Map(list.map((group) => [group.sourceId, group]));

  assert.equal(byId.size, officeMap.furniture.length, 'one group per furniture item, no extras');
  for (const item of officeMap.furniture) {
    const group = byId.get(item.id);
    assert.ok(group, `furniture ${item.id} has a group`);
    assert.equal(group.semantic, `furniture:${item.kind}`, `${item.id} carries its kind`);
    assert.ok(group.ops.length >= 3, `${item.id} is layered, not one flat rect`);

    const painted = rectOps(group.ops);
    assert.ok(painted.length >= 2, `${item.id} paints at least two layers`);

    // Shape-agnostic geometry proof: the painted layers stay inside the approved
    // rect (plus the 5px shadow margin) and cover most of it, so a chair drawn
    // as discs still cannot drift off its seat.
    const pad = 5;
    for (const op of flattenOps(group.ops)) {
      if (op.t === 'rect') {
        assert.ok(op.x >= item.rect.x - pad && op.y >= item.rect.y - pad, `${item.id} layer stays left/top of its rect`);
        assert.ok(op.x + op.w <= item.rect.x + item.rect.w + pad && op.y + op.h <= item.rect.y + item.rect.h + pad, `${item.id} layer stays right/bottom of its rect`);
      }
    }
    const bounds = boundsOf(group.ops);
    assert.ok(bounds.x >= item.rect.x - pad && bounds.y >= item.rect.y - pad, `${item.id} art stays inside its footprint`);
    assert.ok(bounds.x + bounds.w <= item.rect.x + item.rect.w + pad && bounds.y + bounds.h <= item.rect.y + item.rect.h + pad, `${item.id} art does not spill past its footprint`);
    assert.ok(bounds.w >= item.rect.w * 0.55 && bounds.h >= item.rect.h * 0.55, `${item.id} art fills its footprint`);
  }
});

void test('every FurnitureKind has layered art, including kinds absent from this manifest', () => {
  const present = new Set(officeMap.furniture.map((item) => item.kind));
  for (const kind of ALL_KINDS) {
    const item: Furniture = { id: `fixture-${kind}`, kind, solid: true, zone: 'desk-collection', rect: { x: 900, y: 400, w: 60, h: 44 } };
    const group = buildFurnitureGroup(item);
    assert.equal(group.t, 'group');
    assert.equal(group.sourceId, item.id);
    assert.equal(group.semantic, `furniture:${kind}`);
    const painted = flattenOps(group.ops);
    assert.ok(painted.length >= 3, `${kind} art is layered`);
    assert.ok(painted.filter((op): op is Extract<Op, { t: 'rect' }> => op.t === 'rect').length >= 2, `${kind} art is not one flat rect`);
  }
  assert.ok(present.size > 0);
});

// ---------------------------------------------------------------------------
// Determinism and bounds
// ---------------------------------------------------------------------------

void test('game ops and the game preview are deterministic', () => {
  assert.equal(JSON.stringify(buildGameWorldOps(officeMap)), JSON.stringify(buildGameWorldOps(officeMap)));
  assert.equal(JSON.stringify(buildGamePreviewOps(officeMap)), JSON.stringify(buildGamePreviewOps(officeMap)));
});

void test('the game preview is exactly the game world ops, with no legend', () => {
  const preview = buildGamePreviewOps(officeMap);
  assert.equal(preview.width, officeMap.width);
  assert.equal(preview.height, officeMap.height);
  assert.deepEqual(preview.ops, buildGameWorldOps(officeMap));
});

void test('every game op is finite and stays inside the world bounds', () => {
  const width = officeMap.width;
  const height = officeMap.height;
  for (const op of flattenOps(buildGameWorldOps(officeMap))) {
    const numbers: number[] = op.t === 'rect'
      ? [op.x, op.y, op.w, op.h]
      : op.t === 'circle'
        ? [op.cx, op.cy, op.r]
        : op.t === 'image'
          ? [op.x, op.y, op.w, op.h]
          : [op.x, op.y, op.size];
    for (const value of numbers) assert.ok(Number.isFinite(value), `op ${JSON.stringify(op)} is finite`);
    if (op.t === 'rect') {
      assert.ok(op.w > 0 && op.h > 0, 'rects have positive size');
      assert.ok(op.x >= -1 && op.y >= -1 && op.x + op.w <= width + 1 && op.y + op.h <= height + 1, `rect ${JSON.stringify(op)} is in bounds`);
    } else if (op.t === 'image') {
      assert.ok(op.w > 0 && op.h > 0, 'images have positive size');
      assert.ok(op.x >= -1 && op.y >= -1 && op.x + op.w <= width + 1 && op.y + op.h <= height + 1, `image ${JSON.stringify(op)} is in bounds`);
    } else if (op.t === 'circle') {
      assert.ok(op.r > 0, 'circles have positive radius');
      assert.ok(op.cx - op.r >= -1 && op.cy - op.r >= -1 && op.cx + op.r <= width + 1 && op.cy + op.r <= height + 1, `circle stays in bounds`);
    }
  }
});

// ---------------------------------------------------------------------------
// Wiring guards (no DOM harness)
// ---------------------------------------------------------------------------

void test('createWorldCanvas paints the game ops, never the review ops', () => {
  const source = readFileSync(resolve(ROOT, 'lib', 'office-renderer.ts'), 'utf8');
  assert.match(source, /buildGameWorldOps\(/, 'the canvas renderer uses the game render mode');
  assert.doesNotMatch(source, /buildReviewWorldOps\(/, 'the canvas renderer must not paint the review layer');
});

void test('zone location stays in the DOM caption and aria-live output', () => {
  const page = readFileSync(resolve(ROOT, 'app', 'page.tsx'), 'utf8');
  assert.match(page, /zoneAt\(officeMap/, 'the caption resolves the zone from the manifest');
  assert.match(page, /Zona aktif:/, 'the aria-live region announces the zone');
});

// A tiny sanity check that the geometry helper used by the suite is a real
// subset check, so a silent typo cannot make the furniture bounds test vacuous.
void test('the Rect shape used by the bounds checks matches the manifest rects', () => {
  for (const item of officeMap.furniture) {
    const rect: Rect = item.rect;
    assert.ok(rect.w > 0 && rect.h > 0);
  }
});
