// Batch 3 front-of-house detail contract. Written RED before implementation.
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
  resepsionis: 'reception',
  'lobby-besar': 'lobby',
  'lorong-utama': 'circulation',
  sirkulasi: 'circulation',
  'jalur-terbuka': 'circulation',
} as const;
const OWNERS: Readonly<Record<string, readonly string[]>> = {
  'front:reception-monitor': ['F-REC-COUNTER'],
  'front:reception-guestbook': ['F-REC-COUNTER'],
  'front:counter-panel': ['F-REC-COUNTER'],
  'front:sofa-cushion': ['F-REC-S1', 'F-REC-S2', 'F-REC-S3', 'F-REC-S4'],
  'front:lounge-kit': ['F-PS-LOUNGE-T'],
  'front:document-display': ['F-PS-CERT-TABLE'],
};

function topGroups(ops: readonly Op[]): GroupOp[] { return ops.filter((op): op is GroupOp => op.t === 'group'); }
function walkGroups(ops: readonly Op[]): GroupOp[] {
  const out: GroupOp[] = [];
  for (const op of ops) if (op.t === 'group') out.push(op, ...walkGroups(op.ops));
  return out;
}
function opBounds(op: PaintedOp): Rect {
  if (op.t === 'rect' || op.t === 'image') return { x: op.x, y: op.y, w: op.w, h: op.h };
  if (op.t === 'circle') return { x: op.cx - op.r, y: op.cy - op.r, w: op.r * 2, h: op.r * 2 };
  return { x: op.x, y: op.y, w: 0, h: 0 };
}

void test('all front-of-house zones resolve an explicit profile without fallback', () => {
  const resolver = (gameArt as unknown as { frontOfHouseProfile?: (zoneId: string) => string }).frontOfHouseProfile;
  assert.equal(typeof resolver, 'function');
  for (const [zone, profile] of Object.entries(PROFILE)) assert.equal(resolver!(zone), profile, zone);
  assert.throws(() => resolver!('desk-collection'), /front-of-house profile/i);
});

void test('approved front-of-house furniture owns meaningful semantic detail', () => {
  const groups = topGroups(gameArt.buildGameWorldOps(officeMap));
  const found = new Map<string, string[]>();
  for (const furniture of groups) {
    for (const detail of walkGroups(furniture.ops).filter((group) => group.semantic.startsWith('front:'))) {
      const owners = found.get(detail.semantic) ?? [];
      owners.push(furniture.sourceId);
      found.set(detail.semantic, owners);
      assert.ok(flattenOps(detail.ops).length >= 3, `${detail.semantic} is layered`);
    }
  }
  for (const [semantic, allowed] of Object.entries(OWNERS)) {
    const owners = found.get(semantic) ?? [];
    assert.ok(owners.length > 0, `${semantic} exists`);
    for (const owner of owners) assert.ok(allowed.includes(owner), `${semantic} owner ${owner} is approved`);
  }
  assert.deepEqual(new Set(found.keys()), new Set(Object.keys(OWNERS)), 'no unapproved front detail semantics');
});

void test('front-of-house details remain inside their existing furniture footprint', () => {
  const byId = new Map(topGroups(gameArt.buildGameWorldOps(officeMap)).map((group) => [group.sourceId, group]));
  for (const item of officeMap.furniture) {
    const details = walkGroups(byId.get(item.id)!.ops).filter((group) => group.semantic.startsWith('front:'));
    for (const detail of details) for (const op of flattenOps(detail.ops)) {
      const box = opBounds(op);
      assert.ok(box.x >= item.rect.x && box.y >= item.rect.y, `${detail.sourceId} starts inside ${item.id}`);
      assert.ok(box.x + box.w <= item.rect.x + item.rect.w, `${detail.sourceId} stays inside ${item.id} horizontally`);
      assert.ok(box.y + box.h <= item.rect.y + item.rect.h + 2, `${detail.sourceId} stays inside ${item.id} vertically`);
    }
  }
});

void test('Batch 3 stays deterministic, preserves group cardinality and locked assets, and remains under budget', () => {
  const first = gameArt.buildGameWorldOps(officeMap);
  const second = gameArt.buildGameWorldOps(officeMap);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(topGroups(first).length, officeMap.furniture.length);
  const painted = flattenOps(first);
  assert.ok(painted.length <= 11_000, `painted op total ${painted.length}`);
  assert.equal(painted.filter((op) => op.t === 'text').length, 0);
  const hashes: Readonly<Record<string, string>> = {
    'lib/office-map.json': '0eeec47926eef3f099292c8de2b52266a576683c410727d8f387a602092153c5',
    'public/room/bilik-geng-v4.png': '8c553abc4058f76e1328f9d3ad9c0b24a07ab68108bc25ed0554da717beb178e',
    'public/room/bilik-geng-zone.png': '1df4c17ab39648dd34ec89994ea74438d99d7c36a52172d699b122282eeb9547',
  };
  for (const [path, expected] of Object.entries(hashes)) assert.equal(createHash('sha256').update(readFileSync(resolve(ROOT, path))).digest('hex'), expected);
});
