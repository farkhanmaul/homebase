// Deterministic focused-review artifact generator — Panel C revision 4 (work areas).
//
// Scope: ONLY the Desk Collection + Tele/CS/CA work areas of the office plan.
// It reads the single focused source of truth
//   docs/reviews/office-workareas-focus-v4.json
// and writes
//   docs/reviews/office-workareas-focus-v4.svg
//   docs/reviews/office-workareas-focus-v4.png
//
// It does NOT read, write or regenerate any structure/furniture v1/v2 artifact
// or the workareas v2/v3 artifacts. Instead it ASSERTS all of those protected
// hashes are unchanged, and it asserts (delta check) that, relative to
// office-workareas-focus-v3.json, ONLY these things changed:
//   (1) the two far-left side-facing Desk Collection chairs — moved to x=738
//       (left edge x=725) so the west lane keeps >=24 px clear after the wall
//       stroke, for the REAL 18 x 12 px app actor footprint
//   (2) the access-aisle annotation (accessAisle: lane / detours / actor /
//       widths / route / goal / label notes)
//   (3) the wall stroke (3 -> 2) so the drawn wall face (x=696) matches the
//       solid-wall model and the measured clear width is exactly 24 px
//   (4) version metadata (meta.id/version/subtitle/protected)
// The board (x=697..704, y=250..292) and everything else (rooms, walls,
// windows, doors, open paths, labels, callouts, banks and every other chair,
// the Tele top-open correction) is byte-for-byte identical to v3.
//
// Movement validation: a grid BFS with the real actor footprint WIDTH=18 (x)
// and DEPTH/HEIGHT=12 (y). Walls (with their stroke thickness), desks and chairs
// are SOLID; the wall board is wall-mounted and therefore NON-solid. The BFS
// proves the C6/top entrance reaches a point beside the Server door and the
// lower desk bank.
//
// Deterministic: fixed ordering, rounded numbers, no timestamps, no randomness.
// The PNG is a rasterization of the same generated SVG (no second drawing).
//
// Run: node --experimental-strip-types scripts/generate-workareas-focus-v4.ts

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REVIEW_DIR = resolve(HERE, '..', 'docs', 'reviews');
const DATA_PATH = resolve(REVIEW_DIR, 'office-workareas-focus-v4.json');
const SVG_PATH = resolve(REVIEW_DIR, 'office-workareas-focus-v4.svg');
const PNG_PATH = resolve(REVIEW_DIR, 'office-workareas-focus-v4.png');
const V3_JSON = resolve(REVIEW_DIR, 'office-workareas-focus-v3.json');

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
type OverrideFurniture = { id: string; action: string; ref: string; reason?: string; delta?: { x: number } };
type AccessAisle = {
  id: string;
  kind: string;
  label: string;
  note: string;
  wall: string;
  wallX: number;
  wallFaceSourcePx: number;
  lane: Rect;
  detours: Array<Rect & { id: string; around: string; clearWidthSourcePx: number }>;
  actor: { w: number; h: number; note?: string };
  widths: { openSourcePx: number; bankBandSourcePx: number; sideChairBandSourcePx: number; sideChairClearSourcePx: number; targetSourcePx: number; minSourcePx: number; note: string };
  start: [number, number];
  goal: [number, number];
  route: Array<[number, number]>;
  labelAt: { x: number; y: number; size: number; anchor: 'start' | 'middle' | 'end' };
  correction: string;
};
type Data = {
  meta: {
    id: string;
    version: string;
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
  overrides: { structure: OverrideSegment[]; furniture: OverrideFurniture[] };
  board: { id: string; label: string; kind: string; structural: boolean; interactable: boolean; room: string; mount: { wall: string; wallX: number; face: string; facesInto: string }; shape: 'rect'; rect: Rect };
  accessAisle: AccessAisle;
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

// v4 constants (single source for validation & rendering).
const BOARD_RECT: Rect = { x1: 697, y1: 250, x2: 704, y2: 292 };
const SIDE_CHAIR_IDS = ['F-DC-T-SIDE', 'F-DC-B-SIDE'];
const SIDE_CHAIR_X = 738; // center; w=26 -> left edge 725, right edge 751
const SIDE_CHAIR_DX_V1 = SIDE_CHAIR_X - 708; // +30 vs furniture v1
const SIDE_CHAIR_DX_V3 = SIDE_CHAIR_X - 722; // +16 vs workareas v3
const SIDE_CHAIR_MIN_LEFT = 724; // user requirement: left edge >= x=724
const CAP_TUCK = 40; // max px a tucked side chair may reach into its bank from the short cap
const ACTOR_W = 18; // real app actor footprint: lateral (x)
const ACTOR_H = 12; // real app actor footprint: along travel (y)
const MIN_CLEAR = 24; // required west-lane clear width (source px)

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
function polygon(pts: Array<[number, number]>, stroke: string, width: number, dash?: string): string {
  const d = dash ? ` stroke-dasharray="${dash}"` : '';
  return `<polygon points="${pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="none" stroke="${stroke}" stroke-width="${width}"${d} stroke-linejoin="round" />`;
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
// movement model + validation
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

// Obstacles for movement: desk banks + chairs are solid; the wall board is
// wall-mounted, so it is NON-solid and excluded.
function furnitureSolids(): Rect[] {
  return data.furniture.filter((f) => f.type !== 'board').map(boundsOf);
}
function segSolid(r: Rect, t: number): Rect {
  if (r.y1 === r.y2) {
    const y = r.y1;
    return { x1: Math.min(r.x1, r.x2), x2: Math.max(r.x1, r.x2), y1: y - t / 2, y2: y + t / 2 };
  }
  const x = r.x1;
  return { x1: x - t / 2, x2: x + t / 2, y1: Math.min(r.y1, r.y2), y2: Math.max(r.y1, r.y2) };
}
// Walls/windows are solid with their drawn stroke thickness.
function wallSolids(): Rect[] {
  const out: Rect[] = [];
  for (const w of data.walls) out.push(segSolid(w, w.type === 'full' ? S.wall : S.partition));
  for (const win of data.windows) out.push(segSolid(win, S.window));
  return out;
}
function movementSolids(): Rect[] {
  return [...furnitureSolids(), ...wallSolids()];
}
function wallFaceX(): number {
  return data.accessAisle.wallX + S.wall / 2;
}
function actorFree(x: number, y: number, w: number, h: number, room: Rect): boolean {
  const box: Rect = { x1: x - w / 2, y1: y - h / 2, x2: x + w / 2, y2: y + h / 2 };
  if (box.x1 < room.x1 - 1e-9 || box.y1 < room.y1 - 1e-9 || box.x2 > room.x2 + 1e-9 || box.y2 > room.y2 + 1e-9) return false;
  for (const s of movementSolids()) if (overlap(box, s) > 1e-9) return false;
  return true;
}
function pointInSolid(x: number, y: number): boolean {
  for (const s of movementSolids()) if (x > s.x1 + 1e-9 && x < s.x2 - 1e-9 && y > s.y1 + 1e-9 && y < s.y2 - 1e-9) return true;
  return false;
}

// Grid BFS (4-connected, 0.5 source-px step) over the desk-collection west strip.
function aisleBfs(a: AccessAisle): { ok: boolean; reason: string } {
  const room = ROOMS.get('desk-collection') as Rect;
  const step = 0.5;
  const win: Rect = { x1: room.x1, y1: room.y1, x2: 780, y2: room.y2 };
  const { w: aw, h: ah } = a.actor;
  const nx = Math.round((win.x2 - win.x1) / step) + 1;
  const ny = Math.round((win.y2 - win.y1) / step) + 1;
  const idx = (ix: number, iy: number) => iy * nx + ix;
  const cx = (ix: number) => win.x1 + ix * step;
  const cy = (iy: number) => win.y1 + iy * step;

  const grid = new Uint8Array(nx * ny);
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) grid[idx(ix, iy)] = actorFree(cx(ix), cy(iy), aw, ah, win) ? 1 : 0;
  }
  const toIx = (x: number) => Math.round((x - win.x1) / step);
  const toIy = (y: number) => Math.round((y - win.y1) / step);
  const si = { ix: toIx(a.start[0]), iy: toIy(a.start[1]) };
  const gi = { ix: toIx(a.goal[0]), iy: toIy(a.goal[1]) };
  if (si.ix < 0 || si.iy < 0 || si.ix >= nx || si.iy >= ny) return { ok: false, reason: 'start outside the search window' };
  if (gi.ix < 0 || gi.iy < 0 || gi.ix >= nx || gi.iy >= ny) return { ok: false, reason: 'goal outside the search window' };
  if (!grid[idx(si.ix, si.iy)]) return { ok: false, reason: 'start cell is blocked for the actor footprint' };
  if (!grid[idx(gi.ix, gi.iy)]) return { ok: false, reason: 'goal cell is blocked for the actor footprint' };

  const seen = new Uint8Array(nx * ny);
  const queue = new Int32Array(nx * ny);
  let head = 0;
  let tail = 0;
  const s = idx(si.ix, si.iy);
  queue[tail++] = s;
  seen[s] = 1;
  const g = idx(gi.ix, gi.iy);
  while (head < tail) {
    const cur = queue[head++];
    if (cur === g) return { ok: true, reason: 'reachable' };
    const ix = cur % nx;
    const iy = (cur - ix) / nx;
    const neighbours: Array<[number, number]> = [
      [ix + 1, iy],
      [ix - 1, iy],
      [ix, iy + 1],
      [ix, iy - 1],
    ];
    for (const [jx, jy] of neighbours) {
      if (jx < 0 || jy < 0 || jx >= nx || jy >= ny) continue;
      const j = idx(jx, jy);
      if (seen[j] || !grid[j]) continue;
      seen[j] = 1;
      queue[tail++] = j;
    }
  }
  return { ok: false, reason: 'no 4-connected actor path from C6/top to the Server door' };
}

function labelBox(x: number, y: number, size: number, anchor: 'start' | 'middle' | 'end', textLines: string[]): Rect {
  const w = Math.max(...textLines.map((t) => t.length)) * size * 0.62;
  const x1 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  return { x1, y1: y - size, x2: x1 + w, y2: y + size * 0.3 };
}
function calloutBox(c: Callout): Rect {
  const w = Math.max(...c.text.map((t) => t.length)) * c.size * 0.62;
  const x1 = c.anchor === 'start' ? c.lx : c.anchor === 'end' ? c.lx - w : c.lx - w / 2;
  const step = c.lineStep ?? c.size + 1;
  return { x1, y1: c.ly - c.size, x2: x1 + w, y2: c.ly + (c.text.length - 1) * step + c.size * 0.3 };
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

  // --- board: slim, flush-mounted, upper wall segment, unchanged from v3 ---
  const bf = data.furniture.find((f) => f.id === data.board.id);
  const dcChairsById = new Map(data.furniture.filter((f) => f.room === 'desk-collection' && f.type === 'chair').map((f) => [f.id, f]));
  const topSide = dcChairsById.get('F-DC-T-SIDE');
  const bottomSide = dcChairsById.get('F-DC-B-SIDE');
  if (!bf || bf.type !== 'board') errs.push('board item missing or wrong type');
  else {
    if (bf.structural !== false || bf.interactable !== true) errs.push('board must be furniture/interactable, not structural');
    if (bf.room !== 'desk-collection') errs.push('board must belong to desk-collection');
    if (!bf.rect || !sameSeg(bf.rect, data.board.rect)) errs.push('board rect differs from the reference');
    if (!sameSeg(bf.rect as Rect, BOARD_RECT)) errs.push('board rect must be exactly x=697..704, y=250..292');
    if (bf.label !== data.board.label) errs.push('board label differs from the reference');
    const b = bf.rect as Rect;
    if (b.x1 < wallFaceX() - 0.001) errs.push('board must be east of the wall face (x>=696)');
    if (b.x1 - 695 > 3) errs.push('board is not flush-mounted to the Meeting-2 wall (gap > 3)');
    if (b.x2 - b.x1 !== 7) errs.push('board must be slim: exactly 7 px deep');
    if (b.y1 < 244 || b.y2 > 299) errs.push('board must sit in the upper wall segment, above the side chair (y=250..292)');
    if (!contains(ROOMS.get('desk-collection') as Rect, b)) errs.push('board is not inside desk-collection');
    if (data.board.mount.wallX !== 695 || data.board.mount.face !== 'east' || data.board.mount.facesInto !== 'desk-collection') {
      errs.push('board mount must be wall x=695, facing east into desk-collection');
    }
    const doorBox: Rect = { x1: 695 - 1, y1: 430, x2: 695 + 1, y2: 466 };
    if (overlap(b, doorBox) > 0) errs.push('board overlaps the server door opening');
    const gapBox: Rect = { x1: 704, y1: 243, x2: 728, y2: 245 };
    if (overlap(b, gapBox) > 0) errs.push('board overlaps Desk Collection gap C6');
    for (const sc of [topSide, bottomSide]) {
      if (sc && overlap(b, boundsOf(sc)) > 0) errs.push(`board overlaps side chair ${sc.id}`);
    }
    for (const bank of data.furniture.filter((f) => f.type === 'bank')) {
      if (overlap(b, boundsOf(bank)) > 0) errs.push(`board overlaps desk bank ${bank.id}`);
    }
  }
  const boards = data.furniture.filter((f) => f.type === 'board');
  if (boards.length === 0) errs.push('no board furniture present');
  if (boards.some((b) => b.structural !== false)) errs.push('board must be classified as non-structural furniture');

  // --- v4 side chairs: shifted right to x=738 (left edge 725), tucked into the cap ---
  const banks = data.furniture.filter((f) => f.type === 'bank' && f.room === 'desk-collection');
  for (const id of SIDE_CHAIR_IDS) {
    const sc = dcChairsById.get(id);
    if (!sc) {
      errs.push(`missing side chair ${id}`);
      continue;
    }
    if (sc.w !== 26 || sc.h !== 24 || sc.facing !== 'right') errs.push(`${id}: side chair shape/facing changed`);
    const box = boundsOf(sc);
    if (box.x1 < SIDE_CHAIR_MIN_LEFT - 0.001) errs.push(`${id}: left edge x=${n(box.x1)} must be >= ${SIDE_CHAIR_MIN_LEFT}`);
    if (sc.point?.x !== SIDE_CHAIR_X) errs.push(`${id}: center x must be ${SIDE_CHAIR_X} (got ${sc.point?.x})`);
    // tucks into its own bank's short cap, without stabbing deep into the desk surface
    let tucked = false;
    for (const bank of banks) {
      const br = boundsOf(bank);
      if (box.y1 < br.y2 && box.y2 > br.y1) {
        if (box.x2 <= br.x1 + CAP_TUCK + 0.001) tucked = true;
        else errs.push(`${id}: reaches too far into ${bank.id} (beyond its short cap)`);
      }
    }
    if (!tucked) errs.push(`${id}: side chair is not tucked against its bank's short cap`);
    // must not collide with any other chair
    for (const other of data.furniture) {
      if (other.type !== 'chair' || other.id === id) continue;
      if (overlap(box, boundsOf(other)) > 0) errs.push(`${id}: overlaps chair ${other.id}`);
    }
  }

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

  // --- inherited furniture vs furniture v1 (only the two side chairs shift +30 x) ---
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
    if (SIDE_CHAIR_IDS.includes(f.id)) {
      const o0 = JSON.parse(geomOf(p0));
      const o1 = JSON.parse(geomOf(f));
      if (o1.point) o1.point.x = o0.point.x;
      if (JSON.stringify(o0) !== JSON.stringify(o1)) errs.push(`${f.id}: geometry differs from furniture v1 beyond the x shift`);
      if (!(f.point && p0.point && f.point.x - p0.point.x === SIDE_CHAIR_DX_V1)) errs.push(`${f.id}: x shift must be exactly +${SIDE_CHAIR_DX_V1} vs furniture v1`);
    } else if (geomOf(p0) !== geomOf(f)) {
      errs.push(`${f.id}: geometry/placement differs from furniture v1`);
    }
  }
  const dcChairs = data.furniture.filter((f) => f.room === 'desk-collection' && f.type === 'chair').length;
  const tcChairs = data.furniture.filter((f) => f.room === 'tele-cs-ca' && f.type === 'chair').length;
  if (dcChairs !== 34) errs.push(`Desk Collection chairs: expected 34, got ${dcChairs}`);
  if (tcChairs !== 24) errs.push(`Tele/CS/CA chairs: expected 24, got ${tcChairs}`);
  for (const [room, ref] of Object.entries(data.reference.inherited)) {
    const mine = data.furniture.filter((f) => f.room === room && f.group !== 'board').map((f) => f.id).sort(compareIds);
    if (JSON.stringify(mine) !== JSON.stringify([...ref.ids].sort(compareIds))) errs.push(`${room}: inherited ids differ from the reference list`);
    const b = data.furniture.filter((f) => f.room === room && f.type === 'bank').length;
    const ch = data.furniture.filter((f) => f.room === room && f.type === 'chair').length;
    if (b !== ref.bank) errs.push(`${room}: bank count ${b} != ${ref.bank}`);
    if (ch !== ref.chair) errs.push(`${room}: chair count ${ch} != ${ref.chair}`);
  }

  // --- v4 access aisle: >=24 px west lane for the real 18x12 actor + BFS proof ---
  const a = data.accessAisle;
  const dcRoom = ROOMS.get('desk-collection') as Rect;
  const face = wallFaceX();
  if (a.wallX !== 695 || a.wall !== 'meeting-2-east') errs.push('accessAisle must reference the Meeting-2 east wall (x=695)');
  if (a.kind !== 'movement-annotation') errs.push('accessAisle must be a movement annotation, not a room/corridor');
  if (Math.abs(a.wallFaceSourcePx - face) > 0.001) errs.push(`accessAisle wallFaceSourcePx must equal the wall face (${n(face)})`);
  if (!contains(dcRoom, a.lane)) errs.push('accessAisle lane leaves the desk-collection');
  if (Math.abs(a.lane.x1 - face) > 0.001) errs.push(`accessAisle lane must start at the wall face (x=${n(face)})`);
  const bankLeft = Math.min(...banks.map((b) => boundsOf(b).x1));
  if (a.lane.x2 > bankLeft + 0.001) errs.push('accessAisle lane must not run under a desk bank');
  const sideChairs = SIDE_CHAIR_IDS.map((id) => dcChairsById.get(id) as Furniture);
  const sideChairLeft = Math.min(...sideChairs.map((c) => boundsOf(c).x1));
  const bankRowChairs = data.furniture.filter((f) => f.type === 'chair' && f.room === 'desk-collection' && !SIDE_CHAIR_IDS.includes(f.id));
  const openWidth = Math.min(...bankRowChairs.map((f) => boundsOf(f).x1)) - face;
  const bankBand = bankLeft - face;
  const sideChairBand = Math.min(bankLeft, sideChairLeft) - face;
  const sideChairClear = sideChairLeft - face;
  const minClear = Math.min(openWidth, bankBand, sideChairBand);
  // no chair may intrude into the lane
  for (const f of data.furniture.filter((x) => x.type === 'chair' && x.room === 'desk-collection')) {
    if (boundsOf(f).x1 < a.lane.x2 - 0.001) errs.push(`chair ${f.id} intrudes into the access lane`);
  }
  if (a.detours.length !== 0) errs.push('accessAisle should have no detours once the side chairs clear the lane');
  // actor footprint must be the real 18 x 12
  if (a.actor.w !== ACTOR_W || a.actor.h !== ACTOR_H) errs.push(`accessAisle actor must be the real ${ACTOR_W} x ${ACTOR_H} app footprint`);
  // measured widths
  if (Math.abs(a.widths.openSourcePx - openWidth) > 0.01) errs.push(`accessAisle openSourcePx must be ${n(openWidth)}`);
  if (Math.abs(a.widths.bankBandSourcePx - bankBand) > 0.001) errs.push(`accessAisle bankBandSourcePx must be ${n(bankBand)}`);
  if (Math.abs(a.widths.sideChairBandSourcePx - sideChairBand) > 0.001) errs.push(`accessAisle sideChairBandSourcePx must be ${n(sideChairBand)}`);
  if (Math.abs(a.widths.sideChairClearSourcePx - sideChairClear) > 0.001) errs.push(`accessAisle sideChairClearSourcePx must be ${n(sideChairClear)}`);
  if (Math.abs(a.widths.minSourcePx - minClear) > 0.001) errs.push(`accessAisle minSourcePx must be ${n(minClear)}`);
  if (bankBand < MIN_CLEAR - 1e-9) errs.push(`west lane at the bank band is ${n(bankBand)} px, below the required ${MIN_CLEAR} px`);
  if (sideChairBand < MIN_CLEAR - 1e-9) errs.push(`west lane at the side-chair band is ${n(sideChairBand)} px, below the required ${MIN_CLEAR} px`);
  if (minClear < MIN_CLEAR - 1e-9) errs.push(`west lane minimum clear width is ${n(minClear)} px, below the required ${MIN_CLEAR} px`);
  if (minClear < a.actor.w) errs.push('west lane is narrower than the actor footprint');
  // the required chair edge
  if (sideChairLeft < SIDE_CHAIR_MIN_LEFT - 1e-9) errs.push(`side chair left edge ${n(sideChairLeft)} is below the required x=${SIDE_CHAIR_MIN_LEFT}`);
  // route must not cut through any solid (walls included)
  for (const [rx, ry] of a.route) if (pointInSolid(rx, ry)) errs.push(`accessAisle route point ${rx},${ry} is inside solid geometry`);
  for (let i = 1; i < a.route.length; i++) {
    const [x0, y0] = a.route[i - 1];
    const [x1, y1] = a.route[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const px = x0 + (x1 - x0) * t;
      const py = y0 + (y1 - y0) * t;
      if (pointInSolid(px, py)) errs.push(`accessAisle route crosses solid geometry near ${n(px)},${n(py)}`);
    }
  }
  // BFS proof: C6/top -> beside Server door/lower bank, real 18x12 actor, walls+desks+chairs solid
  const bfs = aisleBfs(a);
  if (!bfs.ok) errs.push(`accessAisle BFS failed: ${bfs.reason}`);
  if (!actorFree(a.start[0], a.start[1], a.actor.w, a.actor.h, dcRoom)) errs.push('accessAisle start is not clear for the actor');
  if (!actorFree(a.goal[0], a.goal[1], a.actor.w, a.actor.h, dcRoom)) errs.push('accessAisle goal is not clear for the actor');
  const door = data.doors.find((d) => d.id === 'D6') as Door;
  if (!(a.goal[1] > door.y - door.len / 2 && a.goal[1] < door.y + door.len / 2)) errs.push('accessAisle goal is not beside the Server door (D6)');
  if (a.goal[0] > bankLeft) errs.push('accessAisle goal is not beside the lower desk bank');
  // aisle label clear of furniture, room labels and callouts
  const abox = labelBox(a.labelAt.x, a.labelAt.y, a.labelAt.size, a.labelAt.anchor, [a.label]);
  if (!contains(VIEW, abox)) errs.push('accessAisle label leaves the view');
  for (const f of data.furniture) if (overlap(abox, boundsOf(f)) > 0) errs.push(`accessAisle label overlaps furniture ${f.id}`);
  for (const l of data.roomLabels) {
    if (overlap(abox, labelBox(l.x, l.y, l.size, 'middle', l.lines)) > 0) errs.push(`accessAisle label overlaps room label ${l.room}`);
  }
  for (const c of data.callouts) if (overlap(abox, calloutBox(c)) > 0) errs.push(`accessAisle label overlaps callout ${c.id}`);

  // --- room labels inside the view / known rooms ---
  for (const l of data.roomLabels) {
    if (!ROOMS.has(l.room)) errs.push(`label for unknown room ${l.room}`);
    if (!contains(VIEW, labelBox(l.x, l.y, l.size, 'middle', l.lines))) errs.push(`room label ${l.room} leaves the view`);
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
  check('structureV2Json', 'office-structure-review-v2.json');
  check('furnitureV1Svg', 'office-furniture-review-v1.svg');
  check('furnitureV1Png', 'office-furniture-review-v1.png');
  check('furnitureV1Json', 'office-furniture-review-v1.json');
  check('furnitureV1TopRowSvg', 'office-furniture-review-v1-top-row.svg');
  check('furnitureV1TopRowPng', 'office-furniture-review-v1-top-row.png');
  check('furnitureV1LeftMiddleSvg', 'office-furniture-review-v1-left-middle.svg');
  check('furnitureV1LeftMiddlePng', 'office-furniture-review-v1-left-middle.png');
  check('furnitureV1WorkareasSvg', 'office-furniture-review-v1-workareas.svg');
  check('furnitureV1WorkareasPng', 'office-furniture-review-v1-workareas.png');
  check('workareasV2Json', 'office-workareas-focus-v2.json');
  check('workareasV2Svg', 'office-workareas-focus-v2.svg');
  check('workareasV2Png', 'office-workareas-focus-v2.png');
  check('workareasV3Json', 'office-workareas-focus-v3.json');
  check('workareasV3Svg', 'office-workareas-focus-v3.svg');
  check('workareasV3Png', 'office-workareas-focus-v3.png');

  // --- delta vs workareas-v3: only side chairs + aisle + wall stroke + version meta ---
  const raw = JSON.parse(readFileSync(V3_JSON, 'utf8')) as {
    legend: Array<{ kind: string }>;
    overrides: { structure: unknown; furniture: Array<{ id: string; action?: string; ref?: string; delta?: { x: number } }> };
    accessAisle: unknown;
    furniture: Array<{ id: string; type?: string; point?: { x: number; y: number }; structural?: boolean; interactable?: boolean; label?: string }>;
    meta: {
      title: string;
      scaleNote: string;
      source: unknown;
      focus: unknown;
      view: unknown;
      headerBand: unknown;
      legendBand: unknown;
      output: unknown;
      stroke: Record<string, number>;
      colors: Record<string, string>;
      protected: Record<string, string>;
    };
    rooms: unknown;
    walls: unknown;
    windows: unknown;
    doors: unknown;
    openPaths: unknown;
    roomLabels: unknown;
    callouts: unknown;
  };
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  const rawRecord = raw as unknown as Record<string, unknown>;
  const dataRecord = data as unknown as Record<string, unknown>;
  for (const k of ['rooms', 'walls', 'windows', 'doors', 'openPaths', 'roomLabels', 'callouts']) {
    if (!same(rawRecord[k], dataRecord[k])) errs.push(`delta: ${k} changed vs workareas v3`);
  }
  if (!same(raw.legend, data.legend)) errs.push('delta: legend changed vs workareas v3');
  if (!same(raw.overrides.structure, data.overrides.structure)) errs.push('delta: overrides.structure changed vs v3');
  if (data.overrides.furniture.length !== raw.overrides.furniture.length) errs.push('delta: overrides.furniture length changed vs v3');
  const shiftV3 = raw.overrides.furniture.find((o) => o.id === 'OV-SHIFT-SIDE-CHAIRS');
  const shiftV4 = data.overrides.furniture.find((o) => o.id === 'OV-SHIFT-SIDE-CHAIRS');
  if (!shiftV3 || shiftV3.delta?.x !== 14) errs.push('delta: v3 shift override is not +14 as expected');
  if (!shiftV4 || shiftV4.action !== 'shift' || shiftV4.delta?.x !== SIDE_CHAIR_DX_V1) errs.push(`delta: missing/incorrect OV-SHIFT-SIDE-CHAIRS override (+${SIDE_CHAIR_DX_V1})`);
  if (!same(raw.overrides.furniture[0], data.overrides.furniture[0])) errs.push('delta: overrides.furniture[0] changed vs v3');
  // furniture: only the two side chairs may move (point.x +16); the board
  // geometry must be unchanged (its note wording may differ).
  const rawFur = new Map<string, (typeof raw.furniture)[number]>(raw.furniture.map((f) => [f.id, f]));
  for (const f of data.furniture) {
    const b = rawFur.get(f.id);
    if (!b) {
      errs.push(`delta: furniture ${f.id} is new vs v3`);
      continue;
    }
    if (SIDE_CHAIR_IDS.includes(f.id)) {
      const bx = b.point?.x;
      if (!(typeof bx === 'number' && f.point && f.point.x - bx === SIDE_CHAIR_DX_V3)) errs.push(`delta: ${f.id} must shift exactly +${SIDE_CHAIR_DX_V3} vs v3`);
      const o = JSON.parse(JSON.stringify(f)) as (typeof raw.furniture)[number];
      if (o.point && typeof bx === 'number') o.point.x = bx;
      if (geomOf(o) !== geomOf(b)) errs.push(`delta: ${f.id} may only change point.x vs v3`);
    } else if (f.id === 'F-WA-BOARD-BAP') {
      if (geomOf(b) !== geomOf(f)) errs.push('delta: board geometry changed vs v3 (must be unchanged)');
      if (b.structural !== f.structural || b.interactable !== f.interactable || b.label !== f.label || b.type !== f.type) errs.push('delta: board flags/label changed vs v3');
    } else if (!same(b, f)) {
      errs.push(`delta: furniture ${f.id} changed vs v3 but is not allowed`);
    }
  }
  for (const id of SIDE_CHAIR_IDS) {
    if (rawFur.has(id) && same(rawFur.get(id), data.furniture.find((x) => x.id === id))) errs.push(`delta: ${id} did not change vs v3`);
  }
  if (!rawFur.has('F-WA-BOARD-BAP')) errs.push('delta: board missing in v3');
  if (raw.furniture.length !== data.furniture.length) errs.push('delta: furniture count changed vs v3');
  // meta
  if (raw.meta.title !== M.title || raw.meta.scaleNote !== M.scaleNote || !same(raw.meta.source, M.source) || !same(raw.meta.focus, M.focus) || !same(raw.meta.view, M.view) || !same(raw.meta.headerBand, M.headerBand) || !same(raw.meta.legendBand, M.legendBand) || !same(raw.meta.output, M.output)) {
    errs.push('delta: meta layout/source changed vs v3');
  }
  const strokeA = { ...raw.meta.stroke };
  const strokeB = { ...M.stroke };
  const wallA = strokeA.wall;
  delete strokeA.wall;
  delete strokeB.wall;
  if (!same(strokeA, strokeB)) errs.push('delta: meta.stroke changed beyond the wall width');
  if (!(wallA === 3 && M.stroke.wall === 2)) errs.push('delta: wall stroke must change exactly 3 -> 2 (to match the solid-wall model)');
  if (!same(raw.meta.colors, M.colors)) errs.push('delta: meta.colors changed vs v3');
  for (const [k, v] of Object.entries(raw.meta.protected)) if (M.protected[k] !== v) errs.push(`delta: protected ${k} differs from v3`);
  if (!M.protected.workareasV3Json || !M.protected.workareasV3Svg || !M.protected.workareasV3Png) errs.push('delta: workareas v3 artifacts are not protected');
  if (same(raw.accessAisle, data.accessAisle)) errs.push('delta: accessAisle did not change vs v3');

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
  featureTops.push(a.lane.y1, a.labelAt.y - a.labelAt.size);
  featureBottoms.push(a.lane.y2);
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

  const boxes = data.callouts.map((c) => ({ c, box: calloutBox(c) }));
  for (const { c, box } of boxes) {
    if (box.x1 < VIEW.x1 + 3 || box.x2 > VIEW.x2 - 3 || box.y1 < VIEW.y1 + 3 || box.y2 > VIEW.y2 - 3) errs.push(`callout ${c.id} text leaves the view`);
    for (const [px, py] of [...c.leader, c.target]) {
      if (px < VIEW.x1 || px > VIEW.x2 || py < VIEW.y1 || py > VIEW.y2) errs.push(`callout ${c.id} leader leaves the view`);
    }
    for (const f of data.furniture) if (overlap(box, boundsOf(f)) > 0) errs.push(`callout ${c.id} text overlaps furniture ${f.id}`);
    for (const l of data.roomLabels) {
      if (overlap(box, labelBox(l.x, l.y, l.size, 'middle', l.lines)) > 0) errs.push(`callout ${c.id} text overlaps room label ${l.room}`);
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
  for (const l of data.roomLabels) {
    const lb = labelBox(l.x, l.y, l.size, 'middle', l.lines);
    for (const f of data.furniture) if (overlap(lb, boundsOf(f)) > 0) errs.push(`room label ${l.room} overlaps furniture ${f.id}`);
  }

  if (errs.length) throw new Error(`workareas focus v4 validation failed:\n - ${errs.join('\n - ')}`);
}

// ---------------------------------------------------------------------------
// symbols
// ---------------------------------------------------------------------------

// Floors are left unshaded (same tone as the background), exactly like
// structure v2, so no tint edge can be misread as a false partition across the
// open Tele/CS/CA top.
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
  const inner = { x1: r.x1 + 1.5, y1: r.y1 + 3, x2: r.x2 - 1.5, y2: r.y2 - 3 };
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
// The reserved walkable strip is drawn UNDER the furniture; it is a movement
// annotation, not a room/corridor. No detours are needed in v4 because the two
// side chairs now sit clear of the lane.
function aisleLaneLayer(): string {
  const a = data.accessAisle;
  const r = a.lane;
  const dets = [...a.detours].sort((p, q) => p.y1 - q.y1);
  const pts: Array<[number, number]> = [[r.x1, r.y1], [r.x2, r.y1]];
  for (const d of dets) pts.push([r.x2, d.y1], [d.x2, d.y1], [d.x2, d.y2], [r.x2, d.y2]);
  pts.push([r.x2, r.y2], [r.x1, r.y2], [r.x1, r.y1]);
  return polygon(pts, C.aisle, 0.9, '2 6');
}
function aisleRouteLayer(): string {
  const a = data.accessAisle;
  const out: string[] = [polyline(a.route, C.aisle, S.aisle, '7 5')];
  const last = a.route[a.route.length - 1];
  const prev = a.route[a.route.length - 2];
  out.push(arrowHead(last[0], last[1], last[0] - prev[0], last[1] - prev[1], 8, C.aisle));
  out.push(`<circle cx="${n(a.route[0][0])}" cy="${n(a.route[0][1])}" r="1.8" fill="${C.aisle}" />`);
  const la = a.labelAt;
  out.push(line(la.x - 2, la.y - 2, a.lane.x2 + 6, la.y - 2, C.aisle, 0.9, '3 3'));
  out.push(text(la.x, la.y, a.label, la.size, C.aisle, la.anchor, 700));
  return out.join('\n');
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
      case 'aisle':
        out.push(line(cx, cy + 3, cx + LEG.swW, cy + 3, C.aisle, S.aisle, '5 4'));
        out.push(arrowHead(cx + LEG.swW, cy + 3, 1, 0, 5, C.aisle));
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
    aisleLaneLayer(),
    furnitureSvgLayer(),
    aisleRouteLayer(),
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
console.log(`actor ${data.accessAisle.actor.w}x${data.accessAisle.actor.h} westLaneMin ${data.accessAisle.widths.minSourcePx}px`);
console.log(`aisle bfs ${aisleBfs(data.accessAisle).reason}`);
console.log(`sha256 svg ${sha256(SVG_PATH)}`);
try {
  console.log(`sha256 png ${sha256(PNG_PATH)}`);
} catch {
  /* png not written */
}
