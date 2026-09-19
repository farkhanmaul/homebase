// Crisp actor / world rendering.
//
// Two independent clarity fixes are pinned here, both deterministic:
//
//   a) the canvas backing store is DPR-aware (`canvasBackingSize` sized to the
//      CSS box * clamped devicePixelRatio), so the browser blits the bitmap 1:1
//      to device pixels instead of upscaling a low-res canvas (the source of the
//      blurry actors), and `worldRenderScale` is the world->device factor applied
//      as one context transform;
//   b) `drawActors` keeps nearest-neighbour sampling while the DPR-aware backing
//      store supplies the additional device pixels. Feet and label geometry stay
//      anchored exactly as before.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_DEVICE_PIXEL_RATIO,
  actorPresentationScale,
  canvasBackingSize,
  clampDevicePixelRatio,
  drawActors,
  worldRenderScale,
  type RenderActor,
} from '../lib/office-renderer.ts';

const SHEET = { naturalWidth: 960, naturalHeight: 640 } as unknown as CanvasImageSource & {
  naturalWidth: number;
  naturalHeight: number;
};

type Event =
  | { t: 'smoothing'; value: boolean }

  | { t: 'drawImage'; dx: number; dy: number; dw: number; dh: number }
  | { t: 'fillRect'; x: number; y: number; w: number; h: number };

function clarityContext(): { ctx: CanvasRenderingContext2D; events: Event[] } {
  const events: Event[] = [];
  const state: { _smoothing: boolean; _quality: string } = { _smoothing: false, _quality: 'low' };
  const ctx = {
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    save() {},
    restore() {},
    translate() {},
    scale() {},
    drawImage(...args: unknown[]) {
      events.push({ t: 'drawImage', dx: args[5] as number, dy: args[6] as number, dw: args[7] as number, dh: args[8] as number });
    },
    fillRect(x: number, y: number, w: number, h: number) {
      events.push({ t: 'fillRect', x, y, w, h });
    },
    fillText() {},
    beginPath() {},
    ellipse() {},
    stroke() {},
    measureText(text: string) {
      return { width: text.length * 6 };
    },
    get imageSmoothingEnabled() {
      return state._smoothing;
    },
    set imageSmoothingEnabled(value: boolean) {
      state._smoothing = value;
      events.push({ t: 'smoothing', value });
    },
    get imageSmoothingQuality() {
      return state._quality;
    },
    set imageSmoothingQuality(value: string) { state._quality = value; },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, events };
}

function actor(overrides: Partial<RenderActor> = {}): RenderActor {
  return { id: 3, name: 'Budi', sprite: 0, x: 100, y: 200, direction: 'right', walking: false, sitting: false, online: true, ...overrides };
}

// ---------------------------------------------------------------------------
// (a) DPR-aware backing store + world render scale
// ---------------------------------------------------------------------------

void test('clampDevicePixelRatio keeps the ratio inside [1, MAX] and rejects junk', () => {
  assert.equal(MAX_DEVICE_PIXEL_RATIO, 3);
  assert.equal(clampDevicePixelRatio(1), 1);
  assert.equal(clampDevicePixelRatio(2), 2);
  assert.equal(clampDevicePixelRatio(2.625), 2.625);
  assert.equal(clampDevicePixelRatio(0.5), 1, 'a sub-1 ratio is raised to 1');
  assert.equal(clampDevicePixelRatio(0), 1);
  assert.equal(clampDevicePixelRatio(-4), 1);
  assert.equal(clampDevicePixelRatio(Number.NaN), 1);
  assert.equal(clampDevicePixelRatio(Number.POSITIVE_INFINITY), 1);
  assert.equal(clampDevicePixelRatio(8), 3, 'an extreme ratio is capped');
});

void test('canvasBackingSize matches the CSS box in device px so the browser never rescales', () => {
  const view = { w: 680, h: 444 };
  assert.deepEqual(canvasBackingSize(view, { width: 1072, height: 700 }, 2), { w: 2144, h: 1400 });
  assert.deepEqual(canvasBackingSize(view, { width: 1072, height: 700 }, 1), { w: 1072, h: 700 });
  assert.deepEqual(canvasBackingSize(view, { width: 1440, height: 1000 }, 1.5), { w: 2160, h: 1500 });
  // An unmeasured box falls back to the camera view at the DPR ratio.
  assert.deepEqual(canvasBackingSize(view, { width: 0, height: 0 }, 2), { w: 1360, h: 888 });
  assert.deepEqual(canvasBackingSize(view, { width: Number.NaN, height: 10 }, 1), { w: 680, h: 444 });
  // Never a zero-sized bitmap.
  assert.deepEqual(canvasBackingSize({ w: 1, h: 1 }, { width: 0.1, height: 0.1 }, 1), { w: 1, h: 1 });
});

void test('worldRenderScale is the world->device factor of the backing store', () => {
  assert.equal(worldRenderScale({ w: 680, h: 444 }, { w: 1360, h: 888 }), 2);
  assert.equal(worldRenderScale({ w: 680, h: 444 }, { w: 680, h: 444 }), 1);
  assert.equal(worldRenderScale({ w: 0, h: 0 }, { w: 100, h: 100 }), 1, 'degenerate views fall back to 1');
  assert.equal(worldRenderScale({ w: 680, h: 444 }, { w: 0, h: 0 }), 1, 'degenerate backing falls back to 1');
});

void test('the presentation scale is DPR-independent and the backing store carries the extra device pixels', () => {
  const view = { w: 467, h: 311 };
  const box = { width: 1072, height: 714 };
  // The actor keeps its CSS size: world px per CSS px never sees the DPR.
  const cssScale = actorPresentationScale(view.w, box.width);
  assert.equal(cssScale, view.w / box.width, 'world size per CSS px is unchanged');

  // DPR 2 doubles the backing store, and the world transform doubles with it, so
  // the same world-sized sprite is stamped with twice the device detail.
  const render1 = worldRenderScale(view, canvasBackingSize(view, box, 1));
  const render2 = worldRenderScale(view, canvasBackingSize(view, box, 2));
  assert.ok(Math.abs(render2 / render1 - 2) < 1e-9, 'DPR 2 doubles the device render scale');
});

// ---------------------------------------------------------------------------
// (b) Nearest-neighbour sprite + anchored feet
// ---------------------------------------------------------------------------

void test('drawActors keeps nearest-neighbour sampling for the sprite', () => {
  const { ctx, events } = clarityContext();
  drawActors(ctx, [actor()], { camera: { x: 0, y: 0 }, activeId: null, sheet: SHEET, now: 0, reducedMotion: false, scale: 1 });

  const smoothing = events.find((event): event is Extract<Event, { t: 'smoothing' }> => event.t === 'smoothing');
  const image = events.findIndex((event) => event.t === 'drawImage');
  assert.deepEqual(smoothing, { t: 'smoothing', value: false }, 'the sprite is drawn without interpolation');
  assert.ok(events.indexOf(smoothing!) < image, 'nearest-neighbour mode is set before the sprite');
  assert.equal(ctx.imageSmoothingEnabled, false, 'the pixel-art rule remains active afterwards');
});

void test('the feet and label geometry are unchanged by the smoothing rule', () => {
  const { ctx, events } = clarityContext();
  drawActors(ctx, [actor({ id: 1, name: 'Farkhan' })], { camera: { x: 10, y: 20 }, activeId: null, sheet: SHEET, now: 0, reducedMotion: false, scale: 1 });
  const image = events.find((event): event is Extract<Event, { t: 'drawImage' }> => event.t === 'drawImage')!;
  // World (100, 200) paints at canvas (90, 180); feet anchor bottom-centre.
  assert.ok(Math.abs(image.dx + image.dw / 2 - 90) < 1e-9, 'spans world x');
  assert.ok(Math.abs(image.dy + image.dh - 180) < 1e-9, 'feet sit on world y');
  const label = events.find((event): event is Extract<Event, { t: 'fillRect' }> => event.t === 'fillRect')!;
  assert.equal(label.y, 182, 'the nameplate offset is untouched');
});
