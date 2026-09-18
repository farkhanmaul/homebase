// Deterministic furniture review artifact generator (Tahap 2).
//
// Layers furniture onto the approved structure review v2. It reads
//   docs/reviews/office-furniture-review-v1.json   (single furniture source of truth)
//   docs/reviews/office-structure-review-v2.json   (walls/doors/gaps/columns/lifts — reused as-is)
// and writes
//   docs/reviews/office-furniture-review-v1.svg / .png          (full map)
//   docs/reviews/office-furniture-review-v1-<panel>.svg / .png  (3 readable panels)
//
// The structure JSON is never modified; its SVG/PNG hashes are asserted below.
// Deterministic: fixed ordering, rounded numbers, no timestamps, no randomness.
// The PNG is a rasterization of the same generated SVG (no second drawing).
//
// Run: node --experimental-strip-types scripts/generate-furniture-review.ts

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REVIEW_DIR = resolve(HERE, '..', 'docs', 'reviews');
const DATA_PATH = resolve(REVIEW_DIR, 'office-furniture-review-v1.json');

type Rect = { x1: number; y1: number; x2: number; y2: number };
type Room = Rect & { id: string; name: string; kind: string };
type Wall = Rect & { type: 'full' | 'partition' };
type Door = {
  id: string;
  room: string;
  axis: 'h' | 'v';
  x: number;
  y: number;
  len: number;
  hinge: 'start' | 'end' | 'double';
  swing: 'up' | 'down' | 'left' | 'right';
  locked?: boolean;
};
type Gap = { id: string; room: string; axis: 'h' | 'v'; x: number; y: number; len: number };
type Column = Rect & { note: string };
type Lift = Rect & { id: string; open: 'left' | 'right' };
type Structure = {
  rooms: Room[];
  walls: Wall[];
  windows: Rect[];
  columns: Column[];
  lifts: Lift[];
  doors: Door[];
  gaps: Gap[];
};

type FurnitureType =
  | 'desk'
  | 'table'
  | 'chair'
  | 'seat'
  | 'bank'
  | 'cabinet'
  | 'counter'
  | 'dispenser'
  | 'fridge'
  | 'board';
type BankMeta = { orientation: 'h' | 'v'; divider?: boolean; leftCap?: boolean; cols?: number; rows?: number };
type Furniture = {
  id: string;
  type: FurnitureType;
  room: string;
  shape: 'rect' | 'point';
  rect?: Rect;
  point?: { x: number; y: number };
  w?: number;
  h?: number;
  facing?: 'up' | 'down' | 'left' | 'right';
  bank?: BankMeta;
  note?: string;
};
type Panel = { id: string; file: string; title: string; x: number; y: number; w: number; h: number; scale: number };
type RoomLabel = { room: string; x: number; y: number; size: number; lines: string[]; rotate?: number };
type Data = {
  meta: {
    id: string;
    title: string;
    subtitle: string;
    scaleNote: string;
    source: { file: string; width: number; height: number };
    structure: {
      file: string;
      svg: string;
      png: string;
      svgSha256: string;
      pngSha256: string;
      v1SvgSha256: string;
      v1PngSha256: string;
    };
    canvas: { width: number; height: number };
    stroke: Record<string, number>;
    colors: Record<string, string>;
  };
  roomBoundsOverride: Record<string, Partial<Rect> & { note?: string }>;
  panels: Panel[];
  roomLabels: RoomLabel[];
  furniture: Furniture[];
};

const data: Data = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
const M = data.meta;
const C = M.colors;
const S = M.stroke;

const structRaw = readFileSync(resolve(REVIEW_DIR, M.structure.file), 'utf8');
const structure: Structure = JSON.parse(structRaw);
const ROOMS = new Map(structure.rooms.map((r) => [r.id, r]));
const LOCKED_ROOMS = ['gudang', 'toilet-wanita', 'toilet-pria', 'server'];
const TYPES: FurnitureType[] = ['desk', 'table', 'chair', 'seat', 'bank', 'cabinet', 'counter', 'dispenser', 'fridge', 'board'];
const CORRIDOR = 'corridor-side';

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
  return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${color}" stroke-width="${width}"${d} />`;
}
function rect(r: Rect, fill: string, stroke?: string, width?: number): string {
  const s = stroke ? ` stroke="${stroke}" stroke-width="${width ?? 1}"` : '';
  return `<rect x="${n(r.x1)}" y="${n(r.y1)}" width="${n(r.x2 - r.x1)}" height="${n(r.y2 - r.y1)}" fill="${fill}"${s} />`;
}
function text(x: number, y: number, value: string, size: number, color: string, anchor = 'start', weight = 400, rotate?: number): string {
  const t = rotate ? ` transform="rotate(${rotate} ${n(x)} ${n(y)})"` : '';
  return `<text x="${n(x)}" y="${n(y)}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}"${t}>${esc(value)}</text>`;
}
function polyline(pts: Array<[number, number]>, color: string, width: number): string {
  return `<polyline points="${pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${width}" />`;
}
function unit(a: Rect) {
  const dx = a.x2 - a.x1;
  const dy = a.y2 - a.y1;
  const len = Math.hypot(dx, dy) || 1;
  return { dx: dx / len, dy: dy / len, len };
}
function overlap(a: Rect, b: Rect): number {
  const w = Math.min(Math.max(a.x1, a.x2), Math.max(b.x1, b.x2)) - Math.max(Math.min(a.x1, a.x2), Math.min(b.x1, b.x2));
  const h = Math.min(Math.max(a.y1, a.y2), Math.max(b.y1, b.y2)) - Math.max(Math.min(a.y1, a.y2), Math.min(b.y1, b.y2));
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

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

function validate(): void {
  const errs: string[] = [];
  const ids = new Set<string>();
  const perRoom: Record<string, Record<string, number>> = {};
  const totalByType: Record<string, number> = {};

  for (const f of data.furniture) {
    if (ids.has(f.id)) errs.push(`duplicate furniture id: ${f.id}`);
    ids.add(f.id);
    if (!TYPES.includes(f.type)) errs.push(`${f.id}: invalid type '${f.type}'`);
    if (f.room !== CORRIDOR && !ROOMS.has(f.room)) errs.push(`${f.id}: invalid room '${f.room}'`);
    if (f.shape === 'rect') {
      if (!f.rect) errs.push(`${f.id}: missing rect`);
      else if (f.rect.x2 - f.rect.x1 <= 0 || f.rect.y2 - f.rect.y1 <= 0) errs.push(`${f.id}: non-positive rect`);
    } else if (f.shape === 'point') {
      if (!f.point) errs.push(`${f.id}: missing point`);
      if (!(f.w && f.w > 0) || !(f.h && f.h > 0)) errs.push(`${f.id}: non-positive point size`);
      if (f.facing && !['up', 'down', 'left', 'right'].includes(f.facing)) errs.push(`${f.id}: invalid facing '${f.facing}'`);
    } else {
      errs.push(`${f.id}: invalid shape '${String(f.shape)}'`);
    }

    const box = boundsOf(f);
    if (f.room === CORRIDOR) {
      for (const r of structure.rooms) if (overlap(box, r) > 0) errs.push(`${f.id}: corridor-side item overlaps room ${r.id}`);
    } else {
      const base = ROOMS.get(f.room) as Rect;
      const ovr = data.roomBoundsOverride[f.room] ?? {};
      const room: Rect = { x1: ovr.x1 ?? base.x1, y1: ovr.y1 ?? base.y1, x2: ovr.x2 ?? base.x2, y2: ovr.y2 ?? base.y2 };
      if (!contains(room, box)) errs.push(`${f.id}: outside room ${f.room}`);
    }
    for (const lr of LOCKED_ROOMS) {
      const r = ROOMS.get(lr) as Rect;
      if (overlap(box, r) > 0) errs.push(`${f.id}: overlaps locked ${lr} interior`);
    }

    perRoom[f.room] = perRoom[f.room] ?? {};
    perRoom[f.room][f.type] = (perRoom[f.room][f.type] ?? 0) + 1;
    totalByType[f.type] = (totalByType[f.type] ?? 0) + 1;
  }

  const require = (room: string, type: string, count: number) => {
    const got = perRoom[room]?.[type] ?? 0;
    if (got !== count) errs.push(`${room}: expected ${count} ${type}, got ${got}`);
  };
  const requireTotal = (type: string, count: number) => {
    const got = totalByType[type] ?? 0;
    if (got !== count) errs.push(`total: expected ${count} ${type}, got ${got}`);
  };

  require('meeting-1', 'table', 1);
  require('meeting-1', 'chair', 6);
  require('hrga', 'desk', 2);
  require('hrga', 'chair', 4);
  require('hrga', 'cabinet', 1);
  require('hrga', 'dispenser', 1);
  require('komisaris', 'desk', 1);
  require('komisaris', 'chair', 1);
  require('product-manager', 'desk', 1);
  require('product-manager', 'chair', 1);
  require('it', 'desk', 2);
  require('it', 'chair', 2);
  require('direktur-finance', 'desk', 2);
  require('direktur-finance', 'chair', 2);
  require('direktur-finance', 'counter', 1);
  require('geng-kami', 'bank', 1);
  require('geng-kami', 'desk', 1);
  require('geng-kami', 'chair', 6);
  require('geng-kami', 'cabinet', 1);
  require('resepsionis', 'counter', 1);
  require('resepsionis', 'chair', 1);
  require('resepsionis', 'seat', 4);
  require('pantry', 'counter', 1);
  require('pantry', 'dispenser', 1);
  require('pantry', 'fridge', 1);
  require('meeting-2', 'table', 1);
  require('meeting-2', 'chair', 6);
  require('meeting-2', 'board', 1);
  require('desk-collection', 'bank', 2);
  require('desk-collection', 'chair', 34);
  require('tele-cs-ca', 'bank', 2);
  require('tele-cs-ca', 'chair', 24);
  require(CORRIDOR, 'dispenser', 2);
  requireTotal('chair', 87);
  requireTotal('seat', 4);
  requireTotal('desk', 9);
  requireTotal('table', 2);
  requireTotal('counter', 3);
  requireTotal('cabinet', 2);
  requireTotal('dispenser', 4);
  requireTotal('fridge', 1);
  requireTotal('board', 1);
  requireTotal('bank', 5);

  // Room-name tags: one per structure room, inside the canvas, clear of furniture.
  const labelRooms = new Set(data.roomLabels.map((l) => l.room));
  for (const r of structure.rooms) if (!labelRooms.has(r.id)) errs.push(`room label missing for ${r.id}`);
  for (const l of data.roomLabels) {
    if (!ROOMS.has(l.room)) errs.push(`room label for unknown room ${l.room}`);
    const box = labelBox(l);
    const canvas: Rect = { x1: 0, y1: 0, x2: M.canvas.width, y2: M.canvas.height };
    if (!contains(canvas, box)) errs.push(`room label ${l.room} leaves the canvas`);
    for (const f of data.furniture) if (overlap(box, boundsOf(f)) > 0) errs.push(`room label ${l.room} overlaps furniture ${f.id}`);
  }

  // Structure v2 invariants that must survive into the furniture review.
  const d7 = structure.doors.find((d) => d.id === 'D7');
  if (!d7?.locked) errs.push('structure v2: D7 Gudang must stay locked');
  const d8 = structure.doors.find((d) => d.id === 'D8');
  if (d8?.axis !== 'v' || d8?.x !== 512) errs.push('structure v2: D8 Toilet Wanita must face the Wastafel (x=512)');
  const d9 = structure.doors.find((d) => d.id === 'D9');
  if (d9?.axis !== 'v' || d9?.x !== 554) errs.push('structure v2: D9 Toilet Pria must face the Wastafel (x=554)');

  // Protected structure review hashes must be unchanged.
  const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
  const checkHash = (p: string, want: string, label: string) => {
    const got = sha(p);
    if (got !== want) errs.push(`${label} hash changed: ${got} != ${want}`);
  };
  checkHash(resolve(REVIEW_DIR, M.structure.svg), M.structure.svgSha256, 'structure v2 svg');
  checkHash(resolve(REVIEW_DIR, M.structure.png), M.structure.pngSha256, 'structure v2 png');
  checkHash(resolve(REVIEW_DIR, 'office-structure-review-v1.svg'), M.structure.v1SvgSha256, 'structure v1 svg');
  checkHash(resolve(REVIEW_DIR, 'office-structure-review-v1.png'), M.structure.v1PngSha256, 'structure v1 png');

  if (errs.length) throw new Error(`furniture review validation failed:\n - ${errs.join('\n - ')}`);
}

// ---------------------------------------------------------------------------
// structure v2 symbols (de-emphasized light gray)
// ---------------------------------------------------------------------------

function windowSymbol(w: Rect): string {
  const u = unit(w);
  const parts = [line(w.x1, w.y1, w.x2, w.y2, C.window, S.window)];
  const step = 34;
  const nx = -u.dy;
  const ny = u.dx;
  for (let d = 14; d < u.len - 8; d += step) {
    const cx = w.x1 + u.dx * d;
    const cy = w.y1 + u.dy * d;
    const t = S.tick / 2;
    parts.push(line(cx - nx * t, cy - ny * t, cx + nx * t, cy + ny * t, C.window, S.window));
  }
  return parts.join('\n');
}
function cut(a: { x1: number; y1: number; x2: number; y2: number }, half: number): string {
  const horizontal = a.y1 === a.y2;
  const pad = 3;
  if (horizontal) {
    return rect({ x1: Math.min(a.x1, a.x2) - pad, y1: a.y1 - half, x2: Math.max(a.x1, a.x2) + pad, y2: a.y1 + half }, C.cut);
  }
  return rect({ x1: a.x1 - half, y1: Math.min(a.y1, a.y2) - pad, x2: a.x1 + half, y2: Math.max(a.y1, a.y2) + pad }, C.cut);
}
function arcPoints(px: number, py: number, r: number, tx: number, ty: number, fx: number, fy: number): Array<[number, number]> {
  const a0 = Math.atan2(ty - py, tx - px);
  let d = Math.atan2(fy - py, fx - px) - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= 14; i++) {
    const a = a0 + (d * i) / 14;
    pts.push([px + r * Math.cos(a), py + r * Math.sin(a)]);
  }
  return pts;
}
function doorSymbol(d: Door): string {
  const L = d.len;
  const out: string[] = [];
  if (d.axis === 'h') {
    const a = d.x - L / 2;
    const b = d.x + L / 2;
    const y = d.y;
    const dy = d.swing === 'up' ? -1 : 1;
    if (d.hinge === 'double') {
      const half = L / 2;
      for (const hx of [a, b]) {
        out.push(line(hx, y, hx, y + dy * half, C.wall, S.door));
        out.push(polyline(arcPoints(hx, y, half, hx, y + dy * half, d.x, y), C.wall, S.door));
      }
    } else {
      const hx = d.hinge === 'start' ? a : b;
      const fx = d.hinge === 'start' ? b : a;
      out.push(line(hx, y, hx, y + dy * L, C.wall, S.door));
      out.push(polyline(arcPoints(hx, y, L, hx, y + dy * L, fx, y), C.wall, S.door));
    }
  } else {
    const a = d.y - L / 2;
    const b = d.y + L / 2;
    const x = d.x;
    const dx = d.swing === 'right' ? 1 : -1;
    if (d.hinge === 'double') {
      const half = L / 2;
      for (const hy of [a, b]) {
        out.push(line(x, hy, x + dx * half, hy, C.wall, S.door));
        out.push(polyline(arcPoints(x, hy, half, x + dx * half, hy, x, d.y), C.wall, S.door));
      }
    } else {
      const hy = d.hinge === 'start' ? a : b;
      const fy = d.hinge === 'start' ? b : a;
      out.push(line(x, hy, x + dx * L, hy, C.wall, S.door));
      out.push(polyline(arcPoints(x, hy, L, x + dx * L, hy, x, fy), C.wall, S.door));
    }
  }
  return out.join('\n');
}
function gapSymbol(g: Gap): string {
  const half = S.tick / 2;
  const out: string[] = [];
  if (g.axis === 'h') for (const jx of [g.x - g.len / 2, g.x + g.len / 2]) out.push(line(jx, g.y - half, jx, g.y + half, C.wall, S.door));
  else for (const jy of [g.y - g.len / 2, g.y + g.len / 2]) out.push(line(g.x - half, jy, g.x + half, jy, C.wall, S.door));
  return out.join('\n');
}
function openingCut(a: Door | Gap): string {
  if (a.axis === 'h') return cut({ x1: a.x - a.len / 2, y1: a.y, x2: a.x + a.len / 2, y2: a.y }, S.wall / 2 + 2);
  return cut({ x1: a.x, y1: a.y - a.len / 2, x2: a.x, y2: a.y + a.len / 2 }, S.wall / 2 + 2);
}
function padlock(cx: number, cy: number): string {
  const out: string[] = [];
  out.push(rect({ x1: cx - 5, y1: cy - 1, x2: cx + 5, y2: cy + 9 }, C.bg, C.wall, 1.5));
  const shackle: Array<[number, number]> = [];
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * (1 + i / 10);
    shackle.push([cx + 3 * Math.cos(a), cy - 1 + 3 * Math.sin(a)]);
  }
  out.push(polyline(shackle, C.wall, 1.5));
  return out.join('\n');
}
function liftSymbol(l: Lift): string {
  const out: string[] = [];
  out.push(line(l.x1, l.y1, l.x2, l.y1, C.wall, S.wall));
  out.push(line(l.x1, l.y2, l.x2, l.y2, C.wall, S.wall));
  if (l.open === 'right') {
    out.push(line(l.x1, l.y1, l.x1, l.y2, C.wall, S.wall));
    out.push(line(l.x2, l.y1, l.x2, l.y1 + 18, C.wall, S.wall));
    out.push(line(l.x2, l.y2 - 18, l.x2, l.y2, C.wall, S.wall));
  } else {
    out.push(line(l.x2, l.y1, l.x2, l.y2, C.wall, S.wall));
    out.push(line(l.x1, l.y1, l.x1, l.y1 + 18, C.wall, S.wall));
    out.push(line(l.x1, l.y2 - 18, l.x1, l.y2, C.wall, S.wall));
  }
  out.push(text((l.x1 + l.x2) / 2, (l.y1 + l.y2) / 2 + 4, 'Lift', 11, C.muted, 'middle'));
  return out.join('\n');
}

// Compact room-name tags are placed in clear areas (top band / empty space) via
// data.roomLabels so they never sit on furniture. The inherited structure v2
// centred labels are suppressed in this furniture layer.
function labelBox(l: RoomLabel): Rect {
  const width = Math.max(...l.lines.map((s) => s.length)) * l.size * 0.62;
  if (l.rotate) {
    return { x1: l.x - l.size * 0.8, y1: l.y - width, x2: l.x + l.size * 0.3, y2: l.y + l.size * 0.3 };
  }
  const step = l.size + 1;
  const lastBaseline = l.y + (l.lines.length - 1) * step;
  return { x1: l.x - width / 2, y1: l.y - l.size, x2: l.x + width / 2, y2: lastBaseline + l.size * 0.3 };
}
function roomLabelTag(l: RoomLabel): string {
  const step = l.size + 1;
  if (l.rotate) return text(l.x + l.size * 0.32, l.y, l.lines.join(' '), l.size, C.label, 'start', 500, l.rotate);
  return l.lines.map((ln, i) => text(l.x, l.y + i * step, ln, l.size, C.label, 'middle', 500)).join('\n');
}

// ---------------------------------------------------------------------------
// furniture symbols (black/white drafting, same source symbols)
// ---------------------------------------------------------------------------

function rectBody(r: Rect): string {
  return rect(r, C.bg, C.line, S.furniture);
}
function cabinetSvg(r: Rect): string {
  return [rectBody(r), line(r.x1, r.y1, r.x2, r.y2, C.line, S.chair), line(r.x1, r.y2, r.x2, r.y1, C.line, S.chair)].join('\n');
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
  return [
    rect(r, C.fridge, C.fridgeLine, S.furniture),
    line(r.x1 + w * 0.7, r.y1 + 3, r.x1 + w * 0.7, r.y2 - 3, C.fridgeLine, S.chair),
  ].join('\n');
}
function boardSvg(r: Rect): string {
  const inner = { x1: r.x1 + 3, y1: r.y1 + 3, x2: r.x2 - 3, y2: r.y2 - 3 };
  return [rectBody(r), rect(inner, 'none', C.line, 1)].join('\n');
}
function bankSvg(r: Rect, b: BankMeta): string {
  const out = [rectBody(r)];
  const cx = (r.x1 + r.x2) / 2;
  const cy = (r.y1 + r.y2) / 2;
  if (b.orientation === 'h') {
    if (b.divider) out.push(line(r.x1, cy, r.x2, cy, C.line, S.chair));
    if (b.rows) for (let i = 1; i < b.rows; i++) out.push(line(r.x1, r.y1 + ((r.y2 - r.y1) * i) / b.rows, r.x2, r.y1 + ((r.y2 - r.y1) * i) / b.rows, C.line, S.chair));
    if (b.cols) for (let i = 1; i < b.cols; i++) out.push(line(r.x1 + ((r.x2 - r.x1) * i) / b.cols, r.y1, r.x1 + ((r.x2 - r.x1) * i) / b.cols, r.y2, C.line, S.chair));
    if (b.leftCap) out.push(line(r.x1 + 12, r.y1, r.x1 + 12, r.y2, C.line, S.chair));
  } else {
    if (b.divider) out.push(line(cx, r.y1, cx, r.y2, C.line, S.chair));
    if (b.cols) for (let i = 1; i < b.cols; i++) out.push(line(r.x1 + ((r.x2 - r.x1) * i) / b.cols, r.y1, r.x1 + ((r.x2 - r.x1) * i) / b.cols, r.y2, C.line, S.chair));
    if (b.rows) for (let i = 1; i < b.rows; i++) out.push(line(r.x1, r.y1 + ((r.y2 - r.y1) * i) / b.rows, r.x2, r.y1 + ((r.y2 - r.y1) * i) / b.rows, C.line, S.chair));
    if (b.leftCap) out.push(line(r.x1, r.y1 + 12, r.x2, r.y1 + 12, C.line, S.chair));
  }
  return out.join('\n');
}
function chairSvg(f: Furniture): string {
  const w = f.w as number;
  const h = f.h as number;
  const p = f.point as { x: number; y: number };
  const x1 = p.x - w / 2;
  const y1 = p.y - h / 2;
  const x2 = p.x + w / 2;
  const y2 = p.y + h / 2;
  const r: Rect = { x1, y1, x2, y2 };
  const out = [rect(r, C.bg, C.line, S.furniture)];
  const m = 2;
  switch (f.facing) {
    case 'down':
      out.push(line(x1 + m, y1 + m, x2 - m, y1 + m, C.line, S.chair * 2));
      break;
    case 'up':
      out.push(line(x1 + m, y2 - m, x2 - m, y2 - m, C.line, S.chair * 2));
      break;
    case 'right':
      out.push(line(x1 + m, y1 + m, x1 + m, y2 - m, C.line, S.chair * 2));
      break;
    case 'left':
      out.push(line(x2 - m, y1 + m, x2 - m, y2 - m, C.line, S.chair * 2));
      break;
  }
  return out.join('\n');
}
function furnitureSvg(f: Furniture): string {
  switch (f.type) {
    case 'chair':
    case 'seat':
      return chairSvg(f);
    case 'cabinet':
      return cabinetSvg(boundsOf(f));
    case 'dispenser':
      return dispenserSvg(boundsOf(f));
    case 'fridge':
      return fridgeSvg(boundsOf(f));
    case 'board':
      return boardSvg(boundsOf(f));
    case 'bank':
      return bankSvg(boundsOf(f), f.bank as BankMeta);
    default:
      return rectBody(boundsOf(f));
  }
}

// ---------------------------------------------------------------------------
// composition
// ---------------------------------------------------------------------------

const ZTOP = new Set<FurnitureType>(['chair', 'seat']);
function orderedFurniture(): Furniture[] {
  const base = data.furniture.filter((f) => !ZTOP.has(f.type));
  const top = data.furniture.filter((f) => ZTOP.has(f.type));
  return [...base, ...top];
}

function structureLayer(): string {
  const floors = structure.rooms
    .map((r) => {
      const fill = r.kind === 'lobby' ? C.floorLobby : r.kind === 'service' ? C.floorService : r.kind === 'open' ? C.floorOpen : C.floorOffice;
      return rect(r, fill);
    })
    .join('\n');
  const walls = structure.walls
    .map((wl) => line(wl.x1, wl.y1, wl.x2, wl.y2, C.wall, wl.type === 'full' ? S.wall : S.partition, wl.type === 'partition' ? '8 6' : undefined))
    .join('\n');
  const windows = structure.windows.map(windowSymbol).join('\n');
  const columns = structure.columns.map((c) => [rect(c, C.column, C.columnLine, 1)].join('\n')).join('\n');
  const lifts = structure.lifts.map(liftSymbol).join('\n');
  const cuts = [...structure.doors, ...structure.gaps].map(openingCut).join('\n');
  const doors = structure.doors.map(doorSymbol).join('\n');
  const gaps = structure.gaps.map(gapSymbol).join('\n');
  const locked = structure.doors.filter((d) => d.locked).map((d) => {
    const px = d.axis === 'h' ? d.x : d.x + 16;
    const py = d.axis === 'h' ? d.y - 12 : d.y - 14;
    return [padlock(px, py), text(px, py - 12, 'TERKUNCI', 8, C.muted, 'middle', 700)].join('\n');
  }).join('\n');
  return [floors, walls, windows, columns, lifts, cuts, doors, gaps, locked].filter(Boolean).join('\n');
}

function furnitureLayer(view: Rect): string {
  const pad = 24;
  const crop: Rect = { x1: view.x1 - pad, y1: view.y1 - pad, x2: view.x2 + pad, y2: view.y2 + pad };
  return orderedFurniture()
    .filter((f) => overlap(boundsOf(f), crop) > 0)
    .map(furnitureSvg)
    .join('\n');
}

function labelsLayer(): string {
  return data.roomLabels.map(roomLabelTag).join('\n');
}

function legend(): string {
  const x = 430;
  const y = 520;
  const w = 480;
  const h = 280;
  const out: string[] = [];
  out.push(rect({ x1: x, y1: y, x2: x + w, y2: y + h }, C.bg, C.line, 1.2));
  out.push(text(x + 12, y + 22, 'LEGENDA FURNITURE', 13, C.line, 'start', 700));
  let gy = y + 44;
  const row = (swatch: string, label: string) => {
    out.push(swatch);
    out.push(text(x + 96, gy + 4, label, 11, C.line));
    gy += 19;
  };
  row(rect({ x1: x + 16, y1: gy - 9, x2: x + 76, y2: gy + 9 }, C.bg, C.line, S.furniture), 'Meja kerja / meja rapat');
  row([rect({ x1: x + 16, y1: gy - 9, x2: x + 56, y2: gy + 9 }, C.bg, C.line, S.furniture), line(x + 18, gy - 7, x + 54, gy - 7, C.line, S.chair * 2)].join('\n'), 'Kursi (garis punggung)');
  row(rect({ x1: x + 16, y1: gy - 9, x2: x + 76, y2: gy + 9 }, C.bg, C.line, S.furniture), 'Counter / meja resepsionis');
  row(cabinetSvg({ x1: x + 16, y1: gy - 9, x2: x + 76, y2: gy + 9 }), 'Lemari (bersilang)');
  row(bankSvg({ x1: x + 16, y1: gy - 9, x2: x + 76, y2: gy + 9 }, { orientation: 'h', divider: true, leftCap: true }), 'Bank meja berhadapan');
  row(dispenserSvg({ x1: x + 16, y1: gy - 9, x2: x + 76, y2: gy + 9 }), 'Dispenser (biru muda)');
  row(fridgeSvg({ x1: x + 16, y1: gy - 9, x2: x + 76, y2: gy + 9 }), 'Kulkas (hijau muda)');
  row(boardSvg({ x1: x + 16, y1: gy - 9, x2: x + 76, y2: gy + 9 }), 'Papan / layar (bukan meja)');
  row(line(x + 16, gy, x + 76, gy, C.wall, S.wall), 'Dinding struktur v2 (diredupkan)');
  row(rect({ x1: x + 36, y1: gy - 9, x2: x + 56, y2: gy + 9 }, C.column, C.columnLine, 1), 'Kolom struktur (bukan furniture)');
  return out.join('\n');
}

function counts(): string {
  const x = 950;
  const y = 520;
  const w = 480;
  const h = 280;
  const out: string[] = [];
  out.push(rect({ x1: x, y1: y, x2: x + w, y2: y + h }, C.bg, C.line, 1.2));
  out.push(text(x + 12, y + 22, 'JUMLAH PER RUANG (furniture)', 13, C.line, 'start', 700));
  const chairsPerRoom: Array<[string, number]> = [
    ['Meeting 1', 6],
    ['HRGA', 4],
    ['Komisaris', 1],
    ['Product Manager', 1],
    ['Bilik IT', 2],
    ['Direktur Finance', 2],
    ['Bilik Geng Kami', 6],
    ['Resepsionis', 1],
    ['Meeting 2', 6],
    ['Desk Collection', 34],
    ['Tele / CS / CA', 24],
  ];
  let gy = y + 44;
  for (const [name, count] of chairsPerRoom) {
    out.push(text(x + 16, gy, name, 10.5, C.line));
    out.push(text(x + 240, gy, String(count), 10.5, C.line, 'end', 700));
    gy += 15;
  }
  out.push(line(x + 16, gy - 6, x + 240, gy - 6, C.muted, 1));
  out.push(text(x + 16, gy + 6, 'Total kursi', 10.5, C.line, 'start', 700));
  out.push(text(x + 240, gy + 6, '87', 10.5, C.line, 'end', 700));
  out.push(text(x + 16, gy + 22, 'Kursi tunggu resepsionis', 10.5, C.line));
  out.push(text(x + 240, gy + 22, '4', 10.5, C.line, 'end', 700));
  out.push(text(x + 260, y + 44, 'Meja kerja', 10.5, C.line));
  out.push(text(x + w - 16, y + 44, '9', 10.5, C.line, 'end', 700));
  const rest: Array<[string, string]> = [
    ['Meja rapat', '2'],
    ['Counter / meja panjang', '3'],
    ['Bank meja (5 bank)', '9-10 kursi/bank'],
    ['Lemari', '2'],
    ['Dispenser (biru muda)', '4'],
    ['Kulkas (hijau muda)', '1'],
    ['Papan / layar', '1'],
  ];
  let ry = y + 59;
  for (const [name, val] of rest) {
    out.push(text(x + 260, ry, name, 10.5, C.line));
    out.push(text(x + w - 16, ry, val, 10.5, C.line, 'end', 700));
    ry += 15;
  }
  out.push(text(x + 16, y + h - 12, 'Rincian & ambiguitas: office-furniture-review-v1-notes.md', 9, C.muted));
  return out.join('\n');
}

function header(): string {
  return [
    text(16, 34, `${M.title} — FURNITURE`, 20, C.line, 'start', 700),
    text(16, 56, M.subtitle, 11, C.line, 'start', 700),
    text(16, 74, M.scaleNote, 9, C.muted),
    text(16, 88, `Sumber: ${M.source.file} (${M.source.width} x ${M.source.height}). Struktur: ${M.structure.file} (hash utuh).`, 9, C.muted),
    text(16, 102, 'Furniture hitam/putih; dispenser biru muda; kulkas hijau muda. Tanpa hotspot/avatar.', 9, C.muted),
  ].join('\n');
}

function buildSvg(view: Rect, kind: 'full' | 'panel', panel?: Panel): string {
  const width = kind === 'full' ? M.canvas.width : (panel as Panel).w * (panel as Panel).scale;
  const height = kind === 'full' ? M.canvas.height : (panel as Panel).h * (panel as Panel).scale;
  const bg = rect(view, C.bg);
  const parts: string[] = [bg, structureLayer(), furnitureLayer(view), labelsLayer()];
  if (kind === 'full') {
    parts.push(header(), legend(), counts());
  } else {
    const p = panel as Panel;
    const band: Rect = { x1: p.x, y1: p.y, x2: p.x + p.w, y2: p.y + 26 };
    parts.push(rect(band, C.bg));
    parts.push(line(p.x, band.y2, p.x + p.w, band.y2, C.muted, 1));
    parts.push(text(p.x + 10, p.y + 18, p.title, 12, C.line, 'start', 700));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}" viewBox="${n(view.x1)} ${n(view.y1)} ${n(view.x2 - view.x1)} ${n(view.y2 - view.y1)}" font-family="DejaVu Sans Mono, ui-monospace, Menlo, Consolas, monospace">\n${parts.join('\n')}\n</svg>\n`;
}

// ---------------------------------------------------------------------------
// rasterization + output
// ---------------------------------------------------------------------------

function rasterize(svgPath: string, pngPath: string, w: number, h: number): boolean {
  const candidates = [process.env.FURNITURE_REVIEW_PY, '/tmp/homebase-svg-venv/bin/python3', 'python3'].filter(Boolean) as string[];
  const code = 'import cairosvg,sys; cairosvg.svg2png(url=sys.argv[1], write_to=sys.argv[2], output_width=int(sys.argv[3]), output_height=int(sys.argv[4]), background_color="white")';
  for (const py of candidates) {
    if (spawnSync(py, ['-c', 'import cairosvg'], { stdio: 'ignore' }).status !== 0) continue;
    const r = spawnSync(py, ['-c', code, svgPath, pngPath, String(w), String(h)], { stdio: 'inherit' });
    if (r.status === 0) return true;
  }
  return false;
}
function validateSvgXml(p: string): boolean {
  const r = spawnSync('python3', ['-c', 'import sys,xml.etree.ElementTree as ET; ET.parse(sys.argv[1])', p], { stdio: 'ignore' });
  return r.status === 0;
}
function pngSize(p: string): { width: number; height: number } {
  const b = readFileSync(p);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}
function sha256(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

validate();

const outputs: Array<{ svg: string; png: string; w: number; h: number }> = [];
const fullView: Rect = { x1: 0, y1: 0, x2: M.canvas.width, y2: M.canvas.height };
const fullSvg = resolve(REVIEW_DIR, 'office-furniture-review-v1.svg');
mkdirSync(REVIEW_DIR, { recursive: true });
writeFileSync(fullSvg, buildSvg(fullView, 'full'));
outputs.push({ svg: fullSvg, png: resolve(REVIEW_DIR, 'office-furniture-review-v1.png'), w: M.canvas.width, h: M.canvas.height });

for (const p of data.panels) {
  const svg = resolve(REVIEW_DIR, `${p.file}.svg`);
  writeFileSync(svg, buildSvg({ x1: p.x, y1: p.y, x2: p.x + p.w, y2: p.y + p.h }, 'panel', p));
  outputs.push({ svg, png: resolve(REVIEW_DIR, `${p.file}.png`), w: p.w * p.scale, h: p.h * p.scale });
}

// Validate JSON (re-parse), SVG XML, and PNG dimensions for every artifact.
JSON.parse(readFileSync(DATA_PATH, 'utf8'));
let ok = true;
for (const o of outputs) {
  if (!validateSvgXml(o.svg)) {
    console.error(`invalid SVG XML: ${o.svg}`);
    ok = false;
  }
  const rasterized = rasterize(o.svg, o.png, o.w, o.h);
  if (rasterized) {
    const size = pngSize(o.png);
    if (size.width !== o.w || size.height !== o.h) {
      console.error(`PNG size mismatch: ${o.png} ${size.width}x${size.height} != ${o.w}x${o.h}`);
      ok = false;
    }
  }
  console.log(`${rasterized ? 'svg+png' : 'svg    '} ${o.svg.split('/').pop()} ${o.w}x${o.h}`);
  if (rasterized) console.log(`         sha256 svg ${sha256(o.svg)}`);
  if (rasterized) console.log(`         sha256 png ${sha256(o.png)}`);
}

const typeTotals: Record<string, number> = {};
for (const f of data.furniture) typeTotals[f.type] = (typeTotals[f.type] ?? 0) + 1;
console.log(`items ${data.furniture.length} ${JSON.stringify(typeTotals)}`);
console.log(`structure v2 svg ${sha256(resolve(REVIEW_DIR, M.structure.svg))} (unchanged)`);
console.log(`structure v2 png ${sha256(resolve(REVIEW_DIR, M.structure.png))} (unchanged)`);
if (!ok) process.exit(1);
