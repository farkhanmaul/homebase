// Pure spawn/reset and availability-merge policy used by app/page.tsx.
//
// Kept free of DOM/React so the seat reset and the polling merge can be unit
// tested on the stock Node toolchain. This is the fix for the production spawn
// bug: an inactive availability row must never move a player off its manifest
// seat, and a successful claim must always start the local player on its seat.

import { seatFor, type Direction, type OfficeManifest } from './office-map.ts';

/** The immutable reset target for a character: its manifest seat. */
export type SeatSpawn = { seatId: string; cid: number; x: number; y: number; direction: Direction };

/** Looks up the seat a character (cid) resets to. `null` when there is no seat. */
export function seatSpawnFor(manifest: OfficeManifest, cid: number): SeatSpawn | null {
  const seat = seatFor(manifest, cid);
  if (!seat) return null;
  return { seatId: seat.id, cid, x: seat.x, y: seat.y, direction: seat.direction };
}

// `sitting`/`walking` are optional so any actor shape can be reset; when present
// they are always cleared.
export type SeatResettable = { x: number; y: number; direction: Direction; sitting?: boolean; walking?: boolean };

/**
 * Returns a NEW actor placed exactly on its manifest seat, standing and idle.
 * The input is never mutated; an unknown cid is returned unchanged.
 */
export function resetActorToSeat<A extends SeatResettable>(actor: A, manifest: OfficeManifest, cid: number): A {
  const spawn = seatSpawnFor(manifest, cid);
  if (!spawn) return actor;
  return { ...actor, x: spawn.x, y: spawn.y, direction: spawn.direction, sitting: false, walking: false };
}

export type AvailabilityRow = {
  id: number;
  active: boolean;
  x?: number;
  y?: number;
  direction?: string;
  status?: string;
};

export type SyncableActor = {
  id: number;
  x: number;
  y: number;
  direction: Direction;
  status: string;
  online: boolean;
};

function isDirection(value: string | undefined): value is Direction {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}

/**
 * Folds the server availability rows into the local actors, returning a new
 * array. The rules exist to stop the production void-spawn:
 *   - `online` always mirrors `row.active` (presence is server truth);
 *   - the local active player owns its own position — only presence syncs;
 *   - a REMOTE player adopts backend coordinates only when `row.active` is true;
 *     an inactive row never overwrites manifest/local seat state;
 *   - non-finite coordinates are ignored.
 */
export function applyAvailability<A extends SyncableActor>(
  actors: readonly A[],
  rows: readonly AvailabilityRow[],
  localActiveId: number | null,
): A[] {
  if (!rows.length) return actors.slice();
  const byId = new Map<number, AvailabilityRow>();
  for (const row of rows) byId.set(row.id, row);
  return actors.map((actor) => {
    const row = byId.get(actor.id);
    if (!row) return actor;
    const next: A = { ...actor, online: row.active };
    // The local active player owns its own position: presence syncs, nothing else.
    if (row.id === localActiveId) return next;
    // An inactive row is not a position source; it only marks presence offline,
    // so a stale backend coordinate can never pull a remote off its seat.
    if (!row.active) return next;
    const { x, y } = row;
    if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) {
      next.x = x;
      next.y = y;
    }
    if (row.status) next.status = row.status;
    if (isDirection(row.direction)) next.direction = row.direction;
    return next;
  });
}
