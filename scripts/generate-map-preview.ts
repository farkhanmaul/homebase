// Deterministic review artifact generator for the office map.
//
// Renders `docs/previews/final-office-map.svg` from the same manifest the app
// draws (lib/office-map.json via lib/office-map.ts). There is deliberately no
// second map kept in sync by hand: the op list comes from
// lib/office-render-ops.ts, which the in-app canvas renderer paints too.
//
// Run with: npm run preview:map
// The output is deterministic (fixed ordering, no timestamps, no randomness), so
// re-running it produces a byte-identical SVG unless the manifest changed.
//
// The SVG is the primary artifact. A PNG is also produced when a local
// rasterizer is available: first a real SVG rasterizer (rsvg-convert, resvg,
// inkscape, ImageMagick), otherwise the bundled Pillow backend that paints the
// exact same op list (scripts/rasterize-map-preview.py).

import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { officeMap } from '../lib/office-map.ts';
import { PREVIEW_COLORS, buildPreviewOps, type Op, type PreviewOps } from '../lib/office-render-ops.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '..', 'docs', 'previews');
const SVG_PATH = resolve(OUT_DIR, 'final-office-map.svg');
const PNG_PATH = resolve(OUT_DIR, 'final-office-map.png');

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

function rasterizeSvgWithExternalTool(): boolean {
  const rasterizers: Array<[string, string[]]> = [
    ['rsvg-convert', ['-o', PNG_PATH, SVG_PATH]],
    ['resvg', [SVG_PATH, PNG_PATH]],
    ['inkscape', [SVG_PATH, `--export-filename=${PNG_PATH}`]],
    ['magick', [SVG_PATH, PNG_PATH]],
    ['convert', [SVG_PATH, PNG_PATH]],
  ];
  for (const [bin, args] of rasterizers) {
    if (spawnSync(bin, ['--version'], { stdio: 'ignore' }).error) continue;
    if (spawnSync(bin, args, { stdio: 'inherit' }).status === 0) return true;
  }
  return false;
}

// Fallback: paint the same op list with Pillow, so a PNG exists even without an
// SVG rasterizer. Skipped silently when python3/Pillow is unavailable.
function rasterizeWithPillow(preview: PreviewOps): boolean {
  if (spawnSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' }).status !== 0) return false;
  const opsPath = join(tmpdir(), `office-map-preview-${process.pid}.json`);
  writeFileSync(opsPath, JSON.stringify(preview));
  const result = spawnSync('python3', [resolve(HERE, 'rasterize-map-preview.py'), opsPath, PNG_PATH], { stdio: 'inherit' });
  return result.status === 0;
}

function main(): void {
  const preview = buildPreviewOps(officeMap);
  const svg = toSvg(preview);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(SVG_PATH, svg);
  console.log(`svg  ${SVG_PATH} ${preview.width}x${preview.height} ${Buffer.byteLength(svg)} bytes`);

  if (rasterizeSvgWithExternalTool() || rasterizeWithPillow(preview)) {
    console.log(`png  ${PNG_PATH}`);
    return;
  }
  console.log('png  skipped (no SVG rasterizer and no Pillow available; install rsvg-convert, resvg, or python3-pillow)');
}

main();
