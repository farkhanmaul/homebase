// Batch 2 dense-workarea contract. Written RED before implementation.
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
const BANK_IDS = ['F-DC-BANK-TOP', 'F-DC-BANK-BOTTOM', 'F-TC-BANK-L', 'F-TC-BANK-R'] as const;
const COLLECTION_VARIANTS = new Set(['headset', 'documents', 'notepad', 'clean']);
const TELE_VARIANTS = new Set(['headset', 'ticket', 'status', 'clean']);

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

function bankById(id: string): Furniture {
  const item = officeMap.furniture.find((entry) => entry.id === id);
  assert.ok(item, `${id} exists`);
  return item;
}

void test('dense workarea profiles are explicit and reject generic fallback', () => {
  const resolveProfile = (gameArt as unknown as { denseWorkProfile?: (zoneId: string) => string }).denseWorkProfile;
  assert.equal(typeof resolveProfile, 'function');
  assert.equal(resolveProfile!('desk-collection'), 'collection');
  assert.equal(resolveProfile!('tele-cs-ca'), 'contact-center');
  assert.throws(() => resolveProfile!('meeting-1'), /dense work profile/i);
});

void test('each approved bank preserves exact workstation cardinality and gains bounded construction', () => {
  const world = gameArt.buildGameWorldOps(officeMap);
  const byId = new Map(topGroups(world).map((group) => [group.sourceId, group]));
  const workstations = gameArt.deriveWorkstations(officeMap);
  assert.deepEqual(BANK_IDS.filter((id) => byId.has(id)), [...BANK_IDS], 'exact four existing bank groups remain');

  for (const id of BANK_IDS) {
    const group = byId.get(id)!;
    const nested = walkGroups(group.ops);
    assert.equal(nested.filter((entry) => entry.semantic === 'workstation:kit').length, workstations.get(id)?.length ?? 0, `${id} keeps one kit per associated approved chair`);
    assert.equal(nested.filter((entry) => entry.semantic === 'workarea:cable-tray').length, 1, `${id} has one restrained cable tray`);
    assert.ok(nested.some((entry) => entry.semantic === 'desk:spine'), `${id} keeps its partition spine`);
    assert.ok(nested.some((entry) => entry.semantic === 'desk:divider'), `${id} keeps bay dividers`);
  }
});

void test('Collection and Tele expose deterministic semantic rhythms including clean stations', () => {
  const byId = new Map(topGroups(gameArt.buildGameWorldOps(officeMap)).map((group) => [group.sourceId, group]));
  const variants = (ids: readonly string[], prefix: string): string[] => ids.flatMap((id) => walkGroups(byId.get(id)!.ops))
    .map((group) => group.semantic)
    .filter((semantic) => semantic.startsWith(prefix))
    .map((semantic) => semantic.slice(prefix.length));

  const collection = variants(BANK_IDS.slice(0, 2), 'workarea:collection:');
  const tele = variants(BANK_IDS.slice(2), 'workarea:tele:');
  assert.deepEqual(new Set(collection), COLLECTION_VARIANTS, 'Collection includes headset, documents, notepad and clean rhythms');
  assert.deepEqual(new Set(tele), TELE_VARIANTS, 'Tele includes headset, ticket, status and clean rhythms');
  assert.ok(tele.filter((value) => value === 'headset').length >= Math.floor(tele.length / 3), 'Tele is headset-led rather than generic clutter');

  for (const id of BANK_IDS) {
    const nested = walkGroups(byId.get(id)!.ops);
    const kits = nested.filter((group) => group.semantic === 'workstation:kit');
    for (const kit of kits) {
      const profileGroups = walkGroups(kit.ops).filter((group) => group.semantic.startsWith('workarea:'));
      assert.equal(profileGroups.length, 1, `${kit.sourceId} receives exactly one zone-aware prop profile`);
      assert.ok(flattenOps(profileGroups[0]!.ops).length >= 3, `${profileGroups[0]!.semantic} is painted, not metadata-only`);
    }
  }
});

void test('all Batch 2 paint stays inside its existing bank footprint', () => {
  const byId = new Map(topGroups(gameArt.buildGameWorldOps(officeMap)).map((group) => [group.sourceId, group]));
  for (const id of BANK_IDS) {
    const item = bankById(id);
    const groups = walkGroups(byId.get(id)!.ops).filter((group) => group.semantic.startsWith('workarea:'));
    for (const group of groups) {
      for (const op of flattenOps(group.ops)) {
        const box = opBounds(op);
        assert.ok(box.x >= item.rect.x && box.y >= item.rect.y, `${group.sourceId} starts inside ${id}`);
        assert.ok(box.x + box.w <= item.rect.x + item.rect.w, `${group.sourceId} stays inside ${id} horizontally`);
        assert.ok(box.y + box.h <= item.rect.y + item.rect.h + 2, `${group.sourceId} stays inside ${id} vertically`);
      }
    }
  }
});

void test('Batch 2 remains deterministic, locked and inside its strict op allowance', () => {
  const first = gameArt.buildGameWorldOps(officeMap);
  const second = gameArt.buildGameWorldOps(officeMap);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  const painted = flattenOps(first);
  assert.ok(painted.length <= 10_934, `painted op total ${painted.length} stays within Batch 2 allowance`);
  assert.equal(painted.filter((op) => op.t === 'text').length, 0);

  const hashes: Readonly<Record<string, string>> = {
    'lib/office-map.json': '28f553ed62365bba858a4e69a1da317d46ebaff4e43a724936e7952a54db90d9',
    'public/room/bilik-geng-v4.png': '8c553abc4058f76e1328f9d3ad9c0b24a07ab68108bc25ed0554da717beb178e',
    'public/room/bilik-geng-zone.png': '1df4c17ab39648dd34ec89994ea74438d99d7c36a52172d699b122282eeb9547',
  };
  for (const [path, expected] of Object.entries(hashes)) {
    assert.equal(createHash('sha256').update(readFileSync(resolve(ROOT, path))).digest('hex'), expected, `${path} is unchanged`);
  }
});
