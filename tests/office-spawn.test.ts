// Pure spawn/reset + availability-merge policy tests (Builder Phase 1).
//
// These pin the fix for the production spawn bug: an INACTIVE availability row
// (Farkhan at db 139,211 while seat-1 is 1542.5,88.75) must never move a player
// off its manifest seat, and a claim must always start the local player on its
// assigned seat regardless of whatever coordinates the server last reported.
//
// Everything here is pure, so it runs on the stock Node type-stripping toolchain
// with no DOM or React. The final test is a small wiring guard: the page has no
// DOM test harness, so it asserts app/page.tsx actually calls the helpers it is
// supposed to (enter, sync, the dialog button and the R shortcut).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isWalkable, officeMap, seatFor, type Direction } from '../lib/office-map.ts';
import { applyAvailability, resetActorToSeat, seatSpawnFor, type AvailabilityRow } from '../lib/office-spawn.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

type Actor = {
  id: number;
  name: string;
  x: number;
  y: number;
  direction: Direction;
  status: string;
  online: boolean;
  sitting: boolean;
  walking: boolean;
};

function actor(id: number, x: number, y: number, direction: Direction, overrides: Partial<Actor> = {}): Actor {
  return { id, name: `P${id}`, x, y, direction, status: 'Available', online: false, sitting: false, walking: false, ...overrides };
}

// Brace-matched extraction of `function <name>(...) { ... }` so the wiring
// guards below survive whitespace/formatting changes instead of pinning a
// brittle literal snippet of app/page.tsx.
function functionBody(source: string, name: string): string {
  const signature = source.indexOf(`function ${name}(`);
  assert.notEqual(signature, -1, `page defines ${name}()`);
  const open = source.indexOf('{', signature);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated ${name}()`);
}

// ---------------------------------------------------------------------------
// Seat reset helper
// ---------------------------------------------------------------------------

void test('seatSpawnFor targets every manifest seat exactly and each target is walkable', () => {
  assert.equal(officeMap.seats.length, 6, 'the six existing seats are unchanged');
  for (const seat of officeMap.seats) {
    const spawn = seatSpawnFor(officeMap, seat.cid);
    assert.ok(spawn, `spawn for cid ${seat.cid}`);
    assert.equal(spawn.seatId, seat.id);
    assert.equal(spawn.x, seat.x);
    assert.equal(spawn.y, seat.y);
    assert.equal(spawn.direction, seat.direction);
    assert.equal(isWalkable(officeMap, spawn.x, spawn.y), true, `${seat.id} reset target is walkable`);
  }
  assert.equal(seatSpawnFor(officeMap, 99), null, 'an unknown cid has no seat');
});

void test('resetActorToSeat returns a fresh actor on its seat with sitting/walking cleared', () => {
  const seat = seatFor(officeMap, 3)!;
  const stale = actor(3, 139, 211, 'down', { sitting: true, walking: true });

  const reset = resetActorToSeat(stale, officeMap, 3);

  assert.notEqual(reset, stale, 'the reset is a new object, not a mutation');
  assert.equal(reset.x, seat.x);
  assert.equal(reset.y, seat.y);
  assert.equal(reset.direction, seat.direction);
  assert.equal(reset.sitting, false);
  assert.equal(reset.walking, false);
  assert.equal(stale.x, 139, 'the input actor is untouched');
  assert.equal(stale.sitting, true, 'the input actor is untouched');
});

void test('an own claim resets to the manifest seat regardless of prior availability coordinates', () => {
  const seat = seatFor(officeMap, 1)!;
  const stale = actor(1, 139, 211, 'up', { sitting: true, walking: true });

  const reset = resetActorToSeat(stale, officeMap, 1);

  assert.deepEqual([reset.x, reset.y, reset.direction], [seat.x, seat.y, seat.direction]);
  assert.equal(reset.sitting, false);
  assert.equal(reset.walking, false);
});

// ---------------------------------------------------------------------------
// Availability merge policy
// ---------------------------------------------------------------------------

void test('the production repro: an inactive backend row cannot move Farkhan off seat-1', () => {
  const seat = seatFor(officeMap, 1)!;
  const players = [actor(1, seat.x, seat.y, seat.direction)];
  const rows: AvailabilityRow[] = [{ id: 1, active: false, x: 139, y: 211, direction: 'down', status: 'Available' }];

  const [after] = applyAvailability(players, rows, null);

  assert.equal(after.x, seat.x, 'inactive row must not overwrite x');
  assert.equal(after.y, seat.y, 'inactive row must not overwrite y');
  assert.equal(after.online, false, 'presence still reflects the inactive row');
});

void test('an inactive remote keeps its manifest seat even while another character is active', () => {
  const seat = seatFor(officeMap, 2)!;
  const players = [actor(2, seat.x, seat.y, seat.direction)];
  const rows: AvailabilityRow[] = [{ id: 2, active: false, x: 5, y: 6, direction: 'left', status: 'Pulang' }];

  const [after] = applyAvailability(players, rows, 1);

  assert.equal(after.x, seat.x);
  assert.equal(after.y, seat.y);
  assert.equal(after.status, 'Available', 'an inactive row cannot overwrite local state');
});

void test('an active remote adopts backend movement, direction and status', () => {
  const seat = seatFor(officeMap, 2)!;
  const players = [actor(2, seat.x, seat.y, seat.direction)];
  const rows: AvailabilityRow[] = [{ id: 2, active: true, x: 700, y: 300, direction: 'left', status: 'Meeting' }];

  const [after] = applyAvailability(players, rows, 1);

  assert.equal(after.x, 700);
  assert.equal(after.y, 300);
  assert.equal(after.direction, 'left');
  assert.equal(after.status, 'Meeting');
  assert.equal(after.online, true);
});

void test('the local active player keeps its own movement while presence still syncs', () => {
  const players = [actor(1, 500, 500, 'right')];
  const rows: AvailabilityRow[] = [{ id: 1, active: true, x: 139, y: 211, direction: 'down', status: 'Pulang' }];

  const [after] = applyAvailability(players, rows, 1);

  assert.equal(after.x, 500, 'local movement is never overwritten');
  assert.equal(after.y, 500);
  assert.equal(after.direction, 'right');
  assert.equal(after.status, 'Available');
  assert.equal(after.online, true);
});

void test('non-finite backend coordinates are ignored for an active remote', () => {
  const players = [actor(2, 1621.25, 88.75, 'down')];
  const rows: AvailabilityRow[] = [{ id: 2, active: true, x: Number.NaN, y: 88.75, status: 'Available' }];

  const [after] = applyAvailability(players, rows, 1);

  assert.equal(after.x, 1621.25, 'a NaN x cannot wipe the position');
  assert.equal(after.y, 88.75);
});

void test('applyAvailability ignores unknown ids and never mutates its input', () => {
  const players = [actor(1, 1, 2, 'up')];
  const before = structuredClone(players);

  const after = applyAvailability(players, [{ id: 99, active: true, x: 5, y: 5 }], null);

  assert.deepEqual(players, before, 'the input array is untouched');
  assert.equal(after.length, 1);
  assert.deepEqual(after[0], players[0]);
});

// ---------------------------------------------------------------------------
// Page wiring guard (no DOM harness: assert the helpers are actually used)
// ---------------------------------------------------------------------------

void test('page wires the spawn helpers into sync, enter/reset and the R shortcut', () => {
  const page = readFileSync(resolve(ROOT, 'app', 'page.tsx'), 'utf8');

  assert.match(page, /from '\.\.\/lib\/office-spawn'/, 'imports lib/office-spawn');
  assert.match(page, /applyAvailability\(/, 'sync uses the availability merge policy');
  assert.match(page, /resetActorToSeat\(/, 'enter/reset use the seat reset helper');
  assert.match(page, />Reset posisi</, 'the profile dialog exposes the Reset posisi button');
  assert.match(page, /key === 'r'/, 'the R shortcut is wired');
  const shared = page.match(/resetPosition\(\)/g) ?? [];
  assert.ok(shared.length >= 2, 'the button and the R shortcut share resetPosition');
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

void test('resetPosition persists the reset actor immediately via heartbeat without replaying the claim', () => {
  const page = readFileSync(resolve(ROOT, 'app', 'page.tsx'), 'utf8');
  const body = functionBody(page, 'resetPosition');

  // The local reset lands first: the active actor is placed on its manifest seat.
  const resetAt = body.indexOf('resetActorToSeat(');
  assert.notEqual(resetAt, -1, 'resetPosition places the local actor on its manifest seat');

  // The local UI state is kept no matter what the network does, so it is set
  // before the heartbeat is attempted.
  const hintAt = body.search(/\bsetHint\s*\(/);
  const heartbeatAt = body.search(/\bheartbeat\s*\(/);
  assert.notEqual(heartbeatAt, -1, 'resetPosition immediately heartbeats the reset position');
  assert.ok(hintAt !== -1 && hintAt < heartbeatAt, 'the local reset state is kept before the heartbeat');

  // The heartbeat is API-only, and the reset must precede it.
  const apiGuardAt = body.indexOf('.api');
  assert.notEqual(apiGuardAt, -1, 'the heartbeat is guarded by the API-backed session');
  assert.ok(resetAt < apiGuardAt && apiGuardAt < heartbeatAt, 'reset -> api guard -> heartbeat, in that order');

  // It sends the exact reset actor: x, y, direction and the current status,
  // whether read back through an alias or referenced inline.
  const readBack = body.match(/const\s+([A-Za-z_$][\w$]*)\s*=\s*players\.current\[id\s*-\s*1\][;\s]/);
  const actorExpr = readBack ? readBack[1] : 'players.current[id - 1]';
  if (readBack) assert.ok((readBack.index ?? 0) > resetAt, 'the read-back follows the reset');

  const call = body.match(/heartbeat\s*\(\s*\{([^}]*)\}/);
  assert.ok(call, 'heartbeat is called with a position object');
  if (readBack) assert.ok((call.index ?? 0) > (readBack.index ?? 0), 'heartbeat consumes the post-reset actor');
  for (const field of ['x', 'y', 'direction', 'status']) {
    assert.match(
      call[1],
      new RegExp(`${escapeRegExp(field)}\\s*:\\s*${escapeRegExp(actorExpr)}\\.${escapeRegExp(field)}\\b`),
      `heartbeat sends the reset actor's ${field}`,
    );
  }

  // A failed heartbeat is nonfatal: local state stands, the 2s sync retries, and
  // the reset path never throws or replays the claim.
  assert.match(body.slice(heartbeatAt), /catch\s*\(/, 'a failed heartbeat is caught');
  assert.doesNotMatch(body, /\bthrow\b/, 'the reset path never throws');
  assert.doesNotMatch(body, /\bclaim\s*\(/, 'the reset path never replays the claim');
});
