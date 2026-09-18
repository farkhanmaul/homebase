// Game-art renderer: the top-down pixel-art office the players actually see.
//
// This is a separate render mode from the technical review layer in
// lib/office-render-ops.ts. It paints only the playfield — floors, walls,
// windows, openings, columns, lifts and layered furniture — and never draws
// room-name bands, hotspot badges, seat numbers or internal ids. Location lives
// in the DOM caption / aria-live output, not on the map.
//
// Everything is derived from the approved manifest: every furniture group is
// built from its existing rect and tagged with its stable sourceId + kind, and
// every coordinate is snapped to integer pixels. The op list is pure, ordered
// and deterministic, so the canvas and the standalone preview are identical.

import type { Furniture, FurnitureKind, OfficeManifest, Opening, Rect, SurfaceKind, Wall, WindowRect } from './office-map.ts';
import { type GroupOp, type Op, type PreviewOps } from './office-render-ops.ts';

export const GAME_PALETTE = {
  outside: '#0b141d',
  outsideEdge: '#152330',

  office: '#3a342b',
  officeSeam: '#312c24',
  officeHi: '#463f34',
  officeEdge: '#2a251e',
  lobby: '#37424c',
  lobbySeam: '#2f3942',
  lobbyHi: '#434e59',
  lobbyEdge: '#28323a',
  corridor: '#2e3941',
  corridorSeam: '#27313a',
  corridorHi: '#3a4650',
  corridorEdge: '#242e36',
  service: '#575245',
  serviceSeam: '#4b473b',
  serviceHi: '#6a6455',
  serviceEdge: '#423e33',
  rug: '#63413c',
  rugSeam: '#543632',
  rugHi: '#7d564c',
  rugEdge: '#8a6a52',

  ink: '#0f1922',
  shadow: '#04080c',
  wallFace: '#ddd0ab',
  wallCap: '#f3e8c8',
  wallEdge: '#8d7f5d',
  wallHi: '#fff7de',
  partitionFace: '#c2cac6',
  partitionCap: '#e3e9e5',
  partitionEdge: '#8fa09b',
  columnFace: '#8c8778',
  columnCap: '#bab4a2',
  threshold: '#6d5636',
  thresholdHi: '#8d7248',
  doorGap: '#332e26',
  doorSaddle: '#8a6f45',

  windowSky: '#3f7093',
  windowSkyHi: '#6fa3c2',
  windowGlass: '#5aa0c6',
  windowGlassHi: '#a7d7ea',
  windowFrame: '#14212e',
  skyCloud: '#dfeef4',
  skyline: '#26404f',
  skylineLit: '#6d8ea2',
  greenery: '#4e7a4a',

  liftRecess: '#141d28',
  liftDoor: '#8b959d',
  liftDoorHi: '#bec7cd',
  liftDoorDark: '#5c666e',

  woodTop: '#c69a61',
  woodTopHi: '#ddb47d',
  woodEdge: '#9a713f',
  woodDark: '#79562e',
  woodSeam: '#ab824c',

  metal: '#8b959c',
  metalHi: '#c6ced3',
  metalDark: '#59636b',

  chairBack: '#3a4959',
  chairBackHi: '#4f6174',
  chairSeat: '#4b5c6e',
  chairSeatHi: '#657789',
  chairPost: '#222b34',
  chairBase: '#39434c',

  cabinet: '#a9753f',
  cabinetDoor: '#c28e52',
  cabinetHi: '#dcac6c',
  cabinetDark: '#7d5427',

  fridge: '#ccd5d9',
  fridgeDoor: '#e5ecef',
  fridgeDark: '#8b969c',

  dispenserBody: '#d3dbde',
  dispenserBottle: '#76c3e3',
  dispenserWater: '#3e8eb7',
  dispenserDark: '#79848a',

  sinkBasin: '#e2e9ec',
  sinkRim: '#b4bfc5',
  sinkTap: '#7b868d',

  sofaFrame: '#5a493c',
  sofaCushion: '#4d7c77',
  sofaCushionHi: '#68a29b',

  boardFrame: '#6c593b',
  boardFace: '#eedbae',
  boardInk: '#38473a',

  screen: '#8fa2b2',
  screenHi: '#bacad7',
  paper: '#f0e6c8',
  paperLine: '#b9a06a',
} as const;

// ---------------------------------------------------------------------------
// Pixel helpers (integer snapped)
// ---------------------------------------------------------------------------

function snap(rect: Rect): Rect {
  const x = Math.round(rect.x);
  const y = Math.round(rect.y);
  return { x, y, w: Math.max(1, Math.round(rect.x + rect.w) - x), h: Math.max(1, Math.round(rect.y + rect.h) - y) };
}

function inset(rect: Rect, n: number): Rect {
  const dx = Math.min(n, Math.floor((rect.w - 1) / 2));
  const dy = Math.min(n, Math.floor((rect.h - 1) / 2));
  return { x: rect.x + dx, y: rect.y + dy, w: Math.max(1, rect.w - dx * 2), h: Math.max(1, rect.h - dy * 2) };
}

function rectOp(x: number, y: number, w: number, h: number, fill: string, opacity?: number): Op {
  return opacity === undefined ? { t: 'rect', x, y, w, h, fill } : { t: 'rect', x, y, w, h, fill, opacity };
}

function circleOp(cx: number, cy: number, r: number, fill: string, opacity?: number): Op {
  return opacity === undefined ? { t: 'circle', cx, cy, r, fill } : { t: 'circle', cx, cy, r, fill, opacity };
}

function shadow(rect: Rect, dx = 3, dy = 3, opacity = 0.3): Op {
  return rectOp(rect.x + dx, rect.y + dy, rect.w, rect.h, GAME_PALETTE.shadow, opacity);
}

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

type FloorStyle = { base: string; seam: string; hi: string; edge: string; tile: number };

const FLOOR: Record<SurfaceKind, FloorStyle> = {
  office: { base: GAME_PALETTE.office, seam: GAME_PALETTE.officeSeam, hi: GAME_PALETTE.officeHi, edge: GAME_PALETTE.officeEdge, tile: 32 },
  lobby: { base: GAME_PALETTE.lobby, seam: GAME_PALETTE.lobbySeam, hi: GAME_PALETTE.lobbyHi, edge: GAME_PALETTE.lobbyEdge, tile: 32 },
  corridor: { base: GAME_PALETTE.corridor, seam: GAME_PALETTE.corridorSeam, hi: GAME_PALETTE.corridorHi, edge: GAME_PALETTE.corridorEdge, tile: 40 },
  service: { base: GAME_PALETTE.service, seam: GAME_PALETTE.serviceSeam, hi: GAME_PALETTE.serviceHi, edge: GAME_PALETTE.serviceEdge, tile: 24 },
  rug: { base: GAME_PALETTE.rug, seam: GAME_PALETTE.rugSeam, hi: GAME_PALETTE.rugHi, edge: GAME_PALETTE.rugEdge, tile: 0 },
};

function floorOps(rect: Rect, kind: SurfaceKind, phase: number): Op[] {
  const r = snap(rect);
  if (kind === 'rug') return rugOps(r);

  const style = FLOOR[kind];
  const ops: Op[] = [rectOp(r.x, r.y, r.w, r.h, style.base)];

  const t = style.tile;
  for (let x = r.x + t; x < r.x + r.w - 1; x += t) ops.push(rectOp(x, r.y, 1, r.h, style.seam, 0.9));
  for (let y = r.y + t; y < r.y + r.h - 1; y += t) ops.push(rectOp(r.x, y, r.w, 1, style.seam, 0.9));

  // Sparse carpet tufts on alternating tiles: a cheap texture, not per-pixel noise.
  let col = 0;
  for (let x = r.x + 2; x < r.x + r.w - 3; x += t, col++) {
    let row = 0;
    for (let y = r.y + 2; y < r.y + r.h - 3; y += t, row++) {
      if ((col + row + phase) % 2 === 0) ops.push(rectOp(x, y, Math.min(3, t - 4), 1, style.hi, 0.55));
    }
  }
  ops.push(rectOp(r.x, r.y, r.w, 1, style.edge, 0.45));
  ops.push(rectOp(r.x, r.y + r.h - 1, r.w, 1, style.edge, 0.45));
  return ops;
}

function rugOps(r: Rect): Op[] {
  const ops: Op[] = [rectOp(r.x, r.y, r.w, r.h, GAME_PALETTE.rugEdge)];
  const o = inset(r, 3);
  ops.push(rectOp(o.x, o.y, o.w, o.h, GAME_PALETTE.rug));
  // Dimensional light: top/left catch the room light, bottom/right fall to shade.
  ops.push(rectOp(o.x, o.y, o.w, 1, GAME_PALETTE.rugHi, 0.8));
  ops.push(rectOp(o.x, o.y, 1, o.h, GAME_PALETTE.rugHi, 0.5));
  ops.push(rectOp(o.x, o.y + o.h - 2, o.w, 2, GAME_PALETTE.shadow, 0.16));
  ops.push(rectOp(o.x + o.w - 2, o.y, 2, o.h, GAME_PALETTE.shadow, 0.1));
  const f = inset(o, 6);
  ops.push(rectOp(f.x, f.y, f.w, 1, GAME_PALETTE.rugHi, 0.5));
  ops.push(rectOp(f.x, f.y + f.h - 1, f.w, 1, GAME_PALETTE.rugHi, 0.5));
  ops.push(rectOp(f.x, f.y, 1, f.h, GAME_PALETTE.rugHi, 0.5));
  ops.push(rectOp(f.x + f.w - 1, f.y, 1, f.h, GAME_PALETTE.rugHi, 0.5));
  // Medallion + corner motifs so the declared rug reads as a rug, not a slab.
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  ops.push(circleOp(cx, cy, Math.min(14, o.h * 0.3), GAME_PALETTE.rugSeam, 0.9));
  ops.push(circleOp(cx, cy, Math.min(9, o.h * 0.2), GAME_PALETTE.rug, 1));
  ops.push(circleOp(cx, cy, 4, GAME_PALETTE.rugHi, 0.6));
  const corners: Array<[number, number]> = [[f.x, f.y], [f.x + f.w - 5, f.y], [f.x, f.y + f.h - 5], [f.x + f.w - 5, f.y + f.h - 5]];
  for (const [mx, my] of corners) {
    ops.push(rectOp(mx, my, 5, 5, GAME_PALETTE.rugSeam, 0.7));
    ops.push(rectOp(mx + 1, my + 1, 3, 3, GAME_PALETTE.rugHi, 0.5));
  }
  for (let i = 12; i < o.w - 12; i += 16) {
    ops.push(rectOp(o.x + i, o.y + 5, 2, 3, GAME_PALETTE.rugHi, 0.45));
    ops.push(rectOp(o.x + i, o.y + o.h - 8, 2, 3, GAME_PALETTE.rugHi, 0.45));
  }
  return ops;
}

function outsideOps(rect: Rect): Op[] {
  const r = snap(rect);
  return [rectOp(r.x, r.y, r.w, r.h, GAME_PALETTE.outside), rectOp(r.x, r.y, r.w, 2, GAME_PALETTE.outsideEdge, 0.35)];
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

function wallOps(wall: Wall): Op[] {
  const r = snap(wall.rect);
  const full = wall.kind === 'full';
  const face = full ? GAME_PALETTE.wallFace : GAME_PALETTE.partitionFace;
  const cap = full ? GAME_PALETTE.wallCap : GAME_PALETTE.partitionCap;
  const edge = full ? GAME_PALETTE.wallEdge : GAME_PALETTE.partitionEdge;
  const ops: Op[] = [];
  if (full) ops.push(shadow(r, 2, 3, 0.28));
  ops.push(rectOp(r.x, r.y, r.w, r.h, GAME_PALETTE.ink));
  const inner = inset(r, 1);
  ops.push(rectOp(inner.x, inner.y, inner.w, inner.h, face));
  if (inner.w >= inner.h) {
    ops.push(rectOp(inner.x, inner.y, inner.w, 1, cap));
    if (inner.h > 2) ops.push(rectOp(inner.x, inner.y + inner.h - 1, inner.w, 1, edge, 0.8));
    if (full && inner.w > 8) {
      ops.push(rectOp(inner.x, inner.y, 3, Math.max(1, Math.min(inner.h, 2)), GAME_PALETTE.wallHi));
      ops.push(rectOp(inner.x + inner.w - 3, inner.y, 3, Math.max(1, Math.min(inner.h, 2)), GAME_PALETTE.wallHi));
    }
  } else {
    ops.push(rectOp(inner.x, inner.y, 1, inner.h, cap));
    if (inner.w > 2) ops.push(rectOp(inner.x + inner.w - 1, inner.y, 1, inner.h, edge, 0.8));
    if (full && inner.h > 8) {
      ops.push(rectOp(inner.x, inner.y, Math.min(inner.w, 2), 3, GAME_PALETTE.wallHi));
      ops.push(rectOp(inner.x, inner.y + inner.h - 3, Math.min(inner.w, 2), 3, GAME_PALETTE.wallHi));
    }
  }
  return ops;
}

function columnOps(rect: Rect): Op[] {
  const r = snap(rect);
  const face = inset(r, 1);
  const cap = inset(r, 2);
  return [
    shadow(r, 3, 3, 0.3),
    rectOp(r.x, r.y, r.w, r.h, GAME_PALETTE.ink),
    rectOp(face.x, face.y, face.w, face.h, GAME_PALETTE.columnFace),
    rectOp(cap.x, cap.y, cap.w, cap.h, GAME_PALETTE.columnCap),
    rectOp(cap.x, cap.y, cap.w, 1, GAME_PALETTE.wallHi, 0.7),
  ];
}

// A doorway reads as a walkable gap: the dark gap tone shows the floor
// continuing through the wall, a slim wooden saddle marks the threshold, and
// dark jambs close the two ends. No bright debug bar.
function openingOps(opening: Opening): Op[] {
  const r = snap(opening.rect);
  const ops: Op[] = [rectOp(r.x, r.y, r.w, r.h, GAME_PALETTE.doorGap)];
  if (opening.orientation === 'horizontal') {
    ops.push(rectOp(r.x, r.y, 1, r.h, GAME_PALETTE.ink));
    ops.push(rectOp(r.x + r.w - 1, r.y, 1, r.h, GAME_PALETTE.ink));
    const saddleH = Math.min(3, r.h);
    const sy = r.y + Math.floor((r.h - saddleH) / 2);
    ops.push(rectOp(r.x + 1, sy, Math.max(1, r.w - 2), saddleH, GAME_PALETTE.doorSaddle));
    ops.push(rectOp(r.x + 1, sy, Math.max(1, r.w - 2), 1, GAME_PALETTE.thresholdHi, 0.9));
    ops.push(rectOp(r.x + 1, r.y, Math.max(1, r.w - 2), 1, GAME_PALETTE.wallHi, 0.28));
  } else {
    ops.push(rectOp(r.x, r.y, r.w, 1, GAME_PALETTE.ink));
    ops.push(rectOp(r.x, r.y + r.h - 1, r.w, 1, GAME_PALETTE.ink));
    const saddleW = Math.min(3, r.w);
    const sx = r.x + Math.floor((r.w - saddleW) / 2);
    ops.push(rectOp(sx, r.y + 1, saddleW, Math.max(1, r.h - 2), GAME_PALETTE.doorSaddle));
    ops.push(rectOp(sx, r.y + 1, 1, Math.max(1, r.h - 2), GAME_PALETTE.thresholdHi, 0.9));
    ops.push(rectOp(r.x, r.y + 1, 1, Math.max(1, r.h - 2), GAME_PALETTE.wallHi, 0.28));
  }
  return ops;
}

function windowOps(win: WindowRect): Op[] {
  const r = snap(win.rect);
  const ops: Op[] = [];
  if (win.side === 'top' || win.side === 'bottom') {
    const top = win.side === 'top';
    const skyH = 20;
    const skyY = top ? Math.max(0, r.y - skyH) : r.y + r.h;
    const bandH = top ? Math.max(1, r.y - skyY + r.h) : skyH;
    ops.push(rectOp(r.x, skyY, r.w, bandH, GAME_PALETTE.windowSky));
    ops.push(rectOp(r.x, top ? skyY : skyY + bandH - 3, r.w, 3, GAME_PALETTE.windowSkyHi, 0.5));
    for (let i = 0; i < 3; i++) {
      const cx = r.x + 40 + i * Math.max(140, Math.round(r.w / 3));
      if (cx + 30 > r.x + r.w - 4) break;
      ops.push(rectOp(cx, skyY + 3, 26, 3, GAME_PALETTE.skyCloud, 0.7));
      ops.push(rectOp(cx + 6, skyY + 1, 14, 2, GAME_PALETTE.skyCloud, 0.7));
    }
    const baseY = top ? r.y : skyY + bandH;
    for (let bx = r.x + 6; bx < r.x + r.w - 20; bx += 40) {
      const idx = Math.round((bx - r.x) / 40);
      const h = 6 + ((idx * 7) % 11);
      const by = top ? baseY - h : baseY;
      ops.push(rectOp(bx, by, 30, h, GAME_PALETTE.skyline));
      if (idx % 3 === 0) ops.push(rectOp(bx + 3, by + 2, 4, 3, GAME_PALETTE.skylineLit, 0.8));
      if (idx % 4 === 1) ops.push(rectOp(bx + 2, by - 2, 8, 3, GAME_PALETTE.greenery));
    }
    ops.push(rectOp(r.x, r.y - 2, r.w, r.h + 4, GAME_PALETTE.windowFrame));
    ops.push(rectOp(r.x + 1, r.y - 1, Math.max(1, r.w - 2), Math.max(1, r.h + 2), GAME_PALETTE.windowGlass));
    ops.push(rectOp(r.x + 1, r.y, Math.max(1, r.w - 2), 1, GAME_PALETTE.windowGlassHi));
    for (let mx = r.x + 60; mx < r.x + r.w - 10; mx += 60) ops.push(rectOp(mx, r.y - 2, 1, r.h + 4, GAME_PALETTE.windowFrame));
    return ops;
  }

  const right = win.side === 'right';
  const skyW = 18;
  const skyX = right ? r.x + r.w : Math.max(0, r.x - skyW);
  ops.push(rectOp(skyX, r.y, skyW, r.h, GAME_PALETTE.windowSky));
  ops.push(rectOp(right ? skyX : skyX + skyW - 3, r.y, 3, r.h, GAME_PALETTE.windowSkyHi, 0.5));
  ops.push(rectOp(skyX + 3, r.y + 20, 3, 26, GAME_PALETTE.skyCloud, 0.7));
  for (let by = r.y + 10; by < r.y + r.h - 30; by += 40) {
    const idx = Math.round((by - r.y) / 40);
    const w = 6 + ((idx * 5) % 11);
    ops.push(rectOp(right ? skyX + skyW - w : skyX, by, w, 30, GAME_PALETTE.skyline));
    if (idx % 3 === 0) ops.push(rectOp(right ? skyX + skyW - w + 2 : skyX + 2, by + 3, 3, 4, GAME_PALETTE.skylineLit, 0.8));
  }
  const fx = right ? r.x - 2 : r.x - 2;
  ops.push(rectOp(fx, r.y, r.w + 4, r.h, GAME_PALETTE.windowFrame));
  ops.push(rectOp(r.x - 1, r.y + 1, Math.max(1, r.w + 2), Math.max(1, r.h - 2), GAME_PALETTE.windowGlass));
  ops.push(rectOp(r.x, r.y + 1, 1, Math.max(1, r.h - 2), GAME_PALETTE.windowGlassHi));
  for (let my = r.y + 60; my < r.y + r.h - 10; my += 60) ops.push(rectOp(fx, my, r.w + 4, 1, GAME_PALETTE.windowFrame));
  return ops;
}

function liftOps(rect: Rect): Op[] {
  const r = snap(rect);
  const ops: Op[] = [shadow(r, 2, 2, 0.32), rectOp(r.x, r.y, r.w, r.h, GAME_PALETTE.ink)];
  const recess = inset(r, 2);
  ops.push(rectOp(recess.x, recess.y, recess.w, recess.h, GAME_PALETTE.liftRecess));
  // Inner-frame bevel: light top/left, dark bottom/right, so the shaft is recessed.
  ops.push(rectOp(recess.x, recess.y, recess.w, 1, GAME_PALETTE.liftDoorDark));
  ops.push(rectOp(recess.x, recess.y, 1, recess.h, GAME_PALETTE.liftDoorDark));
  const doors = inset(recess, 2);
  ops.push(rectOp(doors.x, doors.y, doors.w, doors.h, GAME_PALETTE.liftDoor));
  ops.push(rectOp(doors.x, doors.y, doors.w, 1, GAME_PALETTE.liftDoorHi));
  ops.push(rectOp(doors.x, doors.y + doors.h - 1, doors.w, 1, GAME_PALETTE.liftDoorDark));
  ops.push(rectOp(doors.x + Math.floor(doors.w / 2), doors.y, 1, doors.h, GAME_PALETTE.ink));
  // Left leaf catches the light, right leaf falls into shade: a dimensional pair.
  ops.push(rectOp(doors.x + 1, doors.y + 2, 2, Math.max(2, doors.h - 4), GAME_PALETTE.liftDoorHi, 0.75));
  ops.push(rectOp(doors.x + Math.floor(doors.w / 2) + 1, doors.y + 2, 2, Math.max(2, doors.h - 4), GAME_PALETTE.liftDoorDark, 0.6));
  // Sill at the threshold and a small call panel beside the doors.
  ops.push(rectOp(recess.x, recess.y + recess.h - 3, recess.w, 3, GAME_PALETTE.liftDoorDark, 0.55));
  const px = recess.x + recess.w - 5;
  const py = doors.y + Math.round(doors.h / 2) - 4;
  ops.push(rectOp(px, py, 4, 9, GAME_PALETTE.metalDark));
  ops.push(rectOp(px + 1, py + 2, 2, 2, GAME_PALETTE.liftDoorHi));
  ops.push(rectOp(px + 1, py + 5, 2, 2, GAME_PALETTE.liftDoorHi, 0.6));
  return ops;
}

// ---------------------------------------------------------------------------
// Furniture: one layered group per approved item
// ---------------------------------------------------------------------------

function deskArt(item: Furniture): Op[] {
  const r = snap(item.rect);
  const inner = inset(r, 1);
  const wide = inner.w >= inner.h;
  const ops: Op[] = [shadow(r), rectOp(r.x, r.y, r.w, r.h, GAME_PALETTE.ink), rectOp(inner.x, inner.y, inner.w, inner.h, GAME_PALETTE.woodTop)];
  ops.push(rectOp(inner.x, inner.y, inner.w, 1, GAME_PALETTE.woodTopHi));
  const long = wide ? inner.w : inner.h;
  if (wide && inner.h >= 6) ops.push(rectOp(inner.x, inner.y + inner.h - 3, inner.w, 3, GAME_PALETTE.woodEdge));
  if (!wide && inner.w >= 6) ops.push(rectOp(inner.x + inner.w - 3, inner.y, 3, inner.h, GAME_PALETTE.woodEdge));

  // Long banks are split into repeated workstations: a divider per boundary and
  // a subtle alternating panel tint, so they never read as one plain slab.
  if (long >= 96) {
    const segments = Math.max(2, Math.round(long / 66));
    for (let i = 0; i < segments; i++) {
      if (wide) {
        const sx = inner.x + Math.round((inner.w * i) / segments);
        const sw = Math.round((inner.w * (i + 1)) / segments) - sx;
        if (i > 0) ops.push(rectOp(sx - 1, inner.y + 1, 2, Math.max(1, inner.h - 2), GAME_PALETTE.woodDark, 0.9));
        if (i % 2 === 1) ops.push(rectOp(sx + 2, inner.y + 2, Math.max(1, sw - 4), Math.max(1, inner.h - 5), GAME_PALETTE.woodTopHi, 0.16));
      } else {
        const sy = inner.y + Math.round((inner.h * i) / segments);
        const sh = Math.round((inner.h * (i + 1)) / segments) - sy;
        if (i > 0) ops.push(rectOp(inner.x + 1, sy - 1, Math.max(1, inner.w - 2), 2, GAME_PALETTE.woodDark, 0.9));
        if (i % 2 === 1) ops.push(rectOp(inner.x + 2, sy + 2, Math.max(1, inner.w - 5), Math.max(1, sh - 4), GAME_PALETTE.woodTopHi, 0.16));
      }
    }
  } else if (wide) {
    for (let x = inner.x + 64; x < inner.x + inner.w - 10; x += 64) ops.push(rectOp(x, inner.y + 2, 1, Math.max(1, inner.h - 4), GAME_PALETTE.woodSeam, 0.8));
  } else {
    for (let y = inner.y + 64; y < inner.y + inner.h - 10; y += 64) ops.push(rectOp(inner.x + 2, y, Math.max(1, inner.w - 4), 1, GAME_PALETTE.woodSeam, 0.8));
  }
  const capW = Math.min(3, inner.w);
  ops.push(rectOp(inner.x, inner.y, capW, 2, GAME_PALETTE.wallHi, 0.7));
  ops.push(rectOp(inner.x + inner.w - capW, inner.y, capW, 2, GAME_PALETTE.wallHi, 0.7));

  // Restrained monitor + keyboard only on solo desks whose box supports it.
  if (wide && r.w >= 50 && r.w <= 170 && r.h >= 36 && r.h <= 64 && inner.h >= 18) {
    const cx = r.x + Math.round(r.w / 2);
    const my = r.y + 6;
    ops.push(rectOp(cx - 9, my, 18, 11, GAME_PALETTE.ink));
    ops.push(rectOp(cx - 8, my + 1, 16, 9, GAME_PALETTE.screen));
    ops.push(rectOp(cx - 8, my + 1, 16, 3, GAME_PALETTE.screenHi));
    ops.push(rectOp(cx - 2, my + 11, 4, 2, GAME_PALETTE.metalDark));
    ops.push(rectOp(cx - 11, my + 15, 22, 6, GAME_PALETTE.metal));
    ops.push(rectOp(cx - 10, my + 16, 20, 1, GAME_PALETTE.metalHi));
    ops.push(rectOp(cx + 12, my + 14, 8, 10, GAME_PALETTE.paper));
    ops.push(rectOp(cx + 13, my + 16, 6, 1, GAME_PALETTE.paperLine));
    ops.push(rectOp(cx + 13, my + 18, 6, 1, GAME_PALETTE.paperLine));
  }
  return ops;
}

function tableArt(item: Furniture): Op[] {
  const r = snap(item.rect);
  const inner = inset(r, 1);
  const ops: Op[] = [shadow(r), rectOp(r.x, r.y, r.w, r.h, GAME_PALETTE.ink), rectOp(inner.x, inner.y, inner.w, inner.h, GAME_PALETTE.woodTop)];
  ops.push(rectOp(inner.x, inner.y, inner.w, 1, GAME_PALETTE.woodTopHi));
  ops.push(rectOp(inner.x + 3, inner.y + 3, Math.max(1, inner.w - 6), 1, GAME_PALETTE.woodSeam, 0.7));
  // A restrained centre runner on roomy tables: furniture detail, not a screen.
  if (!item.id.includes('CERT') && inner.w >= 56 && inner.h >= 24) {
    if (inner.w >= inner.h) ops.push(rectOp(inner.x + 7, inner.y + Math.round(inner.h / 2) - 1, Math.max(1, inner.w - 14), 2, GAME_PALETTE.woodDark, 0.35));
    else ops.push(rectOp(inner.x + Math.round(inner.w / 2) - 1, inner.y + 7, 2, Math.max(1, inner.h - 14), GAME_PALETTE.woodDark, 0.35));
  }
  if (inner.h >= 6) ops.push(rectOp(inner.x, inner.y + inner.h - 2, inner.w, 2, GAME_PALETTE.woodEdge));

  // The certificate table reads as a small display: a few framed papers, no badge.
  if (item.id.includes('CERT')) {
    const py = r.y + 9;
    for (let i = 0; i < 3; i++) {
      const px = r.x + 16 + i * 42;
      if (px + 16 > r.x + r.w - 6) break;
      ops.push(rectOp(px, py, 16, 22, GAME_PALETTE.paper));
      ops.push(rectOp(px + 2, py + 4, 12, 1, GAME_PALETTE.paperLine));
      ops.push(rectOp(px + 2, py + 8, 12, 1, GAME_PALETTE.paperLine));
      ops.push(rectOp(px + 2, py + 12, 8, 1, GAME_PALETTE.paperLine));
    }
  }
  return ops;
}

function counterArt(item: Furniture): Op[] {
  const r = snap(item.rect);
  const inner = inset(r, 1);
  const wide = inner.w >= inner.h;
  const ops: Op[] = [shadow(r), rectOp(r.x, r.y, r.w, r.h, GAME_PALETTE.ink), rectOp(inner.x, inner.y, inner.w, inner.h, GAME_PALETTE.woodTop)];
  ops.push(rectOp(inner.x, inner.y, inner.w, 1, GAME_PALETTE.woodTopHi));
  ops.push(rectOp(inner.x, inner.y + 1, inner.w, 1, GAME_PALETTE.woodDark, 0.3)); // counter-top overhang
  const span = wide ? inner.w : inner.h;
  const panels = Math.max(1, Math.round(span / 38));
  for (let i = 1; i < panels; i++) {
    if (wide) ops.push(rectOp(inner.x + Math.round((inner.w * i) / panels), inner.y + 2, 1, Math.max(1, inner.h - 2), GAME_PALETTE.woodDark, 0.8));
    else ops.push(rectOp(inner.x + 2, inner.y + Math.round((inner.h * i) / panels), Math.max(1, inner.w - 2), 1, GAME_PALETTE.woodDark, 0.8));
  }
  for (let i = 0; i < panels; i++) {
    if (wide) {
      const cx = inner.x + Math.round((inner.w * (i + 0.5)) / panels);
      ops.push(rectOp(cx - 3, inner.y + Math.max(2, Math.round(inner.h / 2)), 6, 2, GAME_PALETTE.metalHi));
    } else {
      const cy = inner.y + Math.round((inner.h * (i + 0.5)) / panels);
      ops.push(rectOp(inner.x + Math.max(2, Math.round(inner.w / 2)), cy - 3, 2, 6, GAME_PALETTE.metalHi));
    }
  }
  if (wide && inner.h >= 8) ops.push(rectOp(inner.x, inner.y + inner.h - 3, inner.w, 3, GAME_PALETTE.woodEdge));
  if (!wide && inner.w >= 8) ops.push(rectOp(inner.x + inner.w - 3, inner.y, 3, inner.h, GAME_PALETTE.woodEdge));
  return ops;
}

function cabinetArt(item: Furniture): Op[] {
  const r = snap(item.rect);
  const inner = inset(r, 1);
  const wide = inner.w >= inner.h;
  const ops: Op[] = [shadow(r), rectOp(r.x, r.y, r.w, r.h, GAME_PALETTE.ink), rectOp(inner.x, inner.y, inner.w, inner.h, GAME_PALETTE.cabinet)];
  ops.push(rectOp(inner.x, inner.y, inner.w, 1, GAME_PALETTE.cabinetHi));
  const span = wide ? inner.w : inner.h;
  const leaves = Math.max(1, Math.round(span / 36));
  for (let i = 0; i < leaves; i++) {
    if (wide) {
      const lx = inner.x + Math.round((inner.w * i) / leaves);
      const lw = Math.round((inner.w * (i + 1)) / leaves) - Math.round((inner.w * i) / leaves);
      ops.push(rectOp(lx + 1, inner.y + 1, Math.max(1, lw - 2), Math.max(1, inner.h - 2), GAME_PALETTE.cabinetDoor));
      if (i > 0) ops.push(rectOp(lx, inner.y + 1, 1, Math.max(1, inner.h - 2), GAME_PALETTE.cabinetDark));
      if (i > 0) ops.push(rectOp(lx + 2, inner.y + Math.max(2, Math.round(inner.h / 2) - 3), 2, 6, GAME_PALETTE.metalHi));
    } else {
      const ly = inner.y + Math.round((inner.h * i) / leaves);
      const lh = Math.round((inner.h * (i + 1)) / leaves) - Math.round((inner.h * i) / leaves);
      ops.push(rectOp(inner.x + 1, ly + 1, Math.max(1, inner.w - 2), Math.max(1, lh - 2), GAME_PALETTE.cabinetDoor));
      if (i > 0) ops.push(rectOp(inner.x + 1, ly, Math.max(1, inner.w - 2), 1, GAME_PALETTE.cabinetDark));
      if (i > 0) ops.push(rectOp(inner.x + Math.max(2, Math.round(inner.w / 2) - 3), ly + 2, 6, 2, GAME_PALETTE.metalHi));
    }
  }
  return ops;
}

function fridgeArt(item: Furniture): Op[] {
  const r = snap(item.rect);
  const inner = inset(r, 1);
  const wide = inner.w >= inner.h;
  const ops: Op[] = [shadow(r), rectOp(r.x, r.y, r.w, r.h, GAME_PALETTE.ink), rectOp(inner.x, inner.y, inner.w, inner.h, GAME_PALETTE.fridge)];
  ops.push(rectOp(inner.x, inner.y, inner.w, 1, GAME_PALETTE.fridgeDoor));
  if (wide) {
    const mid = inner.x + Math.round(inner.w / 2);
    ops.push(rectOp(inner.x + 1, inner.y + 1, Math.max(1, mid - inner.x - 2), Math.max(1, inner.h - 2), GAME_PALETTE.fridgeDoor));
    ops.push(rectOp(mid + 1, inner.y + 1, Math.max(1, inner.x + inner.w - mid - 2), Math.max(1, inner.h - 2), GAME_PALETTE.fridgeDoor));
    ops.push(rectOp(mid, inner.y, 1, inner.h, GAME_PALETTE.fridgeDark));
    ops.push(rectOp(mid - 4, inner.y + 4, 2, Math.max(4, inner.h - 10), GAME_PALETTE.fridgeDark));
    ops.push(rectOp(mid + 2, inner.y + 4, 2, Math.max(4, inner.h - 10), GAME_PALETTE.fridgeDark));
  } else {
    const mid = inner.y + Math.round(inner.h / 2);
    ops.push(rectOp(inner.x + 1, inner.y + 1, Math.max(1, inner.w - 2), Math.max(1, mid - inner.y - 2), GAME_PALETTE.fridgeDoor));
    ops.push(rectOp(inner.x + 1, mid + 1, Math.max(1, inner.w - 2), Math.max(1, inner.y + inner.h - mid - 2), GAME_PALETTE.fridgeDoor));
    ops.push(rectOp(inner.x, mid, inner.w, 1, GAME_PALETTE.fridgeDark));
  }
  return ops;
}

function dispenserArt(item: Furniture): Op[] {
  void item;
  const r = snap(item.rect);
  const inner = inset(r, 1);
  const bodyH = Math.max(6, Math.round(inner.h * 0.55));
  const ops: Op[] = [shadow(r), rectOp(r.x, r.y, r.w, r.h, GAME_PALETTE.ink)];
  ops.push(rectOp(inner.x, inner.y + inner.h - bodyH, inner.w, bodyH, GAME_PALETTE.dispenserBody));
  ops.push(rectOp(inner.x, inner.y + inner.h - bodyH, inner.w, 1, GAME_PALETTE.metalHi));
  const bw = Math.max(6, Math.round(inner.w * 0.42));
  const bx = inner.x + Math.round((inner.w - bw) / 2);
  const bh = Math.max(5, inner.h - bodyH - 4);
  ops.push(rectOp(bx, inner.y + 1, bw, bh, GAME_PALETTE.dispenserBottle));
  ops.push(rectOp(bx, inner.y + 1, bw, 2, GAME_PALETTE.dispenserWater));
  ops.push(rectOp(bx + 1, inner.y + 4, 1, 2, GAME_PALETTE.metalHi));
  ops.push(rectOp(inner.x + Math.round(inner.w / 2) - 1, inner.y + inner.h - bodyH - 2, 2, 3, GAME_PALETTE.dispenserDark));
  ops.push(rectOp(inner.x + 3, inner.y + inner.h - 3, Math.max(1, inner.w - 6), 2, GAME_PALETTE.metal));
  return ops;
}

function sinkArt(item: Furniture): Op[] {
  void item;
  const r = snap(item.rect);
  const inner = inset(r, 1);
  const ops: Op[] = [shadow(r), rectOp(r.x, r.y, r.w, r.h, GAME_PALETTE.ink), rectOp(inner.x, inner.y, inner.w, inner.h, GAME_PALETTE.sinkRim)];
  const basin = inset(inner, 3);
  ops.push(rectOp(basin.x, basin.y, basin.w, basin.h, GAME_PALETTE.sinkBasin));
  ops.push(rectOp(basin.x + 1, basin.y + 1, Math.max(1, basin.w - 2), Math.max(1, basin.h - 2), GAME_PALETTE.metalHi, 0.5));
  const spoutX = inner.x + Math.round(inner.w / 2) - 1;
  ops.push(rectOp(spoutX, inner.y + 1, 2, Math.max(3, Math.round(inner.h * 0.3)), GAME_PALETTE.sinkTap));
  ops.push(rectOp(spoutX - 3, inner.y + 1, 8, 2, GAME_PALETTE.sinkTap));
  return ops;
}

function sofaArt(item: Furniture): Op[] {
  void item;
  const r = snap(item.rect);
  const inner = inset(r, 1);
  const ops: Op[] = [shadow(r, 2, 3, 0.26), rectOp(r.x, r.y, r.w, r.h, GAME_PALETTE.ink), rectOp(inner.x, inner.y, inner.w, inner.h, GAME_PALETTE.sofaFrame)];
  const backH = Math.max(5, Math.round(inner.h * 0.32));
  ops.push(rectOp(inner.x, inner.y, inner.w, backH, GAME_PALETTE.sofaFrame));
  ops.push(rectOp(inner.x, inner.y, inner.w, 1, GAME_PALETTE.sofaCushionHi, 0.6));
  const seatY = inner.y + backH;
  const seatH = Math.max(1, inner.y + inner.h - seatY - 2);
  const seats = 2;
  for (let i = 0; i < seats; i++) {
    const sx = inner.x + 1 + Math.round(((inner.w - 2) * i) / seats);
    const sw = Math.round(((inner.w - 2) * (i + 1)) / seats) - Math.round(((inner.w - 2) * i) / seats) - 1;
    ops.push(rectOp(sx, seatY, Math.max(1, sw), seatH, GAME_PALETTE.sofaCushion));
    ops.push(rectOp(sx, seatY, Math.max(1, sw), 1, GAME_PALETTE.sofaCushionHi));
  }
  return ops;
}

// The side the chair back sits on. Chairs are oriented away from their nearest
// solid furniture (a desk, table or counter), so a seated avatar faces its
// workstation — inferred deterministically from the approved geometry only.
export type ChairFacing = 'north' | 'south' | 'east' | 'west';

function chairArt(item: Furniture, facing: ChairFacing = 'north'): Op[] {
  void item;
  const r = snap(item.rect);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const rad = Math.max(6, Math.min(r.w, r.h) / 2 - 1.5);
  const arm = Math.max(7, rad * 1.5);
  const ops: Op[] = [circleOp(cx + 2, cy + 3, rad + 0.5, GAME_PALETTE.shadow, 0.26)];

  // 5-star base: an outlined cross, four outlined casters and a centre post.
  ops.push(rectOp(cx - arm / 2 - 1, cy - 2, arm + 2, 4, GAME_PALETTE.ink));
  ops.push(rectOp(cx - 2, cy - arm / 2 - 1, 4, arm + 2, GAME_PALETTE.ink));
  ops.push(rectOp(cx - arm / 2, cy - 1, arm, 2, GAME_PALETTE.chairBase));
  ops.push(rectOp(cx - 1, cy - arm / 2, 2, arm, GAME_PALETTE.chairBase));
  const offset = rad * 0.7;
  const legs: Array<[number, number]> = [[cx + offset, cy], [cx - offset, cy], [cx, cy + offset], [cx, cy - offset]];
  for (const [lx, ly] of legs) {
    ops.push(circleOp(lx, ly, 2.6, GAME_PALETTE.ink));
    ops.push(circleOp(lx, ly, 1.4, GAME_PALETTE.chairBase));
  }
  ops.push(circleOp(cx, cy, Math.max(3, rad * 0.34) + 1, GAME_PALETTE.ink));
  ops.push(circleOp(cx, cy, Math.max(2, rad * 0.3), GAME_PALETTE.chairPost));

  // Backrest: outlined shell, inset cushion panel and a small headrest notch.
  const bw = Math.max(8, Math.round(r.w * 0.78));
  const bh = Math.max(5, Math.round(r.h * 0.26));
  let bx: number;
  let by: number;
  let w: number;
  let h: number;
  if (facing === 'north' || facing === 'south') {
    w = bw;
    h = bh;
    bx = Math.round(cx - bw / 2);
    by = facing === 'north' ? r.y + 1 : r.y + r.h - 1 - bh;
  } else {
    w = bh;
    h = bw;
    bx = facing === 'west' ? r.x + 1 : r.x + r.w - 1 - bh;
    by = Math.round(cy - bw / 2);
  }
  ops.push(rectOp(bx - 1, by - 1, w + 2, h + 2, GAME_PALETTE.ink));
  ops.push(rectOp(bx, by, w, h, GAME_PALETTE.chairBack));
  ops.push(rectOp(bx + 1, by + 1, Math.max(1, w - 2), Math.max(1, h - 2), GAME_PALETTE.chairSeat, 0.5));
  if (facing === 'north') {
    ops.push(rectOp(bx, by, w, 1, GAME_PALETTE.chairBackHi));
    if (w >= 12) ops.push(rectOp(bx + Math.floor(w / 2) - 2, by + 1, 4, 2, GAME_PALETTE.chairBackHi, 0.75));
  } else if (facing === 'south') {
    ops.push(rectOp(bx, by + h - 1, w, 1, GAME_PALETTE.chairBackHi));
    if (w >= 12) ops.push(rectOp(bx + Math.floor(w / 2) - 2, by + h - 3, 4, 2, GAME_PALETTE.chairBackHi, 0.75));
  } else if (facing === 'west') {
    ops.push(rectOp(bx, by, 1, h, GAME_PALETTE.chairBackHi));
    if (h >= 12) ops.push(rectOp(bx + 1, by + Math.floor(h / 2) - 2, 2, 4, GAME_PALETTE.chairBackHi, 0.75));
  } else {
    ops.push(rectOp(bx + w - 1, by, 1, h, GAME_PALETTE.chairBackHi));
    if (h >= 12) ops.push(rectOp(bx + w - 3, by + Math.floor(h / 2) - 2, 2, 4, GAME_PALETTE.chairBackHi, 0.75));
  }

  // Seat cushion: outlined disc pushed toward the front, with a soft sheen.
  const sr = Math.max(4, rad * 0.82);
  const seatOff = sr * 0.35;
  const sx = facing === 'west' ? cx + seatOff : facing === 'east' ? cx - seatOff : cx;
  const sy = facing === 'north' ? cy + 1 + seatOff * 0.4 : facing === 'south' ? cy + 1 - seatOff * 0.4 : cy + 1;
  ops.push(circleOp(sx, sy, sr + 1.2, GAME_PALETTE.ink));
  ops.push(circleOp(sx, sy, sr, GAME_PALETTE.chairSeat));
  ops.push(circleOp(sx - sr * 0.28, sy - sr * 0.28, sr * 0.42, GAME_PALETTE.chairSeatHi, 0.55));
  return ops;
}

function screenArt(item: Furniture): Op[] {
  void item;
  const r = snap(item.rect);
  const inner = inset(r, 1);
  const ops: Op[] = [shadow(r, 2, 3, 0.26), rectOp(r.x, r.y, r.w, r.h, GAME_PALETTE.ink), rectOp(inner.x, inner.y, inner.w, inner.h, GAME_PALETTE.metalDark)];
  const panel = inset(inner, 2);
  ops.push(rectOp(panel.x, panel.y, panel.w, panel.h, GAME_PALETTE.screen));
  ops.push(rectOp(panel.x, panel.y, panel.w, 2, GAME_PALETTE.screenHi));
  ops.push(rectOp(inner.x + Math.round(inner.w / 2) - 2, inner.y + inner.h - 2, 4, 2, GAME_PALETTE.metal));
  return ops;
}

function boardArt(item: Furniture): Op[] {
  void item;
  const r = snap(item.rect);
  const inner = inset(r, 1);
  const face = inset(r, 2);
  const ops: Op[] = [shadow(r, 2, 2, 0.28), rectOp(r.x, r.y, r.w, r.h, GAME_PALETTE.ink), rectOp(inner.x, inner.y, inner.w, inner.h, GAME_PALETTE.boardFrame)];
  ops.push(rectOp(face.x, face.y, face.w, face.h, GAME_PALETTE.boardFace));
  // Subtle ranking pixels on a slim display — no letter badge.
  for (let i = 0; i < 3; i++) {
    const py = face.y + 4 + i * 6;
    ops.push(rectOp(face.x + 1, py, Math.max(2, face.w - 2), 2, GAME_PALETTE.boardInk, 0.75));
    ops.push(rectOp(face.x + 1, py, 1, 2, GAME_PALETTE.paper, 0.9));
  }
  return ops;
}

const FURNITURE_ART: Record<FurnitureKind, (item: Furniture) => Op[]> = {
  desk: deskArt,
  table: tableArt,
  counter: counterArt,
  cabinet: cabinetArt,
  chair: chairArt,
  fridge: fridgeArt,
  dispenser: dispenserArt,
  screen: screenArt,
  sink: sinkArt,
  sofa: sofaArt,
  board: boardArt,
};

export function buildFurnitureGroup(item: Furniture, facing: ChairFacing = 'north'): GroupOp {
  const ops = item.kind === 'chair' ? chairArt(item, facing) : FURNITURE_ART[item.kind](item);
  return { t: 'group', sourceId: item.id, semantic: `furniture:${item.kind}`, ops };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function surfaceArea(manifest: OfficeManifest, surface: OfficeManifest['surfaces'][number]): number {
  const zone = manifest.zones.find((entry) => entry.id === surface.zone);
  const rect = surface.rect ?? zone?.rect;
  return rect ? rect.w * rect.h : 0;
}

// A chair faces its nearest solid workstation (desk/table/counter); the back
// sits on the opposite side. Pure geometry, so it is deterministic.
function chairFacingFor(item: Furniture, solids: readonly Furniture[]): ChairFacing {
  const cx = item.rect.x + item.rect.w / 2;
  const cy = item.rect.y + item.rect.h / 2;
  let best: Furniture | null = null;
  let bestDistance = Infinity;
  for (const solid of solids) {
    const dx = solid.rect.x + solid.rect.w / 2 - cx;
    const dy = solid.rect.y + solid.rect.h / 2 - cy;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = solid;
    }
  }
  if (!best) return 'north';
  const dx = cx - (best.rect.x + best.rect.w / 2);
  const dy = cy - (best.rect.y + best.rect.h / 2);
  if (Math.abs(dy) >= Math.abs(dx)) return dy > 0 ? 'south' : 'north';
  return dx > 0 ? 'east' : 'west';
}

export function buildGameWorldOps(manifest: OfficeManifest): Op[] {
  const ops: Op[] = [rectOp(0, 0, manifest.width, manifest.height, GAME_PALETTE.outside)];

  for (const block of manifest.blocks) if (block.kind === 'void') ops.push(...outsideOps(block.rect));

  // Floors, largest first so patches (the lobby rug) sit on their parent zone.
  const surfaces = [...manifest.surfaces].sort((a, b) => surfaceArea(manifest, b) - surfaceArea(manifest, a));
  surfaces.forEach((surface, index) => {
    const zone = manifest.zones.find((entry) => entry.id === surface.zone);
    const rect = surface.rect ?? zone?.rect;
    if (rect) ops.push(...floorOps(rect, surface.kind, index));
  });

  for (const window of manifest.windows) ops.push(...windowOps(window));
  for (const wall of manifest.walls) ops.push(...wallOps(wall));
  for (const opening of manifest.openings) ops.push(...openingOps(opening));
  for (const column of manifest.columns) ops.push(...columnOps(column.rect));

  // Sealed blocks with no zone of their own are the lift shafts; the locked
  // rooms (Gudang, toilets, server) keep their zone floor + walls instead of a
  // giant opaque overlay, so they never look erased.
  for (const block of manifest.blocks) {
    if (block.kind !== 'sealed') continue;
    if (manifest.zones.some((zone) => zone.name === block.name)) continue;
    ops.push(...liftOps(block.rect));
  }

  const solids = manifest.furniture.filter((item) => item.solid);
  for (const item of manifest.furniture) {
    ops.push(buildFurnitureGroup(item, item.kind === 'chair' ? chairFacingFor(item, solids) : 'north'));
  }

  return ops;
}

/** Standalone game-art preview: exactly the ops the canvas paints, no legend. */
export function buildGamePreviewOps(manifest: OfficeManifest): PreviewOps {
  return { width: manifest.width, height: manifest.height, ops: buildGameWorldOps(manifest) };
}
