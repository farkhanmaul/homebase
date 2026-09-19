// Deterministic preview artifact generator for the office map.
//
// Produces two artifacts from the manifest the app draws (lib/office-map.json
// via lib/office-map.ts), so neither is hand-maintained:
//
//   docs/previews/final-office-map.svg/png   technical REVIEW layer
//       room labels, hotspot badges, seat numbers, legend footer
//   docs/previews/final-office-game.svg/png  GAME layer
//       exactly the ops the in-app canvas paints (no labels/markers/legend)
//   docs/previews/v1-detail-*.svg/png        GAMEPLAY CAMERA crops
//       the same game ops cropped to the in-app desktop camera at a
//       representative point (Bilik Geng, the work areas, the pantry)
//
// Run with: npm run preview:map
// The output is deterministic (fixed ordering, no timestamps, no randomness), so
// re-running it produces byte-identical SVGs unless the manifest or the renderer
// changed.
//
// A PNG is produced when a rasterizer is available: first a real SVG rasterizer
// (rsvg-convert, resvg, inkscape, ImageMagick), otherwise the bundled Pillow
// backend (scripts/rasterize-map-preview.py) that paints the flattened op list.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BILIK_GENG_ZONE_ID, clampCamera, officeMap, type Point, type Rect } from '../lib/office-map.ts';
import { buildGamePreviewOps } from '../lib/office-game-ops.ts';
import { cropPreviewOps } from '../lib/office-crop.ts';
import { frameRectView, resolveCamera, zoneCentre } from '../lib/office-camera.ts';
import { PREVIEW_COLORS, buildReviewPreviewOps, flattenOps, type Op, type PreviewOps } from '../lib/office-render-ops.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT_DIR = resolve(ROOT, 'docs', 'previews');
// Assets referenced by image ops live under public/ as web paths (e.g.
// `/room/bilik-geng-zone.png`). The SVG embeds their bytes as a data URI, so the
// artifact is self-contained and never depends on a filesystem/public URL.
const ASSET_DIR = resolve(ROOT, 'public');

const dataUriCache = new Map<string, string>();
function imageDataUri(src: string): string {
  const cached = dataUriCache.get(src);
  if (cached !== undefined) return cached;
  const path = resolve(ASSET_DIR, src.replace(/^\/+/, ''));
  const bytes = readFileSync(path);
  const uri = `data:image/png;base64,${bytes.toString('base64')}`;
  dataUriCache.set(src, uri);
  return uri;
}

// The representative desktop gameplay camera: a 1440x1000 CSS box (the QA smoke
// size) gives the in-app crop, drawn at 2x so pixel detail is legible.
const CAMERA_BOX = { width: 1440, height: 1000 };
const CAMERA_SCALE = 2;
// Each crop is named for what it must show and framed from its zones, never an
// arbitrary world point: a single room is framed on that zone, while a row or a
// whole service core is framed on the union of the zones it must keep visible.
export type PreviewCropSpec = { name: string; zones: string[]; box?: { width: number; height: number } };

export const PREVIEW_CROP_SPECS: readonly PreviewCropSpec[] = [
  { name: 'v1-detail-bilik', zones: [BILIK_GENG_ZONE_ID] },
  { name: 'v1-detail-workareas', zones: ['desk-collection'] },
  { name: 'v1-detail-pantry', zones: ['pantry'] },
  { name: 'v1-detail-top-rooms', zones: ['meeting-1', 'hrga', 'komisaris', 'product-manager', 'it', 'direktur-finance', BILIK_GENG_ZONE_ID], box: { width: 2800, height: 500 } },
  { name: 'v1-detail-reception-lobby', zones: ['resepsionis', 'lobby-besar'], box: { width: 900, height: 1200 } },
  { name: 'v1-detail-core', zones: ['pantry', 'gudang', 'toilet-wanita', 'wastafel', 'toilet-pria', 'meeting-2', 'server'], box: { width: 1200, height: 900 } },
  { name: 'v1-detail-desk-collection', zones: ['desk-collection'] },
  { name: 'v1-detail-tele', zones: ['tele-cs-ca'] },
];

/** The world rect a crop must keep visible: the union of its zones. */
export function previewCropBounds(spec: PreviewCropSpec): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of spec.zones) {
    const zone = officeMap.zones.find((entry) => entry.id === id);
    if (!zone) continue;
    minX = Math.min(minX, zone.rect.x);
    minY = Math.min(minY, zone.rect.y);
    maxX = Math.max(maxX, zone.rect.x + zone.rect.w);
    maxY = Math.max(maxY, zone.rect.y + zone.rect.h);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: officeMap.width, h: officeMap.height };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Crop the game ops to a named target. Bilik Geng Kami uses the exact in-app
 * zone-aware camera (`resolveCamera`); every other crop fits the union of its
 * zones with the shared padding band so it focuses the region it names instead
 * of overlapping unrelated neighbours.
 */
export function gameplayCrop(preview: PreviewOps, spec: PreviewCropSpec): PreviewOps {
  const bounds = previewCropBounds(spec);
  const box = spec.box ?? CAMERA_BOX;
  const single = spec.zones.length === 1 ? officeMap.zones.find((entry) => entry.id === spec.zones[0]) : undefined;
  if (!single) {
    const centre: Point = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
    const view = frameRectView(officeMap, bounds, box);
    return cropPreviewOps(preview, clampCamera(officeMap, view, centre), view, CAMERA_SCALE);
  }
  const centre = zoneCentre(single);
  const view = single.id === BILIK_GENG_ZONE_ID
    ? resolveCamera(officeMap, box, 'desktop', centre).view
    : frameRectView(officeMap, single.rect, box);
  return cropPreviewOps(preview, clampCamera(officeMap, view, centre), view, CAMERA_SCALE);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function attrs(parts: Array<[string, string | number | undefined]>): string {
  return parts
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}="${typeof value === 'number' ? round(value) : value}"`)
    .join(' ');
}

function renderOp(op: Op): string {
  if (op.t === 'group') {
    return `<g ${attrs([
      ['data-source-id', op.sourceId],
      ['data-semantic', op.semantic],
    ])}>\n${op.ops.map(renderOp).join('\n')}\n</g>`;
  }
  if (op.t === 'rect') {
    return `<rect ${attrs([
      ['x', op.x],
      ['y', op.y],
      ['width', op.w],
      ['height', op.h],
      ['fill', op.fill],
      ['opacity', op.opacity],
      ['stroke', op.stroke],
      ['stroke-width', op.strokeWidth],
    ])} />`;
  }
  if (op.t === 'circle') {
    return `<circle ${attrs([
      ['cx', op.cx],
      ['cy', op.cy],
      ['r', op.r],
      ['fill', op.fill],
      ['stroke', op.stroke],
      ['stroke-width', op.strokeWidth],
      ['opacity', op.opacity],
    ])} />`;
  }
  if (op.t === 'image') {
    // The local asset is embedded as a deterministic data URI (bytes, not a
    // path), so crops stay self-contained. `preserveAspectRatio="none"` lets the
    // bitmap fill the exact op rect; pixelated keeps the pixel art crisp.
    return `<image ${attrs([
      ['href', imageDataUri(op.src)],
      ['x', op.x],
      ['y', op.y],
      ['width', op.w],
      ['height', op.h],
      ['opacity', op.opacity],
      ['preserveAspectRatio', 'none'],
      ['style', 'image-rendering:pixelated'],
    ])} />`;
  }
  return `<text ${attrs([
    ['x', op.x],
    ['y', op.y],
    ['font-size', op.size],
    ['font-weight', op.weight],
    ['fill', op.fill],
    ['text-anchor', op.anchor],
    ['transform', op.rotate ? `rotate(${op.rotate} ${round(op.x)} ${round(op.y)})` : undefined],
    ['stroke', op.halo ? PREVIEW_COLORS.labelBand : undefined],
    ['stroke-width', op.halo ? 4 : undefined],
    ['paint-order', op.halo ? 'stroke' : undefined],
    ['stroke-linejoin', op.halo ? 'round' : undefined],
  ])}>${escapeXml(op.text)}</text>`;
}

export function toSvg(preview: PreviewOps): string {
  const body = preview.ops.map(renderOp).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${preview.width}" height="${preview.height}" viewBox="0 0 ${preview.width} ${preview.height}" shape-rendering="crispEdges" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">\n${body}\n</svg>\n`;
}

function rasterizeSvgWithExternalTool(svgPath: string, pngPath: string): boolean {
  const rasterizers: Array<[string, string[]]> = [
    ['rsvg-convert', ['-o', pngPath, svgPath]],
    ['resvg', [svgPath, pngPath]],
    ['inkscape', [svgPath, `--export-filename=${pngPath}`]],
    ['magick', [svgPath, pngPath]],
    ['convert', [svgPath, pngPath]],
  ];
  for (const [bin, args] of rasterizers) {
    if (spawnSync(bin, ['--version'], { stdio: 'ignore' }).error) continue;
    if (spawnSync(bin, args, { stdio: 'inherit' }).status === 0) return true;
  }
  return false;
}

// Fallback: paint the flattened op list with Pillow, so a PNG exists even
// without an SVG rasterizer. Skipped silently when python3/Pillow is missing.
function rasterizeWithPillow(preview: PreviewOps, pngPath: string): boolean {
  if (spawnSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' }).status !== 0) return false;
  const flat: PreviewOps = { width: preview.width, height: preview.height, ops: flattenOps(preview.ops) };
  const opsPath = join(tmpdir(), `office-map-preview-${process.pid}-${Math.abs(pngPath.length)}.json`);
  writeFileSync(opsPath, JSON.stringify(flat));
  // The asset dir lets the Pillow backend resolve image op sources; it fails
  // loudly rather than silently dropping an image it cannot open.
  const result = spawnSync('python3', [resolve(HERE, 'rasterize-map-preview.py'), opsPath, pngPath, ASSET_DIR], { stdio: 'inherit' });
  return result.status === 0;
}

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function emit(name: string, preview: PreviewOps): void {
  const svg = toSvg(preview);
  const svgPath = resolve(OUT_DIR, `${name}.svg`);
  const pngPath = resolve(OUT_DIR, `${name}.png`);
  writeFileSync(svgPath, svg);
  const painted = flattenOps(preview.ops).length;
  console.log(`svg  ${name}.svg ${preview.width}x${preview.height} ${painted} painted ops, ${Buffer.byteLength(svg)} bytes, sha ${digest(svg)}`);
  if (rasterizeSvgWithExternalTool(svgPath, pngPath) || rasterizeWithPillow(preview, pngPath)) {
    console.log(`png  ${name}.png`);
    return;
  }
  console.log('png  skipped (no SVG rasterizer and no Pillow available; install rsvg-convert, resvg, or python3-pillow)');
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  emit('final-office-map', buildReviewPreviewOps(officeMap));
  const game = buildGamePreviewOps(officeMap);
  emit('final-office-game', game);
  for (const spec of PREVIEW_CROP_SPECS) emit(spec.name, gameplayCrop(game, spec));
}

// Only run when invoked directly, so the crop specs and helpers stay importable
// from the tests without regenerating the artifacts as a side effect.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
