import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isBlocked, officeMap, type OfficeManifest } from '../lib/office-map.ts';
import { MAX_MOVEMENT_SUBSTEP, moveWithCollision } from '../lib/office-navigation.ts';
import { INITIAL_INTERACTION_STATE, closedDoorRects, isBlockedWithDoors } from '../lib/office-interactions.ts';

function thinWallManifest(): OfficeManifest {
  return {
    id: 'thin-wall-map',
    name: 'Thin wall test',
    width: 120,
    height: 120,
    margin: 0,
    wallThickness: 1,
    partitionThickness: 1,
    actor: { halfWidth: 1, feet: 2 },
    spawn: { x: 40, y: 60, direction: 'right' },
    walls: [{ id: 'thin-wall', kind: 'full', rect: { x: 50, y: 0, w: 1, h: 120 } }],
    columns: [],
    blocks: [],
    furniture: [],
    openings: [],
    windows: [],
    surfaces: [],
    hotspots: [],
    seats: [],
    zones: [],
  };
}

void test('movement is swept in at most one-world-pixel substeps', () => {
  assert.equal(MAX_MOVEMENT_SUBSTEP, 1);
  const map = thinWallManifest();
  const result = moveWithCollision({ x: 40, y: 60 }, { x: 40, y: 0 }, (x, y) => isBlocked(map, x, y));
  assert.ok(result.x <= 49, `stopped before the thin wall: ${result.x}`);
  assert.equal(result.y, 60);
  assert.equal(isBlocked(map, result.x, result.y), false);
});

void test('large diagonal movement slides but cannot cut through a solid corner', () => {
  const map = thinWallManifest();
  map.walls.push({ id: 'thin-horizontal', kind: 'full', rect: { x: 0, y: 50, w: 120, h: 1 } });
  const result = moveWithCollision({ x: 40, y: 40 }, { x: 30, y: 30 }, (x, y) => isBlocked(map, x, y));
  assert.ok(result.x <= 49, `x did not cross vertical wall: ${result.x}`);
  assert.ok(result.y <= 50, `y did not cross horizontal wall: ${result.y}`);
  assert.equal(isBlocked(map, result.x, result.y), false);
});

void test('every two-sided manifest opening remains traversable with the real actor footprint', () => {
  let checked = 0;
  for (const opening of officeMap.openings) {
    const cx = opening.rect.x + opening.rect.w / 2;
    const cy = opening.rect.y + opening.rect.h / 2;
    const horizontal = opening.orientation === 'horizontal';
    const from = horizontal ? { x: cx, y: cy - 18 } : { x: cx - 18, y: cy };
    const delta = horizontal ? { x: 0, y: 36 } : { x: 36, y: 0 };
    const to = { x: from.x + delta.x, y: from.y + delta.y };
    if (isBlocked(officeMap, from.x, from.y) || isBlocked(officeMap, to.x, to.y)) continue;
    const result = moveWithCollision(from, delta, (x, y) => isBlocked(officeMap, x, y));
    assert.ok(Math.abs(result.x - to.x) < 1e-9 && Math.abs(result.y - to.y) < 1e-9, `${opening.id} traverses end-to-end`);
    checked += 1;
  }
  assert.ok(checked >= 8, `audited ${checked} two-sided openings`);
});

void test('swept movement respects a closed interactive door and crosses it when opened', () => {
  const allClosedState = {
    ...INITIAL_INTERACTION_STATE,
    closedDoorIds: officeMap.openings.map((opening) => opening.id),
  };
  const closedRects = closedDoorRects(officeMap, allClosedState);
  const closedDoor = officeMap.openings.find(({ rect }) => {
    if (!closedRects.includes(rect)) return false;
    const horizontal = rect.w >= rect.h;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const from = horizontal ? { x: cx, y: cy - 18 } : { x: cx - 18, y: cy };
    const to = horizontal ? { x: cx, y: cy + 18 } : { x: cx + 18, y: cy };
    return !isBlocked(officeMap, from.x, from.y) && !isBlocked(officeMap, to.x, to.y);
  });
  assert.ok(closedDoor, 'a two-sided interactive door exists');

  const horizontal = closedDoor.rect.w >= closedDoor.rect.h;
  const cx = closedDoor.rect.x + closedDoor.rect.w / 2;
  const cy = closedDoor.rect.y + closedDoor.rect.h / 2;
  const from = horizontal ? { x: cx, y: cy - 18 } : { x: cx - 18, y: cy };
  const delta = horizontal ? { x: 0, y: 36 } : { x: 36, y: 0 };
  const blocked = moveWithCollision(from, delta, (x, y) => isBlockedWithDoors(officeMap, x, y, allClosedState));
  assert.notDeepEqual(blocked, { x: from.x + delta.x, y: from.y + delta.y }, 'closed door stops the sweep');

  const openedState = {
    ...allClosedState,
    closedDoorIds: allClosedState.closedDoorIds.filter((id) => id !== closedDoor.id),
  };
  const crossed = moveWithCollision(from, delta, (x, y) => isBlockedWithDoors(officeMap, x, y, openedState));
  assert.deepEqual(crossed, { x: from.x + delta.x, y: from.y + delta.y }, 'open door permits the sweep');
});

void test('production page routes keyboard movement through swept collision', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const page = readFileSync(resolve(root, 'app', 'page.tsx'), 'utf8');
  assert.match(page, /moveWithCollision\(/);
  assert.doesNotMatch(page, /if \(!isBlocked\(officeMap, p\.x \+ dx \* speed/);
});
