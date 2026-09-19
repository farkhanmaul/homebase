// Pure pointer-mapping tests.
//
// These pin the pointer half of app/page.tsx's delegation: mapping a pointer
// event back into world coordinates through the letterboxed canvas and camera,
// and hit-testing avatars. The hotspot interaction state machine is covered in
// tests/office-interactions.test.ts. None of this touches the DOM, so it runs on
// the stock Node type-stripping toolchain.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PLAYER_HIT, playerAtPoint, screenToWorld } from '../lib/office-interaction.ts';

const near = (a: number, b: number): void => assert.ok(Math.abs(a - b) < 1e-6, `${a} !~ ${b}`);

void test('screenToWorld is the identity when the canvas is drawn 1:1', () => {
  const rect = { left: 0, top: 0, width: 960, height: 540 };
  const canvas = { width: 960, height: 540 };
  const point = screenToWorld({ x: 120, y: 90 }, rect, canvas, { x: 0, y: 0 });
  near(point.x, 120);
  near(point.y, 90);
});

void test('screenToWorld accounts for horizontal letterboxing and the camera', () => {
  // 1440x540 box for a 960x540 canvas => scale 1, 240px bars on each side.
  const rect = { left: 0, top: 0, width: 1440, height: 540 };
  const canvas = { width: 960, height: 540 };

  const topLeft = screenToWorld({ x: 240, y: 0 }, rect, canvas, { x: 0, y: 0 });
  near(topLeft.x, 0);
  near(topLeft.y, 0);

  const bottomRight = screenToWorld({ x: 1200, y: 540 }, rect, canvas, { x: 0, y: 0 });
  near(bottomRight.x, 960);
  near(bottomRight.y, 540);

  const withCamera = screenToWorld({ x: 250, y: 10 }, rect, canvas, { x: 300, y: 200 });
  near(withCamera.x, 310);
  near(withCamera.y, 210);
});

void test('screenToWorld handles a scaled, letterboxed box like the responsive layout', () => {
  // 1400x675 inside a 960x540 canvas: scale 1.25, 100px bars on each side.
  const rect = { left: 0, top: 0, width: 1400, height: 675 };
  const canvas = { width: 960, height: 540 };
  const origin = screenToWorld({ x: 100, y: 0 }, rect, canvas, { x: 0, y: 0 });
  near(origin.x, 0);
  near(origin.y, 0);
  const corner = screenToWorld({ x: 1300, y: 675 }, rect, canvas, { x: 0, y: 0 });
  near(corner.x, 960);
  near(corner.y, 540);
});

void test('playerAtPoint hit-tests online avatars using the body box', () => {
  const actors = [
    { id: 1, x: 100, y: 100, online: true },
    { id: 2, x: 500, y: 400, online: false },
  ];
  assert.equal(playerAtPoint(actors, { x: 100, y: 90 }), 1, 'centre of the body box hits');
  assert.equal(playerAtPoint(actors, { x: 100, y: 100 - PLAYER_HIT.up + 5 }), 1, 'upper body hits');
  assert.equal(playerAtPoint(actors, { x: 100, y: 100 - PLAYER_HIT.up - 5 }), null, 'above the head misses');
  assert.equal(playerAtPoint(actors, { x: 100 + PLAYER_HIT.halfWidth + 5, y: 100 }), null, 'beside the body misses');
  assert.equal(playerAtPoint(actors, { x: 500, y: 400 }), null, 'offline avatars are not selectable');
});
