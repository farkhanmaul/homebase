// Bilik Geng Kami raster underlay tests.
//
// The final `bilik-geng-kami` zone is covered by one bitmap op painted last over
// its own vector art. The vector art stays underneath on purpose, as the fallback
// shown while the bitmap loads (and if it fails), so this suite pins:
//
//   a) the deterministic generator artifact (dimensions, RGBA, size, hash, rerun),
//   b) the op model: exactly one image op, at the exact zone rect, last, with no
//      manifest mutation and the vector art still underneath,
//   c) the canvas fallback (no asset -> skipped) and image painting (asset -> drawn),
//   d) the base-path-safe asset URL,
//   e) the crop translation/scale and the SVG data URI embedding,
//   f) the Pillow fallback handling image ops (and failing loudly otherwise),
//   g) the page wiring (single preload, single static repaint, no CSS background).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BILIK_GENG_ZONE_ID, clampCamera, officeMap, zoneById, type Rect } from '../lib/office-map.ts';
import { BILIK_ZONE_IMAGE_SRC, buildGameWorldOps } from '../lib/office-game-ops.ts';
import { buildReviewWorldOps, flattenOps, type Op, type PaintedOp } from '../lib/office-render-ops.ts';
import { cropPreviewOps, opBounds } from '../lib/office-crop.ts';
import { assetUrl, paintOps } from '../lib/office-renderer.ts';
import { resolveCamera, zoneCentre } from '../lib/office-camera.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ZONE_PNG = resolve(ROOT, 'public', 'room', 'bilik-geng-zone.png');
const GENERATOR = resolve(ROOT, 'scripts', 'generate-bilik-zone-art.py');
const RASTERIZE = resolve(ROOT, 'scripts', 'rasterize-map-preview.py');
const CAMERA_BOX = { width: 1440, height: 1000 };
const CAMERA_SCALE = 2;

const bilik = zoneById(officeMap, BILIK_GENG_ZONE_ID)!;
const EXPECTED_ZONE: Rect = { x: 1450, y: 40, w: 386.25, h: 185 };
// The deterministic artifact pinned by the generator test.
const ZONE_PNG_SHA256 = '1df4c17ab39648dd34ec89994ea74438d99d7c36a52172d699b122282eeb9547';
const ZONE_PNG_BYTES = 97641;

const hasPillow = (): boolean => spawnSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' }).status === 0;

function imageOps(ops: readonly Op[]): Extract<PaintedOp, { t: 'image' }>[] {
  return flattenOps(ops).filter((op): op is Extract<PaintedOp, { t: 'image' }> => op.t === 'image');
}

function topLevelImageOps(ops: readonly Op[]): Extract<Op, { t: 'image' }>[] {
  return ops.filter((op): op is Extract<Op, { t: 'image' }> => op.t === 'image');
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// The exact camera + crop the preview generator uses for the Bilik crop.
function bilikCrop() {
  const centre = zoneCentre(bilik);
  const view = resolveCamera(officeMap, CAMERA_BOX, 'desktop', centre).view;
  const camera = clampCamera(officeMap, view, centre);
  return { camera, view, preview: cropPreviewOps({ width: officeMap.width, height: officeMap.height, ops: buildGameWorldOps(officeMap) }, camera, view, CAMERA_SCALE) };
}

// ---------------------------------------------------------------------------
// (a) Deterministic generator artifact
// ---------------------------------------------------------------------------

void test('the zone raster is the exact 386x185 RGBA integer box under the size budget', () => {
  const bytes = readFileSync(ZONE_PNG);
  // PNG signature + IHDR: width/height/bit-depth/colour-type at fixed offsets.
  assert.equal(bytes.subarray(0, 8).toString('latin1'), '\x89PNG\r\n\x1a\n', 'PNG signature');
  assert.equal(bytes.subarray(12, 16).toString('latin1'), 'IHDR', 'IHDR chunk');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const bitDepth = bytes[24];
  const colourType = bytes[25];
  assert.equal(width, 386, 'raster width is the rounded zone width');
  assert.equal(height, 185, 'raster height is the rounded zone height');
  assert.equal(bitDepth, 8);
  assert.equal(colourType, 6, 'RGBA colour type (transparency needed for the wall cut)');
  assert.ok(bytes.length <= 150 * 1024, `artifact ${bytes.length} bytes exceeds the 150KB budget`);
  assert.equal(bytes.length, ZONE_PNG_BYTES, 'artifact size is stable');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), ZONE_PNG_SHA256, 'artifact bytes are stable');
});

void test('the Bilik raster exposes the authoritative structural column instead of empty floor', () => {
  if (!hasPillow()) return;
  const script = [
    'from PIL import Image',
    `im = Image.open(${JSON.stringify(ZONE_PNG)}).convert("RGBA")`,
    // col-geng-1 is world (1672.5,56.25,60,57.5), local to zone (1450,40).
    'assert im.getpixel((224, 18))[:3] == (247, 247, 243), im.getpixel((224, 18))',
    'assert im.getpixel((230, 40))[:3] == (232, 232, 228), im.getpixel((230, 40))',
    'assert im.getpixel((279, 60))[:3] == (205, 205, 201), im.getpixel((279, 60))',
    'print("pillar-ok")',
  ].join('\n');
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /pillar-ok/);
});

void test('the generator is deterministic and derives its size from the manifest zone contract', () => {
  if (!hasPillow()) return; // The generator needs Pillow; CI provides it.
  const dir = mkdtempSync(join(tmpdir(), 'bilik-zone-'));
  try {
    const out = resolve(dir, 'rerun.png');
    const result = spawnSync('python3', [GENERATOR, '--out', out], { encoding: 'utf8' });
    assert.equal(result.status, 0, `generator failed: ${result.stderr}`);
    assert.deepEqual(readFileSync(out), readFileSync(ZONE_PNG), 'a rerun is byte-identical to the committed artifact');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('the bottom six raster rows are transparent so the wall/opening shows through', () => {
  if (!hasPillow()) return;
  const script = [
    'from PIL import Image',
    `im = Image.open(${JSON.stringify(ZONE_PNG)})`,
    'a = im.getchannel("A")',
    'w, h = im.size',
    'rows = [a.crop((0, y, w, y + 1)).getextrema() for y in range(h)]',
    'assert all(e == (0, 0) for e in rows[h - 6:]), rows[h - 6:]',
    'assert all(e == (255, 255) for e in rows[:h - 6]), [e for e in rows[:h - 6] if e != (255, 255)][:3]',
    'print("ok")',
  ].join('\n');
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ok/);
});

// ---------------------------------------------------------------------------
// (b) Op model
// ---------------------------------------------------------------------------

void test('buildGameWorldOps appends exactly one image op for the Bilik zone', () => {
  const ops = buildGameWorldOps(officeMap);
  const images = imageOps(ops);
  assert.equal(images.length, 1, 'exactly one image op');

  const image = images[0]!;
  assert.equal(image.src, BILIK_ZONE_IMAGE_SRC);
  assert.equal(BILIK_ZONE_IMAGE_SRC, '/room/bilik-geng-zone.png');
  assert.deepEqual({ x: image.x, y: image.y, w: image.w, h: image.h }, EXPECTED_ZONE, 'the op uses the exact zone rect');
  assert.deepEqual(bilik.rect, EXPECTED_ZONE, 'the manifest zone rect is unchanged');

  // Last top-level op and last painted op.
  assert.equal(topLevelImageOps(ops).length, 1);
  assert.equal(ops[ops.length - 1]!.t, 'image', 'the image op is the last top-level op');
  const flat = flattenOps(ops);
  assert.equal(flat[flat.length - 1]!.t, 'image', 'the image op is the last painted op');
});

void test('the vector Bilik art stays underneath the image as a fallback', () => {
  const ops = buildGameWorldOps(officeMap);
  const flat = flattenOps(ops);
  const imageIndex = flat.findIndex((op) => op.t === 'image');
  assert.ok(imageIndex > 0);
  // Something the image paints over intersects the zone: the floor and/or its
  // furniture. (The fallback would otherwise be invisible.)
  const underneath = flat.slice(0, imageIndex).some((op) => {
    if (op.t === 'text') return false;
    return intersects(opBounds(op), bilik.rect);
  });
  assert.ok(underneath, 'vector art is painted under the image op');
});

void test('building the game ops never mutates the manifest', () => {
  const before = JSON.stringify(officeMap);
  const opCount = buildGameWorldOps(officeMap).length;
  assert.ok(opCount > 0);
  assert.equal(JSON.stringify(officeMap), before, 'the manifest is untouched');
});

void test('the image op is game art only: the technical review layer never emits it', () => {
  assert.equal(imageOps(buildReviewWorldOps(officeMap)).length, 0, 'review ops carry no image op');
  // And it is not a debug colour/marker: it has no fill to collide with the
  // review palette.
  const image = imageOps(buildGameWorldOps(officeMap))[0]!;
  assert.equal('fill' in image, false, 'an image op paints no fill');
});

// ---------------------------------------------------------------------------
// (c) Canvas paint + fallback
// ---------------------------------------------------------------------------

function createFakeContext(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = [];
  const ctx = {
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    drawImage: (...args: unknown[]) => { calls.push(`drawImage(${args.length})`); },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const sampleImage: Op = { t: 'image', src: BILIK_ZONE_IMAGE_SRC, x: 10, y: 20, w: 30, h: 40 };
const fakeAsset = {} as CanvasImageSource;

void test('without a loaded asset the image op is skipped (vector fallback shows)', () => {
  const { ctx, calls } = createFakeContext();
  paintOps(ctx, [sampleImage]);
  assert.equal(calls.length, 0, 'no drawImage without an asset');

  const { ctx: withEmpty, calls: emptyCalls } = createFakeContext();
  paintOps(withEmpty, [sampleImage], new Map());
  assert.equal(emptyCalls.length, 0, 'an empty asset map still skips the image');
});

void test('with a loaded asset the image op is painted into its exact rect', () => {
  const { ctx, calls } = createFakeContext();
  paintOps(ctx, [sampleImage], new Map([[BILIK_ZONE_IMAGE_SRC, fakeAsset]]));
  assert.deepEqual(calls, ['drawImage(5)'], 'drawImage(asset, x, y, w, h)');
  assert.equal(ctx.globalAlpha, 1, 'alpha is restored');
});

void test('an image asset inside a group is still resolved through the asset map', () => {
  const { ctx, calls } = createFakeContext();
  const group: Op = { t: 'group', sourceId: 'g', semantic: 'g', ops: [sampleImage] };
  paintOps(ctx, [group], new Map([[BILIK_ZONE_IMAGE_SRC, fakeAsset]]));
  assert.deepEqual(calls, ['drawImage(5)']);
});

// ---------------------------------------------------------------------------
// (d) Base-path-safe asset URL
// ---------------------------------------------------------------------------

void test('assetUrl converts a root-relative op src into a base-path-safe relative URL', () => {
  assert.equal(assetUrl('/room/bilik-geng-zone.png'), 'room/bilik-geng-zone.png');
  assert.equal(assetUrl('room/bilik-geng-zone.png'), 'room/bilik-geng-zone.png');
  assert.equal(assetUrl('avatar/team-six.png'), 'avatar/team-six.png', 'the avatar convention is unchanged');
  assert.equal(assetUrl('//room/x.png'), 'room/x.png');
});

// ---------------------------------------------------------------------------
// (e) Crop + SVG embedding
// ---------------------------------------------------------------------------

void test('cropPreviewOps translates and scales the image op whole', () => {
  const { camera, preview } = bilikCrop();
  const images = imageOps(preview.ops);
  assert.equal(images.length, 1, 'the crop keeps exactly one image op');
  const image = images[0]!;
  assert.equal(image.src, BILIK_ZONE_IMAGE_SRC);
  assert.deepEqual(
    { x: image.x, y: image.y, w: image.w, h: image.h },
    {
      x: Math.round((bilik.rect.x - camera.x) * CAMERA_SCALE),
      y: Math.round((bilik.rect.y - camera.y) * CAMERA_SCALE),
      w: Math.max(1, Math.round(bilik.rect.w * CAMERA_SCALE)),
      h: Math.max(1, Math.round(bilik.rect.h * CAMERA_SCALE)),
    },
  );
  assert.ok(image.x + image.w > 0 && image.x < preview.width, 'the image intersects the crop');
});

void test('an image op outside the crop is dropped', () => {
  const op: Op = { t: 'image', src: BILIK_ZONE_IMAGE_SRC, x: 5000, y: 5000, w: 100, h: 100 };
  const preview = cropPreviewOps({ width: officeMap.width, height: officeMap.height, ops: [op] }, { x: 0, y: 0 }, { w: 100, h: 100 }, 1);
  assert.equal(imageOps(preview.ops).length, 0, 'a fully off-crop image is dropped');
});

void test('the SVG artifacts embed the zone raster as a deterministic data URI', () => {
  const base64 = readFileSync(ZONE_PNG).toString('base64');
  const uri = `data:image/png;base64,${base64}`;

  const game = readFileSync(resolve(ROOT, 'docs', 'previews', 'final-office-game.svg'), 'utf8');
  assert.ok(game.includes(uri), 'the game artifact embeds the exact raster bytes');
  const gameImage = /<image ([^>]*)\/>/.exec(game);
  assert.ok(gameImage, 'the game artifact has an <image> element');
  assert.equal(Number(/\bx="([0-9.]+)"/.exec(gameImage![1])![1]), bilik.rect.x);
  assert.equal(Number(/\by="([0-9.]+)"/.exec(gameImage![1])![1]), bilik.rect.y);
  assert.equal(Number(/\bwidth="([0-9.]+)"/.exec(gameImage![1])![1]), bilik.rect.w);
  assert.equal(Number(/\bheight="([0-9.]+)"/.exec(gameImage![1])![1]), bilik.rect.h);
  assert.doesNotMatch(game, /href="(?!data:image\/png;base64,)/, 'no unresolved filesystem/public href');

  const crop = readFileSync(resolve(ROOT, 'docs', 'previews', 'v1-detail-bilik.svg'), 'utf8');
  assert.ok(crop.includes(uri), 'the Bilik crop embeds the same raster bytes');
  const cropImage = /<image ([^>]*)\/>/.exec(crop);
  assert.ok(cropImage, 'the Bilik crop has an <image> element');
  const cropW = Number(/\bwidth="([0-9.]+)"/.exec(cropImage![1])![1]);
  const cropH = Number(/\bheight="([0-9.]+)"/.exec(cropImage![1])![1]);
  assert.equal(cropW, Math.round(bilik.rect.w * CAMERA_SCALE), 'the crop scales the raster');
  assert.equal(cropH, Math.round(bilik.rect.h * CAMERA_SCALE), 'the crop scales the raster');
});

// ---------------------------------------------------------------------------
// (f) Pillow backend: image ops are painted, or the backend fails loudly
// ---------------------------------------------------------------------------

void test('the Pillow backend paints an image op and fails loudly when the asset is missing', () => {
  if (!hasPillow()) return;
  const dir = mkdtempSync(join(tmpdir(), 'pillow-image-'));
  try {
    const assetDir = resolve(dir, 'assets', 'room');
    spawnSync('mkdir', ['-p', assetDir]);
    const bitmap = resolve(assetDir, 'probe.png');
    spawnSync('python3', ['-c', [
      'from PIL import Image',
      `Image.new("RGBA", (2, 1), (255, 0, 0, 255)).save(${JSON.stringify(bitmap)})`,
    ].join('\n')]);
    const ops = {
      width: 4,
      height: 2,
      ops: [
        { t: 'rect', x: 0, y: 0, w: 4, h: 2, fill: '#000000' },
        { t: 'image', src: '/room/probe.png', x: 1, y: 0, w: 2, h: 1 },
      ],
    };
    const opsPath = resolve(dir, 'ops.json');
    const outPath = resolve(dir, 'out.png');
    spawnSync('node', ['-e', `require('fs').writeFileSync(${JSON.stringify(opsPath)}, ${JSON.stringify(JSON.stringify(ops))})`]);

    const painted = spawnSync('python3', [RASTERIZE, opsPath, outPath, resolve(dir, 'assets')], { encoding: 'utf8' });
    assert.equal(painted.status, 0, painted.stderr);
    const probe = spawnSync('python3', ['-c', [
      'from PIL import Image',
      `im = Image.open(${JSON.stringify(outPath)}).convert("RGB")`,
      'print(im.getpixel((1, 0)), im.getpixel((0, 0)))',
    ].join('\n')], { encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    assert.match(probe.stdout, /\(255, 0, 0\)/, 'the image op was painted');

    // Missing asset -> explicit failure, never a silent omission.
    const missing = spawnSync('python3', [RASTERIZE, opsPath, resolve(dir, 'missing.png'), resolve(dir, 'nope')], { encoding: 'utf8' });
    assert.notEqual(missing.status, 0, 'a missing image asset fails the backend');
    assert.match(missing.stderr, /not found|no assets dir/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (g) Page wiring
// ---------------------------------------------------------------------------

void test('the page preloads the raster once, repaints the static world once, and never uses CSS background', () => {
  const page = readFileSync(resolve(ROOT, 'app', 'page.tsx'), 'utf8');
  assert.match(page, /import \{ BILIK_ZONE_IMAGE_SRC \} from '\.\.\/lib\/office-game-ops'/);
  assert.match(page, /assetUrl/, 'the page resolves the asset base-path-safe');
  assert.match(page, /zoneArt\.src = assetUrl\(BILIK_ZONE_IMAGE_SRC\)/, 'one preload, base-path-safe');
  assert.match(page, /zoneArt\.onload = \(\) => \{ world = createWorldCanvas\(officeMap, new Map\(\[\[BILIK_ZONE_IMAGE_SRC, zoneArt\]\]\)\); \}/, 'a single static repaint on load');
  assert.match(page, /let world = createWorldCanvas\(officeMap\)/, 'the initial world uses the vector fallback');
  // The scene is never rebuilt per frame, and the zone art is never a CSS layer.
  assert.equal(page.split('createWorldCanvas(').length - 1, 2, 'exactly two world builds: initial + preload');
  assert.doesNotMatch(page, /url\([^)]*bilik-geng-zone/, 'no CSS background URL for the zone art');
});

// Keep the pipeline hook honest: the generator script and the Pillow backend
// both exist where the tests expect them.
void test('the generator and Pillow backend scripts exist', () => {
  assert.ok(readFileSync(GENERATOR, 'utf8').includes('bilik-geng-zone.png'));
  assert.ok(readFileSync(RASTERIZE, 'utf8').includes('"image"'));
});
