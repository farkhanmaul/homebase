// Deterministic preview artifact generator for the office map.
//
// Produces two artifacts from the manifest the app draws (lib/office-map.json
// via lib/office-map.ts), so neither is hand-maintained:
//
//   docs/previews/final-office-map.svg/png   technical REVIEW layer
//       room labels, hotspot badges, seat numbers, legend footer
//   docs/previews/final-office-game.svg/png  GAME layer
//       exactly the ops the in-app canvas paints (no labels/markers/legend)
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
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { officeMap } from '../lib/office-map.ts';
import { buildGamePreviewOps } from '../lib/office-game-ops.ts';
import { PREVIEW_COLORS, buildReviewPreviewOps, flattenOps, type Op, type PreviewOps } from '../lib/office-render-ops.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '..', 'docs', 'previews');

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
  const result = spawnSync('python3', [resolve(HERE, 'rasterize-map-preview.py'), opsPath, pngPath], { stdio: 'inherit' });
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
  emit('final-office-game', buildGamePreviewOps(officeMap));
}

main();
