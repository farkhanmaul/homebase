// Zone-aware gameplay camera.
//
// The plain viewport rule (`lib/office-viewport.ts`) is an actor-follow crop
// anchored on a fixed world width. That is right for the open floor, the
// corridors and the lobby, but it is wrong inside a small enclosed room: at a
// 1440x1000 desktop box a 680-wide crop only shows the middle of Bilik Geng
// Kami and drags in fragments of the neighbouring work areas.
//
// `frameZoneView` fits one zone into the container with a fixed 32-48 world-px
// padding band while matching the container aspect exactly, so the room fills
// the view without letterboxing. `resolveCamera` picks between the two rules:
// a small enclosed room is framed on the zone, everything else keeps the
// normal actor-follow viewport. It is pure: no DOM, no canvas, no state.

import { clampCamera, zoneAt, type OfficeManifest, type Point, type Zone } from './office-map.ts';
import { computeViewport, defaultViewport, type Viewport, type ViewportBox, type ViewportMode } from './office-viewport.ts';

// The world-px breathing room kept around a framed zone. 40 sits inside the
// requested 32-48 band and matches the world margin (rooms start at y=40).
export const ZONE_PADDING = 40;
// A framed view wider than this would zoom out past the readable gameplay band,
// so the zone rule only applies while the whole room still fits inside it.
export const MAX_ZONE_VIEW_WIDTH = 760;

export type CameraResolution = {
  /** Top-left world corner of the crop. */
  camera: Point;
  /** Camera crop size in world units; its ratio matches the container box. */
  view: Viewport;
  /** The zone the target stands in, if any. */
  zone: Zone | undefined;
  /** True when the view was fitted to the enclosing room rather than following. */
  zoneFocused: boolean;
};

function validBox(box: ViewportBox): boolean {
  return Number.isFinite(box.width) && Number.isFinite(box.height) && box.width > 0 && box.height > 0;
}

/**
 * A view that contains `zone.rect` with `ZONE_PADDING` on every side and keeps
 * the container aspect, clamped to the world. Dimensions are rounded up so
 * rounding can never crop a hair off the padded room.
 */
export function frameZoneView(manifest: OfficeManifest, zone: Zone, box: ViewportBox): Viewport {
  const aspect = validBox(box) ? box.width / box.height : manifest.width / manifest.height;
  const needW = zone.rect.w + ZONE_PADDING * 2;
  const needH = zone.rect.h + ZONE_PADDING * 2;

  let w = Math.max(needW, needH * aspect);
  let h = w / aspect;
  if (h < needH) {
    h = needH;
    w = h * aspect;
  }
  if (w > manifest.width) {
    w = manifest.width;
    h = w / aspect;
  }
  if (h > manifest.height) {
    h = manifest.height;
    w = h * aspect;
  }
  if (w > manifest.width) w = manifest.width;

  return { w: Math.max(1, Math.ceil(w)), h: Math.max(1, Math.ceil(h)) };
}

/** World centre of a zone. */
export function zoneCentre(zone: Zone): Point {
  return { x: zone.rect.x + zone.rect.w / 2, y: zone.rect.y + zone.rect.h / 2 };
}

/**
 * The camera for a gameplay target. Inside a small enclosed room (a `room`
 * zone, desktop only) the whole room is framed with 40px padding; everywhere
 * else the normal 680-wide actor-follow viewport is used. Mobile always keeps
 * the actor-follow view so a portrait screen never zooms out to a full floor.
 */
export function resolveCamera(
  manifest: OfficeManifest,
  box: ViewportBox,
  mode: ViewportMode,
  target: Point,
): CameraResolution {
  const zone = zoneAt(manifest, target.x, target.y);

  if (!validBox(box)) {
    const view = defaultViewport(mode);
    return { camera: clampCamera(manifest, view, target), view, zone, zoneFocused: false };
  }

  if (mode === 'desktop' && zone && zone.kind === 'room') {
    const view = frameZoneView(manifest, zone, box);
    if (view.w <= MAX_ZONE_VIEW_WIDTH) {
      return { camera: clampCamera(manifest, view, zoneCentre(zone)), view, zone, zoneFocused: true };
    }
  }

  const view = computeViewport(box, mode);
  return { camera: clampCamera(manifest, view, target), view, zone, zoneFocused: false };
}
