// Camera viewport sizing.
//
// The world is 1920x960, but the on-screen canvas is laid out by CSS at 100% x
// 100% of its wrapper. If the canvas backing size (the camera view) has a
// different aspect ratio than that CSS box, `object-fit: contain` letterboxes the
// map with large blank bars — which is exactly what the mobile smoke test showed
// (a 368x602 box rendering a fixed 560x360 bitmap).
//
// `computeViewport` derives the camera crop from the real box aspect while
// keeping the world scale controlled. V2 closes the camera so a workstation is
// readable at gameplay size: desktop anchors on a ~680 world-unit width (the old
// 960 crop left desks as small rectangles) and mobile on a ~440 world-unit
// height, with the other axis derived. The result is clamped to the world and
// always positive, so the backing ratio matches the container and no
// letterboxing happens.

import { officeMap } from './office-map.ts';

export type Viewport = { w: number; h: number };
export type ViewportBox = { width: number; height: number };
export type ViewportMode = 'desktop' | 'mobile';

// Desktop aims for a 680 world-unit-wide crop; mobile aims for a 440-unit-tall
// crop (a portrait phone wants more vertical world, not a squashed slice).
export const DESKTOP_WORLD_WIDTH = 680;
export const MOBILE_WORLD_HEIGHT = 440;

const MIN_DIMENSION = 1;

const FALLBACK: Record<ViewportMode, Viewport> = {
  desktop: { w: DESKTOP_WORLD_WIDTH, h: 383 },
  mobile: { w: 269, h: MOBILE_WORLD_HEIGHT },
};

/** The view used before the container has been measured (or when it is zero). */
export function defaultViewport(mode: ViewportMode): Viewport {
  return { ...FALLBACK[mode] };
}

function roundPositive(value: number): number {
  return Math.max(MIN_DIMENSION, Math.round(value));
}

/**
 * The camera crop for a container box. The returned ratio matches the box ratio
 * (up to integer rounding) so the canvas can fill its CSS box without bars.
 */
export function computeViewport(box: ViewportBox, mode: ViewportMode): Viewport {
  const { width, height } = box;
  if (!(width > 0) || !(height > 0)) return defaultViewport(mode);

  const aspect = width / height;
  let w: number;
  let h: number;
  if (mode === 'mobile') {
    // Anchor on height and derive width from the container aspect.
    h = MOBILE_WORLD_HEIGHT;
    w = h * aspect;
  } else {
    // Anchor on width and derive height from the container aspect.
    w = DESKTOP_WORLD_WIDTH;
    h = w / aspect;
  }

  // Clamp to the world, shrinking the other axis so the aspect is preserved.
  if (w > officeMap.width) {
    w = officeMap.width;
    h = w / aspect;
  }
  if (h > officeMap.height) {
    h = officeMap.height;
    w = h * aspect;
  }

  return { w: roundPositive(w), h: roundPositive(h) };
}
