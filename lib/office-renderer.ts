// Lightweight canvas renderer.
//
// The static world (floors, walls, furniture, labels, markers) is painted once
// into an offscreen canvas at world resolution via the shared op list; each
// animation frame only draws the camera crop and the dynamic avatars. No
// graphics library, no per-frame geometry rebuild.

import type { Direction, OfficeManifest, Point } from './office-map.ts';
import { PREVIEW_COLORS, type Op } from './office-render-ops.ts';
import { buildGameWorldOps } from './office-game-ops.ts';

export type CanvasView = { w: number; h: number };
export type CssBox = { width: number; height: number };

// The devicePixelRatio is clamped so a 3x phone cannot allocate an enormous
// backing store; 1 is the floor (a fractional ratio would only blur).
export const MAX_DEVICE_PIXEL_RATIO = 3;

/** A sane, finite devicePixelRatio in [1, MAX]; junk falls back to 1. */
export function clampDevicePixelRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(Math.max(value, 1), MAX_DEVICE_PIXEL_RATIO);
}

/**
 * The canvas backing-store size in device px. It matches the CSS box times the
 * clamped DPR, so the browser blits the bitmap 1:1 to physical pixels instead of
 * upscaling a low-res canvas with its own smoothing — the single fix for the
 * previously blurry world and actors on HiDPI screens. Falls back to the camera
 * view when the box is unmeasured, and never returns a zero-sized bitmap.
 */
export function canvasBackingSize(view: CanvasView, box: CssBox, dpr: number): CanvasView {
  const ratio = clampDevicePixelRatio(dpr);
  if (!(box.width > 0) || !(box.height > 0)) {
    return { w: Math.max(1, Math.round(view.w * ratio)), h: Math.max(1, Math.round(view.h * ratio)) };
  }
  return { w: Math.max(1, Math.round(box.width * ratio)), h: Math.max(1, Math.round(box.height * ratio)) };
}

/**
 * World px per device px of the backing store. Applying it as one context
 * transform lets every op keep drawing in world units while the bitmap carries
 * the extra device pixels.
 */
export function worldRenderScale(view: CanvasView, backing: CanvasView): number {
  if (!(view.w > 0) || !(backing.w > 0)) return 1;
  const scale = backing.w / view.w;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

// Preloaded bitmaps keyed by the op's `src`. An image op is skipped until its
// asset is present, so the vector art underneath is the natural fallback while
// the bitmap loads (or if it never does).
export type ImageAssets = ReadonlyMap<string, CanvasImageSource>;

/**
 * Base-path-safe URL for an asset op (`/room/foo.png` -> `room/foo.png`), matching
 * the relative `avatar/team-six.png` convention already used by the page. GitHub
 * Pages serves the app under `/homebase/`, so a leading slash would escape the
 * project path.
 */
export function assetUrl(src: string): string {
  return src.replace(/^\/+/, '');
}

export type RenderActor = {
  id: number;
  name: string;
  sprite: number;
  x: number;
  y: number;
  direction: Direction;
  walking: boolean;
  sitting: boolean;
  online: boolean;
};

/** Paints a manifest-derived op list into a 2D context at world coordinates. */
export function paintOps(ctx: CanvasRenderingContext2D, ops: readonly Op[], assets?: ImageAssets): void {
  for (const op of ops) {
    if (op.t === 'group') {
      // Groups are metadata around a layered visual; only their ops paint.
      paintOps(ctx, op.ops, assets);
      continue;
    }
    if (op.t === 'rect') {
      ctx.globalAlpha = op.opacity ?? 1;
      ctx.fillStyle = op.fill;
      ctx.fillRect(op.x, op.y, op.w, op.h);
      if (op.stroke && op.strokeWidth) {
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = op.strokeWidth;
        ctx.strokeRect(op.x + op.strokeWidth / 2, op.y + op.strokeWidth / 2, op.w - op.strokeWidth, op.h - op.strokeWidth);
      }
      ctx.globalAlpha = 1;
    } else if (op.t === 'circle') {
      ctx.globalAlpha = op.opacity ?? 1;
      ctx.beginPath();
      ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2);
      ctx.fillStyle = op.fill;
      ctx.fill();
      if (op.stroke && op.strokeWidth) {
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = op.strokeWidth;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else if (op.t === 'image') {
      // Skipped until the bitmap is preloaded: the vector art underneath is the
      // fallback, so a missing/failed asset degrades gracefully.
      const asset = assets?.get(op.src);
      if (asset) {
        ctx.globalAlpha = op.opacity ?? 1;
        ctx.drawImage(asset, op.x, op.y, op.w, op.h);
        ctx.globalAlpha = 1;
      }
    } else {
      ctx.font = `${op.weight ?? 400} ${op.size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      ctx.textAlign = op.anchor === 'middle' ? 'center' : op.anchor === 'end' ? 'right' : 'left';
      ctx.textBaseline = 'alphabetic';
      // A rotate op is painted about its own origin, exactly like the SVG's
      // `transform="rotate(a x y)"`. The halo and the fill must share that
      // transform, so both are drawn inside the save/restore.
      if (typeof op.rotate === 'number' && op.rotate !== 0) {
        ctx.save();
        ctx.translate(op.x, op.y);
        ctx.rotate((op.rotate * Math.PI) / 180);
        paintTextRun(ctx, op, 0, 0);
        ctx.restore();
      } else {
        paintTextRun(ctx, op, op.x, op.y);
      }
      ctx.globalAlpha = 1;
    }
  }
}

function paintTextRun(ctx: CanvasRenderingContext2D, op: Extract<Op, { t: 'text' }>, x: number, y: number): void {
  if (op.halo) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = PREVIEW_COLORS.labelBand;
    ctx.strokeText(op.text, x, y);
  }
  ctx.fillStyle = op.fill;
  ctx.fillText(op.text, x, y);
}

/**
 * Pre-renders the whole static world once. Pass a preloaded `assets` map to paint
 * the image ops; without it those ops are skipped and the vector art shows.
 */
export function createWorldCanvas(manifest: OfficeManifest, assets?: ImageAssets): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = manifest.width;
  canvas.height = manifest.height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    paintOps(ctx, buildGameWorldOps(manifest), assets);
  }
  return canvas;
}

/** Draws only the current camera crop of the pre-rendered world. */
export function drawWorldCrop(ctx: CanvasRenderingContext2D, world: CanvasImageSource, camera: Point, view: CanvasView): void {
  ctx.clearRect(0, 0, view.w, view.h);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(world, camera.x, camera.y, view.w, view.h, 0, 0, view.w, view.h);
}

export type ActorDrawOptions = {
  camera: Point;
  activeId: number | null;
  sheet: CanvasImageSource & { naturalWidth: number; naturalHeight: number };
  now: number;
  reducedMotion: boolean;
  /**
   * World px per CSS px for the current camera zoom. The presentation sizes
   * below are authored in CSS px (a ~56 CSS px tall actor, an 11px label), so
   * multiplying by this factor keeps them roughly constant on screen however
   * far the zone-aware camera zooms in. 1 means world px == CSS px.
   */
  scale: number;
};

/**
 * The actor presentation factor: world px per CSS px when a camera crop of
 * `viewWidth` world units fills a `boxWidth`-CSS-px canvas. A zone-framed
 * desktop camera maps fewer world units onto the same box, so the factor drops
 * and actors shrink in world units to hold their CSS size. Falls back to 1
 * while the box is unmeasured (zero/NaN), keeping the unscaled look.
 */
export function actorPresentationScale(viewWidth: number, boxWidth: number): number {
  if (!(viewWidth > 0) || !(boxWidth > 0)) return 1;
  const scale = viewWidth / boxWidth;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** Draws the online avatars, their name tags and the active-player ring. */
export function drawActors(ctx: CanvasRenderingContext2D, actors: readonly RenderActor[], options: ActorDrawOptions): void {
  const sheet = options.sheet;
  if (!sheet.naturalWidth) return;
  const s = options.scale > 0 && Number.isFinite(options.scale) ? options.scale : 1;
  const cw = sheet.naturalWidth / 6;
  const ch = sheet.naturalHeight / 2;
  const ordered = actors.filter((actor) => actor.online).sort((a, b) => a.y - b.y);

  // Keep sprite sampling nearest-neighbour. The DPR-aware backing store above
  // provides the missing physical pixels; interpolation would soften the hard
  // pixel edges the art direction relies on.
  ctx.imageSmoothingEnabled = false;

  for (const person of ordered) {
    const frame = person.walking && !options.reducedMotion ? Math.floor(options.now / 180) % 2 : 0;
    const w = (person.id === 2 ? 40 : 34) * s;
    const h = (person.sitting ? 46 : person.id === 1 ? 62 : 56) * s;
    const x = person.x - options.camera.x;
    const y = person.y - options.camera.y;

    // The active ring is painted first so it sits behind the avatar and never
    // crosses the nameplate drawn last.
    if (person.id === options.activeId) {
      ctx.strokeStyle = PREVIEW_COLORS.hotspot;
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.ellipse(x, y, 21 * s, 6 * s, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.save();
    if (person.direction === 'left') {
      ctx.translate(x + w / 2, y - h);
      ctx.scale(-1, 1);
      ctx.drawImage(sheet, cw * person.sprite, ch * frame, cw, ch, 0, 0, w, h);
    } else {
      ctx.drawImage(sheet, cw * person.sprite, ch * frame, cw, ch, x - w / 2, y - h, w, h);
    }
    ctx.restore();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `bold ${11 * s}px sans-serif`;
    const label = person.name + (person.id === options.activeId ? ' · kamu' : '');
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = PREVIEW_COLORS.hotspotInk;
    ctx.fillRect(x - tw / 2 - 5 * s, y + 2 * s, tw + 10 * s, 18 * s);
    ctx.fillStyle = '#fff6df';
    ctx.fillText(label, x - tw / 2, y + 15 * s);
  }
}
