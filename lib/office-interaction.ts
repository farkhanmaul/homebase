// Pure interaction + pointer-mapping helpers used by app/page.tsx.
//
// Kept free of DOM/React so the pointer math, avatar hit test and hotspot
// resolution can be unit tested on the stock Node toolchain.

import { DEFAULT_HOTSPOT_RANGE, nearestHotspot, seatFor, type Direction, type OfficeManifest, type Point } from './office-map.ts';

// Avatar hit box, anchored at the feet like the sprite origin.
export const PLAYER_HIT = { halfWidth: 25, up: 65, down: 20 } as const;

export type ScreenRect = { left: number; top: number; width: number; height: number };

/**
 * Maps a pointer event back into world coordinates through the CSS-scaled,
 * letterboxed canvas (`object-fit: contain`) and the current camera.
 */
export function screenToWorld(client: Point, rect: ScreenRect, canvas: { width: number; height: number }, camera: Point): Point {
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const offsetX = (rect.width - canvas.width * scale) / 2;
  const offsetY = (rect.height - canvas.height * scale) / 2;
  return {
    x: (client.x - rect.left - offsetX) / scale + camera.x,
    y: (client.y - rect.top - offsetY) / scale + camera.y,
  };
}

/** The id of the first online avatar whose body box contains the point. */
export function playerAtPoint(actors: ReadonlyArray<{ id: number; x: number; y: number; online: boolean }>, point: Point): number | null {
  const found = actors.find(
    (actor) =>
      actor.online &&
      Math.abs(actor.x - point.x) < PLAYER_HIT.halfWidth &&
      point.y > actor.y - PLAYER_HIT.up &&
      point.y < actor.y + PLAYER_HIT.down,
  );
  return found ? found.id : null;
}

export type InteractionOutcome =
  | { kind: 'none'; hint: string }
  | { kind: 'message'; hint: string; announce: string }
  | { kind: 'sit'; hint: string; announce: string; seatId: string; x: number; y: number; direction: Direction }
  | { kind: 'stand'; hint: string; announce: string }
  | { kind: 'status-pulang'; hint: string; announce: string };

export type InteractionActor = { cid: number; x: number; y: number; sitting: boolean };

/**
 * Resolves the E/X key into a concrete, local outcome from the manifest
 * hotspots. Nothing here persists: the caller applies the result to local state
 * (only `status-pulang` later travels through the normal heartbeat).
 */
export function resolveInteraction(
  manifest: OfficeManifest,
  actor: InteractionActor,
  options: { range?: number } = {},
): InteractionOutcome {
  const found = nearestHotspot(manifest, actor.x, actor.y, { maxDistance: options.range ?? DEFAULT_HOTSPOT_RANGE });
  if (!found) return { kind: 'none', hint: 'Dekati objek di sekitarmu lalu tekan E.' };
  const hotspot = found.hotspot;

  if (hotspot.kind === 'seat') {
    // Only your own chair may seat you; someone else's chair is just a label.
    if (hotspot.cid !== actor.cid) {
      const hint = `${hotspot.name} bukan kursimu.`;
      return { kind: 'message', hint, announce: hint };
    }
    if (actor.sitting) return { kind: 'stand', hint: 'Kembali berdiri.', announce: 'Kembali berdiri.' };
    const seat = seatFor(manifest, actor.cid);
    if (!seat) return { kind: 'none', hint: 'Kursimu tidak ada di peta.' };
    return { kind: 'sit', seatId: seat.id, x: seat.x, y: seat.y, direction: seat.direction, hint: 'Sedang duduk · bergerak untuk berdiri', announce: `Duduk di ${seat.id}.` };
  }

  if (hotspot.action === 'status-pulang') {
    const hint = hotspot.message ?? 'Kamu pulang.';
    return { kind: 'status-pulang', hint, announce: hint };
  }

  const hint = hotspot.message ?? hotspot.name;
  return { kind: 'message', hint, announce: hint };
}
