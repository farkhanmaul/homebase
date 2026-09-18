// Manifest-derived draw list for the technical review layer, plus the shared op
// types. The in-app canvas paints the GAME ops from lib/office-game-ops.ts; the
// offline preview generator (scripts/generate-map-preview.ts) renders both the
// review artifact and the game artifact from their respective op lists.
//
// Kept in `lib/` so the SVG preview, the PNG preview and the canvas all consume
// pure data (rects, circles, text, groups) that is trivially testable.

import { type FurnitureKind, type OfficeManifest, type Rect, type SurfaceKind } from './office-map.ts';

export const LEGEND_HEIGHT = 92;
// Room labels: warm off-white, 16px minimum, on an opaque band.
export const LABEL_SIZE = 16;
const LABEL_CHAR_W = LABEL_SIZE * 0.6;
const LABEL_LINE_H = 20;
const LABEL_PAD = 4;
const MARKER_RADIUS = 11;
const MARKER_INSET = MARKER_RADIUS + 2;
const SEAT_RADIUS = 9;

export const PREVIEW_COLORS = {
  world: '#0d1a26',
  outside: '#0a141d',
  wallFull: '#d8c79f',
  wallPartition: '#6d7d8a',
  column: '#46586a',
  window: '#7fc4e8',
  doorSlot: '#3a4a57',
  threshold: '#d9a441',
  label: '#f4efdf',
  labelBand: '#0b1720',
  labelBandEdge: '#8a7a52',
  labelMuted: '#a9bac3',
  hotspot: '#f6ca65',
  hotspotInk: '#17283b',
  sealed: '#2a3340',
} as const;

const SURFACE_FILL: Record<SurfaceKind, string> = {
  lobby: '#27313d',
  office: '#202b38',
  corridor: '#2b3846',
  service: '#33313c',
  rug: '#3c3139',
};

const FURNITURE_FILL: Record<FurnitureKind, string> = {
  desk: '#d9c9a3',
  table: '#d9c9a3',
  counter: '#cbb98d',
  cabinet: '#b08d5b',
  chair: '#7e6a4c',
  fridge: '#62b98a',
  dispenser: '#86cfe8',
  screen: '#9fb0bf',
  sink: '#9fd3e6',
  sofa: '#8a7a5e',
  board: '#f0dca6',
};

export type TextOp = {
  t: 'text';
  x: number;
  y: number;
  size: number;
  fill: string;
  text: string;
  anchor: 'start' | 'middle' | 'end';
  weight?: number;
  halo?: boolean;
  // Degrees, clockwise, about (x, y). Used by the tall/narrow service cells.
  rotate?: number;
};

export type RectOp = { t: 'rect'; x: number; y: number; w: number; h: number; fill: string; opacity?: number; stroke?: string; strokeWidth?: number };
export type CircleOp = { t: 'circle'; cx: number; cy: number; r: number; fill: string; stroke?: string; strokeWidth?: number; opacity?: number };

// A layered visual group. `sourceId` is the stable manifest id of the thing
// being drawn (a furniture item) and `semantic` names what it is
// ("furniture:desk"). Both are metadata: they let tests and the QA preview
// associate painted layers with approved geometry without ever painting a code
// on the playfield. Only the nested ops are drawn.
export type GroupOp = { t: 'group'; sourceId: string; semantic: string; ops: Op[] };

export type Op = RectOp | CircleOp | TextOp | GroupOp;

// Everything that actually paints: rect/circle/text, with groups flattened away.
export type PaintedOp = RectOp | CircleOp | TextOp;

export type PreviewOps = { width: number; height: number; ops: Op[] };

/** Depth-first flatten of group ops into the painted ops they contain. */
export function flattenOps(ops: readonly Op[]): PaintedOp[] {
  const out: PaintedOp[] = [];
  for (const op of ops) {
    if (op.t === 'group') out.push(...flattenOps(op.ops));
    else out.push(op);
  }
  return out;
}

function rectOp(rect: Rect, fill: string, extra: Partial<Extract<Op, { t: 'rect' }>> = {}): Op {
  return { t: 'rect', x: rect.x, y: rect.y, w: rect.w, h: rect.h, fill, ...extra };
}

function overlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function markerBox(cx: number, cy: number, r: number): Rect {
  return { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
}

function markerCenter(rect: Rect): { cx: number; cy: number } {
  return { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2 };
}

function wrapLabel(text: string, maxChars: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [text];
}

type Corner = 'top-left' | 'bottom-left' | 'top-right' | 'bottom-right';
const CORNERS: readonly Corner[] = ['top-left', 'bottom-left', 'top-right', 'bottom-right'];

function bandAt(rect: Rect, w: number, h: number, corner: Corner): Rect {
  const x = corner.endsWith('right') ? rect.x + rect.w - 2 - w : rect.x + 2;
  const y = corner.startsWith('bottom') ? rect.y + rect.h - 2 - h : rect.y + 2;
  return { x, y, w, h };
}

type LabelPlan =
  | { kind: 'horizontal'; lines: string[]; band: Rect }
  | { kind: 'rotated'; text: string; band: Rect; x: number; y: number };

// A label band is placed in the first clear corner of the room (a corner clear
// of hotspot markers). Rooms that are too narrow for a horizontal band — the
// service core's tall cells — get a single rotated line instead, so a 16px label
// still fits without spilling over a wall.
function planLabel(text: string, rect: Rect, obstacles: readonly Rect[]): LabelPlan {
  if (rect.w < 90 && rect.h >= rect.w * 1.8) {
    const bandW = LABEL_LINE_H + LABEL_PAD * 2;
    const bandH = text.length * LABEL_CHAR_W + LABEL_PAD * 2;
    const band: Rect = {
      x: rect.x + Math.max((rect.w - bandW) / 2, 2),
      y: rect.y + Math.max((rect.h - bandH) / 2, 2),
      w: Math.min(bandW, rect.w - 4),
      h: Math.min(bandH, rect.h - 4),
    };
    // With rotate(-90) about (x, y) the glyphs run upward from y, and the
    // ascender extends toward -x, so the baseline sits one label-size from the
    // band's left edge to keep the text optically centred.
    return { kind: 'rotated', text, band, x: band.x + LABEL_SIZE, y: band.y + band.h - LABEL_PAD };
  }

  const maxChars = Math.max(1, Math.floor((rect.w - 6) / LABEL_CHAR_W));
  const lines = wrapLabel(text, maxChars);
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const w = Math.min(Math.max(longest * LABEL_CHAR_W, LABEL_SIZE) + LABEL_PAD * 2, Math.max(rect.w - 4, LABEL_SIZE));
  const h = lines.length * LABEL_LINE_H + LABEL_PAD * 2;
  const corner = CORNERS.find((candidate) => {
    const band = bandAt(rect, w, h, candidate);
    return obstacles.every((obstacle) => !overlap(band, obstacle));
  });
  return { kind: 'horizontal', lines, band: bandAt(rect, w, h, corner ?? 'top-left') };
}

function labelOps(plan: LabelPlan): Op[] {
  const ops: Op[] = [
    rectOp(plan.band, PREVIEW_COLORS.labelBand, { opacity: 0.9, stroke: PREVIEW_COLORS.labelBandEdge, strokeWidth: 1 }),
  ];
  if (plan.kind === 'rotated') {
    ops.push({
      t: 'text',
      x: plan.x,
      y: plan.y,
      size: LABEL_SIZE,
      fill: PREVIEW_COLORS.label,
      text: plan.text,
      anchor: 'start',
      weight: 700,
      halo: true,
      rotate: -90,
    });
    return ops;
  }
  plan.lines.forEach((line, index) => {
    ops.push({
      t: 'text',
      x: plan.band.x + LABEL_PAD,
      y: plan.band.y + LABEL_PAD + index * LABEL_LINE_H + Math.round(LABEL_SIZE * 0.82),
      size: LABEL_SIZE,
      fill: PREVIEW_COLORS.label,
      text: line,
      anchor: 'start',
      weight: 700,
      halo: true,
    });
  });
  return ops;
}

// Keep a marker inside its hotspot, but move it off any label band it would
// otherwise cover. Tries the centre first, then the four inset corners.
function placeMarker(rect: Rect, bands: readonly Rect[]): { cx: number; cy: number } {
  const { cx, cy } = markerCenter(rect);
  const left = rect.x + MARKER_INSET;
  const right = rect.x + rect.w - MARKER_INSET;
  const top = rect.y + MARKER_INSET;
  const bottom = rect.y + rect.h - MARKER_INSET;
  const candidates = [
    { cx, cy },
    { cx: left, cy: top },
    { cx: right, cy: top },
    { cx: left, cy: bottom },
    { cx: right, cy: bottom },
  ];
  for (const candidate of candidates) {
    if (bands.every((band) => !overlap(band, markerBox(candidate.cx, candidate.cy, MARKER_RADIUS)))) return candidate;
  }
  return { cx, cy };
}

// Technical review layer: floors, walls, furniture blocks plus the diagnostic
// overlays an engineer needs (room labels, hotspot badges, seat numbers). It is
// what the SVG/PNG preview and QA reviews consume. The game layer lives in
// lib/office-game-ops.ts and never paints these overlays.
export function buildReviewWorldOps(manifest: OfficeManifest): Op[] {
  const ops: Op[] = [];

  ops.push(rectOp({ x: 0, y: 0, w: manifest.width, h: manifest.height }, PREVIEW_COLORS.world));

  // Floors, largest first so patches sit on top of their parent zone.
  const surfaces = [...manifest.surfaces].sort((a, b) => {
    const area = (surface: (typeof manifest.surfaces)[number]): number => {
      const zone = manifest.zones.find((entry) => entry.id === surface.zone);
      const rect = surface.rect ?? zone?.rect;
      return rect ? rect.w * rect.h : 0;
    };
    return area(b) - area(a);
  });
  for (const surface of surfaces) {
    const zone = manifest.zones.find((entry) => entry.id === surface.zone);
    const rect = surface.rect ?? zone?.rect;
    if (rect) ops.push(rectOp(rect, SURFACE_FILL[surface.kind]));
  }

  // Outside the leased footprint (the L-shaped notch): darker and unenclosed.
  for (const block of manifest.blocks) {
    if (block.kind === 'void') ops.push(rectOp(block.rect, PREVIEW_COLORS.outside));
  }

  for (const window of manifest.windows) ops.push(rectOp(window.rect, PREVIEW_COLORS.window));

  for (const wall of manifest.walls) {
    ops.push(rectOp(wall.rect, wall.kind === 'full' ? PREVIEW_COLORS.wallFull : PREVIEW_COLORS.wallPartition));
  }

  // Doorways carve the wall with a lit floor slot plus a small warm threshold.
  for (const opening of manifest.openings) {
    ops.push(rectOp(opening.rect, PREVIEW_COLORS.doorSlot));
    const horizontal = opening.orientation === 'horizontal';
    const barLength = Math.max(Math.min(horizontal ? opening.rect.w : opening.rect.h, 76) - 12, 14);
    const thickness = manifest.wallThickness + 6;
    const bar: Rect = horizontal
      ? { x: opening.rect.x + (opening.rect.w - barLength) / 2, y: opening.rect.y + opening.rect.h / 2 - thickness / 2, w: barLength, h: thickness }
      : { x: opening.rect.x + opening.rect.w / 2 - thickness / 2, y: opening.rect.y + (opening.rect.h - barLength) / 2, w: thickness, h: barLength };
    ops.push(rectOp(bar, PREVIEW_COLORS.threshold, { opacity: 0.95 }));
  }

  for (const column of manifest.columns) ops.push(rectOp(column.rect, PREVIEW_COLORS.column));

  for (const block of manifest.blocks) {
    if (block.kind !== 'sealed') continue;
    ops.push(rectOp(block.rect, PREVIEW_COLORS.sealed, { stroke: PREVIEW_COLORS.wallPartition, strokeWidth: 2 }));
  }

  for (const item of manifest.furniture) {
    ops.push(rectOp(item.rect, FURNITURE_FILL[item.kind], { opacity: item.solid ? 1 : 0.92 }));
  }

  // Plan every label before emitting anything, so marker placement can avoid the
  // bands. Sealed rooms (Gudang, toilets, server) already carry a zone label;
  // only the lift shafts need a block label.
  const markerBoxes = manifest.hotspots.map((hotspot) => {
    const { cx, cy } = markerCenter(hotspot.rect);
    return markerBox(cx, cy, MARKER_RADIUS);
  });
  // A marker box counts as an obstacle for a label band when it overlaps the
  // room at all, not only when its centre is inside: a hotspot on a room's edge
  // (a door marker straddling the wall) would otherwise be missed and the band
  // could be painted over it.
  const obstaclesFor = (rect: Rect): Rect[] => markerBoxes.filter((box) => overlap(rect, box));

  const plans: LabelPlan[] = [];
  for (const zone of manifest.zones) {
    if (zone.showLabel === false) continue;
    plans.push(planLabel(zone.name, zone.rect, obstaclesFor(zone.rect)));
  }
  for (const block of manifest.blocks) {
    if (block.kind !== 'sealed' || !block.name) continue;
    if (manifest.zones.some((zone) => zone.name === block.name)) continue;
    plans.push(planLabel(block.name, block.rect, obstaclesFor(block.rect)));
  }
  // Labels paint last so nothing is drawn over them.
  for (const plan of plans) ops.push(...labelOps(plan));
  const bands = plans.map((plan) => plan.band);

  // Hotspots: a warm dot with a kind initial, nudged clear of any label band.
  for (const hotspot of manifest.hotspots) {
    const { cx, cy } = placeMarker(hotspot.rect, bands);
    ops.push({ t: 'circle', cx, cy, r: MARKER_RADIUS, fill: PREVIEW_COLORS.hotspot, opacity: 0.9 });
    ops.push({ t: 'text', x: cx, y: cy + 4, size: 11, fill: PREVIEW_COLORS.hotspotInk, text: hotspot.kind.slice(0, 1).toUpperCase(), anchor: 'middle', weight: 700 });
  }

  for (const seat of manifest.seats) {
    ops.push({ t: 'circle', cx: seat.x, cy: seat.y - 8, r: SEAT_RADIUS, fill: PREVIEW_COLORS.hotspotInk, stroke: PREVIEW_COLORS.hotspot, strokeWidth: 2 });
    ops.push({ t: 'text', x: seat.x, y: seat.y - 4, size: 11, fill: PREVIEW_COLORS.hotspot, text: String(seat.cid), anchor: 'middle', weight: 700 });
  }

  return ops;
}

// Footer strip for the preview artifact only. Layout is two rows so the title
// and the legend can never overlap: row one is the title (left) plus the colour
// swatches (right), row two is the subtitle.
export function buildLegendOps(manifest: OfficeManifest): Op[] {
  const top = manifest.height;
  const ops: Op[] = [rectOp({ x: 0, y: top, w: manifest.width, h: LEGEND_HEIGHT }, PREVIEW_COLORS.outside)];

  ops.push({ t: 'text', x: 40, y: top + 30, size: 22, fill: PREVIEW_COLORS.label, text: 'DENAH KANTOR - Nongkrong Kantor - Blugreen Lt. 6', anchor: 'start', weight: 700 });
  ops.push({
    t: 'text',
    x: 40,
    y: top + 70,
    size: LABEL_SIZE,
    fill: PREVIEW_COLORS.labelMuted,
    text: `Preview vektor dari lib/office-map.json - dunia ${manifest.width}x${manifest.height} (proporsional, bukan arsitektural)`,
    anchor: 'start',
  });

  const swatches: Array<[string, string]> = [
    ['Dinding', PREVIEW_COLORS.wallFull],
    ['Partisi', PREVIEW_COLORS.wallPartition],
    ['Kolom', PREVIEW_COLORS.column],
    ['Jendela', PREVIEW_COLORS.window],
    ['Pintu/celah', PREVIEW_COLORS.threshold],
    ['Meja', FURNITURE_FILL.desk],
    ['Kursi', FURNITURE_FILL.chair],
    ['Kulkas', FURNITURE_FILL.fridge],
    ['Dispenser', FURNITURE_FILL.dispenser],
    ['Hotspot', PREVIEW_COLORS.hotspot],
  ];
  let x = 700;
  for (const [label, color] of swatches) {
    ops.push(rectOp({ x, y: top + 18, w: 22, h: 14 }, color));
    ops.push({ t: 'text', x: x + 28, y: top + 32, size: LABEL_SIZE, fill: PREVIEW_COLORS.label, text: label, anchor: 'start' });
    x += 46 + Math.round(label.length * LABEL_CHAR_W);
  }
  return ops;
}

export function buildReviewPreviewOps(manifest: OfficeManifest): PreviewOps {
  return { width: manifest.width, height: manifest.height + LEGEND_HEIGHT, ops: [...buildReviewWorldOps(manifest), ...buildLegendOps(manifest)] };
}
