// User correction Batch A: all office chairs are black and armless; the Bilik
// raster must carry the same chair language and a white structural pillar.
// Written RED before implementation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
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

function decodeRgbaPng(path: string): { width: number; height: number; pixel(x: number, y: number): [number, number, number, number] } {
  const png = readFileSync(path);
  assert.equal(png.subarray(0, 8).toString('latin1'), '\x89PNG\r\n\x1a\n');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.equal(png[24], 8, '8-bit PNG');
  assert.equal(png[25], 6, 'RGBA PNG');
  assert.equal(png[28], 0, 'non-interlaced PNG');

  const idat: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'IDAT') idat.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const packed = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = Buffer.alloc(stride * height);
  const paeth = (a: number, b: number, c: number): number => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0, source = 0; y < height; y += 1) {
    const filter = packed[source++]!;
    for (let x = 0; x < stride; x += 1) {
      const raw = packed[source++]!;
      const index = y * stride + x;
      const left = x >= 4 ? rgba[index - 4]! : 0;
      const up = y > 0 ? rgba[index - stride]! : 0;
      const upperLeft = y > 0 && x >= 4 ? rgba[index - stride - 4]! : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? Math.floor((left + up) / 2)
              : filter === 4 ? paeth(left, up, upperLeft)
                : -1;
      assert.notEqual(predictor, -1, `unsupported PNG filter ${filter}`);
      rgba[index] = (raw + predictor) & 255;
    }
  }
  return {
    width,
    height,
    pixel(x, y) {
      assert.ok(x >= 0 && x < width && y >= 0 && y < height);
      const index = y * stride + x * 4;
      return [rgba[index]!, rgba[index + 1]!, rgba[index + 2]!, rgba[index + 3]!];
    },
  };
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
  const png = decodeRgbaPng(resolve(ROOT, 'public/room/bilik-geng-zone.png'));
  assert.deepEqual([png.width, png.height], [386, 185]);

  // White pillar: cap, face and side are all neutral white/grey, not beige.
  for (const [x, y] of [[224, 18], [230, 40], [279, 60]]) {
    const [r, g, b] = png.pixel(x!, y!);
    assert.ok(Math.min(r, g, b) >= 185 && Math.max(r, g, b) - Math.min(r, g, b) <= 12, `pillar pixel ${x},${y}: ${r},${g},${b}`);
  }

  // Five visible chair centres; C5 is legitimately occluded by the pillar.
  for (const [x, y] of [[100, 42], [156, 42], [100, 122], [156, 122], [332, 78]]) {
    const [r, g, b] = png.pixel(x!, y!);
    assert.ok(Math.max(r, g, b) <= 105 && Math.max(r, g, b) - Math.min(r, g, b) <= 24, `chair pixel ${x},${y}: ${r},${g},${b}`);
  }

  const regions = [[85, 24, 115, 59], [141, 24, 171, 59], [85, 104, 115, 139], [141, 104, 171, 139], [217, 65, 248, 101], [317, 60, 348, 96]];
  for (const [x1, y1, x2, y2] of regions) {
    const bad: string[] = [];
    for (let y = y1!; y < y2!; y += 1) {
      for (let x = x1!; x < x2!; x += 1) {
        const [r, g, b] = png.pixel(x, y);
        if (b - r >= 18 && b - g >= 5 && b < 150 && g < 130) bad.push(`${x},${y}:${r},${g},${b}`);
      }
    }
    assert.deepEqual(bad, [], `blue/cyan remnants in ${x1},${y1},${x2},${y2}: ${bad.slice(0, 5).join('; ')}`);
  }
});
