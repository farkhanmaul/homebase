// Deterministic focused-review artifact generator — Panel C revision (work areas).
//
// Scope: ONLY the Desk Collection + Tele/CS/CA work areas of the office plan.
// It reads the single focused source of truth
//   docs/reviews/office-workareas-focus-v2.json
// and writes
//   docs/reviews/office-workareas-focus-v2.svg
//   docs/reviews/office-workareas-focus-v2.png
//
// It does NOT read, write or regenerate any structure/furniture v1/v2 artifact;
// instead it ASSERTS those protected hashes are unchanged. It renders from the
// approved structure-v2 + furniture-v1 data, applying ONLY:
//   (1) the top/north Tele/CS/CA partition omission  (x=1156..1465 at y=244)
//   (2) the new wall-mounted board "BEST AGENT PERFORMANCE" (furniture, not structure)
// Deterministic: fixed ordering, rounded numbers, no timestamps, no randomness.
// The PNG is a rasterization of the same generated SVG (no second drawing).
//
// Run: node --experimental-strip-types scripts/generate-workareas-focus-v2.ts

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REVIEW_DIR = resolve(HERE, '..', 'docs', 'reviews');
const DATA_PATH = resolve(REVIEW_DIR, 'office-workareas-focus-v2.json');
const SVG_PATH = resolve(REVIEW_DIR, 'office-workareas-focus-v2.svg');
const PNG_PATH = resolve(REVIEW_DIR, 'office-workareas-focus-v2.png');

type Rect = { x1: number; y1: number; x2: number; y2: number };
type Room = Rect & { id: string; name: string; kind: string };
type Wall = Rect & { id: string; type: 'full' | 'partition'; derived?: boolean; note?: string };
type Win = Rect & { id: string; note?: string };
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
};
type OpenPath = { id: string; label: string; zone: string; x1: number; y1: number; x2: number; y2: number; arrow: { x: number; y1: number; y2: number } };
type BankMeta = { orientation: 'h' | 'v'; divider?: boolean; leftCap?: boolean };
type FurnitureType = 'bank' | 'chair' | 'board';
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
  bank?: BankMeta;
  structural?: boolean;
  interactable?: boolean;
  label?: string;
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
type OverrideSegment = { id: string; action: string; axis: 'h' | 'v'; y: number; x1: number; x2: number; type: string };
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
  reference: {
    inherited: Record<string, { bank: number; chair: number; ids: string[] }>;
  };
  overrides: { structure: OverrideSegment[]; furniture: Array<{ id: string; action: string; ref: string }> };
  board: { id: string; label: string; kind: string; structural: boolean; interactable: boolean; room: string; mount: { wall: string; wallX: number; face: string; facesInto: string }; shape: 'rect'; rect: Rect };
  rooms: Room[];
  walls: Wall[];
  windows: Win[];
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
  firstRowDy: 26,
  rowGap: 15,
  rows: 3,
  swW: 20,
  swH: 8,
  textDx: 26,
  textSize: 7.2,
  padX: 10,
  colW: (M.legendBand.x2 - M.legendBand.x1 - 12) / 3,
};
const HEAD = { titleDy: 15, titleSize: 13, subDy: 30, subSize: 7.6, noteDy: 43, noteSize: 6 };

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
function sameSeg(a: Rect, b: Rect): boolean {
  return a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2;
}
function isHoriz(r: Rect): boolean {
  return r.y1 === r.y2;
}
function isVert(r: Rect): boolean {
  return r.x1 === r.x2;
}
function segContains(outer: Rect, inner: Rect): boolean {
  if (sameSeg(outer, inner)) return true;
  if (isHoriz(outer) && isHoriz(inner) && outer.y1 === inner.y1) {
    return Math.min(outer.x1, outer.x2) <= Math.min(inner.x1, inner.x2) + 0.001 && Math.max(outer.x1, outer.x2) >= Math.max(inner.x1, inner.x2) - 0.001;
  }
  if (isVert(outer) && isVert(inner) && outer.x1 === inner.x1) {
    return Math.min(outer.y1, outer.y2) <= Math.min(inner.y1, inner.y2) + 0.001 && Math.max(outer.y1, outer.y2) >= Math.max(inner.y1, inner.y2) - 0.001;
  }
  return false;
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
  'dc-bank': 2,
  'dc-chair': 34,
  'tc-bank': 2,
  'tc-chair': 24,
  board: 1,
};
const FURN_GEOM_KEYS = ['type', 'room', 'shape', 'rect', 'point', 'w', 'h', 'facing', 'bank'] as const;
function geomOf(value: object): string {
  const f = value as Record<string, unknown>;
  const o: Record<string, unknown> = {};
  for (const k of FURN_GEOM_KEYS) o[k] = f[k] ?? null;
  return JSON.stringify(o);
}

function validate(): void {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const x of [...data.rooms, ...data.walls, ...data.windows, ...data.doors, ...data.openPaths, ...data.furniture, ...data.callouts] as Array<{ id: string }>) {
    if (ids.has(x.id)) errs.push(`duplicate id: ${x.id}`);
    ids.add(x.id);
  }

  // --- group counts (exact) ---
  const groupCount: Record<string, number> = {};
  for (const f of data.furniture) groupCount[f.group] = (groupCount[f.group] ?? 0) + 1;
  for (const [g, want] of Object.entries(REQUIRED_GROUPS)) {
    const got = groupCount[g] ?? 0;
    if (got !== want) errs.push(`group ${g}: expected ${want}, got ${got}`);
  }
  for (const g of Object.keys(groupCount)) if (!(g in REQUIRED_GROUPS)) errs.push(`unexpected group: ${g}`);

  // --- furniture shape sanity ---
  for (const f of data.furniture) {
    if (f.shape === 'rect' && (!f.rect || f.rect.x2 - f.rect.x1 <= 0 || f.rect.y2 - f.rect.y1 <= 0)) errs.push(`${f.id}: bad rect`);
    if (f.shape === 'point' && (!f.point || !(f.w && f.w > 0) || !(f.h && f.h > 0))) errs.push(`${f.id}: bad point`);
    if (!ROOMS.has(f.room)) errs.push(`${f.id}: unknown room ${f.room}`);
  }

  // --- board is furniture/interactable, mounted east of the Meeting-2 wall (x=695) ---
  const bf = data.furniture.find((f) => f.id === data.board.id);
  if (!bf || bf.type !== 'board') errs.push('board item missing or wrong type');
  else {
    if (bf.structural !== false || bf.interactable !== true) errs.push('board must be furniture/interactable, not structural');
    if (bf.room !== 'desk-collection') errs.push('board must belong to desk-collection');
    if (!bf.rect || !sameSeg(bf.rect, data.board.rect)) errs.push('board rect differs from the reference');
    if (bf.label !== data.board.label) errs.push('board label differs from the reference');
    const b = bf.rect as Rect;
    if (b.x1 < 695 - 0.001) errs.push('board must be east of the Meeting-2 wall (x>=695)');
    if (b.x1 - 695 > 8) errs.push('board is not mounted close to the Meeting-2 wall');
    if (!contains(ROOMS.get('desk-collection') as Rect, b)) errs.push('board is not inside desk-collection');
    if (data.board.mount.wallX !== 695 || data.board.mount.face !== 'east') errs.push('board mount must be wall x=695, facing east');
    // must not block a door opening or the Desk Collection top gap C6
    const doorBox: Rect = { x1: 695 - 1, y1: 430, x2: 695 + 1, y2: 466 };
    if (overlap(b, doorBox) > 0) errs.push('board overlaps the server door opening');
    const gapBox: Rect = { x1: 704, y1: 243, x2: 728, y2: 245 };
    if (overlap(b, gapBox) > 0) errs.push('board overlaps Desk Collection gap C6');
  }
  const boards = data.furniture.filter((f) => f.type === 'board');
  if (boards.length === 0) errs.push('no board furniture present');
  if (boards.some((b) => b.structural !== false)) errs.push('board must be classified as non-structural furniture');

  // --- override: the top/north Tele/CS/CA partition is omitted, exactly ---
  const structRaw = JSON.parse(readFileSync(resolve(REVIEW_DIR, 'office-structure-review-v2.json'), 'utf8'));
  const structWalls: Array<Rect & { type: string }> = structRaw.walls;
  const structWins: Rect[] = structRaw.windows;
  const ov = data.overrides.structure.find((o) => o.id === 'OV-TOP-OPEN');
  if (!ov) errs.push('missing structure override OV-TOP-OPEN');
  else {
    if (ov.action !== 'omit-segment' || ov.axis !== 'h' || ov.y !== 244 || ov.x1 !== 1156 || ov.x2 !== 1465 || ov.type !== 'partition') {
      errs.push('override OV-TOP-OPEN must be exactly x1156..1465 at y=244 (partition)');
    }
    const src = structWalls.find((w) => sameSeg(w, { x1: 695, y1: 244, x2: 1465, y2: 244 }) && w.type === 'partition');
    if (!src) errs.push('structure v2 no longer has the approved x695..1465 top partition');
  }
  const dcTop = data.walls.filter((w) => w.y1 === 244 && w.y2 === 244);
  for (const w of dcTop) {
    if (Math.max(w.x1, w.x2) > 1156 + 0.001) errs.push(`wall ${w.id} extends into the omitted Tele/CS/CA top span`);
  }
  if (!dcTop.some((w) => Math.max(w.x1, w.x2) === 1156)) errs.push('Desk Collection top must reach the x=1156 separator');
  // the top span 695..1156 must be fully covered except the C6 gap 704..728
  const covered: Array<[number, number]> = dcTop.map((w): [number, number] => [Math.min(w.x1, w.x2), Math.max(w.x1, w.x2)]).sort((a, b) => a[0] - b[0]);
  const gapLen = 728 - 704;
  const total = covered.reduce((s, [a, b]) => s + (b - a), 0) + gapLen;
  if (total !== 1156 - 695) errs.push('Desk Collection top coverage is not exactly 695..1156 minus the C6 gap');
  if (covered.length && covered[0][0] !== 695) errs.push('Desk Collection top must start at x=695');

  // --- walls fidelity: each wall is a structure-v2 wall (or a sub-segment) ---
  for (const w of data.walls) {
    const ok = structWalls.some((s) => s.type === w.type && segContains(s, w));
    if (!ok) errs.push(`wall ${w.id} is not present in structure v2`);
  }
  for (const win of data.windows) {
    const ok = structWins.some((s) => segContains(s, win));
    if (!ok) errs.push(`window ${win.id} is not present in structure v2`);
  }

  // --- open path: the omitted span must be crossed by no wall ---
  const p = data.openPaths[0];
  if (!p || !sameSeg(p as unknown as Rect, { x1: 1156, y1: 189, x2: 1465, y2: 244 })) {
    errs.push('open path P-OPEN must be exactly x1156..1465, y189..244');
  }
  for (const op of data.openPaths) {
    const box: Rect = { x1: op.x1, y1: op.y1, x2: op.x2, y2: op.y2 };
    for (const w of [...data.walls, ...data.windows]) {
      if (segmentCrossesInterior(w, box)) errs.push(`${op.id}: ${w.id} crosses the open span`);
    }
    const ab: Rect = { x1: op.arrow.x - 0.5, y1: Math.min(op.arrow.y1, op.arrow.y2), x2: op.arrow.x + 0.5, y2: Math.max(op.arrow.y1, op.arrow.y2) };
    for (const w of [...data.walls, ...data.windows]) {
      if (segmentCrossesInterior(w, ab)) errs.push(`${op.id}: ${w.id} crosses the open arrow`);
    }
    if (!(op.arrow.x > op.x1 && op.arrow.x < op.x2)) errs.push(`${op.id}: arrow is outside the open span`);
  }

  // --- inherited furniture must be byte/data-identical to furniture v1 ---
  const fur = JSON.parse(readFileSync(resolve(REVIEW_DIR, 'office-furniture-review-v1.json'), 'utf8')) as {
    furniture: Array<{ id: string; room?: string; type?: string; shape?: string; rect?: Rect; point?: { x: number; y: number }; w?: number; h?: number; facing?: string; bank?: unknown }>;
  };
  const prior = new Map<string, (typeof fur.furniture)[number]>(fur.furniture.map((f) => [f.id, f]));
  const inheritedRooms = ['desk-collection', 'tele-cs-ca'];
  const priorIds = fur.furniture.filter((f) => inheritedRooms.includes(f.room ?? '')).map((f) => f.id);
  const mineIds = data.furniture.filter((f) => f.group !== 'board').map((f) => f.id);
  const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  if (JSON.stringify([...priorIds].sort(compareIds)) !== JSON.stringify([...mineIds].sort(compareIds))) {
    errs.push('inherited furniture id set differs from furniture v1 for the work areas');
  }
  for (const f of data.furniture) {
    if (f.group === 'board') continue;
    const p0 = prior.get(f.id);
    if (!p0) {
      errs.push(`${f.id}: not found in furniture v1`);
      continue;
    }
    if (geomOf(p0) !== geomOf(f)) errs.push(`${f.id}: geometry/placement differs from furniture v1`);
  }
  const dcChairs = data.furniture.filter((f) => f.room === 'desk-collection' && f.type === 'chair').length;
  const tcChairs = data.furniture.filter((f) => f.room === 'tele-cs-ca' && f.type === 'chair').length;
  if (dcChairs !== 34) errs.push(`Desk Collection chairs: expected 34, got ${dcChairs}`);
  if (tcChairs !== 24) errs.push(`Tele/CS/CA chairs: expected 24, got ${tcChairs}`);
  for (const [room, ref] of Object.entries(data.reference.inherited)) {
    const mine = data.furniture.filter((f) => f.room === room && f.group !== 'board').map((f) => f.id).sort(compareIds);
    if (JSON.stringify(mine) !== JSON.stringify([...ref.ids].sort(compareIds))) errs.push(`${room}: inherited ids differ from the reference list`);
    const banks = data.furniture.filter((f) => f.room === room && f.type === 'bank').length;
    const chairs = data.furniture.filter((f) => f.room === room && f.type === 'chair').length;
    if (banks !== ref.bank) errs.push(`${room}: bank count ${banks} != ${ref.bank}`);
    if (chairs !== ref.chair) errs.push(`${room}: chair count ${chairs} != ${ref.chair}`);
  }

  // --- room labels inside the view / known rooms ---
  for (const l of data.roomLabels) {
    if (!ROOMS.has(l.room)) errs.push(`label for unknown room ${l.room}`);
    const w = Math.max(...l.lines.map((s) => s.length)) * l.size * 0.62;
    const box = { x1: l.x - w / 2, y1: l.y - l.size, x2: l.x + w / 2, y2: l.y + (l.lines.length - 1) * (l.size + 1) + l.size * 0.3 };
    if (!contains(VIEW, box)) errs.push(`room label ${l.room} leaves the view`);
  }

  // --- protected artifacts must be byte-identical ---
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
  for (const op of data.openPaths) featureTops.push(Math.min(op.y1, op.arrow.y2));
  const contentTop = Math.min(...featureTops);
  const contentBottom = Math.max(...featureBottoms);
  if (M.headerBand.y2 > contentTop - MIN_SEP) errs.push(`header band overlaps/too close to content (${M.headerBand.y2} > ${n(contentTop - MIN_SEP)})`);
  if (M.legendBand.y1 < contentBottom + MIN_SEP) errs.push(`legend band overlaps/too close to content (${M.legendBand.y1} < ${n(contentBottom + MIN_SEP)})`);

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
  const boardCallout = boxes.find((b) => b.c.id === 'CO-BOARD');
  if (boardCallout && bf) {
    const t = boardCallout.c.target;
    if (!contains(bf.rect as Rect, { x1: t[0], y1: t[1], x2: t[0], y2: t[1] })) errs.push('CO-BOARD target is not inside the board');
  }
  // room labels must be clear of furniture too
  for (const l of data.roomLabels) {
    const lw = Math.max(...l.lines.map((s) => s.length)) * l.size * 0.62;
    const lbox = { x1: l.x - lw / 2, y1: l.y - l.size, x2: l.x + lw / 2, y2: l.y + (l.lines.length - 1) * (l.size + 1) + l.size * 0.3 };
    for (const f of data.furniture) if (overlap(lbox, boundsOf(f)) > 0) errs.push(`room label ${l.room} overlaps furniture ${f.id}`);
  }

  if (errs.length) throw new Error(`workareas focus v2 validation failed:\n - ${errs.join('\n - ')}`);
}

// ---------------------------------------------------------------------------
// symbols
// ---------------------------------------------------------------------------

// Floors are left unshaded (same tone as the background), exactly like
// structure v2. This is deliberate: any tint edge at y=244 would read as a
// false partition across the open Tele/CS/CA top. Openness is shown only by the
// absent partition, the callout and the dashed open arrow.
function floorFill(_kind: string): string {
  return C.floorOffice;
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
    out.push(arrowHead(arc[0][0], arc[0][1], arc[0][0] - arc[1][0], arc[0][1] - arc[1][1], 7, C.line));
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
    out.push(arrowHead(arc[0][0], arc[0][1], arc[0][0] - arc[1][0], arc[0][1] - arc[1][1], 7, C.line));
  }
  return out.join('\n');
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
function bankSvg(r: Rect, b: BankMeta): string {
  const out = [rect(r, C.bg, C.line, S.furniture)];
  const cx = (r.x1 + r.x2) / 2;
  const cy = (r.y1 + r.y2) / 2;
  if (b.orientation === 'h') {
    if (b.divider) out.push(line(r.x1, cy, r.x2, cy, C.line, S.chair));
    if (b.leftCap) out.push(line(r.x1 + 12, r.y1, r.x1 + 12, r.y2, C.line, S.chair));
  } else {
    if (b.divider) out.push(line(cx, r.y1, cx, r.y2, C.line, S.chair));
  }
  return out.join('\n');
}
function boardSvg(r: Rect): string {
  const inner = { x1: r.x1 + 3, y1: r.y1 + 3, x2: r.x2 - 3, y2: r.y2 - 3 };
  const ticks = [line(r.x1 - 3, r.y1 + 8, r.x1, r.y1 + 8, C.boardLine, S.chair), line(r.x1 - 3, r.y2 - 8, r.x1, r.y2 - 8, C.boardLine, S.chair)];
  return [rect(r, C.board, C.boardLine, S.board), rect(inner, 'none', C.boardLine, 1), ...ticks].join('\n');
}
function furnitureSvg(f: Furniture): string {
  switch (f.type) {
    case 'chair': return chairSvg(f);
    case 'bank': return bankSvg(boundsOf(f), f.bank as BankMeta);
    case 'board': return boardSvg(boundsOf(f));
    default: return rect(boundsOf(f), C.bg, C.line, S.furniture);
  }
}

// ---------------------------------------------------------------------------
// layers
// ---------------------------------------------------------------------------

function wallsLayer(): string {
  const cuts = data.doors.map((d) => cut(d, S.wall / 2 + 2)).join('\n');
  const walls = data.walls
    .map((w) => line(w.x1, w.y1, w.x2, w.y2, w.type === 'full' ? C.wall : C.partition, w.type === 'full' ? S.wall : S.partition, w.type === 'partition' ? '7 5' : undefined))
    .join('\n');
  const wins = data.windows.map((w) => line(w.x1, w.y1, w.x2, w.y2, C.window, S.window)).join('\n');
  const doors = data.doors.map(doorSymbol).join('\n');
  return [cuts, walls, wins, doors].filter(Boolean).join('\n');
}
function scenesLayer(): string {
  return data.rooms.map((r) => rect(r, floorFill(r.kind))).join('\n');
}
function openPathLayer(): string {
  return data.openPaths
    .map((p) => {
      const a = p.arrow;
      const dash = '7 6';
      const svg = [line(a.x, a.y1, a.x, a.y2 + 8, C.path, S.path, dash), arrowHead(a.x, a.y2, 0, -1, 9, C.path)].join('\n');
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
    out.push(polyline([...c.leader, c.target], C.callout, 1.2));
    out.push(`<circle cx="${n(c.target[0])}" cy="${n(c.target[1])}" r="1.6" fill="${C.callout}" />`);
  }
  return out.join('\n');
}
function bankLegend(sw: Rect): string {
  return bankSvg(sw, { orientation: 'h', divider: true, leftCap: true });
}
function legendLayer(): string {
  const band = M.legendBand;
  const out: string[] = [rect(band, C.bg), line(band.x1, band.y1, band.x2, band.y1, C.wall, 2)];
  out.push(text(band.x1 + 8, band.y1 + LEG.headerDy, 'LEGENDA', 9, C.line, 'start', 700));
  data.legend.forEach((item, i) => {
    const col = Math.floor(i / LEG.rows);
    const row = i % LEG.rows;
    const cx = band.x1 + LEG.padX + col * LEG.colW;
    const cy = band.y1 + LEG.firstRowDy + row * LEG.rowGap;
    const sw: Rect = { x1: cx, y1: cy - LEG.swH / 2, x2: cx + LEG.swW, y2: cy + LEG.swH / 2 };
    out.push(text(cx + LEG.textDx, cy + 2.5, item.label, LEG.textSize, C.line));
    switch (item.kind) {
      case 'wall': out.push(line(cx, cy, cx + LEG.swW, cy, C.wall, S.wall)); break;
      case 'partition': out.push(line(cx, cy, cx + LEG.swW, cy, C.partition, S.partition, '7 5')); break;
      case 'window': out.push(line(cx, cy - 2, cx + LEG.swW, cy - 2, C.window, S.window)); out.push(line(cx, cy + 2, cx + LEG.swW, cy + 2, C.window, S.window)); break;
      case 'door':
        out.push(line(cx + 2, cy - 6, cx + 2, cy + 4, C.line, S.door));
        out.push(polyline(arcPoints(cx + 2, cy - 2, 10, cx + 2, cy + 8, cx + 12, cy - 2), C.line, S.door));
        out.push(arrowHead(cx + 12, cy - 2, 1, -1, 4.5, C.line));
        break;
      case 'bank': out.push(bankLegend(sw)); break;
      case 'chair':
        out.push(rect(sw, C.bg, C.line, 1.2));
        out.push(line(sw.x1 + 2, sw.y1 + 2, sw.x2 - 2, sw.y1 + 2, C.line, S.chair * 2));
        break;
      case 'board':
        out.push(rect(sw, C.board, C.boardLine, 1.2));
        out.push(rect({ x1: sw.x1 + 2, y1: sw.y1 + 2, x2: sw.x2 - 2, y2: sw.y2 - 2 }, 'none', C.boardLine, 1));
        break;
      case 'open':
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

const ZTOP = new Set<FurnitureType>(['chair']);
function furnitureSvgLayer(): string {
  const base = data.furniture.filter((f) => !ZTOP.has(f.type));
  const top = data.furniture.filter((f) => ZTOP.has(f.type));
  return [...base, ...top].map(furnitureSvg).join('\n');
}

function buildSvg(): string {
  const height = Math.round((M.output.width * (VIEW.y2 - VIEW.y1)) / (VIEW.x2 - VIEW.x1));
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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${M.output.width}" height="${height}" viewBox="${n(VIEW.x1)} ${n(VIEW.y1)} ${n(VIEW.x2 - VIEW.x1)} ${n(VIEW.y2 - VIEW.y1)}" font-family="DejaVu Sans Mono, ui-monospace, Menlo, Consolas, monospace">\n${parts.join('\n')}\n</svg>\n`;
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
  const candidates = [process.env.WORKAREAS_FOCUS_REVIEW_PY, '/tmp/homebase-svg-venv/bin/python3', 'python3'].filter(Boolean) as string[];
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
