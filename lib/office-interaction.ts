// Pure pointer-mapping helpers used by app/page.tsx.
//
// Kept free of DOM/React so the pointer math and the avatar hit test can be unit
// tested on the stock Node toolchain. The hotspot interaction state machine
// lives in lib/office-interactions.ts.

import type { Point } from './office-map.ts';

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
