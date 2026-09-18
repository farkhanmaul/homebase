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
export function paintOps(ctx: CanvasRenderingContext2D, ops: readonly Op[]): void {
  for (const op of ops) {
    if (op.t === 'group') {
      // Groups are metadata around a layered visual; only their ops paint.
      paintOps(ctx, op.ops);
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

/** Pre-renders the whole static world once. */
export function createWorldCanvas(manifest: OfficeManifest): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = manifest.width;
  canvas.height = manifest.height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    paintOps(ctx, buildGameWorldOps(manifest));
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
};

/** Draws the online avatars, their name tags and the active-player ring. */
export function drawActors(ctx: CanvasRenderingContext2D, actors: readonly RenderActor[], options: ActorDrawOptions): void {
  const sheet = options.sheet;
  if (!sheet.naturalWidth) return;
  const cw = sheet.naturalWidth / 6;
  const ch = sheet.naturalHeight / 2;
  const ordered = actors.filter((actor) => actor.online).sort((a, b) => a.y - b.y);

  for (const person of ordered) {
    const frame = person.walking && !options.reducedMotion ? Math.floor(options.now / 180) % 2 : 0;
    const w = person.id === 2 ? 40 : 34;
    const h = person.sitting ? 46 : person.id === 1 ? 62 : 56;
    const x = person.x - options.camera.x;
    const y = person.y - options.camera.y;

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
    ctx.font = 'bold 11px sans-serif';
    const label = person.name + (person.id === options.activeId ? ' · kamu' : '');
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = PREVIEW_COLORS.hotspotInk;
    ctx.fillRect(x - tw / 2 - 5, y + 2, tw + 10, 18);
    ctx.fillStyle = '#fff6df';
    ctx.fillText(label, x - tw / 2, y + 15);
    if (person.id === options.activeId) {
      ctx.strokeStyle = PREVIEW_COLORS.hotspot;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, y, 21, 6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
