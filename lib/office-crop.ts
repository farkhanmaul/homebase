// Gameplay-camera crop: slices the full game op list into the exact world view
// the in-app camera shows, at an integer pixel scale, so the preview artifacts
// are generated from the same game ops the canvas paints (never a second map).
//
// Pure and deterministic: the same op list, camera and view always produce
// byte-identical output. Ops that do not intersect the crop are dropped; ops on
// the edge are kept and clipped by the SVG viewBox / raster target.

import { flattenOps, type PaintedOp, type PreviewOps } from './office-render-ops.ts';
import type { Point, Rect } from './office-map.ts';

export type CropView = { w: number; h: number };

function scaledStroke(strokeWidth: number | undefined, scale: number): number | undefined {
  return strokeWidth === undefined ? undefined : Math.max(1, Math.round(strokeWidth * scale));
}

/**
 * Translates the full-world op list by `-camera`, scales it by `scale` and keeps
 * every op that still intersects the crop. Returns a pixel-space preview whose
 * dimensions are `view * scale`.
 */
export function cropPreviewOps(preview: PreviewOps, camera: Point, view: CropView, scale = 1): PreviewOps {
  const width = Math.max(1, Math.round(view.w * scale));
  const height = Math.max(1, Math.round(view.h * scale));
  const tx = (value: number): number => Math.round((value - camera.x) * scale);
  const ty = (value: number): number => Math.round((value - camera.y) * scale);
  const ops: PaintedOp[] = [];

  for (const op of flattenOps(preview.ops)) {
    if (op.t === 'rect') {
      const x = tx(op.x);
      const y = ty(op.y);
      const w = Math.max(1, Math.round(op.w * scale));
      const h = Math.max(1, Math.round(op.h * scale));
      if (x + w <= 0 || y + h <= 0 || x >= width || y >= height) continue;
      ops.push({ ...op, x, y, w, h, strokeWidth: scaledStroke(op.strokeWidth, scale) });
    } else if (op.t === 'circle') {
      const cx = tx(op.cx);
      const cy = ty(op.cy);
      const r = Math.max(1, Math.round(op.r * scale));
      if (cx + r <= 0 || cy + r <= 0 || cx - r >= width || cy - r >= height) continue;
      ops.push({ ...op, cx, cy, r, strokeWidth: scaledStroke(op.strokeWidth, scale) });
    } else if (op.t === 'image') {
      // The whole image op is kept, translated and scaled; ops whose rect lies
      // entirely outside the crop are dropped, and edges are clipped by the SVG
      // viewBox / raster target. The bitmap is never sliced, so a partially
      // visible zone overlay still paints its visible part.
      const x = tx(op.x);
      const y = ty(op.y);
      const w = Math.max(1, Math.round(op.w * scale));
      const h = Math.max(1, Math.round(op.h * scale));
      if (x + w <= 0 || y + h <= 0 || x >= width || y >= height) continue;
      ops.push({ ...op, x, y, w, h });
    } else {
      const x = tx(op.x);
      const y = ty(op.y);
      if (x < -width || y < -height || x > width || y > height) continue;
      ops.push({ ...op, x, y, size: Math.max(1, Math.round(op.size * scale)) });
    }
  }

  return { width, height, ops };
}

/** Bounds of a painted op, used by the QA previews. */
export function opBounds(op: PaintedOp): Rect {
  if (op.t === 'rect') return { x: op.x, y: op.y, w: op.w, h: op.h };
  if (op.t === 'circle') return { x: op.cx - op.r, y: op.cy - op.r, w: op.r * 2, h: op.r * 2 };
  if (op.t === 'image') return { x: op.x, y: op.y, w: op.w, h: op.h };
  return { x: op.x, y: op.y, w: 0, h: 0 };
}
