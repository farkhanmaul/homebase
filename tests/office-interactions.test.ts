// Pure office-interaction state machine tests.
//
// These pin the deterministic rules app/page.tsx now delegates: a fixed
// proximity/priority resolution from the actor's surroundings to ONE contextual
// action, and the state transitions that action causes (sit/stand, held drink,
// open fridge, open/closed doors). Like the pointer helpers, all of it is pure,
// so it runs on the stock Node type-stripping toolchain with no DOM or React.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_HOTSPOT_RANGE, isBlocked, officeMap, seatFor, type OfficeManifest } from '../lib/office-map.ts';
import {
  INITIAL_INTERACTION_STATE,
  applyInteraction,
  closedDoorRects,
  describeInteraction,
  interactionVisuals,
  isBlockedWithDoors,
  standOnMove,
  type InteractionState,
} from '../lib/office-interactions.ts';

const centre = (rect: { x: number; y: number; w: number; h: number }): { x: number; y: number } => ({
  x: rect.x + rect.w / 2,
  y: rect.y + rect.h / 2,
});

// A minimal manifest for the priority scenarios: the resolver only reads the
// actor footprint, seats, hotspots and openings, so a tiny synthetic world pins
// the ordering without depending on the real map's coordinates.
function miniManifest(overrides: Partial<OfficeManifest> = {}): OfficeManifest {
  return {
    id: 'mini',
    name: 'Mini Office',
    width: 400,
    height: 400,
    margin: 0,
    wallThickness: 4,
    partitionThickness: 2,
    actor: { halfWidth: 9, feet: 12 },
    spawn: { x: 200, y: 200, direction: 'down' },
    seats: [],
    zones: [],
    walls: [],
    columns: [],
    blocks: [],
    furniture: [],
    openings: [],
    windows: [],
    surfaces: [],
    hotspots: [],
    ...overrides,
  } as OfficeManifest;
}

const dispenserHotspot = {
  id: 'hs-dispenser',
  kind: 'dispenser',
  name: 'Dispenser',
  zone: 'z',
  action: 'message',
  message: 'Dispenser: isi air minum.',
  rect: { x: 100, y: 100, w: 20, h: 20 },
} as const;

// ---------------------------------------------------------------------------
// Seat: explicit sit/stand, feet-anchored, only your own chair
// ---------------------------------------------------------------------------

void test('an own nearby seat toggles an explicit, feet-anchored sit/stand', () => {
  const seat = seatFor(officeMap, 3)!;

  const sit = applyInteraction(officeMap, INITIAL_INTERACTION_STATE, { cid: 3, x: seat.x, y: seat.y });
  assert.equal(sit.result.action, 'sit');
  assert.deepEqual(sit.result.seat, { seatId: seat.id, x: seat.x, y: seat.y, direction: seat.direction }, 'the actor lands exactly on the seat (feet anchor)');
  assert.equal(sit.state.sitting, true);
  assert.equal(sit.state.seatId, seat.id);

  const stand = applyInteraction(officeMap, sit.state, { cid: 3, x: seat.x, y: seat.y });
  assert.equal(stand.result.action, 'stand');
  assert.equal(stand.state.sitting, false);
  assert.equal(stand.state.seatId, null);
});

void test('another character nearby seat is refused, never sat on', () => {
  const other = seatFor(officeMap, 1)!;
  const outcome = applyInteraction(officeMap, INITIAL_INTERACTION_STATE, { cid: 3, x: other.x, y: other.y });
  assert.equal(outcome.result.action, 'message');
  assert.match(outcome.result.hint, /bukan kursimu/i);
  assert.equal(outcome.state.sitting, false);
});

void test('movement stands the actor and clears the seat anchor', () => {
  const seated: InteractionState = { ...INITIAL_INTERACTION_STATE, sitting: true, seatId: seatFor(officeMap, 3)!.id };
  const before: InteractionState = structuredClone(seated);

  const moved = standOnMove(seated);

  assert.notEqual(moved, seated, 'a new state object, not a mutation');
  assert.deepEqual(seated, before, 'the input state is untouched');
  assert.equal(moved.sitting, false);
  assert.equal(moved.seatId, null);

  // After standing, the same spot sits again from a clean state.
  const seat = seatFor(officeMap, 3)!;
  assert.equal(applyInteraction(officeMap, moved, { cid: 3, x: seat.x, y: seat.y }).result.action, 'sit');
});

// ---------------------------------------------------------------------------
// Held drink: dispenser + (open) fridge
// ---------------------------------------------------------------------------

void test('a dispenser pours one drink and then reports the held cup', () => {
  const dispenser = officeMap.hotspots.find((entry) => entry.kind === 'dispenser')!;
  const point = centre(dispenser.rect);

  const first = applyInteraction(officeMap, INITIAL_INTERACTION_STATE, { cid: 1, ...point });
  assert.equal(first.result.action, 'drink');
  assert.equal(first.state.holdingDrink, true, 'the held-drink state is set');

  const second = applyInteraction(officeMap, first.state, { cid: 1, ...point });
  assert.equal(second.result.action, 'message');
  assert.match(second.result.hint, /minuman/i);
  assert.equal(second.state.holdingDrink, true);
});

void test('the fridge opens, dispenses a drink, then closes with visible state', () => {
  const fridge = officeMap.hotspots.find((entry) => entry.kind === 'fridge')!;
  const point = centre(fridge.rect);

  const open = applyInteraction(officeMap, INITIAL_INTERACTION_STATE, { cid: 1, ...point });
  assert.equal(open.result.action, 'open-fridge');
  assert.deepEqual(open.state.openFridgeIds, [fridge.id], 'the fridge is visibly open');

  const drink = applyInteraction(officeMap, open.state, { cid: 1, ...point });
  assert.equal(drink.result.action, 'drink');
  assert.equal(drink.state.holdingDrink, true);
  assert.deepEqual(drink.state.openFridgeIds, [fridge.id], 'a drink does not close the fridge');

  const close = applyInteraction(officeMap, drink.state, { cid: 1, ...point });
  assert.equal(close.result.action, 'close-fridge');
  assert.deepEqual(close.state.openFridgeIds, []);
});

void test('open fridges and closed doors expose manifest-aligned canvas visuals', () => {
  const fridge = officeMap.hotspots.find((entry) => entry.kind === 'fridge')!;
  const door = officeMap.openings.find((entry) => entry.id === DOOR_ID)!;
  const state: InteractionState = {
    ...INITIAL_INTERACTION_STATE,
    openFridgeIds: [fridge.id],
    closedDoorIds: [door.id],
  };

  assert.deepEqual(interactionVisuals(officeMap, state), [
    { kind: 'open-fridge', id: fridge.id, rect: fridge.rect },
    { kind: 'closed-door', id: door.id, rect: door.rect, orientation: door.orientation },
  ]);
  assert.deepEqual(interactionVisuals(officeMap, INITIAL_INTERACTION_STATE), []);
});

// ---------------------------------------------------------------------------
// Doors: open/close, closed-door collision, sealed rooms, self-trap guard
// ---------------------------------------------------------------------------

const DOOR_ID = 'op-meeting-1';

void test('a bare doorway toggles open and closed from both sides', () => {
  // Inside Meeting 1, near its corridor door but not standing in the gap.
  const spot = { x: 557.5, y: 200 };

  const described = describeInteraction(officeMap, INITIAL_INTERACTION_STATE, { cid: 1, ...spot });
  assert.equal(described.action, 'close-door');
  assert.equal(described.label, 'Tutup pintu', 'the on-screen button names the same action');

  const closed = applyInteraction(officeMap, INITIAL_INTERACTION_STATE, { cid: 1, ...spot });
  assert.equal(closed.result.action, 'close-door');
  assert.ok(closed.state.closedDoorIds.includes(DOOR_ID));

  const opened = applyInteraction(officeMap, closed.state, { cid: 1, ...spot });
  assert.equal(opened.result.action, 'open-door');
  assert.ok(!opened.state.closedDoorIds.includes(DOOR_ID));
});

void test('a closed door adds its collision rectangle while the gap stays a walkable map opening', () => {
  const door = officeMap.openings.find((entry) => entry.id === DOOR_ID)!;
  const point = centre(door.rect);
  const closed: InteractionState = { ...INITIAL_INTERACTION_STATE, closedDoorIds: [DOOR_ID] };

  assert.equal(isBlocked(officeMap, point.x, point.y), false, 'the manifest opening is walkable');
  assert.equal(isBlockedWithDoors(officeMap, point.x, point.y, closed), true, 'the closed door rect blocks movement');
  assert.equal(isBlockedWithDoors(officeMap, point.x, point.y, INITIAL_INTERACTION_STATE), false, 'an open door stays walkable');
  assert.deepEqual(closedDoorRects(officeMap, closed), [door.rect]);
  assert.deepEqual(closedDoorRects(officeMap, INITIAL_INTERACTION_STATE), []);
});

void test('the actor cannot close a door while standing in the threshold', () => {
  const door = officeMap.openings.find((entry) => entry.id === DOOR_ID)!;
  const point = centre(door.rect);

  const outcome = applyInteraction(officeMap, INITIAL_INTERACTION_STATE, { cid: 1, ...point });

  assert.equal(outcome.result.action, 'door-blocked');
  assert.deepEqual(outcome.state.closedDoorIds, [], 'the door stays open behind the actor');
  assert.equal(isBlockedWithDoors(officeMap, point.x, point.y, outcome.state), false);
});

void test('sealed rooms stay sealed however the doors are toggled', () => {
  const gudang = officeMap.blocks.find((block) => block.kind === 'sealed' && block.name === 'Gudang')!;
  const point = centre(gudang.rect);
  const allClosed: InteractionState = { ...INITIAL_INTERACTION_STATE, closedDoorIds: officeMap.openings.map((opening) => opening.id) };

  assert.equal(isBlocked(officeMap, point.x, point.y), true, 'Gudang is a permanent collider');
  assert.equal(isBlockedWithDoors(officeMap, point.x, point.y, INITIAL_INTERACTION_STATE), true, 'open doors cannot unseal it');
  assert.equal(isBlockedWithDoors(officeMap, point.x, point.y, allClosed), true, 'closed doors cannot unseal it');

  // Its doorway hotspot still reports the lock: a named hotspot outranks the
  // anonymous opening, so the sealed door is never toggled open from outside.
  const lock = officeMap.hotspots.find((entry) => entry.kind === 'gudang')!;
  const approach = applyInteraction(officeMap, INITIAL_INTERACTION_STATE, { cid: 1, ...centre(lock.rect) });
  assert.equal(approach.result.action, 'message');
  assert.equal(approach.result.hint, lock.message);
});

// ---------------------------------------------------------------------------
// Priority (nearest object wins; family rank breaks an exact distance tie)
// ---------------------------------------------------------------------------

void test('priority ties: an own seat wins an equal-distance tie with a drink source', () => {
  const manifest = miniManifest({
    seats: [{ id: 'seat-1', cid: 1, character: 'A', x: 110, y: 110, direction: 'down', zone: 'z' }],
    hotspots: [
      { id: 'hs-own', kind: 'seat', name: 'Kursimu', zone: 'z', action: 'sit', cid: 1, rect: { x: 100, y: 100, w: 20, h: 20 } },
      dispenserHotspot,
    ],
  });
  assert.equal(applyInteraction(manifest, INITIAL_INTERACTION_STATE, { cid: 1, x: 110, y: 110 }).result.action, 'sit');
});

void test('priority ties: proximity still wins, a nearer hotspot beats a farther own seat', () => {
  const manifest = miniManifest({
    seats: [{ id: 'seat-1', cid: 1, character: 'A', x: 170, y: 170, direction: 'down', zone: 'z' }],
    hotspots: [
      { id: 'hs-own', kind: 'seat', name: 'Kursimu', zone: 'z', action: 'sit', cid: 1, rect: { x: 160, y: 160, w: 20, h: 20 } },
      { id: 'hs-lift', kind: 'lift', name: 'Lift', zone: 'z', action: 'message', message: 'Lift belum aktif.', rect: { x: 100, y: 100, w: 20, h: 20 } },
    ],
  });
  const outcome = applyInteraction(manifest, INITIAL_INTERACTION_STATE, { cid: 1, x: 110, y: 110 });
  assert.equal(outcome.result.action, 'message', 'the nearer lift wins even though the seat ranks higher');
  assert.equal(outcome.result.hint, 'Lift belum aktif.');
});

void test('priority: standing up outranks every nearby world object', () => {
  const manifest = miniManifest({
    seats: [{ id: 'seat-1', cid: 1, character: 'A', x: 110, y: 110, direction: 'down', zone: 'z' }],
    hotspots: [
      { id: 'hs-own', kind: 'seat', name: 'Kursimu', zone: 'z', action: 'sit', cid: 1, rect: { x: 100, y: 100, w: 20, h: 20 } },
      dispenserHotspot,
    ],
  });
  const seated: InteractionState = { ...INITIAL_INTERACTION_STATE, sitting: true, seatId: 'hs-own' };
  assert.equal(applyInteraction(manifest, seated, { cid: 1, x: 110, y: 110 }).result.action, 'stand');
});

void test('priority ties: a drink source outranks a manifest message hotspot', () => {
  const manifest = miniManifest({
    hotspots: [
      { id: 'hs-lift', kind: 'lift', name: 'Lift', zone: 'z', action: 'message', message: 'Lift belum aktif.', rect: { x: 100, y: 100, w: 20, h: 20 } },
      dispenserHotspot,
    ],
  });
  assert.equal(applyInteraction(manifest, INITIAL_INTERACTION_STATE, { cid: 1, x: 110, y: 110 }).result.action, 'drink');
});

void test('priority: a drink source outranks a bare doorway', () => {
  const manifest = miniManifest({
    hotspots: [dispenserHotspot],
    openings: [{ id: 'op-1', orientation: 'vertical', rect: { x: 120, y: 100, w: 10, h: 20 } }],
  });
  assert.equal(applyInteraction(manifest, INITIAL_INTERACTION_STATE, { cid: 1, x: 115, y: 110 }).result.action, 'drink');
});

void test('priority: a bare doorway toggles when no object is near', () => {
  const manifest = miniManifest({ openings: [{ id: 'op-1', orientation: 'vertical', rect: { x: 120, y: 100, w: 10, h: 20 } }] });
  const outcome = applyInteraction(manifest, INITIAL_INTERACTION_STATE, { cid: 1, x: 110, y: 150 });
  assert.equal(outcome.result.action, 'close-door');
  assert.deepEqual(outcome.state.closedDoorIds, ['op-1']);
});

// ---------------------------------------------------------------------------
// Range + quiet fallback
// ---------------------------------------------------------------------------

void test('the resolver honours the interaction range option', () => {
  const lift = officeMap.hotspots.find((entry) => entry.kind === 'lift')!;
  const point = { x: centre(lift.rect).x, y: lift.rect.y - DEFAULT_HOTSPOT_RANGE - 30 };
  assert.equal(describeInteraction(officeMap, INITIAL_INTERACTION_STATE, { cid: 1, ...point }, { range: 24 }).action, 'none');
});

void test('the resolver stays quiet when nothing is in range and always labels the button', () => {
  const described = describeInteraction(officeMap, INITIAL_INTERACTION_STATE, { cid: 1, x: 1150, y: 700 });
  assert.equal(described.action, 'none');
  assert.ok(described.label.length > 0, 'the action button never has an empty label');
  assert.ok(described.hint.length > 0, 'the hint explains how to interact');
});
