// User correction Batch B: two bottom-mounted upward-facing toilets, an open
// wall-mounted washbasin+mirror, and one small pantry stool. Written RED first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { officeMap, type Rect } from '../lib/office-map.ts';
import * as gameOps from '../lib/office-game-ops.ts';
import { flattenOps, type GroupOp, type Op } from '../lib/office-render-ops.ts';
import { opBounds } from '../lib/office-crop.ts';

function bounds(ops: readonly Op[]): Rect {
  const boxes = flattenOps(ops).filter((op) => op.t !== 'text').map(opBounds);
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  return { x, y, w: right - x, h: bottom - y };
}

void test('each toilet owns exactly one upward fixture attached to its bottom edge', () => {
  assert.ok('toiletFixtureGroups' in gameOps, 'toilet fixture renderer exists');
  const render = (gameOps as typeof gameOps & { toiletFixtureGroups: (manifest: typeof officeMap) => GroupOp[] }).toiletFixtureGroups;
  const groups = render(officeMap);
  assert.deepEqual(groups.map((group) => group.sourceId).sort(), ['fixture:toilet-pria', 'fixture:toilet-wanita']);
  assert.ok(groups.every((group) => group.semantic === 'service:toilet-up'));
  for (const group of groups) {
    const zoneId = group.sourceId.replace('fixture:', '');
    const zone = officeMap.zones.find((entry) => entry.id === zoneId)!;
    const box = bounds(group.ops);
    assert.ok(box.x >= zone.rect.x && box.x + box.w <= zone.rect.x + zone.rect.w, `${zoneId} stays inside width`);
    assert.ok(box.y >= zone.rect.y + zone.rect.h * 0.55, `${zoneId} sits in lower half`);
    assert.ok(zone.rect.y + zone.rect.h - (box.y + box.h) <= 4, `${zoneId} touches bottom edge`);
    const parts = group.ops.filter((op): op is GroupOp => op.t === 'group').map((op) => op.semantic);
    assert.deepEqual(parts, ['toilet:tank-bottom', 'toilet:bowl-up'], `${zoneId} faces upward from bottom tank`);
  }
});

void test('wastafel is an open north-facing nook with only mirror and basin on the bottom wall', () => {
  const zone = officeMap.zones.find((entry) => entry.id === 'wastafel')!;
  assert.equal(officeMap.walls.some((wall) => wall.id === 'w-wastafel-top'), false, 'no wall closes the open north side');
  const ops = gameOps.serviceNookOps(officeMap);
  const box = bounds(ops);
  assert.ok(box.y >= zone.rect.y + 9, 'north/open approach stays visibly clear');
  assert.ok(zone.rect.y + zone.rect.h - (box.y + box.h) <= 4, 'mirror/basin attach to bottom wall');
  const wideThin = flattenOps(ops).filter((op) => op.t === 'rect' && op.w >= 20 && op.h >= 3 && op.h <= 8);
  assert.ok(wideThin.length >= 2, 'separate mirror and wall-mounted basin faces exist');
  assert.equal(flattenOps(ops).some((op) => op.t === 'text'), false);
});

void test('pantry has one small non-solid black armless stool in front of its counter', () => {
  const pantryChairs = officeMap.furniture.filter((item) => item.zone === 'pantry' && item.kind === 'chair');
  assert.equal(pantryChairs.length, 1);
  const stool = pantryChairs[0]!;
  assert.equal(stool.id, 'F-PS-PANTRY-STOOL');
  assert.equal(stool.solid, false);
  assert.ok(stool.rect.w <= 26 && stool.rect.h <= 24, 'stool stays small');
  const counter = officeMap.furniture.find((item) => item.id === 'F-PS-PANTRY-COUNTER')!;
  assert.ok(stool.rect.y >= counter.rect.y + counter.rect.h, 'stool is in front/south of counter');
  const group = gameOps.buildFurnitureGroup(stool);
  const semantics: string[] = [];
  const visit = (ops: readonly Op[]): void => { for (const op of ops) if (op.t === 'group') { semantics.push(op.semantic); visit(op.ops); } };
  visit(group.ops);
  assert.equal(semantics.includes('chair:armrest'), false);
});
