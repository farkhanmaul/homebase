// Deterministic structure-only review artifact generator (Tahap 1).
//
// Reads docs/reviews/office-structure-review-<version>.json and writes the
// matching .svg (primary, always) and .png (when a local rasterizer exists).
// The default version is v1, so the original v1 artifacts regenerate
// byte-identically; pass another version (e.g. `v2`) or `--input file.json`.
//
// Scope: DINDING, SEKAT 160cm, PINTU (engsel+swing), CELAH, KOLOM, tepi
// eksterior/jendela, dan kotak lift. NO furniture, hotspots, avatars, corridor
// zones, or game styling. There is deliberately no "Koridor Servis" /
// "Koridor Bawah" label.
//
// Run:  node --experimental-strip-types scripts/generate-structure-review.ts [v1|v2|... | --input file.json]
// Deterministic: fixed ordering, no timestamps, no randomness, rounded numbers.
// The PNG is a rasterization of the same generated SVG (no second drawing).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REVIEW_DIR = resolve(HERE, '..', 'docs', 'reviews');

// Resolve the input JSON and the paired output paths. `v<N>` maps to the
// canonical versioned filenames; anything else is treated as a JSON path whose
// basename determines the SVG/PNG names.
function resolveTargets(argv: string[]): { data: string; svg: string; png: string } {
  const inputFlag = argv.indexOf('--input');
  const raw = inputFlag >= 0 ? (argv[inputFlag + 1] ?? 'v1') : (argv.find((a) => !a.startsWith('-')) ?? 'v1');
  if (/^v\d+$/.test(raw)) {
    const base = resolve(REVIEW_DIR, `office-structure-review-${raw}`);
    return { data: `${base}.json`, svg: `${base}.svg`, png: `${base}.png` };
  }
  const data = resolve(raw);
  const dir = dirname(data);
  const stem = basename(data).replace(/\.json$/, '');
  return { data, svg: resolve(dir, `${stem}.svg`), png: resolve(dir, `${stem}.png`) };
}

const TARGET = resolveTargets(process.argv.slice(2));
const DATA_PATH = TARGET.data;
const SVG_PATH = TARGET.svg;
const PNG_PATH = TARGET.png;

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
type Data = {
  meta: {
    title: string;
    subtitle: string;
    scaleNote: string;
    source: { file: string; width: number; height: number };
    canvas: { width: number; height: number };
    stroke: { wall: number; partition: number; window: number; door: number; tick: number };
    colors: Record<string, string>;
  };
  rooms: Room[];
  walls: Wall[];
  windows: Rect[];
  columns: Column[];
  lifts: Lift[];
  doors: Door[];
  gaps: Gap[];
};

const data: Data = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
const M = data.meta;
const C = M.colors;
const S = M.stroke;

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

function unit(a: { x1: number; y1: number; x2: number; y2: number }) {
  const dx = a.x2 - a.x1;
  const dy = a.y2 - a.y1;
  const len = Math.hypot(dx, dy) || 1;
  return { dx: dx / len, dy: dy / len, len };
}

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
  // White break over a wall, perpendicular padding so the wall line is truly cut.
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
      const cx = d.x;
      for (const hx of [a, b]) {
        const tx = hx;
        const ty = y + dy * half;
        out.push(line(hx, y, tx, ty, C.line, S.door));
        out.push(polyline(arcPoints(hx, y, half, tx, ty, cx, y), C.line, S.door));
      }
    } else {
      const hx = d.hinge === 'start' ? a : b;
      const fx = d.hinge === 'start' ? b : a;
      const ty = y + dy * L;
      out.push(line(hx, y, hx, ty, C.line, S.door));
      out.push(polyline(arcPoints(hx, y, L, hx, ty, fx, y), C.line, S.door));
    }
  } else {
    const a = d.y - L / 2;
    const b = d.y + L / 2;
    const x = d.x;
    const dx = d.swing === 'right' ? 1 : -1;
    if (d.hinge === 'double') {
      const half = L / 2;
      const cy = d.y;
      for (const hy of [a, b]) {
        const tx = x + dx * half;
        const ty = hy;
        out.push(line(x, hy, tx, ty, C.line, S.door));
        out.push(polyline(arcPoints(x, hy, half, tx, ty, x, cy), C.line, S.door));
      }
    } else {
      const hy = d.hinge === 'start' ? a : b;
      const fy = d.hinge === 'start' ? b : a;
      const tx = x + dx * L;
      out.push(line(x, hy, tx, hy, C.line, S.door));
      out.push(polyline(arcPoints(x, hy, L, tx, hy, x, fy), C.line, S.door));
    }
  }
  return out.join('\n');
}

function gapSymbol(g: Gap): string {
  const half = S.tick / 2;
  const out: string[] = [];
  if (g.axis === 'h') {
    for (const jx of [g.x - g.len / 2, g.x + g.len / 2]) {
      out.push(line(jx, g.y - half, jx, g.y + half, C.line, S.door));
    }
  } else {
    for (const jy of [g.y - g.len / 2, g.y + g.len / 2]) {
      out.push(line(g.x - half, jy, g.x + half, jy, C.line, S.door));
    }
  }
  return out.join('\n');
}

function openingCut(a: Door | Gap): string {
  if (a.axis === 'h') return cut({ x1: a.x - a.len / 2, y1: a.y, x2: a.x + a.len / 2, y2: a.y }, S.wall / 2 + 2);
  return cut({ x1: a.x, y1: a.y - a.len / 2, x2: a.x, y2: a.y + a.len / 2 }, S.wall / 2 + 2);
}

function padlock(cx: number, cy: number): string {
  const out: string[] = [];
  out.push(rect({ x1: cx - 5, y1: cy - 1, x2: cx + 5, y2: cy + 9 }, C.bg, C.line, 1.5));
  const shackle: Array<[number, number]> = [];
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * (1 + i / 10);
    shackle.push([cx + 3 * Math.cos(a), cy - 1 + 3 * Math.sin(a)]);
  }
  out.push(polyline(shackle, C.line, 1.5));
  out.push(`<circle cx="${n(cx)}" cy="${n(cy + 4)}" r="1.2" fill="${C.line}" />`);
  return out.join('\n');
}

function lockedAnnotation(d: Door): string {
  const px = d.axis === 'h' ? d.x : d.x + 16;
  const py = d.axis === 'h' ? d.y - 12 : d.y - 14;
  return [padlock(px, py), text(px, py - 12, 'TERKUNCI', 9, C.line, 'middle', 700)].join('\n');
}

function liftSymbol(l: Lift): string {
  const out: string[] = [];
  out.push(line(l.x1, l.y1, l.x2, l.y1, C.line, S.wall));
  out.push(line(l.x1, l.y2, l.x2, l.y2, C.line, S.wall));
  if (l.open === 'right') {
    out.push(line(l.x1, l.y1, l.x1, l.y2, C.line, S.wall));
    out.push(line(l.x2, l.y1, l.x2, l.y1 + 18, C.line, S.wall));
    out.push(line(l.x2, l.y2 - 18, l.x2, l.y2, C.line, S.wall));
  } else {
    out.push(line(l.x2, l.y1, l.x2, l.y2, C.line, S.wall));
    out.push(line(l.x1, l.y1, l.x1, l.y1 + 18, C.line, S.wall));
    out.push(line(l.x1, l.y2 - 18, l.x1, l.y2, C.line, S.wall));
  }
  out.push(text((l.x1 + l.x2) / 2, (l.y1 + l.y2) / 2 + 4, 'Lift', 12, C.muted, 'middle'));
  return out.join('\n');
}

function wrap(name: string, maxChars: number): string[] {
  const words = name.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur.length === 0) cur = w;
    else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function roomLabel(r: Room): string {
  const w = r.x2 - r.x1;
  const h = r.y2 - r.y1;
  const cx = (r.x1 + r.x2) / 2;
  const cy = (r.y1 + r.y2) / 2;
  const rotate = h > w * 1.6;
  const size = rotate ? 11 : w < 130 ? 11 : 14;
  if (rotate) return text(cx + 4, cy, r.name, size, C.label, 'middle', 500, -90);
  const lines = wrap(r.name, Math.max(6, Math.floor(w / (size * 0.6))));
  const step = size + 2;
  const start = cy - ((lines.length - 1) * step) / 2 + size * 0.35;
  return lines.map((ln, i) => text(cx, start + i * step, ln, size, C.label, 'middle', 500)).join('\n');
}

function legend(): string {
  const locked = data.doors.some((d) => d.locked);
  const x = 700;
  const y = locked ? 584 : 610;
  const w = 344;
  const h = locked ? 220 : 194;
  const out: string[] = [];
  out.push(rect({ x1: x, y1: y, x2: x + w, y2: y + h }, C.bg, C.line, 1));
  out.push(text(x + 12, y + 22, 'LEGENDA STRUKTUR', 13, C.line, 'start', 700));

  let gy = y + 44;
  out.push(line(x + 14, gy, x + 74, gy, C.line, S.wall));
  out.push(text(x + 86, gy + 4, 'Dinding penuh (solid)', 12, C.line));
  gy += 26;
  out.push(line(x + 14, gy, x + 74, gy, C.line, S.partition, '9 7'));
  out.push(text(x + 86, gy + 4, 'Sekat 160 cm (putus-putus)', 12, C.line));
  gy += 26;
  out.push(line(x + 14, gy - 10, x + 14, gy + 10, C.line, S.door));
  out.push(polyline(arcPoints(x + 14, gy, 22, x + 14, gy + 22, x + 36, gy), C.line, S.door));
  out.push(text(x + 86, gy + 4, 'Pintu engsel + arah buka', 12, C.line));
  gy += 26;
  out.push(line(x + 14, gy - 9, x + 14, gy + 9, C.line, S.door));
  out.push(line(x + 52, gy - 9, x + 52, gy + 9, C.line, S.door));
  out.push(text(x + 86, gy + 4, 'Celah pintu (tanpa daun)', 12, C.line));
  gy += 26;
  out.push(line(x + 14, gy, x + 74, gy, C.window, S.window));
  out.push(line(x + 44, gy - 6, x + 44, gy + 6, C.window, S.window));
  out.push(text(x + 86, gy + 4, 'Jendela / tepi eksterior', 12, C.line));
  gy += 26;
  out.push(rect({ x1: x + 14, y1: gy - 10, x2: x + 36, y2: gy + 10 }, C.column));
  out.push(text(x + 86, gy + 4, 'Kolom struktur (bukan furniture)', 12, C.line));
  if (locked) {
    gy += 26;
    out.push(padlock(x + 24, gy - 6));
    out.push(text(x + 86, gy + 4, 'Pintu terkunci (TERKUNCI)', 12, C.line));
  }
  return out.join('\n');
}

function checklist(): string {
  const locked = data.doors.some((d) => d.locked);
  const x = 1060;
  const y = locked ? 584 : 610;
  const w = 440;
  const h = locked ? 220 : 194;
  const out: string[] = [];
  out.push(rect({ x1: x, y1: y, x2: x + w, y2: y + h }, C.bg, C.line, 1));
  out.push(text(x + 12, y + 22, 'CHECKLIST BUKAAN (mudah dikoreksi)', 12, C.line, 'start', 700));
  out.push(text(x + 12, y + 40, 'PINTU ENGSEL (D)', 11, C.line, 'start', 700));
  let gy = y + 58;
  for (const d of data.doors) {
    out.push(text(x + 16, gy, `${d.id}  ${d.room}${d.locked ? ' (TERKUNCI)' : ''}`, 10, C.line));
    gy += 14;
  }
  out.push(text(x + 226, y + 40, 'CELAH / GAP (C)', 11, C.line, 'start', 700));
  let cy = y + 58;
  for (const g of data.gaps) {
    out.push(text(x + 230, cy, `${g.id}  ${g.room}`, 10, C.line));
    cy += 14;
  }
  if (locked) {
    out.push(text(x + 16, y + h - 12, 'TERKUNCI = pintu terkunci, tidak dapat dibuka.', 10, C.line));
  }
  return out.join('\n');
}

function build(): string {
  const bg = `<rect x="0" y="0" width="${M.canvas.width}" height="${M.canvas.height}" fill="${C.bg}" />`;
  const floors = data.rooms
    .map((r) => {
      const fill = r.kind === 'lobby' ? C.floorLobby : r.kind === 'service' ? C.floorService : r.kind === 'open' ? C.floorOpen : C.floorOffice;
      return rect(r, fill);
    })
    .join('\n');

  const walls = data.walls
    .map((wl) => line(wl.x1, wl.y1, wl.x2, wl.y2, C.line, wl.type === 'full' ? S.wall : S.partition, wl.type === 'partition' ? '9 7' : undefined))
    .join('\n');

  const windows = data.windows.map(windowSymbol).join('\n');
  const columns = data.columns.map((c) => rect(c, C.column)).join('\n');
  const lifts = data.lifts.map(liftSymbol).join('\n');
  const cuts = [...data.doors, ...data.gaps].map(openingCut).join('\n');
  const doorSym = data.doors.map(doorSymbol).join('\n');
  const gapSym = data.gaps.map(gapSymbol).join('\n');
  const lockedSym = data.doors.filter((d) => d.locked).map(lockedAnnotation).join('\n');
  const labels = data.rooms.map(roomLabel).join('\n');
  const ids = [
    ...data.doors.map((d) => text(d.axis === 'h' ? d.x + d.len / 2 + 6 : d.x + 8, d.axis === 'h' ? d.y - 8 : d.y - d.len / 2 - 6, d.id, 11, C.line, 'start', 700)),
    ...data.gaps.map((g) => text(g.axis === 'h' ? g.x + g.len / 2 + 6 : g.x + 8, g.axis === 'h' ? g.y - 8 : g.y - g.len / 2 - 6, g.id, 11, C.line, 'start', 700)),
  ].join('\n');

  const header = [
    text(16, 36, M.title, 24, C.line, 'start', 700),
    text(16, 62, M.subtitle, 12, C.line, 'start', 700),
    text(16, 82, M.scaleNote, 10, C.muted),
    text(16, 98, 'Tanpa furniture / hotspot / avatar.', 10, C.muted),
  ].join('\n');

  const body = [bg, floors, walls, windows, columns, lifts, cuts, doorSym, gapSym, ...(lockedSym ? [lockedSym] : []), labels, ids, header, legend(), checklist()].join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${M.canvas.width}" height="${M.canvas.height}" viewBox="0 0 ${M.canvas.width} ${M.canvas.height}" font-family="DejaVu Sans Mono, ui-monospace, Menlo, Consolas, monospace">\n${body}\n</svg>\n`;
}

function rasterizePng(): boolean {
  const candidates = [process.env.STRUCTURE_REVIEW_PY, '/tmp/homebase-svg-venv/bin/python3', 'python3'].filter(Boolean) as string[];
  const code = 'import cairosvg,sys; cairosvg.svg2png(url=sys.argv[1], write_to=sys.argv[2], output_width=int(sys.argv[3]), output_height=int(sys.argv[4]), background_color="white")';
  for (const py of candidates) {
    if (spawnSync(py, ['-c', 'import cairosvg'], { stdio: 'ignore' }).status !== 0) continue;
    const r = spawnSync(py, ['-c', code, SVG_PATH, PNG_PATH, String(M.canvas.width), String(M.canvas.height)], { stdio: 'inherit' });
    if (r.status === 0) return true;
  }
  return false;
}

const svg = build();
mkdirSync(REVIEW_DIR, { recursive: true });
writeFileSync(SVG_PATH, svg);
console.log(`svg  ${SVG_PATH} ${M.canvas.width}x${M.canvas.height} ${Buffer.byteLength(svg)} bytes`);
if (rasterizePng()) console.log(`png  ${PNG_PATH}`);
else console.log('png  skipped (no local cairosvg interpreter found)');
