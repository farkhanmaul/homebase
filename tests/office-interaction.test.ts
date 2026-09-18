// Pure interaction + pointer-mapping tests (slice B).
//
// These pin the behavior `app/page.tsx` now delegates: mapping a pointer event
// back into world coordinates through the letterboxed canvas and camera, hit
// testing avatars, and resolving a data-driven hotspot into a concrete outcome.
// None of this touches the DOM, so it runs on the stock Node toolchain.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_HOTSPOT_RANGE, officeMap, seatFor } from '../lib/office-map.ts';
import { PLAYER_HIT, playerAtPoint, resolveInteraction, screenToWorld } from '../lib/office-interaction.ts';

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

void test('resolveInteraction sits only on the assigned seat and toggles standing', () => {
  const seat = seatFor(officeMap, 3)!;
  const sit = resolveInteraction(officeMap, { cid: 3, x: seat.x, y: seat.y, sitting: false });
  assert.equal(sit.kind, 'sit');
  if (sit.kind === 'sit') {
    assert.equal(sit.seatId, seat.id);
    assert.equal(sit.x, seat.x);
    assert.equal(sit.y, seat.y);
    assert.equal(sit.direction, seat.direction);
  }

  const stand = resolveInteraction(officeMap, { cid: 3, x: seat.x, y: seat.y, sitting: true });
  assert.equal(stand.kind, 'stand');
});

void test('resolveInteraction refuses to sit a character on someone else seat', () => {
  const other = seatFor(officeMap, 2)!;
  const outcome = resolveInteraction(officeMap, { cid: 5, x: other.x, y: other.y, sitting: false });
  assert.notEqual(outcome.kind, 'sit');
  assert.equal(outcome.kind, 'message');
  assert.match(outcome.hint, /bukan kursimu/i);
});

void test('resolveInteraction reports the manifest message for every non-seat hotspot', () => {
  const cases: Array<[string, string]> = [
    ['lift', 'Lift/transisi belum aktif di preview.'],
    ['gudang', 'Gudang terkunci.'],
    ['fridge', 'Kulkas: ambil minum dingin.'],
    ['server', 'Ruang server terbatas. Hanya tim IT.'],
    ['reception', 'Resepsionis: selamat datang di kantor.'],
    ['board', 'Papan Best Agent Performance.'],
    ['certificate-table', 'Meja sertifikat.'],
  ];
  for (const [kind, message] of cases) {
    const hotspot = officeMap.hotspots.find((entry) => entry.kind === kind)!;
    const point = { x: hotspot.rect.x + hotspot.rect.w / 2, y: hotspot.rect.y + hotspot.rect.h / 2 };
    const outcome = resolveInteraction(officeMap, { cid: 1, ...point, sitting: false });
    assert.equal(outcome.kind, 'message', `${kind} is a message`);
    assert.equal(outcome.hint, message, `${kind} uses its manifest message`);
  }

  // No Meeting-2 screen was invented: the board is the distinct `board` kind.
  assert.equal(officeMap.hotspots.filter((entry) => entry.kind === 'screen').length, 0, 'no screen hotspot');
  const dispensers = officeMap.hotspots.filter((entry) => entry.kind === 'dispenser');
  assert.equal(dispensers.length, 4, 'pantry + HR/IT/Finance dispensers');
  for (const hotspot of dispensers) {
    const outcome = resolveInteraction(officeMap, {
      cid: 1,
      x: hotspot.rect.x + hotspot.rect.w / 2,
      y: hotspot.rect.y + hotspot.rect.h / 2,
      sitting: false,
    });
    assert.equal(outcome.kind, 'message', hotspot.id);
    assert.equal(outcome.hint, hotspot.message, hotspot.id);
  }
});

void test('resolveInteraction only sets Pulang at the exit hotspot', () => {
  const exit = officeMap.hotspots.find((entry) => entry.kind === 'exit')!;
  const outcome = resolveInteraction(officeMap, {
    cid: 1,
    x: exit.rect.x + exit.rect.w / 2,
    y: exit.rect.y + exit.rect.h / 2,
    sitting: false,
  });
  assert.equal(outcome.kind, 'status-pulang');

  const reception = officeMap.hotspots.find((entry) => entry.kind === 'reception')!;
  const info = resolveInteraction(officeMap, {
    cid: 1,
    x: reception.rect.x + reception.rect.w / 2,
    y: reception.rect.y + reception.rect.h / 2,
    sitting: false,
  });
  assert.notEqual(info.kind, 'status-pulang');
});

void test('resolveInteraction is quiet when nothing is in range', () => {
  // Middle of Desk Collection: no hotspot is within the interaction range.
  const outcome = resolveInteraction(officeMap, { cid: 1, x: 1150, y: 700, sitting: false });
  assert.equal(outcome.kind, 'none');
  assert.ok(outcome.hint.length > 0);
});

void test('resolveInteraction honours the hotspot range option', () => {
  const lift = officeMap.hotspots.find((entry) => entry.kind === 'lift')!;
  const near = { x: lift.rect.x + lift.rect.w / 2, y: lift.rect.y - DEFAULT_HOTSPOT_RANGE - 30 };
  assert.equal(resolveInteraction(officeMap, { cid: 1, ...near, sitting: false }, { range: 24 }).kind, 'none');
});
