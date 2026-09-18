// Single source of truth for the office world.
//
// `office-map.json` is the only place world geometry is declared: it is imported
// by the canvas renderer (app/page.tsx), by the offline preview generator
// (scripts/generate-map-preview.ts) and by the tests. Everything in this file is
// pure and dependency-free so it can run under Node's type stripping
// (`node --experimental-strip-types`) as well as in the browser bundle.
//
// Coordinates are proportional (derived from a design floor plan), not
// architectural: the world is 1920x960 and the plan was scaled to preserve
// topology and walkable routes. See docs/final-office-map.md.

import manifestData from './office-map.json' with { type: 'json' };

export const BILIK_GENG_ZONE_ID = 'bilik-geng-kami';
// How close the player must stand to trigger a hotspot. Exported so the UI and
// the tests agree on the interaction radius.
export const DEFAULT_HOTSPOT_RANGE = 72;

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Direction = 'up' | 'down' | 'left' | 'right';
// Collision uses a foot box, not a point: halfWidth is the body width either
// side of the anchor and feet is how far the box extends behind the anchor
// (the anchor is the character's feet, matching the sprite origin).
export type ActorFootprint = { halfWidth: number; feet: number };

export type ZoneKind = 'lobby' | 'room' | 'corridor' | 'service' | 'open';
// `showLabel` controls only whether the zone name is painted by the renderer;
// `name` still resolves through `zoneAt` for the UI caption. Defaults to true.
export type Zone = { id: string; name: string; kind: ZoneKind; rect: Rect; showLabel?: boolean };

export type Seat = {
  id: string;
  cid: number;
  character: string;
  x: number;
  y: number;
  direction: Direction;
  zone: string;
};

export type WallKind = 'full' | 'partition';
export type Wall = { id: string; kind: WallKind; rect: Rect };
export type Column = { id: string; rect: Rect };
// A non-walkable area. 'void' is outside the leased office (never rendered as
// floor); 'sealed' is a real but locked interior such as Gudang or the toilets.
export type Block = { id: string; kind: 'void' | 'sealed'; name: string; rect: Rect };

export type FurnitureKind = 'desk' | 'table' | 'counter' | 'cabinet' | 'chair' | 'fridge' | 'dispenser' | 'screen' | 'sink' | 'sofa' | 'board';
export type Furniture = { id: string; kind: FurnitureKind; solid: boolean; zone: string; rect: Rect };

// A door / celah (gap) carved into a wall: walkable, and it overrides the
// collider it cross-cuts.
export type Opening = { id: string; orientation: 'horizontal' | 'vertical'; rect: Rect };
export type WindowRect = { id: string; side: 'top' | 'right' | 'bottom' | 'left'; rect: Rect };

export type SurfaceKind = 'lobby' | 'office' | 'service' | 'corridor' | 'rug';
// A floor patch. Without `rect` it covers the whole zone.
export type Surface = { zone: string; kind: SurfaceKind; rect?: Rect };

export type HotspotKind = 'seat' | 'lift' | 'gudang' | 'fridge' | 'dispenser' | 'screen' | 'server' | 'reception' | 'exit' | 'board' | 'certificate-table';
export type HotspotAction = 'sit' | 'status-pulang' | 'message';
export type Hotspot = {
  id: string;
  kind: HotspotKind;
  name: string;
  zone: string;
  action: HotspotAction;
  message?: string;
  cid?: number;
  rect: Rect;
};

export type OfficeManifest = {
  id: string;
  name: string;
  width: number;
  height: number;
  margin: number;
  wallThickness: number;
  partitionThickness: number;
  actor: ActorFootprint;
  spawn: { x: number; y: number; direction: Direction };
  seats: Seat[];
  zones: Zone[];
  walls: Wall[];
  columns: Column[];
  blocks: Block[];
  furniture: Furniture[];
  openings: Opening[];
  windows: WindowRect[];
  surfaces: Surface[];
  hotspots: Hotspot[];
};

export class MapValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapValidationError';
  }
}

// ---------------------------------------------------------------------------
// Rectangle primitives
// ---------------------------------------------------------------------------

export function rectArea(rect: Rect): number {
  return rect.w * rect.h;
}

export function rectContainsPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.w >= inner.x + inner.w && outer.y + outer.h >= inner.y + inner.h;
}

// Positive-area intersection: rects that merely touch an edge do not overlap.
export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x || y2 <= y) return null;
  return { x, y, w: x2 - x, h: y2 - y };
}

export function actorFootBox(x: number, y: number, actor: ActorFootprint): Rect {
  return { x: x - actor.halfWidth, y: y - actor.feet, w: actor.halfWidth * 2, h: actor.feet };
}

// ---------------------------------------------------------------------------
// Collision
// ---------------------------------------------------------------------------

// Colliders are rebuilt lazily per manifest object and cached, so the BFS in the
// tests and the per-frame camera logic never re-allocate the list.
const colliderCache = new WeakMap<OfficeManifest, Rect[]>();

function collidersOf(manifest: OfficeManifest): Rect[] {
  const cached = colliderCache.get(manifest);
  if (cached) return cached;
  const rects: Rect[] = [];
  for (const wall of manifest.walls) rects.push(wall.rect);
  for (const column of manifest.columns) rects.push(column.rect);
  for (const block of manifest.blocks) rects.push(block.rect);
  for (const item of manifest.furniture) if (item.solid) rects.push(item.rect);
  colliderCache.set(manifest, rects);
  return rects;
}

function coveredByOpening(manifest: OfficeManifest, rect: Rect): boolean {
  for (const opening of manifest.openings) if (rectContainsRect(opening.rect, rect)) return true;
  return false;
}

/**
 * True when the actor's foot box at (x, y) cannot stand there: outside the
 * world, or overlapping a collider in a way a door opening does not cover.
 */
export function isBlocked(manifest: OfficeManifest, x: number, y: number, actor: ActorFootprint = manifest.actor): boolean {
  const box = actorFootBox(x, y, actor);
  if (box.x < 0 || box.y < 0 || box.x + box.w > manifest.width || box.y + box.h > manifest.height) return true;
  for (const collider of collidersOf(manifest)) {
    const overlap = intersectRect(box, collider);
    if (!overlap) continue;
    if (coveredByOpening(manifest, overlap)) continue;
    return true;
  }
  return false;
}

export function isWalkable(manifest: OfficeManifest, x: number, y: number, actor: ActorFootprint = manifest.actor): boolean {
  return !isBlocked(manifest, x, y, actor);
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function zoneById(manifest: OfficeManifest, id: string): Zone | undefined {
  return manifest.zones.find((zone) => zone.id === id);
}

/** The zone containing the point; the smallest match wins when zones overlap. */
export function zoneAt(manifest: OfficeManifest, x: number, y: number): Zone | undefined {
  let best: Zone | undefined;
  for (const zone of manifest.zones) {
    if (!rectContainsPoint(zone.rect, x, y)) continue;
    if (!best || rectArea(zone.rect) < rectArea(best.rect)) best = zone;
  }
  return best;
}

export function seatFor(manifest: OfficeManifest, cid: number): Seat | undefined {
  return manifest.seats.find((seat) => seat.cid === cid);
}

function distanceToRect(x: number, y: number, rect: Rect): number {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.w));
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.h));
  return Math.hypot(dx, dy);
}

export type HotspotQuery = { maxDistance?: number; kinds?: readonly HotspotKind[] };

/** Nearest hotspot within range (0 when the point is inside the hotspot rect). */
export function nearestHotspot(
  manifest: OfficeManifest,
  x: number,
  y: number,
  query: HotspotQuery = {},
): { hotspot: Hotspot; distance: number } | null {
  const maxDistance = query.maxDistance ?? DEFAULT_HOTSPOT_RANGE;
  let best: { hotspot: Hotspot; distance: number } | null = null;
  for (const hotspot of manifest.hotspots) {
    if (query.kinds && !query.kinds.includes(hotspot.kind)) continue;
    const distance = distanceToRect(x, y, hotspot.rect);
    if (distance > maxDistance) continue;
    if (!best || distance < best.distance) best = { hotspot, distance };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

/** Centre the camera on the target and keep the view inside the world. */
export function clampCamera(manifest: OfficeManifest, view: { w: number; h: number }, target: Point): Point {
  const maxX = Math.max(0, manifest.width - view.w);
  const maxY = Math.max(0, manifest.height - view.h);
  const x = Math.min(Math.max(target.x - view.w / 2, 0), maxX);
  const y = Math.min(Math.max(target.y - view.h / 2, 0), maxY);
  return { x, y };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isPositiveRect(rect: Rect): boolean {
  return Number.isFinite(rect.x) && Number.isFinite(rect.y) && Number.isFinite(rect.w) && Number.isFinite(rect.h) && rect.w > 0 && rect.h > 0;
}

function assertInsideWorld(id: string, rect: Rect, manifest: OfficeManifest): void {
  if (!isPositiveRect(rect)) throw new MapValidationError(`Geometry "${id}" must be a positive rectangle.`);
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > manifest.width || rect.y + rect.h > manifest.height) {
    throw new MapValidationError(`Geometry "${id}" is outside the world bounds ${manifest.width}x${manifest.height}.`);
  }
}

/** Throws MapValidationError with a specific message on the first bad geometry. */
export function validateManifest(manifest: OfficeManifest): void {
  if (!manifest.id || !manifest.name) throw new MapValidationError('Manifest needs an id and a name.');
  if (!Number.isFinite(manifest.width) || !Number.isFinite(manifest.height) || manifest.width <= 0 || manifest.height <= 0) {
    throw new MapValidationError('Manifest needs positive world dimensions.');
  }
  if (!(manifest.actor.halfWidth > 0) || !(manifest.actor.feet > 0)) {
    throw new MapValidationError('Manifest needs a positive actor footprint (halfWidth and feet).');
  }

  const seen = new Set<string>();
  const unique = (id: string): void => {
    if (seen.has(id)) throw new MapValidationError(`Duplicate geometry id "${id}".`);
    seen.add(id);
  };

  for (const zone of manifest.zones) {
    unique(zone.id);
    assertInsideWorld(zone.id, zone.rect, manifest);
    if (!zone.name) throw new MapValidationError(`Zone "${zone.id}" needs a name.`);
  }
  for (const seat of manifest.seats) unique(seat.id);
  for (const wall of manifest.walls) {
    unique(wall.id);
    assertInsideWorld(wall.id, wall.rect, manifest);
  }
  for (const column of manifest.columns) {
    unique(column.id);
    assertInsideWorld(column.id, column.rect, manifest);
  }
  for (const block of manifest.blocks) {
    unique(block.id);
    assertInsideWorld(block.id, block.rect, manifest);
  }
  for (const item of manifest.furniture) {
    unique(item.id);
    assertInsideWorld(item.id, item.rect, manifest);
  }
  for (const opening of manifest.openings) {
    unique(opening.id);
    assertInsideWorld(opening.id, opening.rect, manifest);
    if (opening.orientation !== 'horizontal' && opening.orientation !== 'vertical') {
      throw new MapValidationError(`Opening "${opening.id}" needs a horizontal or vertical orientation.`);
    }
  }
  for (const window of manifest.windows) {
    unique(window.id);
    assertInsideWorld(window.id, window.rect, manifest);
  }
  for (const hotspot of manifest.hotspots) {
    unique(hotspot.id);
    assertInsideWorld(hotspot.id, hotspot.rect, manifest);
    if (!zoneById(manifest, hotspot.zone)) throw new MapValidationError(`Hotspot "${hotspot.id}" references unknown zone "${hotspot.zone}".`);
  }
  for (const surface of manifest.surfaces) {
    const zone = zoneById(manifest, surface.zone);
    if (!zone) throw new MapValidationError(`Surface references unknown zone "${surface.zone}".`);
    if (surface.rect) assertInsideWorld(`${surface.zone}-surface`, surface.rect, manifest);
  }

  const geng = manifest.zones.find((zone) => zone.name === 'Bilik Geng Kami');
  if (!geng) throw new MapValidationError('The manifest needs a "Bilik Geng Kami" zone.');

  for (const seat of manifest.seats) {
    const zone = zoneAt(manifest, seat.x, seat.y);
    if (!zone || zone.name !== 'Bilik Geng Kami') {
      throw new MapValidationError(`Seat "${seat.id}" must be inside Bilik Geng Kami.`);
    }
    if (isBlocked(manifest, seat.x, seat.y)) {
      throw new MapValidationError(`Seat "${seat.id}" is not walkable (blocked by geometry).`);
    }
  }

  if (isBlocked(manifest, manifest.spawn.x, manifest.spawn.y)) {
    throw new MapValidationError('The spawn point is not walkable.');
  }
}

export const officeMap = manifestData as unknown as OfficeManifest;

// Fail fast: an invalid manifest aborts the import instead of rendering wrongly.
validateManifest(officeMap);
