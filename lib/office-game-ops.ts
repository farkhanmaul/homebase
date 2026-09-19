// Game-art renderer: the top-down pixel-art office the players actually see.
//
// This is a separate render mode from the technical review layer in
// lib/office-render-ops.ts. It paints only the playfield — floors, walls,
// windows, openings, columns, lifts and layered furniture — and never draws
// room-name bands, hotspot badges, seat numbers or internal ids. Location lives
// in the DOM caption / aria-live output, not on the map.
//
// V2 detail pass: the palette is a bright warm V1-inspired set (not the old
// near-black brown), every form carries a 1-3px navy outline with a directional
// south-east shadow, and each approved item is built from layered sub-sprites.
// Work desks additionally derive a deterministic workstation kit (monitor with
// bezel/screen/stand, keyboard, mouse and one small prop) per nearby chair, so a
// long bank reads as one coherent workstation rhythm instead of a bare slab.
// A visual-only decoration pass adds perimeter plants and wall art; it never
// creates a collider or a manifest item.
//
// Everything is derived from the approved manifest: every furniture group is
// built from its existing rect and tagged with its stable sourceId + kind, and
// every coordinate is snapped to integer pixels. The op list is pure, ordered
// and deterministic, so the canvas and the standalone preview are identical.

import { BILIK_GENG_ZONE_ID, type Furniture, type FurnitureKind, type OfficeManifest, type Opening, type Rect, type SurfaceKind, type Wall, type WindowRect } from './office-map.ts';
import { type GroupOp, type Op, type PaintedOp, type PreviewOps, type RectOp } from './office-render-ops.ts';

// The raster art underlay for the Bilik Geng Kami zone. It is painted as one
// image op over the zone's own vector art, at the exact approved zone rect; the
// vector art is kept underneath on purpose, as the fallback shown while the
// bitmap loads (and if it fails). The path is root-relative here and the browser
// resolves it base-path-safe through `assetUrl`.
export const BILIK_ZONE_IMAGE_SRC = '/room/bilik-geng-zone.png';

export const GAME_PALETTE = {
  outside: '#2a3946',
  outsideEdge: '#1d2a35',

  // Floors: warm office/corridor, pale service tile, slate lobby, warm rug.
  office: '#c9a976',
  officeSeam: '#b7955f',
  officeHi: '#dcbe8b',
  officeEdge: '#a8864f',
  corridor: '#cdb489',
  corridorSeam: '#b99e6c',
  corridorHi: '#e2cba3',
  corridorEdge: '#a88c5b',
  service: '#d9d7cd',
  serviceSeam: '#c4c1b4',
  serviceHi: '#eceae2',
  serviceEdge: '#aeaa9a',
  lobby: '#717f8c',
  lobbySeam: '#61707c',
  lobbyHi: '#8694a1',
  lobbyEdge: '#54626e',
  rug: '#b4563f',
  rugSeam: '#94432f',
  rugHi: '#cf7a5f',
  rugEdge: '#7d3627',

  ink: '#16202c',
  inkSoft: '#22303e',
  shadow: '#1b2531',

  wallFace: '#e7dcc0',
  wallCap: '#f8f1d9',
  wallEdge: '#a38f6a',
  wallHi: '#fffaea',
  partitionFace: '#cdd6d2',
  partitionCap: '#eaf1ee',
  partitionEdge: '#93a39e',
  columnFace: '#b9b3a1',
  columnCap: '#d8d2c0',
  columnDark: '#8b8574',
  threshold: '#8a6a3f',
  thresholdHi: '#a8834f',
  doorGap: '#3b342a',
  doorSaddle: '#a88356',

  skyFar: '#2f5f86',
  skyMid: '#4f8cb4',
  skyNear: '#93c2d8',
  skyGlow: '#f2d79f',
  windowGlass: '#6fb2d2',
  windowGlassHi: '#c6e6f1',
  windowFrame: '#1b2733',
  windowFrameHi: '#3d5266',
  skyCloud: '#eaf4f8',
  skyline: '#2b4658',
  skylineFar: '#3d5f74',
  skylineLit: '#9ec3d6',
  skylineWindow: '#e8d79a',
  greenery: '#5a8f4e',
  greeneryHi: '#7cb066',

  liftRecess: '#1d2733',
  liftDoor: '#9aa4ab',
  liftDoorHi: '#d3dbe0',
  liftDoorDark: '#616c74',

  woodTop: '#d9ab63',
  woodTopHi: '#f0c98a',
  woodEdge: '#a97a3f',
  woodDark: '#855c2c',
  woodSeam: '#c19653',
  woodSide: '#b98a48',

  metal: '#9aa4ab',
  metalHi: '#d5dde2',
  metalDark: '#5f6a72',

  chairBack: '#2f7f86',
  chairBackHi: '#4fa9ad',
  chairSeat: '#3f979c',
  chairSeatHi: '#74c4c6',
  chairFrame: '#173033',
  chairBase: '#25454a',
  chairArm: '#1d3a3e',

  cabinet: '#b07a41',
  cabinetDoor: '#c9954f',
  cabinetHi: '#e2b06e',
  cabinetDark: '#83551f',

  fridge: '#dde5e9',
  fridgeDoor: '#f1f6f8',
  fridgeDark: '#96a2a8',
  fridgeGasket: '#b7c1c6',

  dispenserBody: '#dfe7ea',
  dispenserBottle: '#6fc6e8',
  dispenserWater: '#3f93bd',
  dispenserDark: '#7f8a90',
  dispenserTray: '#b9c3c8',

  sinkBasin: '#eef4f6',
  sinkRim: '#c1cbd1',
  sinkTap: '#83909a',
  sinkWater: '#78bcd8',

  sofaFrame: '#7a5f47',
  sofaCushion: '#5b9e97',
  sofaCushionHi: '#7fc0b7',
  sofaPiping: '#3f7a74',

  boardFrame: '#8a6a41',
  boardFace: '#e8d3a2',
  boardInk: '#43533f',
  boardPin: '#c65f4a',

  screen: '#8fb2c8',
  screenHi: '#c6dcea',
  paper: '#f7f0dc',
  paperLine: '#c3ac7c',
  paperShadow: '#d8ccae',

  monitorBezel: '#202b37',
  monitorBezelHi: '#3c4c5c',
  monitorStand: '#4a5663',

  leaf: '#4f8f43',
  leafHi: '#79b566',
  leafDark: '#356b31',
  pot: '#b9694a',
  potHi: '#d68a66',
  potDark: '#8a4a33',

  mug: '#e8e2d0',
  mugHi: '#fbf7ec',
  mugAccent: '#c05a48',

  book: '#a8503f',
  bookAlt: '#3f6f8f',
  bookPage: '#f2e9d2',

  penCup: '#4a6d8c',
  pen: '#e0b64a',
  bowl: '#d9d3c4',
  broth: '#c98b4a',

  artFrame: '#8a6a41',
  artFace: '#f1e3c0',
  artInk: '#5a7a9c',
  clockFace: '#f6f1e2',
  clockRim: '#4a3b2c',

  // Area identity: fabric partitions, warm baseboards, per-room rug families
  // and the restrained lamp pools that light the corridors and the lobby.
  partitionFabric: '#2f7580',
  partitionFabricHi: '#56a7ac',
  partitionFabricDark: '#1d4d55',
  baseboard: '#b59c6e',
  baseboardHi: '#d9c69a',
  lampPool: '#ffdca0',
  lampPoolEdge: '#e6b877',

  // Cooler Tele/CS/CA upholstery, distinct from the V1 work-area teal.
  coolBack: '#2f6f9c',
  coolBackHi: '#5b9cc4',
  coolSeat: '#4a8aa6',
  coolSeatHi: '#7fbcd0',
  coolFrame: '#152b3a',
  coolBase: '#23455c',

  // Executive rooms share a deeper teal.
  execBack: '#256a6f',
  execBackHi: '#469aa0',
  execSeat: '#358086',
  execSeatHi: '#63b0b4',
  execFrame: '#123033',
  execBase: '#1e4449',

  // Reception / pantry equipment.
  phoneShell: '#3b4652',
  phoneShellHi: '#5b6a78',
  cup: '#eef2f4',
  cupAccent: '#c96a52',
  bell: '#d9b96a',
  bellHi: '#f0dca0',
  tray: '#8f9ba3',
  trayHi: '#c3ccd1',
  screenGlyph: '#6f93ad',
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

function rectOp(x: number, y: number, w: number, h: number, fill: string, opacity?: number): RectOp {
  return opacity === undefined ? { t: 'rect', x, y, w, h, fill } : { t: 'rect', x, y, w, h, fill, opacity };
}

function circleOp(cx: number, cy: number, r: number, fill: string, opacity?: number): PaintedOp {
  return opacity === undefined ? { t: 'circle', cx, cy, r, fill } : { t: 'circle', cx, cy, r, fill, opacity };
}

function rectOf(r: Rect, fill: string, opacity?: number): PaintedOp {
  return rectOp(r.x, r.y, r.w, r.h, fill, opacity);
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Directional south-east drop shadow: every solid form casts it, so the whole
// scene shares one light direction.
function shadow(rect: Rect, dx = 3, dy = 4, opacity = 0.22): Op {
  return rectOp(rect.x + dx, rect.y + dy, rect.w, rect.h, GAME_PALETTE.shadow, opacity);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// ---------------------------------------------------------------------------
// Area identity: deterministic per-zone materials and upholstery
// ---------------------------------------------------------------------------

type RugStyle = { edge: string; base: string; hi: string; seam: string };

const RUG_STYLES = {
  warm: { edge: GAME_PALETTE.rugEdge, base: GAME_PALETTE.rug, hi: GAME_PALETTE.rugHi, seam: GAME_PALETTE.rugSeam },
  sand: { edge: '#7d6a4a', base: '#b9a276', hi: '#d8c69c', seam: '#9a8460' },
  cool: { edge: '#22414a', base: '#3f6f7a', hi: '#5f96a0', seam: '#2e545d' },
  slate: { edge: '#39444f', base: '#5f6f80', hi: '#8294a4', seam: '#4a5766' },
  burgundy: { edge: '#54222c', base: '#8f3f4f', hi: '#b0606f', seam: '#6f2f3d' },
} as const satisfies Record<string, RugStyle>;

type RugVariant = keyof typeof RUG_STYLES;

// Chair upholstery families: every family keeps the V1 teal-and-navy
// construction, so a room's seating reads as its own set without leaving the
// shared material language.
type Upholstery = {
  back: string;
  backHi: string;
  seat: string;
  seatHi: string;
  frame: string;
  base: string;
  arm: string;
};

const UPHOLSTERY: Record<'v1' | 'exec' | 'cool', Upholstery> = {
  v1: { back: GAME_PALETTE.chairBack, backHi: GAME_PALETTE.chairBackHi, seat: GAME_PALETTE.chairSeat, seatHi: GAME_PALETTE.chairSeatHi, frame: GAME_PALETTE.chairFrame, base: GAME_PALETTE.chairBase, arm: GAME_PALETTE.chairArm },
  exec: { back: GAME_PALETTE.execBack, backHi: GAME_PALETTE.execBackHi, seat: GAME_PALETTE.execSeat, seatHi: GAME_PALETTE.execSeatHi, frame: GAME_PALETTE.execFrame, base: GAME_PALETTE.execBase, arm: GAME_PALETTE.execFrame },
  cool: { back: GAME_PALETTE.coolBack, backHi: GAME_PALETTE.coolBackHi, seat: GAME_PALETTE.coolSeat, seatHi: GAME_PALETTE.coolSeatHi, frame: GAME_PALETTE.coolFrame, base: GAME_PALETTE.coolBase, arm: GAME_PALETTE.coolFrame },
};

type PartitionStyle = { base: string; hi: string; dark: string };

const PARTITION_FABRIC: Record<'warm' | 'cool', PartitionStyle> = {
  warm: { base: GAME_PALETTE.partitionFabric, hi: GAME_PALETTE.partitionFabricHi, dark: GAME_PALETTE.partitionFabricDark },
  cool: { base: '#376f9c', hi: '#63a3c8', dark: '#21496b' },
};

export type ZoneIdentity = { rug?: RugVariant; upholstery: keyof typeof UPHOLSTERY; partition: keyof typeof PARTITION_FABRIC };

const DEFAULT_IDENTITY: ZoneIdentity = { upholstery: 'v1', partition: 'warm' };

// Rooms get a material identity derived from the approved zone id, never an
// arbitrary coordinate: the top row each carries its own rug, the executive and
// the IT rooms a distinct upholstery, and Tele/CS/CA switches to the cooler
// partition fabric that separates it from Desk Collection at a glance.
const ZONE_IDENTITY: Record<string, ZoneIdentity> = {
  'meeting-1': { rug: 'warm', upholstery: 'v1', partition: 'warm' },
  hrga: { rug: 'sand', upholstery: 'v1', partition: 'warm' },
  komisaris: { rug: 'cool', upholstery: 'exec', partition: 'cool' },
  'product-manager': { rug: 'sand', upholstery: 'exec', partition: 'warm' },
  it: { rug: 'slate', upholstery: 'cool', partition: 'cool' },
  'direktur-finance': { rug: 'burgundy', upholstery: 'exec', partition: 'warm' },
  resepsionis: { rug: 'sand', upholstery: 'v1', partition: 'warm' },
  'meeting-2': { rug: 'cool', upholstery: 'v1', partition: 'cool' },
  'desk-collection': { upholstery: 'v1', partition: 'warm' },
  'tele-cs-ca': { upholstery: 'cool', partition: 'cool' },
};

export function zoneIdentity(zoneId: string): ZoneIdentity {
  return ZONE_IDENTITY[zoneId] ?? DEFAULT_IDENTITY;
}

export function upholsteryFor(zoneId: string): Upholstery {
  return UPHOLSTERY[zoneIdentity(zoneId).upholstery];
}

export function partitionFor(zoneId: string): PartitionStyle {
  return PARTITION_FABRIC[zoneIdentity(zoneId).partition];
}

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

type FloorStyle = { base: string; seam: string; hi: string; edge: string; tile: number; grain: 'plank' | 'grid' | 'plain' };

const FLOOR: Record<SurfaceKind, FloorStyle> = {
  office: { base: GAME_PALETTE.office, seam: GAME_PALETTE.officeSeam, hi: GAME_PALETTE.officeHi, edge: GAME_PALETTE.officeEdge, tile: 32, grain: 'plank' },
  lobby: { base: GAME_PALETTE.lobby, seam: GAME_PALETTE.lobbySeam, hi: GAME_PALETTE.lobbyHi, edge: GAME_PALETTE.lobbyEdge, tile: 32, grain: 'grid' },
  corridor: { base: GAME_PALETTE.corridor, seam: GAME_PALETTE.corridorSeam, hi: GAME_PALETTE.corridorHi, edge: GAME_PALETTE.corridorEdge, tile: 40, grain: 'grid' },
  service: { base: GAME_PALETTE.service, seam: GAME_PALETTE.serviceSeam, hi: GAME_PALETTE.serviceHi, edge: GAME_PALETTE.serviceEdge, tile: 24, grain: 'grid' },
  rug: { base: GAME_PALETTE.rug, seam: GAME_PALETTE.rugSeam, hi: GAME_PALETTE.rugHi, edge: GAME_PALETTE.rugEdge, tile: 0, grain: 'plain' },
};

// Lamp pools: the restrained warm glow the corridors and the lobby read by. They
// are translucent floor paint (never a collider) whose positions derive from the
// surface rect, so a corridor always lights along its own length. Kept inside the
// rect and off its 8px edges so no pool implies a route edge.
function lampPoolOps(r: Rect, phase: number): Op[] {
  const ops: Op[] = [];
  const horizontal = r.w >= r.h;
  const step = 220;
  const offset = 40 + (phase % 2) * 30;
  if (horizontal) {
    const w = Math.min(150, Math.max(36, Math.round(r.w * 0.16)));
    const h = Math.max(6, r.h - 18);
    for (let x = r.x + offset + w / 2; x + w / 2 < r.x + r.w - 8; x += step) {
      ops.push(rectOp(Math.round(x - w / 2), r.y + 9, w, h, GAME_PALETTE.lampPool, 0.1));
      ops.push(rectOp(Math.round(x - w / 2), r.y + 9, w, 1, GAME_PALETTE.lampPoolEdge, 0.12));
    }
  } else {
    const w = Math.max(6, r.w - 18);
    const h = Math.min(150, Math.max(36, Math.round(r.h * 0.16)));
    for (let y = r.y + offset + h / 2; y + h / 2 < r.y + r.h - 8; y += step) {
      ops.push(rectOp(r.x + 9, Math.round(y - h / 2), w, h, GAME_PALETTE.lampPool, 0.1));
      ops.push(rectOp(r.x + 9, Math.round(y - h / 2), 1, h, GAME_PALETTE.lampPoolEdge, 0.12));
    }
  }
  return ops;
}

// A thin inner frame shared by every floor material: warm light on the top/left
// lip, material edge on the bottom/right, so the surface reads as a slab.
function edgeFrameOps(r: Rect, style: FloorStyle): Op[] {
  return [
    rectOp(r.x, r.y, r.w, 1, style.hi, 0.4),
    rectOp(r.x, r.y, 1, r.h, style.hi, 0.25),
    rectOp(r.x, r.y + r.h - 1, r.w, 1, style.edge, 0.5),
    rectOp(r.x + r.w - 1, r.y, 1, r.h, style.edge, 0.5),
  ];
}

// Office wood: horizontal boards, never a square tile grid. Board rows are
// 10-16px tall, each carrying a dark seam plus an alternating warm highlight, a
// staggered run of 48-80px end joints and a couple of short grain dashes. Every
// number is derived from the zone/surface id hash, so the floor is identical on
// every build but each room gets its own board pitch and joint stagger.
function plankFloorOps(r: Rect, style: FloorStyle, zoneId: string): Op[] {
  const ops: Op[] = [];
  const seed = hashString(zoneId);
  const board = clamp(10 + (seed % 7), 10, 16);
  const joint = clamp(48 + ((seed >>> 4) % 33), 48, 80);
  let row = 0;
  for (let y = r.y; y < r.y + r.h - 1; y += board, row += 1) {
    const h = Math.min(board, r.y + r.h - y);
    if (h < 3) break;
    ops.push(rectOp(r.x, y, r.w, 1, style.seam, 0.5));
    if (row % 2 === 0) ops.push(rectOp(r.x, y + 1, r.w, 1, style.hi, 0.26));
    const shift = (seed + row * 29) % joint;
    for (let x = r.x + shift + joint; x < r.x + r.w - 4; x += joint) {
      ops.push(rectOp(Math.round(x), y + 1, 1, Math.max(1, h - 1), style.seam, 0.45));
    }
    const grain = hashString(`${zoneId}#${row}`);
    const dashes = 1 + (grain % 2);
    for (let i = 0; i < dashes; i += 1) {
      const span = Math.max(1, r.w - 14);
      const gx = r.x + 5 + ((grain >>> (i * 5)) % span);
      const gw = clamp(2 + ((grain >>> (i * 3 + 2)) % 7), 2, 8);
      const gy = y + 2 + ((grain >>> (i * 2)) % Math.max(1, Math.min(h - 3, board - 3)));
      if (gx + gw >= r.x + r.w - 1) continue;
      ops.push(rectOp(Math.round(gx), Math.round(gy), gw, 1, style.edge, 0.34));
    }
  }
  ops.push(...edgeFrameOps(r, style));
  return ops;
}

function gridFloorOps(r: Rect, style: FloorStyle, phase: number): Op[] {
  const ops: Op[] = [];
  const t = style.tile;
  for (let x = r.x + t; x < r.x + r.w - 1; x += t) ops.push(rectOp(x, r.y, 1, r.h, style.seam, 0.85));
  for (let y = r.y + t; y < r.y + r.h - 1; y += t) ops.push(rectOp(r.x, y, r.w, 1, style.seam, 0.85));
  // Sparse tufts on alternating tiles: a cheap texture, not per-pixel noise.
  let col = 0;
  for (let x = r.x + 2; x < r.x + r.w - 3; x += t, col += 1) {
    let row = 0;
    for (let y = r.y + 2; y < r.y + r.h - 3; y += t, row += 1) {
      if ((col + row + phase) % 2 === 0) ops.push(rectOp(x, y, Math.min(3, Math.max(1, t - 4)), 1, style.hi, 0.5));
    }
  }
  ops.push(...edgeFrameOps(r, style));
  return ops;
}

// Lobby material bands: a polished inset frame plus two long runner stripes in
// the lobby's own slate tones, so the big room reads as a finished floor rather
// than one flat colour. Pure paint, derived from the zone rect.
function lobbyBandOps(r: Rect): Op[] {
  const band = inset(r, 10);
  if (band.w < 60 || band.h < 80) return [];
  const insetX = r.x + 16;
  const bandW = Math.max(1, r.w - 32);
  return [
    rectOp(band.x, band.y, band.w, 1, GAME_PALETTE.lobbyHi, 0.3),
    rectOp(band.x, band.y + band.h - 1, band.w, 1, GAME_PALETTE.lobbyEdge, 0.35),
    rectOp(band.x, band.y, 1, band.h, GAME_PALETTE.lobbyHi, 0.24),
    rectOp(band.x + band.w - 1, band.y, 1, band.h, GAME_PALETTE.lobbyEdge, 0.28),
    rectOp(insetX, Math.round(r.y + r.h * 0.3), bandW, 4, GAME_PALETTE.lobbyHi, 0.16),
    rectOp(insetX, Math.round(r.y + r.h * 0.3) + 4, bandW, 1, GAME_PALETTE.lobbyEdge, 0.2),
    rectOp(insetX, Math.round(r.y + r.h * 0.68), bandW, 4, GAME_PALETTE.lobbySeam, 0.18),
  ];
}

function floorOps(rect: Rect, kind: SurfaceKind, phase: number, zoneId: string): Op[] {
  const r = snap(rect);
  if (kind === 'rug') return rugOps(r, RUG_STYLES.warm);

  const style = FLOOR[kind];
  const ops: Op[] = [rectOp(r.x, r.y, r.w, r.h, style.base)];

  if (style.grain === 'plank') ops.push(...plankFloorOps(r, style, zoneId));
  else if (style.grain === 'grid') ops.push(...gridFloorOps(r, style, phase));

  // Restrained lighting pools along the corridors and across the lobby.
  if (kind === 'corridor' || kind === 'lobby') ops.push(...lampPoolOps(r, phase));
  if (kind === 'lobby') ops.push(...lobbyBandOps(r));

  return ops;
}

// Furniture-centred rugs: instead of a room-wide inset panel, a rug is the union
// of the room's approved tables/desks plus the chairs that sit at them, padded
// 8-16px, clipped inside the zone and clear of every opening. Sealed rooms and
// the long Desk Collection / Tele banks never get one (they have no rug identity
// and stay legible as work floors), and the manifest rug surfaces are untouched.
function furnitureRugOps(manifest: OfficeManifest): Op[] {
  const ops: Op[] = [];
  for (const zone of manifest.zones) {
    const identity = zoneIdentity(zone.id);
    if (!identity.rug || zone.kind === 'service') continue;
    if (zone.id === 'desk-collection' || zone.id === 'tele-cs-ca') continue;

    const items = manifest.furniture.filter((item) => item.zone === zone.id);
    const tops = items.filter((item) => item.kind === 'table' || item.kind === 'desk');
    if (!tops.length) continue;
    const cluster = [...tops];
    for (const chair of items) {
      if (chair.kind !== 'chair') continue;
      const cx = chair.rect.x + chair.rect.w / 2;
      const cy = chair.rect.y + chair.rect.h / 2;
      const seated = tops.some((top) => {
        const dx = top.rect.x + top.rect.w / 2 - cx;
        const dy = top.rect.y + top.rect.h / 2 - cy;
        return Math.hypot(dx, dy) <= Math.max(top.rect.w, top.rect.h) / 2 + 44;
      });
      if (seated) cluster.push(chair);
    }

    const pad = 8 + (hashString(zone.id) % 9);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const item of cluster) {
      minX = Math.min(minX, item.rect.x);
      minY = Math.min(minY, item.rect.y);
      maxX = Math.max(maxX, item.rect.x + item.rect.w);
      maxY = Math.max(maxY, item.rect.y + item.rect.h);
    }
    const zx = zone.rect.x + 5;
    const zy = zone.rect.y + 5;
    const zr = zone.rect.x + zone.rect.w - 5;
    const zb = zone.rect.y + zone.rect.h - 5;
    const rect: Rect = {
      x: Math.max(Math.floor(minX - pad), Math.round(zx)),
      y: Math.max(Math.floor(minY - pad), Math.round(zy)),
      w: 0,
      h: 0,
    };
    rect.w = Math.min(Math.ceil(maxX + pad), Math.round(zr)) - rect.x;
    rect.h = Math.min(Math.ceil(maxY + pad), Math.round(zb)) - rect.y;
    if (rect.w < 44 || rect.h < 44) continue;

    // Clip away any opening that bites into the rug, then re-check the size.
    const clipped = clearOpenings(rect, manifest.openings.map((opening) => opening.rect));
    if (!clipped) continue;
    ops.push(...rugOps(clipped, RUG_STYLES[identity.rug]));
  }
  return ops;
}

// Shrinks a rug away from any opening it overlaps, along the opening's dominant
// axis, and returns null if the rug would collapse below a usable size.
function clearOpenings(rect: Rect, openings: readonly Rect[]): Rect | null {
  const r = { ...rect };
  for (const opening of openings) {
    if (!overlaps(r, opening)) continue;
    const horizontal = opening.w >= opening.h;
    const openingCx = opening.x + opening.w / 2;
    const openingCy = opening.y + opening.h / 2;
    const centreX = r.x + r.w / 2;
    const centreY = r.y + r.h / 2;
    if (horizontal) {
      if (openingCy <= centreY) {
        const next = Math.round(opening.y + opening.h + 2);
        r.h -= next - r.y;
        r.y = next;
      } else {
        r.h = Math.round(opening.y - 2) - r.y;
      }
    } else if (openingCx <= centreX) {
      const next = Math.round(opening.x + opening.w + 2);
      r.w -= next - r.x;
      r.x = next;
    } else {
      r.w = Math.round(opening.x - 2) - r.x;
    }
    if (r.w < 44 || r.h < 44) return null;
  }
  return r;
}

function rugOps(r: Rect, style: RugStyle): Op[] {
  const ops: Op[] = [rectOp(r.x, r.y, r.w, r.h, style.edge)];
  const o = inset(r, 3);
  ops.push(rectOf(o, style.base));
  ops.push(rectOp(o.x, o.y, o.w, 1, style.hi, 0.85));
  ops.push(rectOp(o.x, o.y, 1, o.h, style.hi, 0.5));
  ops.push(rectOp(o.x, o.y + o.h - 2, o.w, 2, GAME_PALETTE.shadow, 0.16));
  ops.push(rectOp(o.x + o.w - 2, o.y, 2, o.h, GAME_PALETTE.shadow, 0.1));
  const f = inset(o, 6);
  ops.push(rectOp(f.x, f.y, f.w, 1, style.hi, 0.5));
  ops.push(rectOp(f.x, f.y + f.h - 1, f.w, 1, style.hi, 0.5));
  ops.push(rectOp(f.x, f.y, 1, f.h, style.hi, 0.5));
  ops.push(rectOp(f.x + f.w - 1, f.y, 1, f.h, style.hi, 0.5));
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  ops.push(circleOp(cx, cy, Math.min(14, o.h * 0.3), style.seam, 0.9));
  ops.push(circleOp(cx, cy, Math.min(9, o.h * 0.2), style.base, 1));
  ops.push(circleOp(cx, cy, 4, style.hi, 0.6));
  const corners: Array<[number, number]> = [[f.x, f.y], [f.x + f.w - 5, f.y], [f.x, f.y + f.h - 5], [f.x + f.w - 5, f.y + f.h - 5]];
  for (const [mx, my] of corners) {
    ops.push(rectOp(mx, my, 5, 5, style.seam, 0.7));
    ops.push(rectOp(mx + 1, my + 1, 3, 3, style.hi, 0.5));
  }
  for (let i = 12; i < o.w - 12; i += 16) {
    ops.push(rectOp(o.x + i, o.y + 5, 2, 3, style.hi, 0.45));
    ops.push(rectOp(o.x + i, o.y + o.h - 8, 2, 3, style.hi, 0.45));
  }
  return ops;
}

function outsideOps(rect: Rect): Op[] {
  const r = snap(rect);
  return [rectOp(r.x, r.y, r.w, r.h, GAME_PALETTE.outside), rectOp(r.x, r.y, r.w, 2, GAME_PALETTE.outsideEdge, 0.4)];
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
  if (full) ops.push(shadow(r, 2, 4, 0.2));
  ops.push(rectOp(r.x, r.y, r.w, r.h, GAME_PALETTE.ink));
  const inner = inset(r, 1);
  ops.push(rectOf(inner, face));

  if (inner.w >= inner.h) {
    ops.push(rectOp(inner.x, inner.y, inner.w, Math.min(2, inner.h), cap));
    ops.push(rectOp(inner.x, inner.y + inner.h - 1, inner.w, 1, edge, 0.85));
    // Baseboard trim along the room-facing (south) edge of a horizontal wall.
    if (inner.h >= 3) ops.push(rectOp(inner.x, inner.y + inner.h - 2, inner.w, 1, GAME_PALETTE.baseboard, 0.55));
    if (full) ops.push(rectOp(inner.x, inner.y, Math.min(2, inner.w), inner.h, GAME_PALETTE.wallHi, 0.6));
    else ops.push(rectOp(inner.x, inner.y, inner.w, 1, GAME_PALETTE.wallHi, 0.7));
  } else {
    ops.push(rectOp(inner.x, inner.y, Math.min(2, inner.w), inner.h, cap));
    ops.push(rectOp(inner.x + inner.w - 1, inner.y, 1, inner.h, edge, 0.85));
    // Baseboard trim along the room-facing (east) edge of a vertical wall.
    if (inner.w >= 3) ops.push(rectOp(inner.x + inner.w - 2, inner.y, 1, inner.h, GAME_PALETTE.baseboard, 0.55));
    ops.push(rectOp(inner.x, inner.y, inner.w, Math.min(2, inner.h), GAME_PALETTE.wallHi, 0.6));
  }
  // A foot shadow just outside the south/east face grounds the wall.
  ops.push(rectOp(r.x + 1, r.y + r.h, Math.max(1, r.w - 2), 1, GAME_PALETTE.shadow, 0.16));
  return ops;
}

function columnOps(rect: Rect): Op[] {
  const r = snap(rect);
  const face = inset(r, 1);
  const cap = inset(r, 2);
  return [
    shadow(r, 3, 4, 0.26),
    rectOp(r.x, r.y, r.w, r.h, GAME_PALETTE.ink),
    rectOf(face, GAME_PALETTE.columnFace),
    rectOf(cap, GAME_PALETTE.columnCap),
    rectOp(face.x, face.y, face.w, 1, GAME_PALETTE.wallHi, 0.7),
    rectOp(face.x + face.w - 1, face.y, 1, face.h, GAME_PALETTE.columnDark, 0.7),
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
    // Wooden jamb depth one pixel in from each dark end, then the saddle.
    if (r.h >= 4) {
      ops.push(rectOp(r.x + 1, r.y, 1, r.h, GAME_PALETTE.baseboard, 0.8));
      ops.push(rectOp(r.x + r.w - 2, r.y, 1, r.h, GAME_PALETTE.baseboard, 0.8));
    }
    const saddleH = Math.min(3, r.h);
    const sy = r.y + Math.floor((r.h - saddleH) / 2);
    ops.push(rectOp(r.x + 1, sy, Math.max(1, r.w - 2), saddleH, GAME_PALETTE.doorSaddle));
    ops.push(rectOp(r.x + 1, sy, Math.max(1, r.w - 2), 1, GAME_PALETTE.thresholdHi, 0.9));
    ops.push(rectOp(r.x + 1, r.y, Math.max(1, r.w - 2), 1, GAME_PALETTE.wallHi, 0.28));
  } else {
    ops.push(rectOp(r.x, r.y, r.w, 1, GAME_PALETTE.ink));
    ops.push(rectOp(r.x, r.y + r.h - 1, r.w, 1, GAME_PALETTE.ink));
    if (r.w >= 4) {
      ops.push(rectOp(r.x, r.y + 1, r.w, 1, GAME_PALETTE.baseboard, 0.8));
      ops.push(rectOp(r.x, r.y + r.h - 2, r.w, 1, GAME_PALETTE.baseboard, 0.8));
    }
    const saddleW = Math.min(3, r.w);
    const sx = r.x + Math.floor((r.w - saddleW) / 2);
    ops.push(rectOp(sx, r.y + 1, saddleW, Math.max(1, r.h - 2), GAME_PALETTE.doorSaddle));
    ops.push(rectOp(sx, r.y + 1, 1, Math.max(1, r.h - 2), GAME_PALETTE.thresholdHi, 0.9));
    ops.push(rectOp(r.x, r.y + 1, 1, Math.max(1, r.h - 2), GAME_PALETTE.wallHi, 0.28));
  }
  return ops;
}

// V1 window: layered sky bands, sun glow, clouds, a near/far skyline with lit
// windows and greenery, then a deep frame with sill, mullions and glass sheen.
function windowOps(win: WindowRect): Op[] {
  const r = snap(win.rect);
  const ops: Op[] = [];

  if (win.side === 'top' || win.side === 'bottom') {
    const top = win.side === 'top';
    const bandH = 24;
    const skyY = top ? Math.max(0, r.y - bandH) : r.y + r.h;
    const skyH = top ? Math.max(1, r.y + r.h - skyY) : bandH;
    ops.push(rectOp(r.x, skyY, r.w, skyH, GAME_PALETTE.skyFar));
    ops.push(rectOp(r.x, top ? skyY + Math.round(skyH * 0.38) : skyY, r.w, Math.round(skyH * 0.62), GAME_PALETTE.skyMid));
    ops.push(rectOp(r.x, top ? skyY + Math.round(skyH * 0.68) : skyY, r.w, Math.round(skyH * 0.32), GAME_PALETTE.skyNear));
    // Sun glow pocket.
    ops.push(circleOp(r.x + Math.round(r.w * 0.2), skyY + Math.round(skyH * 0.3), 7, GAME_PALETTE.skyGlow, 0.55));
    for (let i = 0; i < 3; i += 1) {
      const cx = r.x + 44 + i * Math.max(150, Math.round(r.w / 3));
      if (cx + 34 > r.x + r.w - 6) break;
      ops.push(rectOp(cx, skyY + 4, 30, 3, GAME_PALETTE.skyCloud, 0.75));
      ops.push(rectOp(cx + 7, skyY + 2, 15, 2, GAME_PALETTE.skyCloud, 0.75));
    }
    const baseY = top ? r.y : skyY + skyH;
    // Far row then a nearer row with lit windows, then greenery.
    for (let bx = r.x + 4; bx < r.x + r.w - 22; bx += 34) {
      const idx = Math.round((bx - r.x) / 34);
      const fh = 7 + ((idx * 5) % 9);
      ops.push(rectOp(bx + 3, top ? baseY - fh - 3 : baseY + 3, 24, fh, GAME_PALETTE.skylineFar));
    }
    for (let bx = r.x + 8; bx < r.x + r.w - 20; bx += 40) {
      const idx = Math.round((bx - r.x) / 40);
      const h = 8 + ((idx * 7) % 12);
      const by = top ? baseY - h : baseY;
      ops.push(rectOp(bx, by, 30, h, GAME_PALETTE.skyline));
      ops.push(rectOp(bx, by, 30, 1, GAME_PALETTE.skylineLit, 0.7));
      if (idx % 3 === 0) ops.push(rectOp(bx + 4, by + 3, 4, 3, GAME_PALETTE.skylineWindow, 0.85));
      if (idx % 4 === 1) ops.push(rectOp(bx + 14, by + 2, 4, 3, GAME_PALETTE.skylineLit, 0.8));
      if (idx % 4 === 2) ops.push(rectOp(bx + 2, top ? by - 3 : by + h, 9, 3, GAME_PALETTE.greenery));
    }
    // Deep frame: outer ink, frame tone, sill, mullions, glass and sheen.
    ops.push(rectOp(r.x, r.y - 2, r.w, r.h + 4, GAME_PALETTE.windowFrame));
    ops.push(rectOp(r.x + 1, r.y - 1, Math.max(1, r.w - 2), Math.max(1, r.h + 2), GAME_PALETTE.windowFrameHi, 0.6));
    ops.push(rectOp(r.x + 1, r.y, Math.max(1, r.w - 2), Math.max(1, r.h), GAME_PALETTE.windowGlass));
    ops.push(rectOp(r.x + 1, r.y, Math.max(1, r.w - 2), 1, GAME_PALETTE.windowGlassHi));
    for (let mx = r.x + 60; mx < r.x + r.w - 10; mx += 60) ops.push(rectOp(mx, r.y - 2, 1, r.h + 4, GAME_PALETTE.windowFrame));
    ops.push(rectOp(r.x, top ? r.y + r.h + 2 : r.y - 3, r.w, 1, GAME_PALETTE.wallHi, 0.5));
    return ops;
  }

  const right = win.side === 'right';
  const bandW = 22;
  const skyX = right ? r.x + r.w : Math.max(0, r.x - bandW);
  const skyW = right ? bandW : Math.max(1, r.x - skyX + r.w);
  ops.push(rectOp(skyX, r.y, skyW, r.h, GAME_PALETTE.skyFar));
  ops.push(rectOp(right ? skyX : skyX + Math.round(skyW * 0.38), r.y, Math.round(skyW * 0.62), r.h, GAME_PALETTE.skyMid));
  ops.push(rectOp(right ? skyX : skyX + Math.round(skyW * 0.68), r.y, Math.round(skyW * 0.32), r.h, GAME_PALETTE.skyNear));
  ops.push(rectOp(skyX + 3, r.y + 22, 3, 30, GAME_PALETTE.skyCloud, 0.7));
  for (let by = r.y + 12; by < r.y + r.h - 34; by += 40) {
    const idx = Math.round((by - r.y) / 40);
    const w = 8 + ((idx * 5) % 12);
    ops.push(rectOp(right ? skyX + skyW - w : skyX, by, w, 32, GAME_PALETTE.skyline));
    if (idx % 3 === 0) ops.push(rectOp(right ? skyX + skyW - w + 2 : skyX + 2, by + 3, 3, 4, GAME_PALETTE.skylineWindow, 0.85));
  }
  ops.push(rectOp(r.x - 2, r.y - 2, r.w + 4, r.h + 4, GAME_PALETTE.windowFrame));
  ops.push(rectOp(r.x - 1, r.y - 1, Math.max(1, r.w + 2), Math.max(1, r.h + 2), GAME_PALETTE.windowFrameHi, 0.6));
  ops.push(rectOp(r.x, r.y, Math.max(1, r.w), Math.max(1, r.h), GAME_PALETTE.windowGlass));
  ops.push(rectOp(r.x, r.y, 1, Math.max(1, r.h), GAME_PALETTE.windowGlassHi));
  for (let my = r.y + 60; my < r.y + r.h - 10; my += 60) ops.push(rectOp(r.x - 2, my, r.w + 4, 1, GAME_PALETTE.windowFrame));
  return ops;
}

function liftOps(rect: Rect): Op[] {
  const r = snap(rect);
  const ops: Op[] = [shadow(r, 2, 3, 0.3), rectOp(r.x, r.y, r.w, r.h, GAME_PALETTE.ink)];
  const recess = inset(r, 2);
  ops.push(rectOf(recess, GAME_PALETTE.liftRecess));
  ops.push(rectOp(recess.x, recess.y, recess.w, 1, GAME_PALETTE.liftDoorDark));
  ops.push(rectOp(recess.x, recess.y, 1, recess.h, GAME_PALETTE.liftDoorDark));
  const doors = inset(recess, 2);
  ops.push(rectOf(doors, GAME_PALETTE.liftDoor));
  ops.push(rectOp(doors.x, doors.y, doors.w, 1, GAME_PALETTE.liftDoorHi));
  ops.push(rectOp(doors.x, doors.y + doors.h - 1, doors.w, 1, GAME_PALETTE.liftDoorDark));
  ops.push(rectOp(doors.x + Math.floor(doors.w / 2), doors.y, 1, doors.h, GAME_PALETTE.ink));
  ops.push(rectOp(doors.x + 1, doors.y + 2, 2, Math.max(2, doors.h - 4), GAME_PALETTE.liftDoorHi, 0.75));
  ops.push(rectOp(doors.x + Math.floor(doors.w / 2) + 1, doors.y + 2, 2, Math.max(2, doors.h - 4), GAME_PALETTE.liftDoorDark, 0.6));
  ops.push(rectOp(recess.x, recess.y + recess.h - 3, recess.w, 3, GAME_PALETTE.liftDoorDark, 0.55));
  const px = recess.x + recess.w - 5;
  const py = doors.y + Math.round(doors.h / 2) - 4;
  ops.push(rectOp(px, py, 4, 9, GAME_PALETTE.metalDark));
  ops.push(rectOp(px + 1, py + 2, 2, 2, GAME_PALETTE.liftDoorHi));
  ops.push(rectOp(px + 1, py + 5, 2, 2, GAME_PALETTE.liftDoorHi, 0.6));
  return ops;
}

// ---------------------------------------------------------------------------
// Workstations: deterministic kits derived from chair + desk geometry
// ---------------------------------------------------------------------------

export type ChairFacing = 'north' | 'south' | 'east' | 'west';

// A concrete kit slot on a desk top. `latStart`/`latLen` are along the axis
// perpendicular to the facing and `depStart`/`depLen` run from the chair edge
// toward the desk centre, so a kit always faces the chair that owns it.
export type Workstation = {
  chairId: string;
  facing: ChairFacing;
  latStart: number;
  latLen: number;
  depStart: number;
  depLen: number;
};

type DeskEntry = { chair: Furniture; facing: ChairFacing };

// A chair faces its nearest solid workstation (desk/table/counter); the back
// sits on the opposite side. The side is chosen from the chair's position
// against the solid's *rect*, not its centre: a chair at the end of a long bank
// still sits on the bank's long edge, so it must face north/south instead of
// being misread as an east/west sitter by the centre comparison. Pure geometry,
// so it is deterministic.
export function chairFacingFor(item: Furniture, solids: readonly Furniture[]): ChairFacing {
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
  const r = best.rect;
  const slack = 10;
  const withinX = cx >= r.x - slack && cx <= r.x + r.w + slack;
  const withinY = cy >= r.y - slack && cy <= r.y + r.h + slack;
  if (withinX && !withinY) return cy < r.y ? 'north' : 'south';
  if (withinY && !withinX) return cx < r.x ? 'west' : 'east';
  if (withinX && withinY) {
    const dTop = Math.abs(cy - r.y);
    const dBottom = Math.abs(r.y + r.h - cy);
    const dLeft = Math.abs(cx - r.x);
    const dRight = Math.abs(r.x + r.w - cx);
    const nearest = Math.min(dTop, dBottom, dLeft, dRight);
    if (nearest === dTop) return 'north';
    if (nearest === dBottom) return 'south';
    if (nearest === dLeft) return 'west';
    return 'east';
  }
  // Outside both spans: the dominant gap decides the near edge.
  const gapX = Math.abs(cx - (r.x + r.w / 2)) - r.w / 2;
  const gapY = Math.abs(cy - (r.y + r.h / 2)) - r.h / 2;
  if (gapX >= gapY) return cx < r.x ? 'west' : 'east';
  return cy < r.y ? 'north' : 'south';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Groups the approved chairs by the desk they belong to and derives one kit slot
 * per chair. Slots are centred on their chair's column and the desk depth is
 * split when a desk is staffed from both sides, so opposing workstations sit
 * back to back and never overlap.
 */
export function deriveWorkstations(manifest: OfficeManifest): Map<string, Workstation[]> {
  const solids = manifest.furniture.filter((item) => item.solid);
  const byDesk = new Map<string, DeskEntry[]>();

  for (const item of manifest.furniture) {
    if (item.kind !== 'chair') continue;
    const facing = chairFacingFor(item, solids);
    let best: Furniture | null = null;
    let bestDistance = Infinity;
    const cx = item.rect.x + item.rect.w / 2;
    const cy = item.rect.y + item.rect.h / 2;
    for (const solid of solids) {
      const dx = solid.rect.x + solid.rect.w / 2 - cx;
      const dy = solid.rect.y + solid.rect.h / 2 - cy;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = solid;
      }
    }
    if (!best || best.kind !== 'desk') continue;
    const entries = byDesk.get(best.id) ?? [];
    entries.push({ chair: item, facing });
    byDesk.set(best.id, entries);
  }

  const result = new Map<string, Workstation[]>();
  for (const [deskId, entries] of byDesk) {
    const desk = manifest.furniture.find((item) => item.id === deskId);
    if (!desk) continue;
    const inner = inset(snap(desk.rect), 1);
    const facings = new Set(entries.map((entry) => entry.facing));
    const splitNS = facings.has('north') && facings.has('south');
    const splitEW = facings.has('east') && facings.has('west');
    const kits: Workstation[] = [];

    for (const facing of ['north', 'south', 'east', 'west'] as ChairFacing[]) {
      const group = entries.filter((entry) => entry.facing === facing);
      if (!group.length) continue;
      const lateralIsX = facing === 'north' || facing === 'south';
      const latExtent = lateralIsX ? inner.w : inner.h;
      const sorted = [...group].sort((a, b) => {
        const av = lateralIsX ? a.chair.rect.x + a.chair.rect.w / 2 : a.chair.rect.y + a.chair.rect.h / 2;
        const bv = lateralIsX ? b.chair.rect.x + b.chair.rect.w / 2 : b.chair.rect.y + b.chair.rect.h / 2;
        return av - bv;
      });
      const slotLen = Math.min(latExtent / sorted.length, 44);
      // Depth runs from the chair edge toward the desk centre, but is capped to
      // the desk's short dimension so a chair the association assigns to a long
      // far-away desk can never stretch a kit across the whole counter.
      const acrossDim = lateralIsX ? inner.h : inner.w;
      const rawDep = lateralIsX ? (splitNS ? inner.h / 2 : inner.h) : splitEW ? inner.w / 2 : inner.w;
      const depLen = clamp(rawDep, 8, Math.max(10, Math.round(acrossDim * 0.8)));

      for (const entry of sorted) {
        const chairCentre = lateralIsX
          ? entry.chair.rect.x + entry.chair.rect.w / 2
          : entry.chair.rect.y + entry.chair.rect.h / 2;
        const origin = lateralIsX ? inner.x : inner.y;
        const latStart = clamp(chairCentre - origin - slotLen / 2, 0, Math.max(0, latExtent - slotLen));
        kits.push({ chairId: entry.chair.id, facing, latStart, latLen: Math.max(10, slotLen), depStart: 0, depLen });
      }
    }
    if (kits.length) result.set(deskId, kits);
  }
  return result;
}

// Maps a kit-local box (lateral/depth offsets from the desk inner origin) into
// an integer world rect for the kit's facing. Local coordinates are clamped to
// the inner rect first, so no workstation sub-sprite can ever paint outside its
// desk (the association may hand a desk a chair from across the floor).
function kitBox(facing: ChairFacing, inner: Rect, l0: number, l1: number, d0: number, d1: number): Rect {
  const lateralIsX = facing === 'north' || facing === 'south';
  const latMax = lateralIsX ? inner.w : inner.h;
  const depMax = lateralIsX ? inner.h : inner.w;
  const la = clamp(Math.min(l0, l1), 0, Math.max(0, latMax));
  const lb = clamp(Math.max(l0, l1), la, Math.max(0, latMax));
  const da = clamp(Math.min(d0, d1), 0, Math.max(0, depMax));
  const db = clamp(Math.max(d0, d1), da, Math.max(0, depMax));
  let x1: number;
  let x2: number;
  let y1: number;
  let y2: number;
  if (facing === 'north') {
    x1 = inner.x + la; x2 = inner.x + lb; y1 = inner.y + da; y2 = inner.y + db;
  } else if (facing === 'south') {
    x1 = inner.x + la; x2 = inner.x + lb; y1 = inner.y + inner.h - db; y2 = inner.y + inner.h - da;
  } else if (facing === 'west') {
    x1 = inner.x + da; x2 = inner.x + db; y1 = inner.y + la; y2 = inner.y + lb;
  } else {
    x1 = inner.x + inner.w - db; x2 = inner.x + inner.w - da; y1 = inner.y + la; y2 = inner.y + lb;
  }
  return { x: Math.round(x1), y: Math.round(y1), w: Math.max(1, Math.round(x2) - Math.round(x1)), h: Math.max(1, Math.round(y2) - Math.round(y1)) };
}

const PROP_KINDS = ['plant', 'mug', 'books', 'pens', 'papers'] as const;
type PropKind = (typeof PROP_KINDS)[number];

// Workstation material variants. Every pick is derived from the kit's own id, so
// a long bank never reads as exact clones while every choice stays inside the
// shared office material language (muted screens, veneer mats, warm props).
const SCREEN_TINTS = [
  { screen: GAME_PALETTE.screen, hi: GAME_PALETTE.screenHi, glyph: GAME_PALETTE.screenGlyph },
  { screen: '#9dc2b3', hi: '#d0e7dd', glyph: '#6f9c8a' },
  { screen: '#b3a9cd', hi: '#dcd4ec', glyph: '#8879ad' },
  { screen: '#c8b7a1', hi: '#ecdfc8', glyph: '#a2866a' },
] as const;
const MAT_TONES = ['#8a6a44', '#6f7f7a', '#5f7486', '#7a6a5a'] as const;
const PROP_TONES = [
  { leaf: '#4f8f43', leafHi: '#79b566', accent: '#c05a48', book: '#a8503f', bookAlt: '#3f6f8f', paper: '#f7f0dc' },
  { leaf: '#5f9a56', leafHi: '#8cc47a', accent: '#3f7a8f', book: '#3f6f8f', bookAlt: '#7a5f9f', paper: '#f2ecd8' },
  { leaf: '#437c50', leafHi: '#6fae72', accent: '#b0742f', book: '#7a5f3f', bookAlt: '#4f8f6a', paper: '#efe6d0' },
] as const;

// A prop is a compact object cluster, never a long bar: every mark comes from a
// single square-ish footprint inside the kit box, so a mug reads as a mug and a
// stack of papers as a stack. `variant` shifts the accent tones only.
function propArt(kind: PropKind, box: Rect, variant = 0): Op[] {
  const F = GAME_PALETTE;
  const T = PROP_TONES[variant % PROP_TONES.length]!;
  const size = Math.max(6, Math.min(box.w, box.h, 14));
  const cluster: Rect = {
    x: Math.round(box.x + (box.w - size) / 2),
    y: Math.round(box.y + (box.h - size) / 2),
    w: size,
    h: size,
  };
  if (kind === 'plant') {
    const potH = Math.max(3, Math.round(size * 0.34));
    return [
      rectOp(cluster.x, cluster.y + cluster.h - potH, cluster.w, potH, F.potDark),
      rectOp(cluster.x + 1, cluster.y + cluster.h - potH, Math.max(1, cluster.w - 2), Math.max(1, potH - 1), F.pot),
      rectOp(cluster.x + 1, cluster.y + cluster.h - potH, Math.max(1, cluster.w - 2), 1, F.potHi),
      rectOp(cluster.x + 1, cluster.y + 1, Math.max(1, cluster.w - 2), Math.max(2, cluster.h - potH - 1), F.leafDark),
      rectOp(cluster.x + 2, cluster.y, Math.max(1, cluster.w - 4), Math.max(2, cluster.h - potH - 2), T.leaf),
      rectOp(cluster.x + Math.round(cluster.w / 2) - 1, cluster.y, 2, Math.max(2, cluster.h - potH - 2), T.leafHi),
    ];
  }
  if (kind === 'mug') {
    return [
      rectOp(cluster.x, cluster.y, cluster.w, cluster.h, F.ink),
      rectOp(cluster.x + 1, cluster.y + 1, Math.max(1, cluster.w - 3), Math.max(1, cluster.h - 2), F.mug),
      rectOp(cluster.x + 1, cluster.y + 1, Math.max(1, cluster.w - 3), 1, F.mugHi),
      rectOp(cluster.x + Math.max(2, cluster.w - 2), cluster.y + 2, 2, Math.max(1, cluster.h - 4), F.mug),
      rectOp(cluster.x + 1, cluster.y + Math.round(cluster.h / 2), Math.max(1, cluster.w - 3), 1, T.accent, 0.8),
    ];
  }
  if (kind === 'books') {
    const rows = 3;
    const rowH = Math.max(1, Math.floor((cluster.h - 2) / rows));
    const cols = [T.book, T.bookAlt, T.book];
    const out: Op[] = [];
    for (let i = 0; i < rows; i += 1) {
      const y = cluster.y + 1 + i * rowH;
      out.push(rectOp(cluster.x + i, y, Math.max(1, cluster.w - i - 1), rowH, F.ink));
      out.push(rectOp(cluster.x + i + 1, y, Math.max(1, cluster.w - i - 3), Math.max(1, rowH - 1), cols[i]!));
    }
    return out;
  }
  if (kind === 'pens') {
    const cupH = Math.max(3, Math.round(cluster.h * 0.6));
    const cupY = cluster.y + cluster.h - cupH;
    return [
      rectOp(cluster.x, cupY, cluster.w, cupH, F.ink),
      rectOp(cluster.x + 1, cupY + 1, Math.max(1, cluster.w - 2), Math.max(1, cupH - 2), F.penCup),
      rectOp(cluster.x + 1, cupY + 1, Math.max(1, cluster.w - 2), 1, F.metalHi, 0.7),
      rectOp(cluster.x + 2, cluster.y, 1, Math.max(2, cupY - cluster.y + 1), F.pen),
      rectOp(cluster.x + 4, cluster.y, 1, Math.max(2, cupY - cluster.y), T.accent),
    ];
  }
  return [
    rectOp(cluster.x, cluster.y + 1, cluster.w, Math.max(3, cluster.h - 2), F.ink),
    rectOp(cluster.x + 1, cluster.y + 2, Math.max(2, cluster.w - 2), Math.max(2, cluster.h - 4), T.paper),
    rectOp(cluster.x + 2, cluster.y + 3, Math.max(1, cluster.w - 4), 1, F.paperLine),
    rectOp(cluster.x + 2, cluster.y + 5, Math.max(1, cluster.w - 5), 1, F.paperLine),
    rectOp(cluster.x + 1, cluster.y + 2, Math.max(2, cluster.w - 2), 1, F.paperShadow),
  ];
}

function workstationOps(workstation: Workstation, inner: Rect, deskId: string): Op[] {
  const F = GAME_PALETTE;
  const { facing, latStart, latLen, depStart, depLen } = workstation;
  const dep = (f: number): number => depStart + depLen * f;
  const box = (l0: number, l1: number, d0: number, d1: number): Rect => kitBox(facing, inner, l0, l1, d0, d1);
  const base = `${deskId}:${workstation.chairId}`;

  const kw = clamp(latLen * 0.6, 12, 30);
  const kd = clamp(depLen * 0.22, 3, 6);
  const kLat = latStart + (latLen - kw) / 2;
  const seed = hashString(base);
  const tint = SCREEN_TINTS[seed % SCREEN_TINTS.length]!;
  const matTone = MAT_TONES[(seed >>> 4) % MAT_TONES.length]!;

  // Desk mat grounds the workstation on the veneer, tinted per kit.
  const mat = box(kLat - 1, kLat + kw + 1, dep(0.04), dep(0.04) + kd + 3);
  const matOps: Op[] = [rectOp(mat.x, mat.y, mat.w, mat.h, matTone, 0.5)];

  // Keyboard: dark outline, light deck and key rows.
  const keyboard = box(kLat, kLat + kw, dep(0.08), dep(0.08) + kd);
  const deck = inset(keyboard, 1);
  const keyboardOps: Op[] = [
    rectOp(keyboard.x, keyboard.y, keyboard.w, keyboard.h, F.ink),
    rectOf(deck, F.metalHi),
    rectOp(deck.x, deck.y, deck.w, 1, F.paper),
  ];
  const ticks = Math.max(3, Math.min(5, Math.floor(deck.w / 5)));
  const keyRow = Math.max(1, Math.floor((deck.h - 1) / 2));
  for (let i = 0; i < ticks; i += 1) {
    const tx = deck.x + 1 + Math.round((i * (deck.w - 2)) / ticks);
    keyboardOps.push(rectOp(tx, deck.y + (deck.h > 2 ? 1 : 0), 2, keyRow, F.metalDark, 0.75));
    if (deck.h >= 4) keyboardOps.push(rectOp(tx, deck.y + 1 + keyRow, 2, Math.max(1, deck.h - 2 - keyRow), F.metalDark, 0.5));
  }
  if (deck.w >= 12 && deck.h >= 4) keyboardOps.push(rectOp(deck.x + Math.round(deck.w * 0.28), deck.y + deck.h - 2, Math.max(2, Math.round(deck.w * 0.44)), 1, F.paper, 0.75));

  // Mouse beside the keyboard.
  const mouseX = clamp(latStart + latLen * 0.86, latStart, Math.max(latStart, latStart + latLen - 4));
  const mouse = box(mouseX, mouseX + Math.max(3, Math.round(latLen * 0.1)), dep(0.08), dep(0.08) + Math.max(4, Math.round(depLen * 0.16)));
  keyboardOps.push(rectOp(mouse.x, mouse.y, mouse.w, mouse.h, F.ink));
  keyboardOps.push(rectOp(mouse.x + 1, mouse.y + 1, Math.max(1, mouse.w - 2), Math.max(1, mouse.h - 2), F.metal));
  keyboardOps.push(rectOp(mouse.x + 1, mouse.y + 1, Math.max(1, mouse.w - 2), 1, F.metalHi));

  // Monitor: bezel, screen, glare band, stand and foot. Sized up so the screen
  // stays readable at the gameplay camera scale.
  const mw = clamp(latLen * 0.62, 16, 30);
  const md = clamp(depLen * 0.3, 8, 14);
  const mLat = latStart + (latLen - mw) / 2;
  const monitor = box(mLat, mLat + mw, dep(0.42), dep(0.42) + md);
  const stand = box(mLat + mw / 2 - 2, mLat + mw / 2 + 2, dep(0.42) + md, dep(0.42) + md + Math.max(2, depLen * 0.08));
  const foot = box(mLat + mw / 2 - 5, mLat + mw / 2 + 5, stand.y + stand.h, stand.y + stand.h + 1);
  const monitorOps: Op[] = [
    rectOp(monitor.x, monitor.y, monitor.w, monitor.h, F.ink),
    rectOp(monitor.x + 1, monitor.y + 1, Math.max(1, monitor.w - 2), Math.max(1, monitor.h - 2), F.monitorBezel),
    rectOp(monitor.x + 2, monitor.y + 2, Math.max(1, monitor.w - 4), Math.max(1, monitor.h - 4), tint.screen),
    rectOp(monitor.x + 2, monitor.y + 2, Math.max(1, monitor.w - 4), 1, tint.hi),
    rectOp(monitor.x + 1, monitor.y + 1, Math.max(1, monitor.w - 2), 1, F.monitorBezelHi, 0.8),
    rectOp(stand.x, stand.y, stand.w, stand.h, F.monitorStand),
    rectOp(foot.x, foot.y, foot.w, foot.h, F.ink, 0.85),
  ];
  // Deterministic on-screen content: two or three short glyph bars whose widths
  // come from the kit's own id, so adjacent workstations never look cloned.
  const glyphRows = 2 + (seed % 2);
  for (let i = 0; i < glyphRows; i += 1) {
    const gy = monitor.y + 3 + i * 3;
    if (gy + 1 > monitor.y + monitor.h - 3) break;
    const gw = clamp(Math.round((monitor.w - 6) * (0.4 + ((seed >>> (i * 3)) % 5) / 10)), 2, Math.max(2, monitor.w - 6));
    monitorOps.push(rectOp(monitor.x + 3, gy, gw, 1, tint.glyph, 0.75));
  }
  if (monitor.w >= 10) monitorOps.push(rectOp(monitor.x + Math.round(monitor.w / 2) - 1, monitor.y + monitor.h - 2, 2, 1, F.monitorBezelHi, 0.9));

  // One deterministic prop per workstation, sized to a compact cluster.
  const propKind = PROP_KINDS[hashString(base) % PROP_KINDS.length]!;
  const propW = clamp(latLen * 0.3, 6, 14);
  const propD = clamp(depLen * 0.34, 6, 14);
  const propLat = clamp(latStart + latLen * 0.04, latStart, Math.max(latStart, latStart + latLen - propW));
  const propBox = box(propLat, propLat + propW, dep(0.5), dep(0.5) + propD);
  const propOps = propArt(propKind, propBox, seed >>> 6);

  return [
    ...matOps,
    { t: 'group', sourceId: `${base}:monitor`, semantic: 'workstation:monitor', ops: monitorOps },
    { t: 'group', sourceId: `${base}:keyboard`, semantic: 'workstation:keyboard', ops: keyboardOps },
    { t: 'group', sourceId: `${base}:prop`, semantic: 'workstation:prop', ops: propOps },
  ];
}

// ---------------------------------------------------------------------------
// Furniture: one layered group per approved item
// ---------------------------------------------------------------------------

function deskArt(item: Furniture, kits: readonly Workstation[] = []): Op[] {
  const F = GAME_PALETTE;
  const r = snap(item.rect);
  const inner = inset(r, 1);
  const wide = inner.w >= inner.h;
  const body: Op[] = [shadow(r), rectOp(r.x, r.y, r.w, r.h, F.ink), rectOf(inner, F.woodTop)];

  // Top bevel + front (south-east) face, then legs or a modesty panel.
  body.push(rectOp(inner.x, inner.y, inner.w, 1, F.woodTopHi));
  body.push(rectOp(inner.x, inner.y, 1, inner.h, F.woodTopHi, 0.7));
  if (wide) {
    body.push(rectOp(inner.x, inner.y + inner.h - 3, inner.w, 3, F.woodEdge));
    body.push(rectOp(inner.x, inner.y + inner.h - 1, inner.w, 1, F.woodDark, 0.85));
    const legW = Math.min(8, Math.max(4, Math.round(inner.w * 0.12)));
    body.push(rectOp(inner.x + 2, inner.y + 2, legW, 2, F.woodSide, 0.8));
    body.push(rectOp(inner.x + inner.w - legW - 2, inner.y + 2, legW, 2, F.woodSide, 0.8));
    body.push(rectOp(inner.x + 2, inner.y + 4, 2, Math.max(1, inner.h - 6), F.woodDark, 0.5));
    body.push(rectOp(inner.x + inner.w - 4, inner.y + 4, 2, Math.max(1, inner.h - 6), F.woodDark, 0.5));
  } else {
    body.push(rectOp(inner.x + inner.w - 3, inner.y, 3, inner.h, F.woodEdge));
    body.push(rectOp(inner.x + inner.w - 1, inner.y, 1, inner.h, F.woodDark, 0.85));
    body.push(rectOp(inner.x + 2, inner.y + 2, 2, Math.min(8, Math.max(4, Math.round(inner.h * 0.12))), F.woodSide, 0.8));
    body.push(rectOp(inner.x + 2, inner.y + inner.h - 10, 2, 8, F.woodSide, 0.8));
  }

  // Desktop detail: an inset writing panel, a soft front-face shadow and a
  // fastener, so even a bare desk is layered rather than a flat slab.
  const panel = inset(inner, 2);
  if (panel.w > 4 && panel.h > 4) {
    body.push(rectOp(panel.x, panel.y, panel.w, panel.h, F.woodSeam, 0.22));
    body.push(rectOp(panel.x, panel.y, panel.w, 1, F.woodTopHi, 0.35));
  }
  body.push(rectOp(inner.x + 1, inner.y + 1, Math.max(1, inner.w - 2), Math.max(1, inner.h - 2), F.woodDark, 0.12));
  body.push(rectOp(inner.x + 2, inner.y + 2, 2, 2, F.metalDark, 0.7));
  // A grounded apron: a dark contact band just inside the front edge plus a
  // bright lip above it, so a desk reads with thickness at gameplay scale.
  body.push(rectOp(inner.x + 1, inner.y + inner.h - 1, Math.max(1, inner.w - 2), 1, F.ink, 0.3));
  body.push(rectOp(inner.x + 1, inner.y + 2, Math.max(1, inner.w - 2), 1, F.woodTopHi, 0.28));

  // Drawer pedestal: body, inset drawer panels, handles and seams.
  const drawerW = wide ? Math.min(34, Math.max(18, Math.round(inner.w * 0.16))) : Math.max(8, inner.w - 4);
  const drawerH = wide ? Math.max(8, inner.h - 8) : Math.min(34, Math.max(16, Math.round(inner.h * 0.26)));
  const dx = wide ? inner.x + inner.w - drawerW - 2 : inner.x + 2;
  const dy = wide ? inner.y + 4 : inner.y + inner.h - drawerH - 3;
  body.push(rectOp(dx, dy, drawerW, drawerH, F.woodDark));
  body.push(rectOp(dx + 1, dy + 1, Math.max(1, drawerW - 2), Math.max(1, drawerH - 2), F.woodSide));
  const drawers = Math.max(2, Math.min(3, Math.floor(drawerH / 8)));
  for (let i = 0; i < drawers; i += 1) {
    const sy = dy + 2 + Math.round((i * (drawerH - 4)) / drawers);
    const sh = Math.max(2, Math.round((drawerH - 4) / drawers) - 2);
    body.push(rectOp(dx + 2, sy, Math.max(1, drawerW - 4), sh, F.woodSeam, 0.9));
    body.push(rectOp(dx + 2, sy, Math.max(1, drawerW - 4), 1, F.woodTopHi, 0.5));
    body.push(rectOp(dx + Math.round(drawerW / 2) - 3, sy + Math.max(1, sh - 2), 6, 1, F.metalHi));
  }

  // Veneer grain + seams, a cable grommet and a front edge cap.
  if (wide) {
    for (let x = inner.x + 64; x < inner.x + inner.w - 12; x += 64) body.push(rectOp(x, inner.y + 2, 1, Math.max(1, inner.h - 4), F.woodSeam, 0.7));
    body.push(rectOp(inner.x + 4, inner.y + Math.round(inner.h / 2), Math.max(1, inner.w - 8), 1, F.woodTopHi, 0.3));
  } else {
    for (let y = inner.y + 64; y < inner.y + inner.h - 12; y += 64) body.push(rectOp(inner.x + 2, y, Math.max(1, inner.w - 4), 1, F.woodSeam, 0.7));
    body.push(rectOp(inner.x + Math.round(inner.w / 2), inner.y + 4, 1, Math.max(1, inner.h - 8), F.woodTopHi, 0.3));
  }
  const capW = Math.min(3, inner.w);
  body.push(rectOp(inner.x + inner.w - capW, inner.y, capW, 2, F.wallHi, 0.6));
  const grommet = inset(inner, Math.max(2, Math.round(Math.min(inner.w, inner.h) * 0.18)));
  body.push(rectOp(grommet.x + Math.round(grommet.w / 2), grommet.y, 3, 2, F.ink, 0.8));
  body.push(rectOp(grommet.x + Math.round(grommet.w / 2) + 1, grommet.y, 1, 1, F.metalDark));

  const ops: Op[] = [...body];

  const splitNS = kits.some((kit) => kit.facing === 'north') && kits.some((kit) => kit.facing === 'south');
  const splitEW = kits.some((kit) => kit.facing === 'east') && kits.some((kit) => kit.facing === 'west');
  const lateralIsX = kits.length ? kits[0]!.facing === 'north' || kits[0]!.facing === 'south' : wide;
  const slots = [...new Set(kits
    .filter((kit) => (kit.facing === 'north' || kit.facing === 'south') === lateralIsX)
    .map((kit) => Math.round(kit.latStart + kit.latLen / 2)))].sort((a, b) => a - b);

  for (const kit of kits) {
    ops.push({ t: 'group', sourceId: `${item.id}#${kit.chairId}@${kit.facing}`, semantic: 'workstation:kit', ops: workstationOps(kit, inner, item.id) });
  }

  // Two-sided banks get a central partition — the cubicle divider the V1
  // four-person cluster reads by — and every bay boundary gets a cross divider.
  // Both are fabric over a dark frame, tinted by the zone's partition family and
  // derived from the kit rhythm, never a duplicated map coordinate. They paint
  // after the kits so the divider always sits between neighbouring workstations.
  const fabric = partitionFor(item.zone);
  if (splitNS || splitEW) {
    const spine: Op[] = [];
    if (splitNS) {
      const band = Math.min(5, Math.max(3, Math.round(inner.h * 0.12)));
      const sy = inner.y + Math.round(inner.h / 2) - Math.floor(band / 2);
      spine.push(rectOp(inner.x + 1, sy + 1, Math.max(1, inner.w - 2), band, F.shadow, 0.16));
      spine.push(rectOp(inner.x + 1, sy, Math.max(1, inner.w - 2), band, F.ink));
      spine.push(rectOp(inner.x + 2, sy + 1, Math.max(1, inner.w - 4), Math.max(1, band - 2), fabric.base));
      spine.push(rectOp(inner.x + 2, sy + 1, Math.max(1, inner.w - 4), 1, fabric.hi, 0.85));
      spine.push(rectOp(inner.x + 2, sy + band - 2, Math.max(1, inner.w - 4), 1, fabric.dark, 0.85));
    } else {
      const band = Math.min(5, Math.max(3, Math.round(inner.w * 0.12)));
      const sx = inner.x + Math.round(inner.w / 2) - Math.floor(band / 2);
      spine.push(rectOp(sx + 1, inner.y + 1, band, Math.max(1, inner.h - 2), F.shadow, 0.16));
      spine.push(rectOp(sx, inner.y + 1, band, Math.max(1, inner.h - 2), F.ink));
      spine.push(rectOp(sx + 1, inner.y + 2, Math.max(1, band - 2), Math.max(1, inner.h - 4), fabric.base));
      spine.push(rectOp(sx + 1, inner.y + 2, 1, Math.max(1, inner.h - 4), fabric.hi, 0.85));
      spine.push(rectOp(sx + band - 2, inner.y + 2, 1, Math.max(1, inner.h - 4), fabric.dark, 0.85));
    }
    ops.push({ t: 'group', sourceId: `${item.id}:spine`, semantic: 'desk:spine', ops: spine });
  }

  if (slots.length > 1) {
    const dividers: Op[] = [];
    for (let i = 1; i < slots.length; i += 1) {
      const boundary = Math.round((slots[i - 1]! + slots[i]!) / 2);
      if (lateralIsX) {
        const x = inner.x + clamp(boundary - 1, 1, Math.max(1, inner.w - 3));
        dividers.push(rectOp(x, inner.y + 1, 3, Math.max(1, inner.h - 2), F.ink));
        dividers.push(rectOp(x + 1, inner.y + 2, 1, Math.max(1, inner.h - 4), fabric.base));
        dividers.push(rectOp(x + 1, inner.y + 2, 1, 1, fabric.hi, 0.85));
      } else {
        const y = inner.y + clamp(boundary - 1, 1, Math.max(1, inner.h - 3));
        dividers.push(rectOp(inner.x + 1, y, Math.max(1, inner.w - 2), 3, F.ink));
        dividers.push(rectOp(inner.x + 2, y + 1, Math.max(1, inner.w - 4), 1, fabric.base));
        dividers.push(rectOp(inner.x + 2, y + 1, 1, 1, fabric.hi, 0.85));
      }
    }
    ops.push({ t: 'group', sourceId: `${item.id}:divider`, semantic: 'desk:divider', ops: dividers });
  }

  return ops;
}

function tableArt(item: Furniture): Op[] {
  const F = GAME_PALETTE;
  const r = snap(item.rect);
  const inner = inset(r, 1);
  const wide = inner.w >= inner.h;
  const ops: Op[] = [shadow(r), rectOp(r.x, r.y, r.w, r.h, F.ink), rectOf(inner, F.woodTop)];
  ops.push(rectOp(inner.x, inner.y, inner.w, 1, F.woodTopHi));
  ops.push(rectOp(inner.x, inner.y, 1, inner.h, F.woodTopHi, 0.65));
  // Outline, top edge, front face and legs/panel.
  if (wide) {
    ops.push(rectOp(inner.x, inner.y + inner.h - 2, inner.w, 2, F.woodEdge));
    ops.push(rectOp(inner.x, inner.y + inner.h - 1, inner.w, 1, F.woodDark, 0.8));
    ops.push(rectOp(inner.x + 3, inner.y + 2, 3, Math.max(1, inner.h - 4), F.woodDark, 0.45));
    ops.push(rectOp(inner.x + inner.w - 6, inner.y + 2, 3, Math.max(1, inner.h - 4), F.woodDark, 0.45));
  } else {
    ops.push(rectOp(inner.x + inner.w - 2, inner.y, 2, inner.h, F.woodEdge));
  }
  // Inset apron and top sheen: a front apron, an inner highlight and a pair of
  // leg shadows give even a narrow side table the layered joinery of a larger
  // one. Every mark stays inside the table top.
  if (wide) {
    ops.push(rectOp(inner.x + 3, inner.y + inner.h - 3, Math.max(1, inner.w - 6), 2, F.woodEdge, 0.85));
    ops.push(rectOp(inner.x + 3, inner.y + 2, Math.max(1, inner.w - 6), 1, F.woodTopHi, 0.5));
    ops.push(rectOp(inner.x + 3, inner.y + 4, 2, Math.max(1, inner.h - 8), F.woodDark, 0.4));
    ops.push(rectOp(inner.x + inner.w - 5, inner.y + 4, 2, Math.max(1, inner.h - 8), F.woodDark, 0.4));
  } else {
    ops.push(rectOp(inner.x + inner.w - 3, inner.y + 3, 2, Math.max(1, inner.h - 6), F.woodEdge, 0.85));
    ops.push(rectOp(inner.x + 2, inner.y + 3, 1, Math.max(1, inner.h - 6), F.woodTopHi, 0.5));
    ops.push(rectOp(inner.x + 4, inner.y + 3, Math.max(1, inner.w - 8), 2, F.woodDark, 0.4));
    ops.push(rectOp(inner.x + 4, inner.y + inner.h - 5, Math.max(1, inner.w - 8), 2, F.woodDark, 0.4));
  }
  ops.push(rectOp(inner.x + 4, inner.y + 4, Math.max(1, inner.w - 8), 1, F.woodSeam, 0.6));

  // Restrained centre detail: a runner plus 2-3 notepads/papers. Never a screen.
  const cx = inner.x + inner.w / 2;
  const cy = inner.y + inner.h / 2;
  if (wide && inner.w >= 56) {
    ops.push(rectOp(inner.x + 8, Math.round(cy) - 1, Math.max(1, inner.w - 16), 2, F.woodDark, 0.3));
    const pads = Math.min(3, Math.max(2, Math.floor(inner.w / 40)));
    for (let i = 0; i < pads; i += 1) {
      const px = inner.x + 12 + Math.round((i * (inner.w - 30)) / pads);
      ops.push(rectOp(px, Math.round(cy) - 6, 14, 10, F.ink));
      ops.push(rectOp(px + 1, Math.round(cy) - 5, 12, 8, F.paper));
      ops.push(rectOp(px + 2, Math.round(cy) - 3, 10, 1, F.paperLine));
      ops.push(rectOp(px + 2, Math.round(cy) - 1, 8, 1, F.paperLine));
    }
    const plantX = Math.round(cx) - 5;
    ops.push(rectOp(plantX, Math.round(cy) - 16, 10, 6, F.potDark));
    ops.push(rectOp(plantX + 1, Math.round(cy) - 16, 8, 5, F.pot));
    ops.push(rectOp(plantX - 1, Math.round(cy) - 21, 12, 5, F.leaf));
    ops.push(rectOp(plantX + 1, Math.round(cy) - 23, 8, 3, F.leafHi));
  } else {
    ops.push(rectOp(Math.round(cx) - 6, Math.round(cy) - 4, 12, 8, F.ink));
    ops.push(rectOp(Math.round(cx) - 5, Math.round(cy) - 3, 10, 6, F.paper));
    ops.push(rectOp(Math.round(cx) - 3, Math.round(cy) - 1, 6, 1, F.paperLine));
  }

  if (item.id.includes('CERT')) {
    const py = r.y + 9;
    for (let i = 0; i < 3; i += 1) {
      const px = r.x + 16 + i * 42;
      if (px + 16 > r.x + r.w - 6) break;
      ops.push(rectOp(px, py, 16, 22, F.ink));
      ops.push(rectOp(px + 1, py + 1, 14, 20, F.paper));
      ops.push(rectOp(px + 3, py + 5, 10, 1, F.paperLine));
      ops.push(rectOp(px + 3, py + 9, 10, 1, F.paperLine));
      ops.push(rectOp(px + 3, py + 13, 6, 1, F.paperLine));
    }
  }
  return ops;
}

// Counter equipment: a compact, zone-specific cluster derived from the counter's
// own rect. Reception gets a monitor, a phone and a bell; the pantry a tray of
// cups; the executive counter a tidy tray. Always inside the counter's inner
// rect, so no fixture can be invented off the approved footprint.
function counterEquipment(item: Furniture, inner: Rect): PaintedOp[] {
  const F = GAME_PALETTE;
  const ops: PaintedOp[] = [];
  if (inner.w < 24 || inner.h < 12) return ops;
  const x0 = inner.x + 4;
  const y0 = inner.y + 2;
  const zone = item.zone;
  if (zone === 'resepsionis') {
    ops.push(rectOp(x0, y0, 10, 7, F.ink));
    ops.push(rectOp(x0 + 1, y0 + 1, 8, 5, F.monitorBezel));
    ops.push(rectOp(x0 + 2, y0 + 2, 6, 3, F.screen));
    ops.push(rectOp(x0 + 2, y0 + 2, 6, 1, F.screenHi));
    const px = x0 + 15;
    if (px + 9 < inner.x + inner.w) {
      ops.push(rectOp(px, y0 + 2, 9, 5, F.ink));
      ops.push(rectOp(px + 1, y0 + 3, 7, 3, F.phoneShell));
      ops.push(rectOp(px + 1, y0 + 3, 7, 1, F.phoneShellHi, 0.8));
    }
    const bx = x0 + 28;
    if (bx + 6 < inner.x + inner.w) {
      ops.push(rectOp(bx, y0 + 3, 6, 4, F.ink));
      ops.push(rectOp(bx + 1, y0 + 4, 4, 2, F.bell));
      ops.push(rectOp(bx + 1, y0 + 4, 4, 1, F.bellHi));
    }
    return ops;
  }
  if (zone === 'pantry') {
    ops.push(rectOp(x0, y0 + 1, 12, 6, F.ink));
    ops.push(rectOp(x0 + 1, y0 + 2, 10, 4, F.tray));
    ops.push(rectOp(x0 + 1, y0 + 2, 10, 1, F.trayHi, 0.8));
    for (let i = 0; i < 3; i += 1) {
      const cx = x0 + 2 + i * 3;
      ops.push(rectOp(cx, y0 + 2, 2, 3, F.cup));
      ops.push(rectOp(cx, y0 + 2, 2, 1, F.cupAccent));
    }
    // A coffee pot and a small fruit bowl complete the pantry worktop props.
    const kx = x0 + 15;
    if (kx + 8 < inner.x + inner.w) {
      ops.push(rectOp(kx, y0, 8, 7, F.ink));
      ops.push(rectOp(kx + 1, y0 + 1, 6, 5, F.metal));
      ops.push(rectOp(kx + 1, y0 + 1, 6, 1, F.metalHi));
      ops.push(rectOp(kx + 2, y0 + 2, 4, 2, F.broth, 0.85));
      ops.push(rectOp(kx + 1, y0 + 6, 6, 1, F.metalDark));
    }
    const fx = x0 + 25;
    if (fx + 6 < inner.x + inner.w) {
      ops.push(rectOp(fx, y0 + 3, 6, 4, F.ink));
      ops.push(rectOp(fx + 1, y0 + 4, 4, 2, F.bowl));
      ops.push(rectOp(fx + 2, y0 + 2, 2, 2, F.pot));
      ops.push(rectOp(fx + 4, y0 + 2, 1, 2, F.leaf));
    }
    return ops;
  }
  if (zone === 'direktur-finance') {
    ops.push(rectOp(x0, y0 + 1, 11, 6, F.ink));
    ops.push(rectOp(x0 + 1, y0 + 2, 9, 4, F.tray));
    ops.push(rectOp(x0 + 1, y0 + 2, 9, 1, F.trayHi, 0.8));
    ops.push(rectOp(x0 + 2, y0 + 2, 3, 4, F.cup, 0.9));
    ops.push(rectOp(x0 + 6, y0 + 2, 2, 4, F.cupAccent, 0.8));
  }
  return ops;
}

function counterArt(item: Furniture): Op[] {
  const F = GAME_PALETTE;
  const zone = item.zone;
  const r = snap(item.rect);
  const inner = inset(r, 1);
  const wide = inner.w >= inner.h;
  const ops: Op[] = [shadow(r), rectOp(r.x, r.y, r.w, r.h, F.ink), rectOf(inner, F.woodTop)];
  ops.push(rectOp(inner.x, inner.y, inner.w, 1, F.woodTopHi));
  // Inset front seam and a soft inner top highlight: even a short one-panel
  // counter reads as layered joinery rather than a flat slab. Both layers stay
  // inside the inner rect, so the approved footprint is untouched.
  if (wide) {
    ops.push(rectOp(inner.x + 2, inner.y + 2, Math.max(1, inner.w - 4), 1, F.woodTopHi, 0.5));
    ops.push(rectOp(inner.x + 1, inner.y + inner.h - 2, Math.max(1, inner.w - 2), 1, F.woodSeam, 0.7));
  } else {
    ops.push(rectOp(inner.x + 2, inner.y + 2, 1, Math.max(1, inner.h - 4), F.woodTopHi, 0.5));
    ops.push(rectOp(inner.x + inner.w - 2, inner.y + 1, 1, Math.max(1, inner.h - 2), F.woodSeam, 0.7));
  }
  const span = wide ? inner.w : inner.h;
  const panels = Math.max(1, Math.round(span / 38));
  for (let i = 1; i < panels; i += 1) {
    if (wide) ops.push(rectOp(inner.x + Math.round((inner.w * i) / panels), inner.y + 2, 1, Math.max(1, inner.h - 2), F.woodDark, 0.8));
    else ops.push(rectOp(inner.x + 2, inner.y + Math.round((inner.h * i) / panels), Math.max(1, inner.w - 2), 1, F.woodDark, 0.8));
  }
  for (let i = 0; i < panels; i += 1) {
    if (wide) {
      const cx = inner.x + Math.round((inner.w * (i + 0.5)) / panels);
      ops.push(rectOp(cx - 3, inner.y + Math.max(2, Math.round(inner.h / 2)), 6, 2, F.metalHi));
    } else {
      const cy = inner.y + Math.round((inner.h * (i + 0.5)) / panels);
      ops.push(rectOp(inner.x + Math.max(2, Math.round(inner.w / 2)), cy - 3, 2, 6, F.metalHi));
    }
  }
  if (wide) {
    // Backsplash band behind the top — tiled in the pantry, plain elsewhere —
    // then a lip above the worktop and a recessed plinth below it, so the
    // counter reads with real depth instead of a flat slab.
    const splashH = zone === 'pantry' ? 3 : 2;
    ops.push(rectOp(inner.x, inner.y, inner.w, splashH, F.serviceSeam, 0.9));
    ops.push(rectOp(inner.x, inner.y, inner.w, 1, F.serviceHi, 0.85));
    if (zone === 'pantry') {
      for (let x = inner.x + 6; x < inner.x + inner.w - 2; x += 8) ops.push(rectOp(x, inner.y + 1, 1, splashH - 1, F.serviceEdge, 0.7));
    }
    ops.push(rectOp(inner.x, inner.y + splashH, inner.w, 1, F.woodTopHi, 0.5));
    ops.push(rectOp(inner.x, inner.y + inner.h - 3, inner.w, 3, F.woodEdge));
    ops.push(rectOp(inner.x, inner.y + inner.h - 1, inner.w, 1, F.woodDark, 0.85));
    ops.push(rectOp(inner.x + 1, inner.y + inner.h - 2, Math.max(1, inner.w - 2), 1, F.ink, 0.4));
    ops.push(...counterEquipment(item, inner));
  } else {
    ops.push(rectOp(inner.x + inner.w - 3, inner.y, 3, inner.h, F.woodEdge));
    ops.push(rectOp(inner.x + inner.w - 1, inner.y + 1, 1, Math.max(1, inner.h - 2), F.ink, 0.4));
  }
  return ops;
}

function cabinetArt(item: Furniture): Op[] {
  const F = GAME_PALETTE;
  const r = snap(item.rect);
  const inner = inset(r, 1);
  const wide = inner.w >= inner.h;
  const ops: Op[] = [shadow(r), rectOp(r.x, r.y, r.w, r.h, F.ink), rectOf(inner, F.cabinet)];
  ops.push(rectOp(inner.x, inner.y, inner.w, 1, F.cabinetHi));
  ops.push(rectOp(inner.x, inner.y, 1, inner.h, F.cabinetHi, 0.6));
  ops.push(rectOp(inner.x, inner.y + inner.h - 2, inner.w, 2, F.cabinetDark, 0.8));
  // A top lip and a recessed plinth ground the cabinet and read as real depth.
  ops.push(rectOp(inner.x, inner.y + 1, inner.w, 1, F.cabinetDark, 0.35));
  ops.push(rectOp(inner.x + 1, inner.y + inner.h - 1, Math.max(1, inner.w - 2), 1, F.ink, 0.5));
  const span = wide ? inner.w : inner.h;
  const leaves = Math.max(1, Math.round(span / 36));
  for (let i = 0; i < leaves; i += 1) {
    if (wide) {
      const lx = inner.x + Math.round((inner.w * i) / leaves);
      const lw = Math.round((inner.w * (i + 1)) / leaves) - Math.round((inner.w * i) / leaves);
      ops.push(rectOp(lx + 1, inner.y + 1, Math.max(1, lw - 2), Math.max(1, inner.h - 3), F.cabinetDoor));
      ops.push(rectOp(lx + 1, inner.y + 1, Math.max(1, lw - 2), 1, F.cabinetHi, 0.7));
      if (i > 0) ops.push(rectOp(lx, inner.y + 1, 1, Math.max(1, inner.h - 2), F.cabinetDark));
      const hx = i === 0 ? lx + lw - 5 : lx + 3;
      ops.push(rectOp(hx, inner.y + Math.max(2, Math.round(inner.h / 2) - 3), 2, 6, F.metalHi));
      ops.push(rectOp(lx + 1, inner.y + Math.max(2, Math.round(inner.h * 0.72)), Math.max(1, lw - 2), 1, F.cabinetDark, 0.35));
    } else {
      const ly = inner.y + Math.round((inner.h * i) / leaves);
      const lh = Math.round((inner.h * (i + 1)) / leaves) - Math.round((inner.h * i) / leaves);
      ops.push(rectOp(inner.x + 1, ly + 1, Math.max(1, inner.w - 2), Math.max(1, lh - 2), F.cabinetDoor));
      ops.push(rectOp(inner.x + 1, ly + 1, Math.max(1, inner.w - 2), 1, F.cabinetHi, 0.7));
      if (i > 0) ops.push(rectOp(inner.x + 1, ly, Math.max(1, inner.w - 2), 1, F.cabinetDark));
      ops.push(rectOp(inner.x + Math.max(2, Math.round(inner.w / 2) - 3), ly + 2, 6, 2, F.metalHi));
    }
  }
  return ops;
}

function fridgeArt(item: Furniture): Op[] {
  const F = GAME_PALETTE;
  const r = snap(item.rect);
  const inner = inset(r, 1);
  const wide = inner.w >= inner.h;
  const ops: Op[] = [shadow(r), rectOp(r.x, r.y, r.w, r.h, F.ink), rectOf(inner, F.fridge)];
  ops.push(rectOp(inner.x, inner.y, inner.w, 1, F.fridgeDoor));
  if (wide) {
    const mid = inner.x + Math.round(inner.w / 2);
    ops.push(rectOp(inner.x + 1, inner.y + 1, Math.max(1, mid - inner.x - 2), Math.max(1, inner.h - 2), F.fridgeDoor));
    ops.push(rectOp(mid + 1, inner.y + 1, Math.max(1, inner.x + inner.w - mid - 2), Math.max(1, inner.h - 2), F.fridgeDoor));
    ops.push(rectOp(mid, inner.y, 1, inner.h, F.fridgeGasket));
    ops.push(rectOp(mid - 4, inner.y + 4, 2, Math.max(4, inner.h - 10), F.fridgeDark));
    ops.push(rectOp(mid + 2, inner.y + 4, 2, Math.max(4, inner.h - 10), F.fridgeDark));
    // Handle highlights and a door-split shadow read the two-door depth.
    ops.push(rectOp(mid - 3, inner.y + 4, 1, Math.max(4, inner.h - 10), F.metalHi, 0.7));
    ops.push(rectOp(mid + 4, inner.y + 4, 1, Math.max(4, inner.h - 10), F.metalHi, 0.7));
    ops.push(rectOp(mid + 1, inner.y + 1, 1, Math.max(1, inner.h - 2), F.fridgeGasket, 0.7));
    ops.push(rectOp(inner.x + 2, inner.y + 2, Math.max(1, mid - inner.x - 5), 1, F.fridgeDoor, 1));
  } else {
    const mid = inner.y + Math.round(inner.h / 2);
    ops.push(rectOp(inner.x + 1, inner.y + 1, Math.max(1, inner.w - 2), Math.max(1, mid - inner.y - 2), F.fridgeDoor));
    ops.push(rectOp(inner.x + 1, mid + 1, Math.max(1, inner.w - 2), Math.max(1, inner.y + inner.h - mid - 2), F.fridgeDoor));
    ops.push(rectOp(inner.x, mid, inner.w, 1, F.fridgeGasket));
    ops.push(rectOp(inner.x + 2, mid + 3, Math.max(4, inner.w - 4), 2, F.fridgeDark));
  }
  // A magnet note keeps it from reading as a plain box.
  ops.push(rectOp(inner.x + inner.w - 7, inner.y + 4, 4, 4, F.paper));
  ops.push(rectOp(inner.x + inner.w - 6, inner.y + 5, 2, 1, F.paperLine));
  // Top cap and a recessed kick plinth: real cabinet depth, front and back.
  ops.push(rectOp(inner.x + 1, inner.y + 1, Math.max(1, inner.w - 2), 1, F.fridgeDoor, 0.95));
  ops.push(rectOp(inner.x + 1, inner.y + inner.h - 2, Math.max(1, inner.w - 2), 2, F.ink, 0.45));
  return ops;
}

function dispenserArt(item: Furniture): Op[] {
  const F = GAME_PALETTE;
  const r = snap(item.rect);
  const inner = inset(r, 1);
  const bodyH = Math.max(6, Math.round(inner.h * 0.52));
  const bodyY = inner.y + inner.h - bodyH;
  const ops: Op[] = [shadow(r), rectOp(r.x, r.y, r.w, r.h, F.ink)];
  ops.push(rectOp(inner.x, bodyY, inner.w, bodyH, F.dispenserBody));
  ops.push(rectOp(inner.x, bodyY, inner.w, 1, F.metalHi));
  ops.push(rectOp(inner.x + inner.w - 1, bodyY, 1, bodyH, F.dispenserDark, 0.7));
  // Bottle with a water line.
  const bw = Math.max(6, Math.round(inner.w * 0.44));
  const bx = inner.x + Math.round((inner.w - bw) / 2);
  const bh = Math.max(5, inner.h - bodyH - 3);
  ops.push(rectOp(bx, inner.y + 1, bw, bh, F.ink));
  ops.push(rectOp(bx + 1, inner.y + 2, Math.max(2, bw - 2), Math.max(2, bh - 2), F.dispenserBottle));
  ops.push(rectOp(bx + 1, inner.y + 2, Math.max(2, bw - 2), 2, F.dispenserWater));
  ops.push(rectOp(bx + 1, inner.y + 3, 1, 2, F.metalHi));
  // Two taps and a drip tray on the body.
  ops.push(rectOp(inner.x + Math.round(inner.w / 2) - 4, bodyY - 2, 2, 3, F.dispenserDark));
  ops.push(rectOp(inner.x + Math.round(inner.w / 2) + 2, bodyY - 2, 2, 3, F.dispenserDark));
  ops.push(rectOp(inner.x + 2, bodyY + 2, Math.max(1, inner.w - 4), 2, F.dispenserTray));
  ops.push(rectOp(inner.x + 2, bodyY + 2, Math.max(1, inner.w - 4), 1, F.metalHi, 0.8));
  ops.push(rectOp(inner.x + 3, bodyY + bodyH - 3, Math.max(1, inner.w - 6), 2, F.metal));
  // A control panel and a bottle highlight give the dispenser a real face.
  ops.push(rectOp(inner.x + 2, bodyY + bodyH - 6, Math.max(3, Math.round(inner.w * 0.28)), 2, F.metalDark, 0.75));
  ops.push(rectOp(inner.x + 3, bodyY + bodyH - 6, Math.max(2, Math.round(inner.w * 0.28) - 2), 1, F.metalHi, 0.7));
  ops.push(rectOp(inner.x + Math.round(inner.w / 2) + 4, bodyY + 1, 2, 2, F.dispenserWater, 0.9));
  // A stack of paper cups beside the bottle and a base plinth.
  if (inner.w >= 24 && inner.h >= 16) {
    ops.push(rectOp(inner.x + 2, inner.y + 3, 5, 6, F.ink));
    ops.push(rectOp(inner.x + 3, inner.y + 4, 3, 4, F.cup));
    ops.push(rectOp(inner.x + 3, inner.y + 4, 3, 1, F.cupAccent));
  }
  ops.push(rectOp(inner.x + 1, inner.y + inner.h - 1, Math.max(1, inner.w - 2), 1, F.ink, 0.5));
  return ops;
}

function sinkArt(item: Furniture): Op[] {
  const F = GAME_PALETTE;
  const r = snap(item.rect);
  const inner = inset(r, 1);
  const ops: Op[] = [shadow(r), rectOp(r.x, r.y, r.w, r.h, F.ink), rectOf(inner, F.sinkRim)];
  const basin = inset(inner, 3);
  ops.push(rectOp(basin.x, basin.y, basin.w, basin.h, F.ink));
  ops.push(rectOp(basin.x + 1, basin.y + 1, Math.max(1, basin.w - 2), Math.max(1, basin.h - 2), F.sinkBasin));
  ops.push(rectOp(basin.x + 1, basin.y + 1, Math.max(1, basin.w - 2), 1, F.metalHi, 0.6));
  ops.push(rectOp(basin.x + 2, basin.y + 2, Math.max(1, basin.w - 6), Math.max(1, basin.h - 6), F.sinkWater, 0.45));
  const spoutX = inner.x + Math.round(inner.w / 2) - 1;
  ops.push(rectOp(spoutX, inner.y + 1, 2, Math.max(3, Math.round(inner.h * 0.3)), F.sinkTap));
  ops.push(rectOp(spoutX - 3, inner.y + 1, 8, 2, F.sinkTap));
  ops.push(rectOp(spoutX - 2, inner.y + 3, 6, 1, F.metalHi, 0.6));
  // A soap bottle and a cup on the rim.
  if (inner.w >= 20 && inner.h >= 16) {
    ops.push(rectOp(inner.x + 2, inner.y + 2, 3, 5, F.ink));
    ops.push(rectOp(inner.x + 3, inner.y + 3, 1, 3, F.cup, 0.9));
  }
  return ops;
}

function sofaArt(item: Furniture): Op[] {
  const F = GAME_PALETTE;
  const r = snap(item.rect);
  const inner = inset(r, 1);
  const ops: Op[] = [shadow(r, 2, 4, 0.24), rectOp(r.x, r.y, r.w, r.h, F.ink), rectOf(inner, F.sofaFrame)];
  const backH = Math.max(5, Math.round(inner.h * 0.32));
  ops.push(rectOp(inner.x, inner.y, inner.w, backH, F.sofaFrame));
  ops.push(rectOp(inner.x, inner.y, inner.w, 1, F.sofaCushionHi, 0.6));
  ops.push(rectOp(inner.x, inner.y + backH, inner.w, 1, F.sofaPiping, 0.7));
  const seatY = inner.y + backH;
  const seatH = Math.max(1, inner.y + inner.h - seatY - 2);
  const seats = 2;
  for (let i = 0; i < seats; i += 1) {
    const sx = inner.x + 1 + Math.round(((inner.w - 2) * i) / seats);
    const sw = Math.round(((inner.w - 2) * (i + 1)) / seats) - Math.round(((inner.w - 2) * i) / seats) - 1;
    ops.push(rectOp(sx, seatY, Math.max(1, sw), seatH, F.sofaCushion));
    ops.push(rectOp(sx, seatY, Math.max(1, sw), 1, F.sofaCushionHi));
    ops.push(rectOp(sx + 1, seatY + 1, Math.max(1, sw - 2), 1, F.sofaCushionHi, 0.4));
  }
  ops.push(rectOp(inner.x, inner.y + inner.h - 1, inner.w, 1, F.sofaPiping, 0.6));
  // Armrests and a shadowed skirt complete the V1 sofa silhouette.
  const armW = Math.max(2, Math.min(4, Math.round(inner.w * 0.1)));
  ops.push(rectOp(inner.x, inner.y, armW, inner.h, F.sofaPiping, 0.85));
  ops.push(rectOp(inner.x + inner.w - armW, inner.y, armW, inner.h, F.sofaPiping, 0.85));
  ops.push(rectOp(inner.x, inner.y, armW, 1, F.sofaCushionHi, 0.5));
  ops.push(rectOp(inner.x + inner.w - armW, inner.y, armW, 1, F.sofaCushionHi, 0.5));
  ops.push(rectOp(inner.x + 1, inner.y + inner.h - 1, Math.max(1, inner.w - 2), 1, F.ink, 0.4));
  return ops;
}

// --- Chair silhouette helpers ---------------------------------------------

// A rounded block drawn as stacked rectangles (never one disc), so a cushion or
// backrest reads as a pixel-art office chair rather than a schematic symbol.
function steppedBlock(rect: Rect, fill: string, corner = 2, opacity?: number): PaintedOp[] {
  const c = Math.max(1, Math.min(corner, Math.floor(Math.min(rect.w, rect.h) / 3)));
  if (rect.w <= 2 * c || rect.h <= 2 * c) return [rectOp(rect.x, rect.y, rect.w, rect.h, fill, opacity)];
  return [
    rectOp(rect.x + c, rect.y, rect.w - 2 * c, rect.h, fill, opacity),
    rectOp(rect.x + c - 1, rect.y + 1, rect.w - 2 * (c - 1), Math.max(1, rect.h - 2), fill, opacity),
    rectOp(rect.x, rect.y + c, rect.w, rect.h - 2 * c, fill, opacity),
  ];
}

function expand(rect: Rect, n: number): Rect {
  return { x: rect.x - n, y: rect.y - n, w: rect.w + n * 2, h: rect.h + n * 2 };
}

type Side = 'top' | 'bottom' | 'left' | 'right';

function edgeBand(rect: Rect, side: Side, thickness: number, fill: string, opacity?: number): RectOp {
  if (side === 'top') return rectOp(rect.x, rect.y, rect.w, thickness, fill, opacity);
  if (side === 'bottom') return rectOp(rect.x, rect.y + rect.h - thickness, rect.w, thickness, fill, opacity);
  if (side === 'left') return rectOp(rect.x, rect.y, thickness, rect.h, fill, opacity);
  return rectOp(rect.x + rect.w - thickness, rect.y, thickness, rect.h, fill, opacity);
}

// The chair is authored in a canonical frame: `u` runs sideways, `v` runs from
// the front toward the backrest, both centred on the chair. `place` maps that
// frame into world space for a facing, so the backrest always ends up on the
// side the chair belongs to.
function placePoint(r: Rect, facing: ChairFacing, u: number, v: number): { x: number; y: number } {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  if (facing === 'north') return { x: cx + u, y: cy - v };
  if (facing === 'south') return { x: cx - u, y: cy + v };
  if (facing === 'west') return { x: cx - v, y: cy + u };
  return { x: cx + v, y: cy - u };
}

function placeRect(r: Rect, facing: ChairFacing, u0: number, u1: number, v0: number, v1: number): Rect {
  const a = placePoint(r, facing, u0, v0);
  const b = placePoint(r, facing, u1, v1);
  const x = Math.round(Math.min(a.x, b.x));
  const y = Math.round(Math.min(a.y, b.y));
  return { x, y, w: Math.max(1, Math.round(Math.max(a.x, b.x)) - x), h: Math.max(1, Math.round(Math.max(a.y, b.y)) - y) };
}

const sideToward = (facing: ChairFacing): Side =>
  facing === 'north' ? 'top' : facing === 'south' ? 'bottom' : facing === 'west' ? 'left' : 'right';
const sideAway = (facing: ChairFacing): Side =>
  facing === 'north' ? 'bottom' : facing === 'south' ? 'top' : facing === 'west' ? 'right' : 'left';

// Chairs keep the V1 silhouette: a pixel-rounded cushion and backrest built from
// stepped rectangles, visible armrests, a five-star base with casters and a
// central post, and an orientation that is readable from the backrest side.
function chairArt(item: Furniture, facing: ChairFacing = 'north', upholstery: Upholstery = UPHOLSTERY.v1): Op[] {
  const F = GAME_PALETTE;
  const U = upholstery;
  const r = snap(item.rect);
  const W = r.w;
  const H = r.h;
  const cx = r.x + W / 2;
  const cy = r.y + H / 2;
  const place = (u0: number, u1: number, v0: number, v1: number): Rect => placeRect(r, facing, u0, u1, v0, v1);
  // A per-chair upholstery tone inside the zone family: three deterministic
  // combinations of the family's own back/seat/highlight tones, so a long row of
  // identical chairs still reads as individual seating, never a cloned grid.
  const tone = hashString(item.id) % 3;
  const seatFill = tone === 0 ? U.seat : tone === 1 ? U.seatHi : U.back;
  const seatTrim = tone === 0 ? U.seatHi : tone === 1 ? U.seat : U.backHi;
  const backFill = tone === 0 ? U.back : tone === 1 ? U.backHi : U.seat;
  const backTrim = tone === 0 ? U.backHi : tone === 1 ? U.seatHi : U.backHi;

  // Base: a shadow, five-star legs, four casters and a central post.
  const base: Op[] = [rectOp(r.x + 2, r.y + 3, W, H, F.shadow, 0.18)];
  const barU = W * 0.3;
  const barV = H * 0.3;
  base.push(rectOp(Math.round(cx - barU - 1), Math.round(cy - 1), Math.round(barU * 2) + 2, 2, U.base, 0.95));
  base.push(rectOp(Math.round(cx - 1), Math.round(cy - barV - 1), 2, Math.round(barV * 2) + 2, U.base, 0.95));
  base.push(rectOp(Math.round(cx - barU - 1), Math.round(cy - 1), Math.round(barU * 2) + 2, 1, F.metalDark, 0.5));
  base.push(rectOp(Math.round(cx - 1), Math.round(cy - barV - 1), 1, Math.round(barV * 2) + 2, F.metalDark, 0.5));
  for (const [su, sv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as Array<[number, number]>) {
    const caster = placePoint(r, facing, su * barU, sv * barV);
    base.push(rectOp(Math.round(caster.x) - 2, Math.round(caster.y) - 2, 4, 4, F.ink));
    base.push(circleOp(caster.x, caster.y, 1.6, U.base));
  }
  base.push(rectOp(Math.round(cx) - 2, Math.round(cy) - 2, 4, 4, U.frame));
  base.push(circleOp(cx, cy, 2.4, U.base));

  // Cushion: stepped, shifted toward the desk (away from the backrest).
  const seat = place(-W * 0.32, W * 0.32, -H * 0.16, H * 0.3);
  const seatOps: Op[] = [
    ...steppedBlock(expand(seat, 1), F.ink, 3),
    ...steppedBlock(seat, seatFill, 3),
    edgeBand(seat, sideAway(facing), 1, seatTrim),
    edgeBand(seat, sideToward(facing), 1, U.frame, 0.35),
  ];

  // Backrest: stepped shell on the far side, highlighted on its outer edge and
  // a lumbar band across its inner face so the seat reads in three layers.
  const back = place(-W * 0.36, W * 0.36, H * 0.2, H * 0.46);
  const backOps: Op[] = [
    ...steppedBlock(expand(back, 1), F.ink, 3),
    ...steppedBlock(back, backFill, 3),
    edgeBand(back, sideToward(facing), 1, backTrim),
    edgeBand(back, sideAway(facing), 1, U.seat, 0.4),
  ];
  if (back.w >= 6 && back.h >= 5) {
    const lumbar = edgeBand(back, sideAway(facing), 2, backTrim, 0.45);
    backOps.push({ ...lumbar, x: lumbar.x + 1, y: lumbar.y + 1, w: Math.max(1, lumbar.w - 2), h: Math.max(1, lumbar.h - 2) });
    backOps.push(edgeBand(back, sideToward(facing), 1, U.frame, 0.3));
  }

  // Armrests flank the cushion along the perpendicular of the facing; each gets
  // a dark frame, a fabric pad and a highlight cap.
  const armLow = -H * 0.05;
  const armHigh = H * 0.3;
  const arms: Op[] = [];
  for (const su of [-1, 1]) {
    const start = su < 0 ? -W * 0.42 : W * 0.3;
    const end = su < 0 ? -W * 0.3 : W * 0.42;
    const bar = place(start, end, armLow, armHigh);
    arms.push(...steppedBlock(expand(bar, 1), F.ink, 2));
    arms.push(...steppedBlock(bar, U.arm, 2));
    if (bar.w >= 4 && bar.h >= 4) arms.push(edgeBand(bar, sideAway(facing), 2, backTrim, 0.3));
    arms.push(edgeBand(bar, sideToward(facing), 1, F.metalHi, 0.35));
  }

  return [
    { t: 'group', sourceId: `${item.id}:base`, semantic: 'chair:base', ops: base },
    { t: 'group', sourceId: `${item.id}:seat`, semantic: 'chair:seat', ops: seatOps },
    { t: 'group', sourceId: `${item.id}:backrest`, semantic: 'chair:backrest', ops: backOps },
    { t: 'group', sourceId: `${item.id}:armrest`, semantic: 'chair:armrest', ops: arms },
  ];
}

function screenArt(item: Furniture): Op[] {
  const F = GAME_PALETTE;
  void item;
  const r = snap(item.rect);
  const inner = inset(r, 1);
  const ops: Op[] = [shadow(r, 2, 4, 0.24), rectOp(r.x, r.y, r.w, r.h, F.ink), rectOf(inner, F.metalDark)];
  const panel = inset(inner, 2);
  ops.push(rectOf(panel, F.screen));
  ops.push(rectOp(panel.x, panel.y, panel.w, 2, F.screenHi));
  ops.push(rectOp(panel.x, panel.y + panel.h - 1, panel.w, 1, F.monitorBezel, 0.6));
  ops.push(rectOp(inner.x + Math.round(inner.w / 2) - 2, inner.y + inner.h - 2, 4, 2, F.metal));
  ops.push(rectOp(inner.x, inner.y, inner.w, 1, F.metalHi, 0.7));
  return ops;
}

function boardArt(item: Furniture): Op[] {
  const F = GAME_PALETTE;
  void item;
  const r = snap(item.rect);
  const inner = inset(r, 1);
  const face = inset(r, 2);
  const ops: Op[] = [shadow(r, 2, 3, 0.26), rectOp(r.x, r.y, r.w, r.h, F.ink), rectOf(inner, F.boardFrame)];
  ops.push(rectOf(face, F.boardFace));
  ops.push(rectOp(face.x, face.y, face.w, 1, F.wallHi, 0.7));
  for (let i = 0; i < 3; i += 1) {
    const py = face.y + 4 + i * 6;
    ops.push(rectOp(face.x + 1, py, Math.max(2, face.w - 2), 2, F.boardInk, 0.75));
    ops.push(rectOp(face.x + 1, py, 1, 2, F.paper, 0.9));
    ops.push(rectOp(face.x + face.w - 3, py, 2, 2, F.boardPin));
  }
  return ops;
}

const FURNITURE_ART: Record<FurnitureKind, (item: Furniture) => Op[]> = {
  desk: (item) => deskArt(item, []),
  table: tableArt,
  counter: counterArt,
  cabinet: cabinetArt,
  chair: (item) => chairArt(item, 'north'),
  fridge: fridgeArt,
  dispenser: dispenserArt,
  screen: screenArt,
  sink: sinkArt,
  sofa: sofaArt,
  board: boardArt,
};

export function buildFurnitureGroup(item: Furniture, facing: ChairFacing = 'north', kits: readonly Workstation[] = []): GroupOp {
  let ops: Op[];
  if (item.kind === 'chair') ops = chairArt(item, facing, upholsteryFor(item.zone));
  else if (item.kind === 'desk') ops = deskArt(item, kits);
  else ops = FURNITURE_ART[item.kind](item);
  return { t: 'group', sourceId: item.id, semantic: `furniture:${item.kind}`, ops };
}

// ---------------------------------------------------------------------------
// Decorations: deterministic, non-collision, geometry-derived
// ---------------------------------------------------------------------------

function plantOps(r: Rect): PaintedOp[] {
  const F = GAME_PALETTE;
  const potH = Math.max(5, Math.round(r.h * 0.4));
  const potY = r.y + r.h - potH;
  const potW = Math.max(6, Math.round(r.w * 0.7));
  const potX = r.x + Math.round((r.w - potW) / 2);
  const leaf = { x: r.x + 1, y: r.y, w: Math.max(5, r.w - 2), h: Math.max(5, potY - r.y) };
  return [
    rectOp(r.x + 2, r.y + r.h, Math.max(4, r.w - 4), 2, F.shadow, 0.2),
    rectOp(potX, potY, potW, potH, F.ink),
    rectOp(potX + 1, potY + 1, Math.max(2, potW - 2), Math.max(2, potH - 1), F.pot),
    rectOp(potX + 1, potY + 1, Math.max(2, potW - 2), 1, F.potHi),
    rectOp(leaf.x, leaf.y + 1, leaf.w, leaf.h - 1, F.ink),
    rectOp(leaf.x + 1, leaf.y + 2, Math.max(2, leaf.w - 2), Math.max(2, leaf.h - 3), F.leaf),
    rectOp(leaf.x + 2, leaf.y + 2, Math.max(2, Math.round(leaf.w * 0.5)), 2, F.leafHi),
    rectOp(leaf.x + 1, leaf.y + Math.max(3, Math.round(leaf.h * 0.5)), Math.max(2, leaf.w - 3), 2, F.leafDark),
  ];
}

function wallArtOps(r: Rect, kind: 'clock' | 'art'): PaintedOp[] {
  const F = GAME_PALETTE;
  const ops: PaintedOp[] = [
    rectOp(r.x + 1, r.y + 2, Math.max(1, r.w - 2), 1, F.shadow, 0.28),
    rectOp(r.x, r.y, r.w, r.h, F.ink),
  ];
  const face = inset(r, 1);
  ops.push(rectOf(face, kind === 'clock' ? F.clockFace : F.artFace));
  if (kind === 'clock') {
    ops.push(circleOp(r.x + r.w / 2, r.y + r.h / 2, Math.max(2, Math.min(face.w, face.h) / 2), F.clockRim));
    ops.push(circleOp(r.x + r.w / 2, r.y + r.h / 2, Math.max(1, Math.min(face.w, face.h) / 2 - 1.5), F.clockFace));
    ops.push(rectOp(Math.round(r.x + r.w / 2), Math.round(r.y + r.h / 2) - 2, 1, 3, F.clockRim));
    ops.push(rectOp(Math.round(r.x + r.w / 2), Math.round(r.y + r.h / 2), 2, 1, F.clockRim));
  } else {
    ops.push(rectOp(face.x + 1, face.y + 1, Math.max(1, face.w - 2), Math.max(1, face.h - 2), F.artInk, 0.5));
    ops.push(rectOp(face.x + 1, face.y + Math.max(1, face.h - 3), Math.max(1, face.w - 2), 2, F.leaf, 0.7));
  }
  return ops;
}

// The wastafel alcove is a real, walkable service nook but carries no approved
// furniture item, so its basin is painted as zone-derived detail rather than an
// invented collider: a tiled sill, a rimmed bowl with a tap and a couple of cups,
// all derived from and contained by the approved zone rect.
export function serviceNookOps(manifest: OfficeManifest): Op[] {
  const F = GAME_PALETTE;
  const zone = manifest.zones.find((entry) => entry.id === 'wastafel');
  if (!zone) return [];
  const r = snap(zone.rect);
  const inner = inset(r, 3);
  if (inner.w < 24 || inner.h < 16) return [];
  const ops: Op[] = [];
  ops.push(rectOp(inner.x, inner.y, inner.w, 1, F.serviceHi, 0.7));
  const basin = { x: inner.x + 2, y: inner.y + Math.round(inner.h * 0.35), w: Math.max(8, inner.w - 4), h: Math.max(6, Math.round(inner.h * 0.5)) };
  ops.push(rectOp(basin.x, basin.y, basin.w, basin.h, F.ink));
  ops.push(rectOp(basin.x + 1, basin.y + 1, Math.max(1, basin.w - 2), Math.max(1, basin.h - 2), F.sinkRim));
  ops.push(rectOp(basin.x + 2, basin.y + 2, Math.max(1, basin.w - 4), Math.max(1, basin.h - 4), F.sinkBasin));
  ops.push(rectOp(basin.x + 2, basin.y + 2, Math.max(1, basin.w - 4), 1, F.metalHi, 0.6));
  ops.push(rectOp(basin.x + 3, basin.y + 3, Math.max(1, basin.w - 8), Math.max(1, basin.h - 6), F.sinkWater, 0.4));
  const tapX = basin.x + Math.round(basin.w / 2) - 1;
  ops.push(rectOp(tapX, basin.y - 3, 2, 4, F.sinkTap));
  ops.push(rectOp(tapX - 3, basin.y - 3, 8, 2, F.sinkTap));
  ops.push(rectOp(tapX - 2, basin.y - 1, 6, 1, F.metalHi, 0.6));
  ops.push(rectOp(inner.x + inner.w - 6, inner.y + 2, 4, 5, F.ink));
  ops.push(rectOp(inner.x + inner.w - 5, inner.y + 3, 2, 3, F.cup));
  return ops;
}

/**
 * A visual-only decoration pass derived purely from zone and furniture geometry:
 * perimeter plants in safe empty corners and small wall art / clocks on long
 * walls. It emits plain paint ops (never a group, never a collider) and stays
 * clear of openings, solid furniture, seats and already-placed decorations.
 */
export function buildDecorationOps(manifest: OfficeManifest): PaintedOp[] {
  const ops: PaintedOp[] = [];
  const placed: Rect[] = [];
  const blocked: Rect[] = [
    ...manifest.walls.map((wall) => wall.rect),
    ...manifest.columns.map((column) => column.rect),
    ...manifest.blocks.map((block) => block.rect),
    ...manifest.furniture.map((item) => item.rect),
    ...manifest.openings.map((opening) => opening.rect),
    ...manifest.hotspots.map((hotspot) => hotspot.rect),
  ];
  const free = (rect: Rect): boolean =>
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.w <= manifest.width &&
    rect.y + rect.h <= manifest.height &&
    !blocked.some((entry) => overlaps(rect, entry)) &&
    !placed.some((entry) => overlaps(rect, entry));

  const sealedNames = new Set(manifest.blocks.filter((block) => block.kind === 'sealed').map((block) => block.name));
  const PLANT = 18;
  for (const zone of manifest.zones) {
    if (zone.kind !== 'room' && zone.kind !== 'open' && zone.kind !== 'lobby') continue;
    if (zone.rect.w < 96 || zone.rect.h < 96) continue;
    if (sealedNames.has(zone.name)) continue;
    const inner = inset(zone.rect, 22);
    const margin = 3;
    const corners: Rect[] = [
      { x: zone.rect.x + margin, y: zone.rect.y + margin, w: PLANT, h: PLANT },
      { x: zone.rect.x + zone.rect.w - margin - PLANT, y: zone.rect.y + margin, w: PLANT, h: PLANT },
      { x: zone.rect.x + margin, y: zone.rect.y + zone.rect.h - margin - PLANT, w: PLANT, h: PLANT },
      { x: zone.rect.x + zone.rect.w - margin - PLANT, y: zone.rect.y + zone.rect.h - margin - PLANT, w: PLANT, h: PLANT },
    ];
    let count = 0;
    for (const corner of corners) {
      if (count >= 2) break;
      const rect = { x: Math.round(corner.x), y: Math.round(corner.y), w: PLANT, h: PLANT };
      if (!free(rect)) continue;
      if (overlaps(rect, inner)) continue;
      placed.push(rect);
      ops.push(...plantOps(rect));
      count += 1;
    }
  }

  // Mounted wall motifs: one small framed art/clock per private room, hung on
  // the room-facing side of its back (north) wall just inside the perimeter
  // ring, so the rooms read as occupied rather than empty boxes. Placement is
  // derived from the zone rect, tries a centre-first set of deterministic
  // anchors and only paints where the spot is genuinely free (never over an
  // opening, a fixture or a seat). It never creates a collider.
  let artIndex = 0;
  for (const zone of manifest.zones) {
    if (zone.kind !== 'room') continue;
    if (sealedNames.has(zone.name)) continue;
    if (zone.rect.w < 96) continue;
    const artW = 24;
    const artH = 10;
    const y = Math.round(zone.rect.y + 6);
    const anchors = [0.5, 0.32, 0.68];
    for (const anchor of anchors) {
      const rect: Rect = { x: Math.round(zone.rect.x + zone.rect.w * anchor - artW / 2), y, w: artW, h: artH };
      const padded: Rect = { x: rect.x - 3, y: rect.y - 2, w: rect.w + 6, h: rect.h + 4 };
      if (manifest.openings.some((opening) => overlaps(padded, opening.rect))) continue;
      if (manifest.furniture.some((item) => overlaps(padded, item.rect))) continue;
      if (!free(rect)) continue;
      if (overlaps(rect, inset(zone.rect, 24))) continue;
      placed.push(rect);
      ops.push(...wallArtOps(rect, artIndex % 3 === 0 ? 'clock' : 'art'));
      artIndex += 1;
      break;
    }
  }

  return ops;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function surfaceArea(manifest: OfficeManifest, surface: OfficeManifest['surfaces'][number]): number {
  const zone = manifest.zones.find((entry) => entry.id === surface.zone);
  const rect = surface.rect ?? zone?.rect;
  return rect ? rect.w * rect.h : 0;
}

export function buildGameWorldOps(manifest: OfficeManifest): Op[] {
  const ops: Op[] = [rectOp(0, 0, manifest.width, manifest.height, GAME_PALETTE.outside)];

  for (const block of manifest.blocks) if (block.kind === 'void') ops.push(...outsideOps(block.rect));

  // Floors, largest first so patches (the lobby rug) sit on their parent zone.
  const surfaces = [...manifest.surfaces].sort((a, b) => surfaceArea(manifest, b) - surfaceArea(manifest, a));
  surfaces.forEach((surface, index) => {
    const zone = manifest.zones.find((entry) => entry.id === surface.zone);
    const rect = surface.rect ?? zone?.rect;
    if (rect) ops.push(...floorOps(rect, surface.kind, index, surface.zone));
  });

  // Furniture-centred rugs, derived per room and painted under the furniture.
  ops.push(...furnitureRugOps(manifest));

  // Service-nook detail (the wastafel basin) derived from its own zone rect.
  ops.push(...serviceNookOps(manifest));

  for (const window of manifest.windows) ops.push(...windowOps(window));
  for (const wall of manifest.walls) ops.push(...wallOps(wall));
  for (const opening of manifest.openings) ops.push(...openingOps(opening));
  for (const column of manifest.columns) ops.push(...columnOps(column.rect));

  // Visual-only decorations derived from the same geometry (never colliders).
  ops.push(...buildDecorationOps(manifest));

  // Sealed blocks with no zone of their own are the lift shafts; the locked
  // rooms (Gudang, toilets, server) keep their zone floor + walls instead of a
  // giant opaque overlay, so they never look erased.
  for (const block of manifest.blocks) {
    if (block.kind !== 'sealed') continue;
    if (manifest.zones.some((zone) => zone.name === block.name)) continue;
    ops.push(...liftOps(block.rect));
  }

  const solids = manifest.furniture.filter((item) => item.solid);
  const workstations = deriveWorkstations(manifest);
  for (const item of manifest.furniture) {
    const facing = item.kind === 'chair' ? chairFacingFor(item, solids) : 'north';
    ops.push(buildFurnitureGroup(item, facing, workstations.get(item.id) ?? []));
  }

  // The Bilik Geng Kami raster underlay is the very last op, so it covers the
  // zone's own vector art (which stays underneath as the fallback). It uses the
  // exact approved zone rect; no manifest geometry is touched.
  const bilik = manifest.zones.find((zone) => zone.id === BILIK_GENG_ZONE_ID);
  if (bilik) {
    ops.push({ t: 'image', src: BILIK_ZONE_IMAGE_SRC, x: bilik.rect.x, y: bilik.rect.y, w: bilik.rect.w, h: bilik.rect.h });
  }

  return ops;
}

/** Standalone game-art preview: exactly the ops the canvas paints, no legend. */
export function buildGamePreviewOps(manifest: OfficeManifest): PreviewOps {
  return { width: manifest.width, height: manifest.height, ops: buildGameWorldOps(manifest) };
}
