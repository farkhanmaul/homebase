// Deterministic focused-review artifact generator — Pantry / Toilet / Meeting 2.
//
// Scope: ONLY the Pantry–Toilet Wanita–Wastafel–Toilet Pria–Meeting 2–Server
// area of the office plan. It reads the single focused source of truth
//   docs/reviews/office-pantry-service-focus-v1.json
// and writes
//   docs/reviews/office-pantry-service-focus-v1.svg
//   docs/reviews/office-pantry-service-focus-v1.png
//
// It does NOT read, write or regenerate any structure/furniture v1/v2 artifact;
// instead it ASSERTS those protected hashes are unchanged. Deterministic: fixed
// ordering, rounded numbers, no timestamps, no randomness. The PNG is a
// rasterization of the same generated SVG (no second drawing).
//
// Run: node --experimental-strip-types scripts/generate-pantry-service-focus.ts

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REVIEW_DIR = resolve(HERE, '..', 'docs', 'reviews');
const DATA_PATH = resolve(REVIEW_DIR, 'office-pantry-service-focus-v1.json');
const SVG_PATH = resolve(REVIEW_DIR, 'office-pantry-service-focus-v1.svg');
const PNG_PATH = resolve(REVIEW_DIR, 'office-pantry-service-focus-v1.png');

type Rect = { x1: number; y1: number; x2: number; y2: number };
type Room = Rect & { id: string; name: string; kind: string; locked?: boolean };
type Wall = Rect & { id: string; type: 'full' | 'partition'; note?: string };
type Door = {
  id: string;
  room: string;
  label: string;
  axis: 'h' | 'v';
  x: number;
  y: number;
  len: number;
  hinge: 'start' | 'end' | 'double';
  swing: 'up' | 'down' | 'left' | 'right';
  locked?: boolean;
  inward?: boolean;
};
type OpenPath = { id: string; label: string; x1: number; y1: number; x2: number; y2: number; arrow: { x: number; y1: number; y2: number } };
type FurnitureType = 'table' | 'counter' | 'chair' | 'dispenser' | 'fridge';
type Furniture = {
  id: string;
  group: string;
  type: FurnitureType;
  room: string;
  shape: 'rect' | 'point';
  rect?: Rect;
  point?: { x: number; y: number };
  w?: number;
  h?: number;
  facing?: 'up' | 'down' | 'left' | 'right';
  external?: boolean;
  note?: string;
};
type RoomLabel = { room: string; x: number; y: number; size: number; lines: string[] };
type Callout = {
  id: string;
  text: string[];
  lx: number;
  ly: number;
  anchor: 'start' | 'middle' | 'end';
  size: number;
  lineStep?: number;
  leader: Array<[number, number]>;
  target: [number, number];
};
type LegendItem = { kind: string; label: string };
type Data = {
  meta: {
    id: string;
    title: string;
    subtitle: string;
    scaleNote: string;
    source: { file: string; width: number; height: number };
    focus: Rect;
    view: Rect;
    headerBand: Rect;
    legendBand: Rect;
    output: { width: number };
    protected: Record<string, string>;
    stroke: Record<string, number>;
    colors: Record<string, string>;
  };
  rooms: Room[];
  walls: Wall[];
  doors: Door[];
  openPaths: OpenPath[];
  furniture: Furniture[];
  roomLabels: RoomLabel[];
  callouts: Callout[];
  legend: LegendItem[];
};

const data: Data = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
const M = data.meta;
const C = M.colors;
const S = M.stroke;
const VIEW = M.view;
const ROOMS = new Map(data.rooms.map((r) => [r.id, r]));

// Presentation layout (kept in one place so validation and rendering agree).
const SCALE = M.output.width / (VIEW.x2 - VIEW.x1);
const MIN_SEP = 12 / SCALE; // 12 px expressed in drawing units
const LEG = {
  headerDy: 13,
  firstRowDy: 27,
  rowGap: 12,
  rows: 3,
  swW: 20,
  swH: 8,
  textDx: 26,
  textSize: 7.2,
  padX: 10,
  colW: (M.legendBand.x2 - M.legendBand.x1 - 12) / 3,
};
const HEAD = { titleDy: 15, titleSize: 13, subDy: 28, subSize: 7.6, noteDy: 40, noteSize: 6 };

// ---------------------------------------------------------------------------
// geometry + svg helpers
// ---------------------------------------------------------------------------

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function n(v: number): number {
  return Math.round(v * 100) / 100;
}
function line(x1: number, y1: number, x2: number, y2: number, color: string, width: number, dash?: string): string {
  const d = dash ? ` stroke-dasharray="${dash}"` : '';
  return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${color}" stroke-width="${width}"${d} stroke-linecap="round" />`;
}
function rect(r: Rect, fill: string, stroke?: string, width?: number): string {
  const s = stroke ? ` stroke="${stroke}" stroke-width="${width ?? 1}"` : '';
  return `<rect x="${n(r.x1)}" y="${n(r.y1)}" width="${n(r.x2 - r.x1)}" height="${n(r.y2 - r.y1)}" fill="${fill}"${s} />`;
}
function text(x: number, y: number, value: string, size: number, color: string, anchor = 'start', weight = 400): string {
  return `<text x="${n(x)}" y="${n(y)}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${esc(value)}</text>`;
}
function polyline(pts: Array<[number, number]>, color: string, width: number, dash?: string): string {
  const d = dash ? ` stroke-dasharray="${dash}"` : '';
  return `<polyline points="${pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${width}"${d} stroke-linecap="round" />`;
}
function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  return w > 0 && h > 0 ? w * h : 0;
}
function contains(outer: Rect, inner: Rect): boolean {
  return inner.x1 >= outer.x1 - 0.001 && inner.y1 >= outer.y1 - 0.001 && inner.x2 <= outer.x2 + 0.001 && inner.y2 <= outer.y2 + 0.001;
}
function boundsOf(f: Furniture): Rect {
  if (f.shape === 'rect') return f.rect as Rect;
  const p = f.point as { x: number; y: number };
  const w = f.w ?? 0;
  const h = f.h ?? 0;
  return { x1: p.x - w / 2, y1: p.y - h / 2, x2: p.x + w / 2, y2: p.y + h / 2 };
}
function segmentCrossesInterior(seg: Rect, box: Rect): boolean {
  const horiz = seg.y1 === seg.y2;
  const vert = seg.x1 === seg.x2;
  if (horiz) {
    const y = seg.y1;
    if (!(y > box.y1 + 0.001 && y < box.y2 - 0.001)) return false;
    const a = Math.min(seg.x1, seg.x2);
    const b = Math.max(seg.x1, seg.x2);
    return Math.min(b, box.x2) - Math.max(a, box.x1) > 0.001;
  }
  if (vert) {
    const x = seg.x1;
    if (!(x > box.x1 + 0.001 && x < box.x2 - 0.001)) return false;
    const a = Math.min(seg.y1, seg.y2);
    const b = Math.max(seg.y1, seg.y2);
    return Math.min(b, box.y2) - Math.max(a, box.y1) > 0.001;
  }
  return false;
}
function arrowHead(x: number, y: number, dx: number, dy: number, size: number, color: string): string {
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L;
  const uy = dy / L;
  const px = -uy;
  const py = ux;
  const bx = x - ux * size;
  const by = y - uy * size;
  const w = size * 0.5;
  return `<polygon points="${n(x)},${n(y)} ${n(bx + px * w)},${n(by + py * w)} ${n(bx - px * w)},${n(by - py * w)}" fill="${color}" />`;
}
function arcPoints(px: number, py: number, r: number, tx: number, ty: number, fx: number, fy: number): Array<[number, number]> {
  const a0 = Math.atan2(ty - py, tx - px);
  let d = Math.atan2(fy - py, fx - px) - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= 16; i++) {
    const a = a0 + (d * i) / 16;
    pts.push([px + r * Math.cos(a), py + r * Math.sin(a)]);
  }
  return pts;
}

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

const REQUIRED_GROUPS: Record<string, number> = {
  'lounge-chair': 2,
  'lounge-table': 1,
  'cert-table': 1,
  'ext-table': 1,
  'pantry-counter': 1,
  'pantry-dispenser': 1,
  'pantry-fridge': 1,
  'mtg2-table': 1,
  'mtg2-chair': 6,
};
const SEALED_ROOMS = ['gudang', 'toilet-wanita', 'wastafel', 'toilet-pria', 'server'];

function validate(): void {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const x of [...data.rooms, ...data.walls, ...data.doors, ...data.openPaths, ...data.furniture, ...data.callouts]) {
    if (ids.has(x.id)) errs.push(`duplicate id: ${x.id}`);
    ids.add(x.id);
  }

  // group counts (exact)
  const groupCount: Record<string, number> = {};
  for (const f of data.furniture) groupCount[f.group] = (groupCount[f.group] ?? 0) + 1;
  for (const [g, want] of Object.entries(REQUIRED_GROUPS)) {
    const got = groupCount[g] ?? 0;
    if (got !== want) errs.push(`group ${g}: expected ${want}, got ${got}`);
  }
  for (const g of Object.keys(groupCount)) if (!(g in REQUIRED_GROUPS)) errs.push(`unexpected group: ${g}`);

  // no board classification anywhere
  if (data.furniture.some((f) => (f.type as string) === 'board')) errs.push('a board item exists (must be removed)');
  if (data.legend.some((l) => l.kind === 'board' || /papan|board|layar/i.test(l.label))) errs.push('legend still mentions a board/screen');

  for (const f of data.furniture) {
    if (f.shape === 'rect' && (!f.rect || f.rect.x2 - f.rect.x1 <= 0 || f.rect.y2 - f.rect.y1 <= 0)) errs.push(`${f.id}: bad rect`);
    if (f.shape === 'point' && (!f.point || !(f.w && f.w > 0) || !(f.h && f.h > 0))) errs.push(`${f.id}: bad point`);
    const box = boundsOf(f);
    for (const r of SEALED_ROOMS) {
      const room = ROOMS.get(r) as Rect;
      if (overlap(box, room) > 0) errs.push(`${f.id}: overlaps sealed room ${r}`);
    }
    if (!ROOMS.has(f.room)) errs.push(`${f.id}: unknown room ${f.room}`);
  }

  // every room label points at a known room and stays inside the view
  for (const l of data.roomLabels) {
    if (!ROOMS.has(l.room)) errs.push(`label for unknown room ${l.room}`);
    if (!contains(VIEW, { x1: l.x - 60, y1: l.y - l.size, x2: l.x + 60, y2: l.y + (l.lines.length - 1) * (l.size + 1) })) {
      errs.push(`room label ${l.room} leaves the view`);
    }
  }

  // OPEN PATH: no wall may cross the interior of any declared open path
  for (const p of data.openPaths) {
    const box: Rect = { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2 };
    if (!(box.x2 > box.x1 && box.y2 > box.y1)) errs.push(`${p.id}: bad open-path rect`);
    for (const w of data.walls) {
      if (segmentCrossesInterior(w, box)) errs.push(`${p.id}: wall ${w.id} crosses the open path`);
    }
  }

  // DOORS on the toilets: on the inner wall, in the UPPER part, swinging INWARD
  const d8 = data.doors.find((d) => d.id === 'D8') as Door;
  const d9 = data.doors.find((d) => d.id === 'D9') as Door;
  if (!d8 || d8.axis !== 'v' || d8.x !== 512) errs.push('D8 must sit on the east wall x=512');
  if (!d8 || d8.swing !== 'left') errs.push('D8 must swing inward (west) into Toilet Wanita');
  if (!d8 || d8.y - d8.len / 2 < 424 - 0.001 || d8.y + d8.len / 2 > 460 + 0.001) errs.push('D8 opening must be the UPPER part of the wall (y≈424..460)');
  if (!d9 || d9.axis !== 'v' || d9.x !== 554) errs.push('D9 must sit on the west wall x=554');
  if (!d9 || d9.swing !== 'right') errs.push('D9 must swing inward (east) into Toilet Pria');
  if (!d9 || d9.y - d9.len / 2 < 415 - 0.001 || d9.y + d9.len / 2 > 452 + 0.001) errs.push('D9 opening must be the UPPER part of the wall (y≈415..452)');
  if (!d8.inward || !d9.inward) errs.push('toilet doors must be flagged inward');

  // Door swing region must land INSIDE the owning room (visibly inward).
  const swingRegion = (d: Door): Rect => {
    const L = d.len;
    if (d.axis === 'h') {
      const y = d.y;
      const sy = d.swing === 'up' ? y - L : y + L;
      return { x1: d.x - L / 2, y1: Math.min(y, sy), x2: d.x + L / 2, y2: Math.max(y, sy) };
    }
    const x = d.x;
    const sx = d.swing === 'right' ? x + L : x - L;
    return { x1: Math.min(x, sx), y1: d.y - L / 2, x2: Math.max(x, sx), y2: d.y + L / 2 };
  };
  for (const d of [d8, d9]) {
    if (!d || !d.inward) continue;
    const room = ROOMS.get(d.room) as Rect;
    if (!contains(room, swingRegion(d))) errs.push(`${d.id}: swing region is not fully inside ${d.room} (not inward)`);
  }
  if (!data.doors.some((d) => d.id === 'D7' && d.locked)) errs.push('D7 Gudang must stay locked');

  // protected artifacts must be byte-identical
  const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
  const check = (name: string, file: string) => {
    const want = M.protected[name];
    const got = sha(resolve(REVIEW_DIR, file));
    if (got !== want) errs.push(`protected ${file} changed: ${got} != ${want}`);
  };
  check('structureV1Svg', 'office-structure-review-v1.svg');
  check('structureV1Png', 'office-structure-review-v1.png');
  check('structureV2Svg', 'office-structure-review-v2.svg');
  check('structureV2Png', 'office-structure-review-v2.png');
  check('furnitureV1Svg', 'office-furniture-review-v1.svg');
  check('furnitureV1Png', 'office-furniture-review-v1.png');
  check('furnitureV1TopRowSvg', 'office-furniture-review-v1-top-row.svg');
  check('furnitureV1TopRowPng', 'office-furniture-review-v1-top-row.png');
  check('furnitureV1LeftMiddleSvg', 'office-furniture-review-v1-left-middle.svg');
  check('furnitureV1LeftMiddlePng', 'office-furniture-review-v1-left-middle.png');
  check('furnitureV1WorkareasSvg', 'office-furniture-review-v1-workareas.svg');
  check('furnitureV1WorkareasPng', 'office-furniture-review-v1-workareas.png');

  // Meeting 2 table + 6 chairs must match the prior furniture review coordinates.
  const fur = JSON.parse(readFileSync(resolve(REVIEW_DIR, 'office-furniture-review-v1.json'), 'utf8')) as {
    furniture: Array<{ id: string; rect?: { x1: number; y1: number; x2: number; y2: number }; point?: { x: number; y: number } }>;
  };
  const priorTable = fur.furniture.find((f) => f.id === 'F-MTG2-TABLE');
  const mineTable = data.furniture.find((f) => f.id === 'F-PS-MTG2-TABLE');
  if (!priorTable || !mineTable || JSON.stringify(priorTable.rect) !== JSON.stringify(mineTable.rect)) {
    errs.push('Meeting 2 table differs from prior review');
  }
  const priorChairs = fur.furniture.filter((f) => f.id.startsWith('F-MTG2-C')).map((f) => `${f.point!.x},${f.point!.y}`);
  const mineChairs = data.furniture.filter((f) => f.id.startsWith('F-PS-MTG2-C')).map((f) => `${f.point!.x},${f.point!.y}`);
  if (JSON.stringify(priorChairs) !== JSON.stringify(mineChairs)) errs.push('Meeting 2 chairs differ from prior review');

  // --- presentation: header/legend must fully fit and clear the content ---
  const featureTops: number[] = [189 - 1.5];
  const featureBottoms: number[] = [501 + 1.5];
  for (const f of data.furniture) {
    const b = boundsOf(f);
    featureTops.push(b.y1);
    featureBottoms.push(b.y2);
  }
  for (const l of data.roomLabels) featureTops.push(l.y - l.size);
  for (const c of data.callouts) featureTops.push(c.ly - c.size);
  for (const d of data.doors) {
    if (d.axis === 'h') featureBottoms.push(d.y + d.len + 8);
    else featureTops.push(d.y - d.len / 2 - 1.5);
  }
  const contentTop = Math.min(...featureTops);
  const contentBottom = Math.max(...featureBottoms);
  if (M.headerBand.y2 > contentTop - MIN_SEP) errs.push(`header band overlaps/too close to content (${M.headerBand.y2} > ${n(contentTop - MIN_SEP)})`);
  if (M.legendBand.y1 < contentBottom + MIN_SEP) errs.push(`legend band overlaps/too close to content (${M.legendBand.y1} < ${n(contentBottom + MIN_SEP)})`);

  // header lines: inside the band, >=12px apart
  const headerLines = [
    { name: 'title', top: M.headerBand.y1 + HEAD.titleDy - HEAD.titleSize, bottom: M.headerBand.y1 + HEAD.titleDy },
    { name: 'subtitle', top: M.headerBand.y1 + HEAD.subDy - HEAD.subSize, bottom: M.headerBand.y1 + HEAD.subDy },
    { name: 'scaleNote', top: M.headerBand.y1 + HEAD.noteDy - HEAD.noteSize, bottom: M.headerBand.y1 + HEAD.noteDy + HEAD.noteSize * 0.3 },
  ];
  for (const l of headerLines) {
    if (l.top < M.headerBand.y1 + 1 || l.bottom > M.headerBand.y2 - 1) errs.push(`header line ${l.name} leaves the header band`);
  }
  for (let i = 1; i < headerLines.length; i++) {
    if (headerLines[i].top - headerLines[i - 1].bottom < MIN_SEP) errs.push(`header lines ${headerLines[i - 1].name}/${headerLines[i].name} too close`);
  }
  const fitX = (start: number, width: number) => start >= M.headerBand.x1 + 4 && start + width <= M.headerBand.x2 - 4;
  if (!fitX(M.headerBand.x1 + 8, M.title.length * HEAD.titleSize * 0.62)) errs.push('title overflows the header');
  if (!fitX(M.headerBand.x1 + 8, M.subtitle.length * HEAD.subSize * 0.62)) errs.push('subtitle overflows the header');
  if (!fitX(M.headerBand.x2 - 8 - M.scaleNote.length * HEAD.noteSize * 0.62, M.scaleNote.length * HEAD.noteSize * 0.62)) errs.push('scale note overflows the header');

  // legend: every swatch + label fully inside the band, >=12px apart
  for (let i = 0; i < data.legend.length; i++) {
    const col = Math.floor(i / LEG.rows);
    const row = i % LEG.rows;
    const cx = M.legendBand.x1 + LEG.padX + col * LEG.colW;
    const cy = M.legendBand.y1 + LEG.firstRowDy + row * LEG.rowGap;
    const textW = data.legend[i].label.length * LEG.textSize * 0.62;
    if (cx - 1 < M.legendBand.x1 + 2) errs.push(`legend '${data.legend[i].label}' starts outside the band`);
    if (cx + LEG.textDx + textW > M.legendBand.x2 - 4) errs.push(`legend '${data.legend[i].label}' overflows the band`);
    if (cy - LEG.swH / 2 < M.legendBand.y1 + 18) errs.push(`legend '${data.legend[i].label}' rises into the LEGENDA title`);
    if (cy + LEG.swH / 2 > M.legendBand.y2 - 1) errs.push(`legend '${data.legend[i].label}' leaves the band`);
    if (row > 0 && LEG.rowGap - LEG.swH < MIN_SEP) errs.push(`legend swatch row gap under 12px (${data.legend[i].label})`);
  }

  // callouts: text inside the view, clear of furniture and of each other
  const calloutBox = (c: Callout): Rect => {
    const w = Math.max(...c.text.map((t) => t.length)) * c.size * 0.62;
    const x1 = c.anchor === 'start' ? c.lx : c.anchor === 'end' ? c.lx - w : c.lx - w / 2;
    const step = c.lineStep ?? c.size + 1;
    return { x1, y1: c.ly - c.size, x2: x1 + w, y2: c.ly + (c.text.length - 1) * step + c.size * 0.3 };
  };
  const boxes = data.callouts.map((c) => ({ c, box: calloutBox(c) }));
  for (const { c, box } of boxes) {
    if (box.x1 < VIEW.x1 + 3 || box.x2 > VIEW.x2 - 3 || box.y1 < VIEW.y1 + 3 || box.y2 > VIEW.y2 - 3) errs.push(`callout ${c.id} text leaves the view`);
    for (const [px, py] of [...c.leader, c.target]) {
      if (px < VIEW.x1 || px > VIEW.x2 || py < VIEW.y1 || py > VIEW.y2) errs.push(`callout ${c.id} leader leaves the view`);
    }
    for (const f of data.furniture) if (overlap(box, boundsOf(f)) > 0) errs.push(`callout ${c.id} text overlaps furniture ${f.id}`);
    for (const l of data.roomLabels) {
      const lw = Math.max(...l.lines.map((s) => s.length)) * l.size * 0.62;
      const lbox = { x1: l.x - lw / 2, y1: l.y - l.size, x2: l.x + lw / 2, y2: l.y + (l.lines.length - 1) * (l.size + 1) + l.size * 0.3 };
      if (overlap(box, lbox) > 0) errs.push(`callout ${c.id} text overlaps room label ${l.room}`);
    }
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (overlap(boxes[i].box, boxes[j].box) > 0) errs.push(`callouts ${boxes[i].c.id}/${boxes[j].c.id} overlap`);
    }
  }
  // 'Meja luar' must point at the external table, not the Meeting 2 door
  const ext = boxes.find((b) => b.c.id === 'CO-EXT');
  const extTable = data.furniture.find((f) => f.group === 'ext-table');
  if (ext && extTable && !contains(boundsOf(extTable), { x1: ext.c.target[0], y1: ext.c.target[1], x2: ext.c.target[0], y2: ext.c.target[1] })) {
    errs.push("CO-EXT target is not inside the external table");
  }

  if (errs.length) throw new Error(`pantry-service focus validation failed:\n - ${errs.join('\n - ')}`);
}

// ---------------------------------------------------------------------------
// symbols
// ---------------------------------------------------------------------------

function floorFill(kind: string): string {
  return kind === 'service' ? C.floorService : kind === 'open' ? C.floorOpen : C.floorOffice;
}
function cut(a: Door, half: number): string {
  const pad = 3;
  if (a.axis === 'h') return rect({ x1: a.x - a.len / 2 - pad, y1: a.y - half, x2: a.x + a.len / 2 + pad, y2: a.y + half }, C.cut);
  return rect({ x1: a.x - half, y1: a.y - a.len / 2 - pad, x2: a.x + half, y2: a.y + a.len / 2 + pad }, C.cut);
}
function doorSymbol(d: Door): string {
  const L = d.len;
  const out: string[] = [];
  if (d.axis === 'h') {
    const a = d.x - L / 2;
    const b = d.x + L / 2;
    const y = d.y;
    const dy = d.swing === 'up' ? -1 : 1;
    const hx = d.hinge === 'start' ? a : b;
    const fx = d.hinge === 'start' ? b : a;
    const ty = y + dy * L;
    out.push(line(hx, y, hx, ty, C.line, S.door));
    const arc = arcPoints(hx, y, L, hx, ty, fx, y);
    out.push(polyline(arc, C.line, S.door));
    const p0 = arc[0];
    const p1 = arc[1];
    out.push(arrowHead(p0[0], p0[1], p0[0] - p1[0], p0[1] - p1[1], 7, C.line));
  } else {
    const a = d.y - L / 2;
    const b = d.y + L / 2;
    const x = d.x;
    const dx = d.swing === 'right' ? 1 : -1;
    const hy = d.hinge === 'start' ? a : b;
    const fy = d.hinge === 'start' ? b : a;
    const tx = x + dx * L;
    out.push(line(x, hy, tx, hy, C.line, S.door));
    const arc = arcPoints(x, hy, L, tx, hy, x, fy);
    out.push(polyline(arc, C.line, S.door));
    const p0 = arc[0];
    const p1 = arc[1];
    out.push(arrowHead(p0[0], p0[1], p0[0] - p1[0], p0[1] - p1[1], 7, C.line));
  }
  return out.join('\n');
}
function padlock(cx: number, cy: number): string {
  const out: string[] = [];
  out.push(rect({ x1: cx - 5, y1: cy - 1, x2: cx + 5, y2: cy + 9 }, C.bg, C.line, 1.4));
  const shackle: Array<[number, number]> = [];
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * (1 + i / 10);
    shackle.push([cx + 3 * Math.cos(a), cy - 1 + 3 * Math.sin(a)]);
  }
  out.push(polyline(shackle, C.line, 1.4));
  out.push(`<circle cx="${n(cx)}" cy="${n(cy + 4)}" r="1.1" fill="${C.line}" />`);
  return out.join('\n');
}
function tableSvg(r: Rect): string {
  return rect(r, C.bg, C.line, S.furniture);
}
function chairSvg(f: Furniture): string {
  const r = boundsOf(f);
  const out = [rect(r, C.bg, C.line, S.furniture)];
  const m = 2;
  switch (f.facing) {
    case 'down': out.push(line(r.x1 + m, r.y1 + m, r.x2 - m, r.y1 + m, C.line, S.chair * 2)); break;
    case 'up': out.push(line(r.x1 + m, r.y2 - m, r.x2 - m, r.y2 - m, C.line, S.chair * 2)); break;
    case 'right': out.push(line(r.x1 + m, r.y1 + m, r.x1 + m, r.y2 - m, C.line, S.chair * 2)); break;
    case 'left': out.push(line(r.x2 - m, r.y1 + m, r.x2 - m, r.y2 - m, C.line, S.chair * 2)); break;
  }
  return out.join('\n');
}
function dispenserSvg(r: Rect): string {
  const w = r.x2 - r.x1;
  const h = r.y2 - r.y1;
  return [
    rect(r, C.dispenser, C.dispenserLine, S.furniture),
    line(r.x1 + w * 0.34, r.y1 + 2, r.x1 + w * 0.34, r.y2 - 2, C.dispenserLine, S.chair),
    `<circle cx="${n(r.x1 + w * 0.67)}" cy="${n(r.y1 + h * 0.38)}" r="2.6" fill="none" stroke="${C.dispenserLine}" stroke-width="${S.chair}" />`,
  ].join('\n');
}
function fridgeSvg(r: Rect): string {
  const w = r.x2 - r.x1;
  return [rect(r, C.fridge, C.fridgeLine, S.furniture), line(r.x1 + w * 0.7, r.y1 + 3, r.x1 + w * 0.7, r.y2 - 3, C.fridgeLine, S.chair)].join('\n');
}
function furnitureSvg(f: Furniture): string {
  switch (f.type) {
    case 'chair': return chairSvg(f);
    case 'dispenser': return dispenserSvg(boundsOf(f));
    case 'fridge': return fridgeSvg(boundsOf(f));
    default: return tableSvg(boundsOf(f));
  }
}

// Removable tables (konteks): the side/back walls of the Pantry/Sirkulasi/locked
// cells are visible side boundaries only — identical treatment to a wall line.
function wallsLayer(): string {
  const cuts = data.doors.map((d) => cut(d, S.wall / 2 + 2)).join('\n');
  const walls = data.walls
    .map((w) => line(w.x1, w.y1, w.x2, w.y2, w.type === 'full' ? C.wall : C.partition, w.type === 'full' ? S.wall : S.partition, w.type === 'partition' ? '7 5' : undefined))
    .join('\n');
  const doors = data.doors.map(doorSymbol).join('\n');
  const locks = data.doors
    .filter((d) => d.locked)
    .map(() => padlock(437, 432))
    .join('\n');
  return [cuts, walls, doors, locks].filter(Boolean).join('\n');
}
function scenesLayer(): string {
  const floors = data.rooms.map((r) => rect(r, floorFill(r.kind))).join('\n');
  return floors;
}
function openPathLayer(): string {
  return data.openPaths
    .map((p) => {
      const a = p.arrow;
      const dash = '7 6';
      const svg = [line(a.x, a.y1, a.x, a.y2 + 8, C.path, 2.2, dash), arrowHead(a.x, a.y2, 0, -1, 9, C.path)].join('\n');
      return svg;
    })
    .join('\n');
}
function roomLabelsLayer(): string {
  return data.roomLabels
    .map((l) => l.lines.map((ln, i) => text(l.x, l.y + i * (l.size + 1), ln, l.size, C.label, 'middle', 600)).join('\n'))
    .join('\n');
}
function calloutsLayer(): string {
  const out: string[] = [];
  for (const c of data.callouts) {
    const step = c.lineStep ?? c.size + 1;
    c.text.forEach((ln, i) => out.push(text(c.lx, c.ly + i * step, ln, c.size, C.callout, c.anchor, 700)));
    const pts: Array<[number, number]> = [...c.leader, c.target];
    out.push(polyline(pts, C.callout, 1.2));
    out.push(`<circle cx="${n(c.target[0])}" cy="${n(c.target[1])}" r="1.6" fill="${C.callout}" />`);
  }
  return out.join('\n');
}
function legendLayer(): string {
  const band = M.legendBand;
  const out: string[] = [rect(band, C.bg), line(band.x1, band.y1, band.x2, band.y1, C.wall, 2)];
  out.push(text(band.x1 + 8, band.y1 + LEG.headerDy, 'LEGENDA', 9, C.line, 'start', 700));
  data.legend.forEach((item, i) => {
    const col = Math.floor(i / 3);
    const row = i % 3;
    const cx = band.x1 + LEG.padX + col * LEG.colW;
    const cy = band.y1 + LEG.firstRowDy + row * LEG.rowGap;
    const sw: Rect = { x1: cx, y1: cy - LEG.swH / 2, x2: cx + LEG.swW, y2: cy + LEG.swH / 2 };
    out.push(text(cx + LEG.textDx, cy + 2.5, item.label, LEG.textSize, C.line));
    switch (item.kind) {
      case 'wall': out.push(line(cx, cy, cx + LEG.swW, cy, C.wall, S.wall)); break;
      case 'partition': out.push(line(cx, cy, cx + LEG.swW, cy, C.partition, S.partition, '7 5')); break;
      case 'door-in':
        out.push(line(cx + 2, cy - 6, cx + 2, cy + 4, C.line, S.door));
        out.push(polyline(arcPoints(cx + 2, cy - 2, 10, cx + 2, cy + 8, cx + 12, cy - 2), C.line, S.door));
        out.push(arrowHead(cx + 12, cy - 2, 1, -1, 4.5, C.line));
        break;
      case 'locked': out.push(padlock(cx + LEG.swW / 2, cy - 5)); break;
      case 'table': out.push(rect(sw, C.bg, C.line, 1.2)); break;
      case 'chair':
        out.push(rect(sw, C.bg, C.line, 1.2));
        out.push(line(sw.x1 + 2, sw.y1 + 2, sw.x2 - 2, sw.y1 + 2, C.line, S.chair * 2));
        break;
      case 'dispenser': out.push(dispenserSvg(sw)); break;
      case 'fridge': out.push(fridgeSvg(sw)); break;
      case 'path':
        out.push(line(cx, cy + 3, cx + LEG.swW, cy + 3, C.path, 2, '6 4'));
        out.push(arrowHead(cx + LEG.swW, cy + 3, 1, 0, 5, C.path));
        break;
    }
  });
  return out.join('\n');
}
function headerLayer(): string {
  const band = M.headerBand;
  const out: string[] = [rect(band, C.bg)];
  out.push(text(band.x1 + 8, band.y1 + HEAD.titleDy, M.title, HEAD.titleSize, C.line, 'start', 700));
  out.push(text(band.x1 + 8, band.y1 + HEAD.subDy, M.subtitle, HEAD.subSize, C.line, 'start', 700));
  out.push(text(band.x2 - 8, band.y1 + HEAD.noteDy, M.scaleNote, HEAD.noteSize, C.muted, 'end'));
  out.push(line(band.x1, band.y2, band.x2, band.y2, C.wall, 2));
  return out.join('\n');
}

function buildSvg(): string {
  const parts = [
    rect(VIEW, C.bg),
    scenesLayer(),
    wallsLayer(),
    furnitureSvgLayer(),
    openPathLayer(),
    roomLabelsLayer(),
    calloutsLayer(),
    headerLayer(),
    legendLayer(),
    rect(VIEW, 'none', C.wall, 2),
  ];
  const width = M.output.width;
  const height = Math.round((M.output.width * (VIEW.y2 - VIEW.y1)) / (VIEW.x2 - VIEW.x1));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${n(VIEW.x1)} ${n(VIEW.y1)} ${n(VIEW.x2 - VIEW.x1)} ${n(VIEW.y2 - VIEW.y1)}" font-family="DejaVu Sans Mono, ui-monospace, Menlo, Consolas, monospace">\n${parts.join('\n')}\n</svg>\n`;
}
function furnitureSvgLayer(): string {
  return data.furniture.map(furnitureSvg).join('\n');
}

// ---------------------------------------------------------------------------
// rasterization + output
// ---------------------------------------------------------------------------

function pngSize(p: string): { width: number; height: number } {
  const b = readFileSync(p);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}
function sha256(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}
function validateSvgXml(p: string): boolean {
  const r = spawnSync('python3', ['-c', 'import sys,xml.etree.ElementTree as ET; ET.parse(sys.argv[1])', p], { stdio: 'ignore' });
  return r.status === 0;
}
function rasterize(svgPath: string, pngPath: string, w: number, h: number): boolean {
  const candidates = [process.env.PANTRY_FOCUS_REVIEW_PY, '/tmp/homebase-svg-venv/bin/python3', 'python3'].filter(Boolean) as string[];
  const code = 'import cairosvg,sys; cairosvg.svg2png(url=sys.argv[1], write_to=sys.argv[2], output_width=int(sys.argv[3]), output_height=int(sys.argv[4]), background_color="white")';
  for (const py of candidates) {
    if (spawnSync(py, ['-c', 'import cairosvg'], { stdio: 'ignore' }).status !== 0) continue;
    const r = spawnSync(py, ['-c', code, svgPath, pngPath, String(w), String(h)], { stdio: 'inherit' });
    if (r.status === 0) return true;
  }
  return false;
}

validate();

const svg = buildSvg();
const width = M.output.width;
const height = Math.round((M.output.width * (VIEW.y2 - VIEW.y1)) / (VIEW.x2 - VIEW.x1));

mkdirSync(REVIEW_DIR, { recursive: true });
writeFileSync(SVG_PATH, svg);
console.log(`svg  ${SVG_PATH.split('/').pop()} ${width}x${height}`);

if (!validateSvgXml(SVG_PATH)) {
  console.error('invalid SVG XML');
  process.exit(1);
}

if (rasterize(SVG_PATH, PNG_PATH, width, height)) {
  const size = pngSize(PNG_PATH);
  if (size.width !== width || size.height !== height) {
    console.error(`PNG size mismatch: ${size.width}x${size.height} != ${width}x${height}`);
    process.exit(1);
  }
  console.log(`png  ${PNG_PATH.split('/').pop()} ${size.width}x${size.height}`);
} else {
  console.log('png  skipped (no local cairosvg interpreter found)');
}

// re-parse the JSON to prove it stays valid
JSON.parse(readFileSync(DATA_PATH, 'utf8'));

const counts: Record<string, number> = {};
for (const f of data.furniture) counts[f.group] = (counts[f.group] ?? 0) + 1;
console.log(`items ${data.furniture.length} ${JSON.stringify(counts)}`);
console.log(`sha256 svg ${sha256(SVG_PATH)}`);
try {
  console.log(`sha256 png ${sha256(PNG_PATH)}`);
} catch {
  /* png not written */
}
