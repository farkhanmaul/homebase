// Batch 1 top-room furniture detail contract. Written RED before the renderer
// implementation: each approved room must select an explicit profile and expose
// meaningful, footprint-bound semantic groups inside its existing furniture.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { officeMap, type Furniture, type Rect } from '../lib/office-map.ts';
import { flattenOps, type GroupOp, type Op, type PaintedOp } from '../lib/office-render-ops.ts';
import * as gameArt from '../lib/office-game-ops.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOP_ROOMS = ['meeting-1', 'hrga', 'komisaris', 'product-manager', 'it', 'direktur-finance'] as const;
const EXPECTED_PROFILE = {
  'meeting-1': 'conference',
  hrga: 'hr-document',
  komisaris: 'executive',
  'product-manager': 'planning',
  it: 'technical',
  'direktur-finance': 'finance',
} as const;

const SEMANTIC_OWNERS: Readonly<Record<string, readonly string[]>> = {
  'room-detail:meeting-kit': ['F-MTG1-TABLE'],
  'room-detail:table-support': ['F-MTG1-TABLE'],
  'room-detail:hr-files': ['F-HRGA-DESK-A', 'F-HRGA-DESK-B'],
  'room-detail:storage-binders': ['F-HRGA-CABINET'],
  'room-detail:executive-folio': ['F-KOM-DESK'],
  'room-detail:phone': ['F-KOM-DESK'],
  'room-detail:planning-kit': ['F-PM-DESK'],
  'room-detail:sticky-strip': ['F-PM-DESK'],
  'room-detail:it-device': ['F-IT-DESK-H', 'F-IT-DESK-V'],
  'room-detail:cable-tray': ['F-IT-DESK-H', 'F-IT-DESK-V'],
  'room-detail:ledger': ['F-FIN-DESK-V', 'F-FIN-DESK-H'],
  'room-detail:calculator': ['F-FIN-DESK-V', 'F-FIN-DESK-H'],
  'room-detail:counter-panel': ['F-FIN-COUNTER'],
};

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

function opBounds(op: PaintedOp): Rect {
  if (op.t === 'rect' || op.t === 'image') return { x: op.x, y: op.y, w: op.w, h: op.h };
  if (op.t === 'circle') return { x: op.cx - op.r, y: op.cy - op.r, w: op.r * 2, h: op.r * 2 };
  return { x: op.x, y: op.y, w: 0, h: 0 };
}

function nearestSolid(chair: Furniture): Furniture | undefined {
  const cx = chair.rect.x + chair.rect.w / 2;
  const cy = chair.rect.y + chair.rect.h / 2;
  return officeMap.furniture
    .filter((item) => item.solid)
    .map((item) => ({ item, distance: (item.rect.x + item.rect.w / 2 - cx) ** 2 + (item.rect.y + item.rect.h / 2 - cy) ** 2 }))
    .sort((a, b) => a.distance - b.distance)[0]?.item;
}

void test('all six Batch 1 rooms resolve an explicit room-detail profile without generic fallback', () => {
  const resolveProfile = (gameArt as unknown as { roomDetailProfile?: (zoneId: string) => string }).roomDetailProfile;
  assert.equal(typeof resolveProfile, 'function', 'renderer exports an explicit roomDetailProfile resolver');
  for (const zoneId of TOP_ROOMS) assert.equal(resolveProfile!(zoneId), EXPECTED_PROFILE[zoneId], `${zoneId} has its explicit profile`);
  assert.throws(() => resolveProfile!('desk-collection'), /room detail profile/i, 'out-of-scope rooms do not silently get a generic profile');
});

void test('required room-detail semantics exist only in their intended manifest furniture groups', () => {
  const furnitureGroups = topGroups(gameArt.buildGameWorldOps(officeMap));
  const found = new Map<string, string[]>();
  for (const furniture of furnitureGroups) {
    for (const group of walkGroups(furniture.ops)) {
      if (!group.semantic.startsWith('room-detail:')) continue;
      const owners = found.get(group.semantic) ?? [];
      owners.push(furniture.sourceId);
      found.set(group.semantic, owners);
    }
  }

  for (const [semantic, allowed] of Object.entries(SEMANTIC_OWNERS)) {
    const owners = found.get(semantic) ?? [];
    assert.ok(owners.length > 0, `${semantic} is present`);
    for (const owner of owners) assert.ok(allowed.includes(owner), `${semantic} belongs to intended furniture, got ${owner}`);
  }
  const expected = new Set(Object.keys(SEMANTIC_OWNERS));
  for (const semantic of found.keys()) assert.ok(expected.has(semantic), `Batch 1 emits only approved semantic ${semantic}`);
});

void test('room profiles differ through meaningful construction groups, not colour-only variants', () => {
  const byId = new Map(topGroups(gameArt.buildGameWorldOps(officeMap)).map((group) => [group.sourceId, group]));
  const signatures = new Set<string>();
  for (const zoneId of TOP_ROOMS) {
    const semantics = officeMap.furniture
      .filter((item) => item.zone === zoneId)
      .flatMap((item) => walkGroups(byId.get(item.id)!.ops))
      .filter((group) => group.semantic.startsWith('room-detail:'));
    assert.ok(semantics.length >= 2, `${zoneId} has at least two semantic construction/prop groups`);
    for (const group of semantics) assert.ok(flattenOps(group.ops).length >= 3, `${group.semantic} is layered rather than metadata noise`);
    signatures.add([...new Set(semantics.map((group) => group.semantic))].sort().join('|'));
  }
  assert.ok(signatures.size >= 4, `at least four structural room variants differ, got ${signatures.size}`);
});

void test('Batch 1 detail stays in its approved furniture footprint plus the existing 2px south depth skirt', () => {
  const byId = new Map(topGroups(gameArt.buildGameWorldOps(officeMap)).map((group) => [group.sourceId, group]));
  for (const item of officeMap.furniture.filter((entry) => TOP_ROOMS.includes(entry.zone as typeof TOP_ROOMS[number]))) {
    const details = walkGroups(byId.get(item.id)!.ops).filter((group) => group.semantic.startsWith('room-detail:'));
    for (const detail of details) {
      for (const op of flattenOps(detail.ops)) {
        const box = opBounds(op);
        assert.ok(box.x >= item.rect.x && box.y >= item.rect.y, `${detail.sourceId} starts inside ${item.id}`);
        assert.ok(box.x + box.w <= item.rect.x + item.rect.w, `${detail.sourceId} stays within ${item.id} horizontally`);
        assert.ok(box.y + box.h <= item.rect.y + item.rect.h + 2, `${detail.sourceId} stays within ${item.id} plus 2px south skirt`);
      }
    }
  }
});

void test('Batch 1 preserves one top-level group per manifest furniture and workstation/chair cardinality', () => {
  const groups = topGroups(gameArt.buildGameWorldOps(officeMap));
  assert.equal(groups.length, officeMap.furniture.length);
  assert.equal(new Set(groups.map((group) => group.sourceId)).size, officeMap.furniture.length);
  const byId = new Map(groups.map((group) => [group.sourceId, group]));
  for (const desk of officeMap.furniture.filter((item) => item.kind === 'desk')) {
    const chairs = officeMap.furniture.filter((item) => item.kind === 'chair' && nearestSolid(item)?.id === desk.id);
    const kits = walkGroups(byId.get(desk.id)!.ops).filter((group) => group.semantic === 'workstation:kit');
    assert.equal(kits.length, chairs.length, `${desk.id} keeps one workstation kit per approved chair`);
  }
});

void test('Batch 1 output is deterministic, clean, within budget, and preserves locked map/Bilik bytes', () => {
  const first = gameArt.buildGameWorldOps(officeMap);
  const second = gameArt.buildGameWorldOps(officeMap);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.ok(flattenOps(first).length <= 12_000, `painted op total ${flattenOps(first).length} stays within budget`);
  assert.equal(flattenOps(first).filter((op) => op.t === 'text').length, 0, 'no text/debug label is added');
  const hashes: Readonly<Record<string, string>> = {
    'lib/office-map.json': '0eeec47926eef3f099292c8de2b52266a576683c410727d8f387a602092153c5',
    'public/room/bilik-geng-v4.png': '8c553abc4058f76e1328f9d3ad9c0b24a07ab68108bc25ed0554da717beb178e',
    'public/room/bilik-geng-zone.png': '1df4c17ab39648dd34ec89994ea74438d99d7c36a52172d699b122282eeb9547',
  };
  for (const [path, expected] of Object.entries(hashes)) {
    assert.equal(createHash('sha256').update(readFileSync(resolve(ROOT, path))).digest('hex'), expected, `${path} is unchanged`);
  }
});
