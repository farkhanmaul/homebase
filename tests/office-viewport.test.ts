// Pure viewport tests (letterboxing fix).
//
// The canvas is sized in world units but laid out by CSS at 100% x 100%. If the
// backing ratio does not match the container's CSS box, `object-fit: contain`
// letterboxes it (the browser smoke test showed a 368x602 mobile box drawing a
// 560x360 bitmap, so the map used only ~236px of height). `computeViewport`
// derives the camera view from the real box aspect while keeping a controlled
// world scale, and always returns a positive view inside the 1920x960 world.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { officeMap } from '../lib/office-map.ts';
import { DESKTOP_WORLD_WIDTH, MOBILE_WORLD_HEIGHT, computeViewport, defaultViewport, type ViewportBox } from '../lib/office-viewport.ts';

const aspect = (view: { w: number; h: number }): number => view.w / view.h;

const closeTo = (actual: number, expected: number, tolerance = 0.02): void => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance * Math.max(Math.abs(actual), Math.abs(expected)),
    `${actual} is not within ${tolerance * 100}% of ${expected}`,
  );
};

void test('desktop viewport follows the container aspect around a 960-wide world view', () => {
  const box: ViewportBox = { width: 1072, height: 778 };
  const view = computeViewport(box, 'desktop');

  closeTo(view.w, DESKTOP_WORLD_WIDTH, 0.05);
  closeTo(aspect(view), box.width / box.height, 0.02);
  assert.ok(view.h > 400 && view.h < officeMap.height, `height ${view.h} is a sensible desktop crop`);
  assert.ok(view.w > 0 && view.h > 0);
  assert.ok(view.w <= officeMap.width && view.h <= officeMap.height);
});

void test('mobile viewport follows the container aspect around a 600-tall world view', () => {
  const box: ViewportBox = { width: 368, height: 603 };
  const view = computeViewport(box, 'mobile');

  closeTo(view.h, MOBILE_WORLD_HEIGHT, 0.05);
  closeTo(aspect(view), box.width / box.height, 0.02);
  assert.ok(view.w > 200 && view.w < 600, `width ${view.w} is a sensible mobile crop`);
  assert.ok(view.w > 0 && view.h > 0);
  assert.ok(view.w <= officeMap.width && view.h <= officeMap.height);
});

void test('the no-letterbox invariant holds across representative boxes', () => {
  const boxes: ViewportBox[] = [
    { width: 1072, height: 778 }, // desktop smoke box
    { width: 1440, height: 700 },
    { width: 1920, height: 1080 },
    { width: 368, height: 603 }, // mobile smoke box
    { width: 414, height: 720 },
    { width: 320, height: 480 },
    { width: 1920, height: 960 }, // world aspect
  ];
  for (const box of boxes) {
    for (const mode of ['desktop', 'mobile'] as const) {
      const view = computeViewport(box, mode);
      const viewAspect = aspect(view);
      const boxAspect = box.width / box.height;
      // Integer backing sizes cannot match a fractional aspect exactly; 2% is far
      // tighter than the bars the browser smoke test showed.
      assert.ok(
        Math.abs(viewAspect - boxAspect) <= 0.02 * Math.max(viewAspect, boxAspect),
        `${mode} ${box.width}x${box.height} -> ${view.w}x${view.h} (aspect ${viewAspect} vs ${boxAspect})`,
      );
    }
  }
});

void test('every viewport is positive and inside the 1920x960 world', () => {
  const boxes: ViewportBox[] = [
    { width: 5000, height: 100 },
    { width: 100, height: 5000 },
    { width: 1, height: 1 },
    { width: 1920, height: 960 },
    { width: 4000, height: 2000 },
  ];
  for (const box of boxes) {
    for (const mode of ['desktop', 'mobile'] as const) {
      const view = computeViewport(box, mode);
      assert.ok(Number.isFinite(view.w) && Number.isFinite(view.h), `${mode} view is finite`);
      assert.ok(view.w >= 1 && view.h >= 1, `${mode} ${box.width}x${box.height} -> ${view.w}x${view.h} is positive`);
      assert.ok(view.w <= officeMap.width && view.h <= officeMap.height, `${mode} view stays inside the world`);
    }
  }
});

void test('a degenerate box falls back to a sane viewport instead of a zero-sized canvas', () => {
  const bad: ViewportBox[] = [
    { width: 0, height: 0 },
    { width: 0, height: 603 },
    { width: 368, height: 0 },
    { width: -5, height: 100 },
    { width: Number.NaN, height: Number.NaN },
  ];
  for (const box of bad) {
    for (const mode of ['desktop', 'mobile'] as const) {
      const view = computeViewport(box, mode);
      assert.ok(view.w >= 1 && view.h >= 1, `${mode} fallback is positive`);
      assert.ok(view.w <= officeMap.width && view.h <= officeMap.height, `${mode} fallback is inside the world`);
      assert.deepEqual(view, defaultViewport(mode));
    }
  }
});

void test('defaultViewport is valid for both modes', () => {
  for (const mode of ['desktop', 'mobile'] as const) {
    const view = defaultViewport(mode);
    assert.ok(view.w >= 1 && view.h >= 1);
    assert.ok(view.w <= officeMap.width && view.h <= officeMap.height);
  }
  closeTo(aspect(defaultViewport('desktop')), 16 / 9, 0.05);
  assert.ok(defaultViewport('mobile').h > defaultViewport('mobile').w, 'the mobile default is portrait');
});
