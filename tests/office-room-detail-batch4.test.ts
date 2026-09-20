// Batch 4 service-core detail contract. Written RED before implementation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { officeMap, type Rect } from '../lib/office-map.ts';
import { flattenOps, type GroupOp, type Op, type PaintedOp } from '../lib/office-render-ops.ts';
import * as gameArt from '../lib/office-game-ops.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = {
  pantry: 'pantry',
  gudang: 'storage',
  'toilet-wanita': 'toilet',
  wastafel: 'wet-service',
  'toilet-pria': 'toilet',
  'meeting-2': 'meeting',
  server: 'server',
} as const;
const OWNERS: Readonly<Record<string, readonly string[]>> = {
  'service:pantry-tray': ['F-PS-PANTRY-COUNTER'],
  'service:pantry-panel': ['F-PS-PANTRY-COUNTER'],
  'service:meeting-kit': ['F-PS-MTG2-TABLE'],
  'service:sideboard-storage': ['F-PS-EXT-TABLE'],
};
function topGroups(ops: readonly Op[]): GroupOp[] { return ops.filter((op): op is GroupOp => op.t === 'group'); }
function walkGroups(ops: readonly Op[]): GroupOp[] { const out: GroupOp[] = []; for (const op of ops) if (op.t === 'group') out.push(op, ...walkGroups(op.ops)); return out; }
function opBounds(op: PaintedOp): Rect {
  if (op.t === 'rect' || op.t === 'image') return { x: op.x, y: op.y, w: op.w, h: op.h };
  if (op.t === 'circle') return { x: op.cx - op.r, y: op.cy - op.r, w: op.r * 2, h: op.r * 2 };
  return { x: op.x, y: op.y, w: 0, h: 0 };
}

void test('all seven service-core zones have explicit profiles without fallback', () => {
  const resolver = (gameArt as unknown as { serviceCoreProfile?: (zoneId: string) => string }).serviceCoreProfile;
  assert.equal(typeof resolver, 'function');
  for (const [zone, profile] of Object.entries(PROFILE)) assert.equal(resolver!(zone), profile, zone);
  assert.throws(() => resolver!('resepsionis'), /service-core profile/i);
});

void test('approved pantry and Meeting 2 furniture owns layered service semantics', () => {
  const found = new Map<string, string[]>();
  for (const furniture of topGroups(gameArt.buildGameWorldOps(officeMap))) {
    for (const detail of walkGroups(furniture.ops).filter((group) => group.semantic.startsWith('service:'))) {
      const owners = found.get(detail.semantic) ?? [];
      owners.push(furniture.sourceId); found.set(detail.semantic, owners);
      assert.ok(flattenOps(detail.ops).length >= 3, `${detail.semantic} is layered`);
    }
  }
  for (const [semantic, allowed] of Object.entries(OWNERS)) {
    const owners = found.get(semantic) ?? [];
    assert.ok(owners.length > 0, `${semantic} exists`);
    for (const owner of owners) assert.ok(allowed.includes(owner), `${semantic} owner ${owner} is approved`);
  }
  assert.deepEqual(new Set(found.keys()), new Set(Object.keys(OWNERS)));
});

void test('service semantic paint stays within existing furniture footprints', () => {
  const byId = new Map(topGroups(gameArt.buildGameWorldOps(officeMap)).map((group) => [group.sourceId, group]));
  for (const item of officeMap.furniture) for (const detail of walkGroups(byId.get(item.id)!.ops).filter((group) => group.semantic.startsWith('service:'))) {
    for (const op of flattenOps(detail.ops)) {
      const box = opBounds(op);
      assert.ok(box.x >= item.rect.x && box.y >= item.rect.y, `${detail.sourceId} starts inside ${item.id}`);
      assert.ok(box.x + box.w <= item.rect.x + item.rect.w, `${detail.sourceId} stays inside ${item.id} horizontally`);
      assert.ok(box.y + box.h <= item.rect.y + item.rect.h + 2, `${detail.sourceId} stays inside ${item.id} vertically`);
    }
  }
});

void test('empty service zones remain free of invented manifest furniture', () => {
  for (const zone of ['gudang', 'toilet-wanita', 'wastafel', 'toilet-pria', 'server']) {
    assert.equal(officeMap.furniture.filter((item) => item.zone === zone).length, 0, `${zone} remains manifest-empty`);
  }
});

void test('Batch 4 is deterministic, locked, cardinality-safe and within budget', () => {
  const first = gameArt.buildGameWorldOps(officeMap); const second = gameArt.buildGameWorldOps(officeMap);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(topGroups(first).length, officeMap.furniture.length);
  const painted = flattenOps(first);
  assert.ok(painted.length <= 11_200, `painted op total ${painted.length}`);
  assert.equal(painted.filter((op) => op.t === 'text').length, 0);
  const hashes: Readonly<Record<string, string>> = {
    'lib/office-map.json': '7a8d6ed0b055eb6c1c7913d24ab242756ae1ee4e2590599118d6f87958faebb7',
    'public/room/bilik-geng-v4.png': '8c553abc4058f76e1328f9d3ad9c0b24a07ab68108bc25ed0554da717beb178e',
    'public/room/bilik-geng-zone.png': '1df4c17ab39648dd34ec89994ea74438d99d7c36a52172d699b122282eeb9547',
  };
  for (const [path, expected] of Object.entries(hashes)) assert.equal(createHash('sha256').update(readFileSync(resolve(ROOT, path))).digest('hex'), expected);
});
