// Zone-aware camera tests.
//
// The actor-follow viewport is right on the open floor but wrong inside a small
// enclosed room: a 680-wide crop of Bilik Geng Kami (386x185) cuts the room and
// drags in neighbouring work areas. `resolveCamera` frames the whole room with a
// 32-48px padding band and keeps the container aspect, while the open floor,
// corridors, lobby and mobile stay on the plain actor-follow view.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { officeMap, zoneById, type Rect } from '../lib/office-map.ts';
import { DESKTOP_WORLD_WIDTH, computeViewport } from '../lib/office-viewport.ts';
import { MAX_ZONE_VIEW_WIDTH, ZONE_PADDING, frameZoneView, resolveCamera, zoneCentre } from '../lib/office-camera.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DESKTOP_BOX = { width: 1440, height: 1000 };

const bilik = zoneById(officeMap, 'bilik-geng-kami')!;
const bilikSeats = officeMap.seats.filter((seat) => seat.zone === 'bilik-geng-kami');

function contains(outer: Rect, inner: Rect): boolean {
  return outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.w >= inner.x + inner.w && outer.y + outer.h >= inner.y + inner.h;
}

// ---------------------------------------------------------------------------
// frameZoneView
// ---------------------------------------------------------------------------

void test('frameZoneView contains the whole zone with 32-48px padding and the box aspect', () => {
  const view = frameZoneView(officeMap, bilik, DESKTOP_BOX);

  // Padding band around the zone: at least 32px on both axes, and the binding
  // axis (the one the container aspect constrains) stays at 48px or less. The
  // free axis can carry extra space because a landscape box cannot hug a 2:1
  // room on both axes without letterboxing.
  const padW = (view.w - bilik.rect.w) / 2;
  const padH = (view.h - bilik.rect.h) / 2;
  assert.ok(padW >= 32 && padH >= 32, `padding ${padW}x${padH} keeps at least 32px`);
  assert.ok(Math.min(padW, padH) <= 48, `the binding padding ${Math.min(padW, padH)} stays at 48px or less`);

  // Aspect matches the container tightly enough that no bars appear.
  const viewAspect = view.w / view.h;
  const boxAspect = DESKTOP_BOX.width / DESKTOP_BOX.height;
  assert.ok(Math.abs(viewAspect - boxAspect) <= 0.02 * Math.max(viewAspect, boxAspect), `aspect ${viewAspect} ~ ${boxAspect}`);
  assert.ok(view.w <= officeMap.width && view.h <= officeMap.height, 'view is clamped to the world');
});

void test('frameZoneView keeps the whole room visible at a 1440x1000 desktop box', () => {
  const view = frameZoneView(officeMap, bilik, DESKTOP_BOX);
  const camera = { x: zoneCentre(bilik).x - view.w / 2, y: zoneCentre(bilik).y - view.h / 2 };
  assert.ok(contains({ x: camera.x, y: camera.y, w: view.w, h: view.h }, bilik.rect), 'the room fits inside the crop');

  // The room is the subject, not a corner of a big open floor.
  assert.ok(bilik.rect.w / view.w >= 0.7, `room fills ${Math.round((bilik.rect.w / view.w) * 100)}% of the width`);
  assert.ok(view.w < DESKTOP_WORLD_WIDTH, 'the room view is closer than the open-floor view');
  assert.ok(view.w <= MAX_ZONE_VIEW_WIDTH, 'the fitted view stays inside the readable band');
});

// ---------------------------------------------------------------------------
// resolveCamera
// ---------------------------------------------------------------------------

void test('resolveCamera frames an enclosed room and shows every seat', () => {
  const resolution = resolveCamera(officeMap, DESKTOP_BOX, 'desktop', zoneCentre(bilik));
  assert.equal(resolution.zoneFocused, true);
  assert.equal(resolution.zone?.id, 'bilik-geng-kami');
  assert.deepEqual(resolution.view, frameZoneView(officeMap, bilik, DESKTOP_BOX), 'the page uses the shared zone fit');

  const crop: Rect = { x: resolution.camera.x, y: resolution.camera.y, w: resolution.view.w, h: resolution.view.h };
  assert.ok(contains(crop, bilik.rect), 'the whole Bilik room is in frame');
  assert.ok(bilikSeats.length >= 6, `expected the six Bilik seats, got ${bilikSeats.length}`);
  for (const seat of bilikSeats) {
    assert.ok(seat.x >= crop.x && seat.x <= crop.x + crop.w, `seat ${seat.id} x is visible`);
    assert.ok(seat.y >= crop.y && seat.y <= crop.y + crop.h, `seat ${seat.id} y is visible`);
  }
});

void test('resolveCamera keeps the normal actor-follow viewport on open floor, corridors and lobby', () => {
  const targets: Array<[string, { x: number; y: number }]> = [
    ['desk-collection', zoneCentre(zoneById(officeMap, 'desk-collection')!)],
    ['lorong-utama', zoneCentre(zoneById(officeMap, 'lorong-utama')!)],
    ['lobby-besar', zoneCentre(zoneById(officeMap, 'lobby-besar')!)],
    ['tele-cs-ca', zoneCentre(zoneById(officeMap, 'tele-cs-ca')!)],
  ];
  for (const [id, target] of targets) {
    const resolution = resolveCamera(officeMap, DESKTOP_BOX, 'desktop', target);
    assert.equal(resolution.zoneFocused, false, `${id} keeps the follow camera`);
    const expected = computeViewport(DESKTOP_BOX, 'desktop');
    assert.deepEqual(resolution.view, expected, `${id} uses the plain viewport`);
    assert.equal(resolution.view.w, DESKTOP_WORLD_WIDTH, `${id} stays 680 wide`);
  }
});

void test('resolveCamera centres the follow view on the actor and clamps to the world', () => {
  const centre = zoneCentre(zoneById(officeMap, 'desk-collection')!);
  const resolution = resolveCamera(officeMap, DESKTOP_BOX, 'desktop', centre);
  const expectedView = computeViewport(DESKTOP_BOX, 'desktop');
  const expectedX = Math.min(Math.max(centre.x - expectedView.w / 2, 0), officeMap.width - expectedView.w);
  assert.equal(resolution.camera.x, expectedX);

  const corner = resolveCamera(officeMap, DESKTOP_BOX, 'desktop', { x: 0, y: 0 });
  assert.deepEqual(corner.camera, { x: 0, y: 0 }, 'a corner target pins to the origin');
  const far = resolveCamera(officeMap, DESKTOP_BOX, 'desktop', { x: 1e6, y: 1e6 });
  assert.equal(far.camera.x + far.view.w, officeMap.width);
  assert.equal(far.camera.y + far.view.h, officeMap.height);
});

void test('mobile never zone-frames and stays letterbox-free and usable', () => {
  const phone = { width: 368, height: 603 };
  const resolution = resolveCamera(officeMap, phone, 'mobile', zoneCentre(bilik));
  assert.equal(resolution.zoneFocused, false, 'a portrait screen keeps the follow camera');
  const viewAspect = resolution.view.w / resolution.view.h;
  const boxAspect = phone.width / phone.height;
  assert.ok(Math.abs(viewAspect - boxAspect) <= 0.02 * Math.max(viewAspect, boxAspect), 'no letterboxing');
  assert.ok(resolution.view.h > resolution.view.w, 'mobile stays portrait');
});

void test('a degenerate container falls back to the default viewport', () => {
  for (const box of [{ width: 0, height: 0 }, { width: Number.NaN, height: 10 }]) {
    const resolution = resolveCamera(officeMap, box, 'desktop', zoneCentre(bilik));
    assert.equal(resolution.zoneFocused, false);
    assert.ok(resolution.view.w >= 1 && resolution.view.h >= 1);
  }
});

void test('ZONE_PADDING stays inside the requested 32-48px band', () => {
  assert.ok(ZONE_PADDING >= 32 && ZONE_PADDING <= 48, `padding ${ZONE_PADDING}`);
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

void test('the page and the preview generator share the zone-aware camera', () => {
  const page = readFileSync(resolve(ROOT, 'app', 'page.tsx'), 'utf8');
  assert.match(page, /from '\.\.\/lib\/office-camera'/, 'page imports the camera helper');
  assert.match(page, /resolveCamera\(/, 'page resolves the camera through the helper');

  const generator = readFileSync(resolve(ROOT, 'scripts', 'generate-map-preview.ts'), 'utf8');
  assert.match(generator, /from '\.\.\/lib\/office-camera\.ts'/, 'generator imports the camera helper');
  assert.match(generator, /resolveCamera\(|frameZoneView\(/, 'generator frames the crop through the helper');
});
