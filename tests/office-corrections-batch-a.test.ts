// User correction Batch A: all office chairs are black and armless; the Bilik
// raster must carry the same chair language and a white structural pillar.
// Written RED before implementation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { officeMap } from '../lib/office-map.ts';
import { buildGameWorldOps } from '../lib/office-game-ops.ts';
import { flattenOps, type GroupOp, type Op, type PaintedOp } from '../lib/office-render-ops.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function groups(ops: readonly Op[]): GroupOp[] {
  const out: GroupOp[] = [];
  const visit = (items: readonly Op[]): void => {
    for (const op of items) {
      if (op.t !== 'group') continue;
      out.push(op);
      visit(op.ops);
    }
  };
  visit(ops);
  return out;
}

function rgb(fill: string): [number, number, number] | undefined {
  const match = /^#([0-9a-f]{6})$/i.exec(fill);
  if (!match) return undefined;
  const value = Number.parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

void test('every procedural chair is black-neutral and has no armrest subgroup', () => {
  const top = new Map(buildGameWorldOps(officeMap).filter((op): op is GroupOp => op.t === 'group').map((op) => [op.sourceId, op]));
  const chairs = officeMap.furniture.filter((item) => item.kind === 'chair');
  assert.ok(chairs.length >= 40);
  for (const chair of chairs) {
    const group = top.get(chair.id)!;
    const nested = groups(group.ops);
    assert.equal(nested.some((entry) => entry.semantic === 'chair:armrest'), false, `${chair.id} is armless`);
    for (const semantic of ['chair:seat', 'chair:backrest']) {
      const part = nested.find((entry) => entry.semantic === semantic);
      assert.ok(part, `${chair.id} has ${semantic}`);
      const fills = flattenOps(part!.ops)
        .filter((op): op is PaintedOp & { fill: string } => op.t !== 'image' && op.t !== 'text' && 'fill' in op)
        .map((op) => rgb(op.fill))
        .filter((value): value is [number, number, number] => Boolean(value));
      assert.ok(fills.length > 0);
      for (const [r, g, b] of fills) {
        assert.ok(Math.max(r, g, b) <= 105, `${chair.id} ${semantic} is dark: ${r},${g},${b}`);
        assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 24, `${chair.id} ${semantic} is neutral black: ${r},${g},${b}`);
      }
    }
  }
});

void test('the composed Bilik raster has neutral-black chairs and a white pillar', () => {
  const image = resolve(ROOT, 'public/room/bilik-geng-zone.png');
  const script = [
    'from PIL import Image',
    `im=Image.open(${JSON.stringify(image)}).convert("RGBA")`,
    // White pillar: cap, face and side are all neutral white/grey, not beige.
    'for p in [(224,18),(230,40),(279,60)]:',
    ' c=im.getpixel(p)[:3]; assert min(c)>=185 and max(c)-min(c)<=12,(p,c)',
    // Five visible chair centres; C5 is legitimately occluded by the structural pillar.
    'for p in [(100,42),(156,42),(100,122),(156,122),(332,78)]:',
    ' c=im.getpixel(p)[:3]; assert max(c)<=105 and max(c)-min(c)<=24,(p,c)',
    'regions=[(85,24,115,59),(141,24,171,59),(85,104,115,139),(141,104,171,139),(217,65,248,101),(317,60,348,96)]',
    'for box in regions:',
    ' bad=[p for p in im.crop(box).getdata() if p[2]-p[0]>=18 and p[2]-p[1]>=5 and p[2]<150 and p[1]<130]',
    ' assert not bad,(box,bad[:5],len(bad))',
    'print("bilik-correction-ok")',
  ].join('\n');
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /bilik-correction-ok/);
});
