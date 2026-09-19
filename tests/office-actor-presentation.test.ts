// Actor presentation-size tests.
//
// Avatars, name tags and the active ring are authored in CSS px (a ~56 CSS px
// tall actor, an 11px label). The zone-aware desktop camera zooms into a small
// room, mapping fewer world px onto the same CSS box, so drawing those sizes as
// raw world px made actors balloon — Farkhan covered the desk at ~2.3x.
//
// `drawActors` now multiplies every presentation dimension by `scale` (world px
// per CSS px), while the feet stay anchored at the exact world x/y and the hit /
// collision logic is untouched. These tests drive a fake 2D context and pin the
// geometry at scale 1 and 0.5 and the feet anchor.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { officeMap, zoneById } from '../lib/office-map.ts';
import { resolveCamera, zoneCentre } from '../lib/office-camera.ts';
import { actorPresentationScale, drawActors, type RenderActor } from '../lib/office-renderer.ts';

const SHEET = { naturalWidth: 576, naturalHeight: 128 } as unknown as CanvasImageSource & {
  naturalWidth: number;
  naturalHeight: number;
};

type Recorded =
  | { t: 'translate'; x: number; y: number }
  | { t: 'scale'; x: number; y: number }
  | { t: 'drawImage'; dx: number; dy: number; dw: number; dh: number }
  | { t: 'fillRect'; x: number; y: number; w: number; h: number }
  | { t: 'fillText'; text: string; x: number; y: number; font: string }
  | { t: 'ellipse'; x: number; y: number; rx: number; ry: number }
  | { t: 'stroke'; lineWidth: number };

function recordingContext(): { ctx: CanvasRenderingContext2D; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const ctx: Record<string, unknown> = {
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    save() {},
    restore() {},
    translate(x: number, y: number) { calls.push({ t: 'translate', x, y }); },
    scale(x: number, y: number) { calls.push({ t: 'scale', x, y }); },
    drawImage(...args: unknown[]) {
      calls.push({ t: 'drawImage', dx: args[5] as number, dy: args[6] as number, dw: args[7] as number, dh: args[8] as number });
    },
    fillRect(x: number, y: number, w: number, h: number) { calls.push({ t: 'fillRect', x, y, w, h }); },
    fillText(text: string, x: number, y: number) { calls.push({ t: 'fillText', text, x, y, font: String(ctx.font) }); },
    beginPath() {},
    ellipse(x: number, y: number, rx: number, ry: number) { calls.push({ t: 'ellipse', x, y, rx, ry }); },
    stroke() { calls.push({ t: 'stroke', lineWidth: ctx.lineWidth as number }); },
    measureText(text: string) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(String(ctx.font))?.[1] ?? '0');
      return { width: text.length * size * 0.6 };
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

function actor(overrides: Partial<RenderActor> = {}): RenderActor {
  return { id: 3, name: 'Geng', sprite: 0, x: 100, y: 200, direction: 'right', walking: false, sitting: false, online: true, ...overrides };
}

// Draw one actor through the real renderer and hand back the recorded calls.
// Camera is (10, 20), so world (100, 200) paints at canvas (90, 180).
function draw(overrides: Partial<RenderActor>, scale: number, activeId: number | null = null): Recorded[] {
  const { ctx, calls } = recordingContext();
  drawActors(ctx, [actor(overrides)], { camera: { x: 10, y: 20 }, activeId, sheet: SHEET, now: 0, reducedMotion: false, scale });
  return calls;
}

function imageCall(calls: Recorded[]): Extract<Recorded, { t: 'drawImage' }> {
  const image = calls.find((call): call is Extract<Recorded, { t: 'drawImage' }> => call.t === 'drawImage');
  assert.ok(image, 'the actor sprite is drawn');
  return image;
}

function close(actual: number, expected: number, label: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} != ${expected}`);
}

// ---------------------------------------------------------------------------
// The scale factor
// ---------------------------------------------------------------------------

void test('actorPresentationScale is world px per CSS px and falls back to 1 for an unmeasured box', () => {
  close(actorPresentationScale(467, 1072), 467 / 1072, 'zoomed-in room');
  assert.equal(actorPresentationScale(1072, 1072), 1, '1:1 box is unchanged');
  assert.equal(actorPresentationScale(680, 1072), 680 / 1072, 'open-floor desktop');
  assert.equal(actorPresentationScale(467, 0), 1, 'zero-width box falls back');
  assert.equal(actorPresentationScale(467, Number.NaN), 1, 'NaN box falls back');
  assert.equal(actorPresentationScale(0, 1072), 1, 'zero view falls back');
});

// ---------------------------------------------------------------------------
// Dimensions scale with the factor
// ---------------------------------------------------------------------------

void test('sprite dimensions are the CSS-authored sizes at scale 1', () => {
  assert.deepEqual(imageCall(draw({ id: 1, name: 'Farkhan' }, 1)), { t: 'drawImage', dx: 73, dy: 118, dw: 34, dh: 62 });
  assert.deepEqual(imageCall(draw({ id: 2, name: 'Rani' }, 1)), { t: 'drawImage', dx: 70, dy: 124, dw: 40, dh: 56 });
  assert.deepEqual(imageCall(draw({ id: 3, name: 'Budi' }, 1)), { t: 'drawImage', dx: 73, dy: 124, dw: 34, dh: 56 });
  assert.deepEqual(imageCall(draw({ id: 3, name: 'Budi', sitting: true }, 1)), { t: 'drawImage', dx: 73, dy: 134, dw: 34, dh: 46 });
});

void test('sprite dimensions halve at scale 0.5', () => {
  assert.deepEqual(imageCall(draw({ id: 1, name: 'Farkhan' }, 0.5)), { t: 'drawImage', dx: 81.5, dy: 149, dw: 17, dh: 31 });
  assert.deepEqual(imageCall(draw({ id: 2, name: 'Rani' }, 0.5)), { t: 'drawImage', dx: 80, dy: 152, dw: 20, dh: 28 });
  assert.deepEqual(imageCall(draw({ id: 3, name: 'Budi', sitting: true }, 0.5)), { t: 'drawImage', dx: 81.5, dy: 157, dw: 17, dh: 23 });
});

// ---------------------------------------------------------------------------
// Feet stay anchored at the exact world position
// ---------------------------------------------------------------------------

void test('the feet anchor stays at the exact world x/y for both facings and zooms', () => {
  for (const scale of [1, 0.5, 467 / 1072]) {
    const right = imageCall(draw({ id: 1, direction: 'right' }, scale));
    close(right.dx + right.dw / 2, 90, `right-facing spans world x (scale ${scale})`);
    close(right.dy + right.dh, 180, `right-facing feet sit on world y (scale ${scale})`);

    const leftCalls = draw({ id: 1, direction: 'left' }, scale);
    const left = imageCall(leftCalls);
    const translate = leftCalls.find((call): call is Extract<Recorded, { t: 'translate' }> => call.t === 'translate');
    assert.ok(translate, 'left-facing flips about its centre');
    close(translate.x - left.dw / 2, 90, `left-facing spans world x (scale ${scale})`);
    close(translate.y + left.dh, 180, `left-facing feet sit on world y (scale ${scale})`);
  }
});

// ---------------------------------------------------------------------------
// Label scales
// ---------------------------------------------------------------------------

void test('the name label scales its font, pad, height and offset', () => {
  const one = draw({ id: 1, name: 'Farkhan' }, 1, 1);
  const labelOne = one.find((call): call is Extract<Recorded, { t: 'fillText' }> => call.t === 'fillText');
  const boxOne = one.find((call): call is Extract<Recorded, { t: 'fillRect' }> => call.t === 'fillRect');
  assert.ok(labelOne && boxOne);
  assert.equal(labelOne.text, 'Farkhan · kamu');
  assert.equal(labelOne.font, 'bold 11px sans-serif');
  close(labelOne.y, 195, 'label baseline');
  close(boxOne.y, 182, 'label box top');
  close(boxOne.h, 18, 'label box height');
  close(boxOne.w, 14 * 11 * 0.6 + 10, 'label box width = text + pad');
  close(boxOne.x, 90 - (14 * 11 * 0.6) / 2 - 5, 'label box centred, padded');

  const half = draw({ id: 1, name: 'Farkhan' }, 0.5, 1);
  const labelHalf = half.find((call): call is Extract<Recorded, { t: 'fillText' }> => call.t === 'fillText');
  const boxHalf = half.find((call): call is Extract<Recorded, { t: 'fillRect' }> => call.t === 'fillRect');
  assert.ok(labelHalf && boxHalf);
  assert.equal(labelHalf.font, 'bold 5.5px sans-serif');
  close(labelHalf.y, 187.5, 'label baseline at 0.5');
  close(boxHalf.y, 181, 'label box top at 0.5');
  close(boxHalf.h, 9, 'label box height at 0.5');
  close(boxHalf.w, (14 * 5.5 * 0.6) + 5, 'label box width at 0.5');
  close(boxHalf.x, 90 - (14 * 5.5 * 0.6) / 2 - 2.5, 'label box centred at 0.5');
});

// ---------------------------------------------------------------------------
// Active ring scales
// ---------------------------------------------------------------------------

void test('the active ring scales its radii and stroke, and only the active actor gets one', () => {
  const one = draw({ id: 1, name: 'Farkhan' }, 1, 1);
  assert.deepEqual(one.find((call) => call.t === 'ellipse'), { t: 'ellipse', x: 90, y: 180, rx: 21, ry: 6 });
  assert.deepEqual(one.find((call) => call.t === 'stroke'), { t: 'stroke', lineWidth: 2 });

  const half = draw({ id: 1, name: 'Farkhan' }, 0.5, 1);
  assert.deepEqual(half.find((call) => call.t === 'ellipse'), { t: 'ellipse', x: 90, y: 180, rx: 10.5, ry: 3 });
  assert.deepEqual(half.find((call) => call.t === 'stroke'), { t: 'stroke', lineWidth: 1 });

  const inactive = draw({ id: 1, name: 'Farkhan' }, 1, null);
  assert.equal(inactive.some((call) => call.t === 'ellipse'), false, 'no ring for an inactive actor');
  assert.equal(inactive.some((call) => call.t === 'stroke'), false, 'no ring stroke for an inactive actor');
});

void test('the active ring is painted behind the avatar and before the nameplate', () => {
  const calls = draw({ id: 1, name: 'Farkhan' }, 1, 1);
  const ring = calls.findIndex((call) => call.t === 'ellipse');
  const sprite = calls.findIndex((call) => call.t === 'drawImage');
  const label = calls.findIndex((call) => call.t === 'fillRect');
  assert.ok(ring >= 0 && sprite >= 0 && label >= 0, 'the ring, avatar and nameplate are all painted');
  assert.ok(ring < sprite, 'the ring is painted behind the avatar');
  assert.ok(sprite < label, 'the avatar is painted before the nameplate');
});

// ---------------------------------------------------------------------------
// The desktop room frame keeps Farkhan at his CSS size
// ---------------------------------------------------------------------------

void test('the desktop room frame shrinks Farkhan to ~27 world px so he stays ~62 CSS px on a 1072-wide box', () => {
  const bilik = zoneById(officeMap, 'bilik-geng-kami')!;
  const { view } = resolveCamera(officeMap, { width: 1072, height: 700 }, 'desktop', zoneCentre(bilik));
  assert.equal(view.w, 467, 'the framed room is 467 world px wide');

  const scale = actorPresentationScale(view.w, 1072);
  const image = imageCall(draw({ id: 1, name: 'Farkhan' }, scale));
  assert.ok(Math.abs(image.dh - 27) < 0.05, `Farkhan is ~27 world px tall, got ${image.dh}`);
  const cssHeight = image.dh * (1072 / view.w);
  assert.ok(Math.abs(cssHeight - 62) < 0.2, `Farkhan stays ~62 CSS px, got ${cssHeight}`);
});
