import type { Point } from './office-map.ts';

/** Maximum distance evaluated by one collision query. */
export const MAX_MOVEMENT_SUBSTEP = 1;

export type CollisionProbe = (x: number, y: number) => boolean;

/**
 * Sweeps a feet-anchored actor through a requested delta. X and Y are resolved
 * separately on every small step, retaining natural wall sliding while making it
 * impossible to jump across a thin wall or corner during a slow frame.
 */
export function moveWithCollision(start: Point, delta: Point, isBlocked: CollisionProbe): Point {
  if (![start.x, start.y, delta.x, delta.y].every(Number.isFinite)) return { ...start };
  const distance = Math.max(Math.abs(delta.x), Math.abs(delta.y));
  const steps = Math.max(1, Math.ceil(distance / MAX_MOVEMENT_SUBSTEP));
  const stepX = delta.x / steps;
  const stepY = delta.y / steps;
  let x = start.x;
  let y = start.y;

  for (let i = 0; i < steps; i += 1) {
    const nextX = x + stepX;
    if (!isBlocked(nextX, y)) x = nextX;
    const nextY = y + stepY;
    if (!isBlocked(x, nextY)) y = nextY;
  }
  return { x, y };
}
