// Batch 0 floor/material contract.
//
// The manifest remains authoritative for geometry and surface kinds, while the
// game-art renderer classifies every indoor zone into exactly one visual floor
// family. This test deliberately enumerates the complete 21-zone contract so a
// future room cannot become an accidental material exception.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { officeMap } from '../lib/office-map.ts';
import { flattenOps } from '../lib/office-render-ops.ts';
import * as gameArt from '../lib/office-game-ops.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
type MaterialFamily = 'building-carpet' | 'front-of-house' | 'toilet-wet';
type Classifier = (zoneId: string) => MaterialFamily;

const EXPECTED_MATERIALS: ReadonlyArray<readonly [string, MaterialFamily]> = [
  ['meeting-1', 'building-carpet'],
  ['hrga', 'building-carpet'],
  ['komisaris', 'building-carpet'],
  ['product-manager', 'building-carpet'],
  ['it', 'building-carpet'],
  ['direktur-finance', 'building-carpet'],
  ['bilik-geng-kami', 'building-carpet'],
  ['resepsionis', 'front-of-house'],
  ['lobby-besar', 'front-of-house'],
  ['lorong-utama', 'building-carpet'],
  ['sirkulasi', 'building-carpet'],
  ['jalur-terbuka', 'building-carpet'],
  ['pantry', 'building-carpet'],
  ['gudang', 'building-carpet'],
  ['toilet-wanita', 'toilet-wet'],
  ['wastafel', 'toilet-wet'],
  ['toilet-pria', 'toilet-wet'],
  ['meeting-2', 'building-carpet'],
  ['server', 'building-carpet'],
  ['desk-collection', 'building-carpet'],
  ['tele-cs-ca', 'building-carpet'],
];

const EXPECTED_SURFACES = [
  { zone: 'meeting-1', kind: 'office' },
  { zone: 'hrga', kind: 'office' },
  { zone: 'komisaris', kind: 'office' },
  { zone: 'product-manager', kind: 'office' },
  { zone: 'it', kind: 'office' },
  { zone: 'direktur-finance', kind: 'office' },
  { zone: 'bilik-geng-kami', kind: 'office' },
  { zone: 'resepsionis', kind: 'office' },
  { zone: 'lobby-besar', kind: 'lobby' },
  { zone: 'lorong-utama', kind: 'corridor' },
  { zone: 'sirkulasi', kind: 'corridor' },
  { zone: 'jalur-terbuka', kind: 'corridor' },
  { zone: 'pantry', kind: 'service' },
  { zone: 'gudang', kind: 'service' },
  { zone: 'toilet-wanita', kind: 'service' },
  { zone: 'wastafel', kind: 'service' },
  { zone: 'toilet-pria', kind: 'service' },
  { zone: 'meeting-2', kind: 'office' },
  { zone: 'server', kind: 'service' },
  { zone: 'desk-collection', kind: 'office' },
  { zone: 'tele-cs-ca', kind: 'office' },
  { zone: 'lobby-besar', kind: 'rug', rect: { x: 192.5, y: 763.75, w: 262.5, h: 137.5 } },
] as const;

function classifier(): Classifier {
  const candidate = (gameArt as unknown as { zoneMaterialFamily?: unknown }).zoneMaterialFamily;
  assert.equal(typeof candidate, 'function', 'office-game-ops must export zoneMaterialFamily');
  return candidate as Classifier;
}

void test('all 21 zones are explicitly classified into the accepted material family', () => {
  assert.equal(officeMap.zones.length, 21, 'the complete approved zone set is covered');
  assert.deepEqual(officeMap.zones.map((zone) => zone.id), EXPECTED_MATERIALS.map(([id]) => id));
  const classify = classifier();
  assert.deepEqual(
    officeMap.zones.map((zone) => [zone.id, classify(zone.id)]),
    EXPECTED_MATERIALS,
  );
  assert.throws(() => classify('future-unreviewed-zone'), /Unknown office zone material/);
});

void test('front-of-house and toilet/wet are the only building-carpet exceptions', () => {
  const classify = classifier();
  const exceptions = officeMap.zones
    .map((zone) => [zone.id, classify(zone.id)] as const)
    .filter(([, family]) => family !== 'building-carpet');
  assert.deepEqual(exceptions, [
    ['resepsionis', 'front-of-house'],
    ['lobby-besar', 'front-of-house'],
    ['toilet-wanita', 'toilet-wet'],
    ['wastafel', 'toilet-wet'],
    ['toilet-pria', 'toilet-wet'],
  ]);
  assert.deepEqual(new Set(EXPECTED_MATERIALS.map(([, family]) => family)), new Set<MaterialFamily>(['building-carpet', 'front-of-house', 'toilet-wet']));
});

void test('manifest surface kinds and geometry stay byte-for-byte equivalent', () => {
  assert.deepEqual(officeMap.surfaces, EXPECTED_SURFACES);
  const bytes = readFileSync(resolve(ROOT, 'lib', 'office-map.json'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '28f553ed62365bba858a4e69a1da317d46ebaff4e43a724936e7952a54db90d9');
});

void test('Bilik source and generated zone raster stay byte-identical', () => {
  const source = readFileSync(resolve(ROOT, 'public', 'room', 'bilik-geng-v4.png'));
  const generated = readFileSync(resolve(ROOT, 'public', 'room', 'bilik-geng-zone.png'));
  assert.equal(createHash('sha256').update(source).digest('hex'), '8c553abc4058f76e1328f9d3ad9c0b24a07ab68108bc25ed0554da717beb178e');
  assert.equal(createHash('sha256').update(generated).digest('hex'), '1938ed6931f2964e0d69e08aeab0c289abcfe13fed26e9d3242ef7af85c4f47f');
});

void test('the renderer has no furniture-centred rug pass or per-room rug identity', () => {
  const source = readFileSync(resolve(ROOT, 'lib', 'office-game-ops.ts'), 'utf8');
  assert.doesNotMatch(source, /furnitureRugOps/, 'furniture-centred rug operations are removed');
  const zoneIdentity = (gameArt as unknown as { zoneIdentity: (zoneId: string) => Record<string, unknown> }).zoneIdentity;
  for (const zone of officeMap.zones) {
    assert.equal('rug' in zoneIdentity(zone.id), false, `${zone.id} has no furniture-centred rug material identity`);
  }
});

void test('material output is deterministic and stays within the painted-op budget', () => {
  const first = gameArt.buildGameWorldOps(officeMap);
  const second = gameArt.buildGameWorldOps(officeMap);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  const count = flattenOps(first).length;
  assert.ok(count <= 12_000, `painted ops ${count} must stay within 12000`);
});
