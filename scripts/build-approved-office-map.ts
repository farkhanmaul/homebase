// Deterministic consolidation of the APPROVED review artifacts into the final
// app manifest `lib/office-map.json` (1920x960, world coordinates).
//
// Approved, read-only inputs (see docs/reviews/approved-map-selection.json):
//   - docs/reviews/office-structure-review-v2.json    base walls/partitions/
//                                                     columns/lifts/doors/gaps
//   - docs/reviews/office-furniture-review-v1.json    top row + Reception +
//                                                     general furniture
//   - docs/reviews/office-pantry-service-focus-v1.json pantry/service cells,
//                                                     toilet doors, open wash
//                                                     strip, lounge/certificate/
//                                                     external tables, pantry row
//   - docs/reviews/office-workareas-focus-v4.json     Desk Collection / Tele
//                                                     corrections, open Tele top,
//                                                     Best Agent board, 18x12 aisle
//
// Coordinate transform (uniform; no non-uniform stretch):
//   worldX = 60 + (sourceX - 44) * 1.25
//   worldY = 40 + (sourceY - 41) * 1.25
// Every transformed coordinate is rounded half-up to 2 decimals; rect extents
// are derived from the transformed endpoints so no gaps appear.
//
// The generator ASSERTS the selected source hashes, the approved overrides,
// exact furniture/chair counts, forbidden zone names, the open Tele top, the
// open Wastafel path, exactly three columns, the six Bilik Geng Kami seats, and
// deterministic output. It writes lib/office-map.json with 2-space JSON.
//
// Run: node --experimental-strip-types scripts/build-approved-office-map.ts

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateManifest,
  type Block,
  type Column,
  type Direction,
  type Furniture,
  type FurnitureKind,
  type Hotspot,
  type OfficeManifest,
  type Opening,
  type Rect,
  type Seat,
  type Surface,
  type SurfaceKind,
  type Wall,
  type WindowRect,
  type Zone,
  type ZoneKind,
} from '../lib/office-map.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const REVIEW_DIR = resolve(ROOT, 'docs', 'reviews');
const OUT_PATH = resolve(ROOT, 'lib', 'office-map.json');

// ---------------------------------------------------------------------------
// Approved sources (paths + current sha256; the selection doc mirrors these)
// ---------------------------------------------------------------------------

const APPROVED = {
  structure: { file: 'office-structure-review-v2.json', sha256: '2938e3376cffe56eb7769eee53f672462d1f7c24af13b671555e6c283baaec1f' },
  furniture: { file: 'office-furniture-review-v1.json', sha256: '1ad1da290bcddbf246836a11e855c2eeab4f79470dba2517deff24444d4096c6' },
  pantry: { file: 'office-pantry-service-focus-v1.json', sha256: 'b51751dbfe62b96373fed5f5d25642f875fdabdffec2b7bd33b8cfed989fadb6' },
  workareas: { file: 'office-workareas-focus-v4.json', sha256: 'fcd8f8e227e48ef573565154e011e4a7fdae1d81736fad55506d5f779a91401e' },
} as const;

// ---------------------------------------------------------------------------
// Transform + deterministic rounding
// ---------------------------------------------------------------------------

const TRANSFORM = {
  scale: 1.25,
  sourceX0: 44,
  sourceY0: 41,
  worldX0: 60,
  worldY0: 40,
  world: { width: 1920, height: 960 },
  sourceExtents: { x1: 44, x2: 1465, y1: 41, y2: 761 },
  rounding: 'round-half-up to 2 decimals, extents from transformed endpoints',
} as const;

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function worldX(sourceX: number): number {
  return round2(TRANSFORM.worldX0 + (sourceX - TRANSFORM.sourceX0) * TRANSFORM.scale);
}

export function worldY(sourceY: number): number {
  return round2(TRANSFORM.worldY0 + (sourceY - TRANSFORM.sourceY0) * TRANSFORM.scale);
}

/** Rect from a source-space (x1,y1)-(x2,y2) box. */
function rectOf(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: worldX(x1), y: worldY(y1), w: round2((x2 - x1) * TRANSFORM.scale), h: round2((y2 - y1) * TRANSFORM.scale) };
}

/** Axis-aligned wall/opening rect centered on a source segment. */
function segmentRect(x1: number, y1: number, x2: number, y2: number, thicknessWorld: number): Rect {
  if (y1 === y2) {
    return { x: worldX(Math.min(x1, x2)), y: round2(worldY(y1) - thicknessWorld / 2), w: round2(Math.abs(x2 - x1) * TRANSFORM.scale), h: round2(thicknessWorld) };
  }
  return { x: round2(worldX(x1) - thicknessWorld / 2), y: worldY(Math.min(y1, y2)), w: round2(thicknessWorld), h: round2(Math.abs(y2 - y1) * TRANSFORM.scale) };
}

/** Chair/seat rect centered on a source point, with a source pixel size. */
function pointRect(px: number, py: number, w: number, h: number): Rect {
  const width = round2(w * TRANSFORM.scale);
  const height = round2(h * TRANSFORM.scale);
  return { x: round2(worldX(px) - width / 2), y: round2(worldY(py) - height / 2), w: width, h: height };
}

// ---------------------------------------------------------------------------
// Final model constants
// ---------------------------------------------------------------------------

const WORLD_WALL = 6.25; // 5 source px * 1.25
const WORLD_PARTITION = 3.75; // 3 source px * 1.25
const OPENING_PAD = 4; // openings are a little taller/wider than the wall they cut
const COLUMN_COUNT = 3;
const GENG_SEAT_CHARS = ['Farkhan', 'Surya', 'Imam', 'Malla', 'Siska', 'Mona'] as const;
const GENG_SEAT_DIRECTIONS: Direction[] = ['down', 'down', 'up', 'up', 'right', 'left'];
const ACTOR = { halfWidth: 9, feet: 12 }; // 18 wide x 12 feet, world units
const FORBIDDEN = ['koridor servis', 'koridor bawah'];

// ---------------------------------------------------------------------------
// Source typing (only the fields this generator reads)
// ---------------------------------------------------------------------------

type SourceRoom = { id: string; name: string; kind?: string; x1: number; y1: number; x2: number; y2: number };
type SourceWall = { id?: string; type: string; x1: number; y1: number; x2: number; y2: number };
type SourceFurniture = {
  id: string;
  type: string;
  room: string;
  shape: string;
  rect?: { x1: number; y1: number; x2: number; y2: number };
  point?: { x: number; y: number };
  w?: number;
  h?: number;
  facing?: string;
};
type StructureV2 = {
  rooms: SourceRoom[];
  walls: SourceWall[];
  columns: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  lifts: Array<{ id: string; x1: number; y1: number; x2: number; y2: number; open: string }>;
  doors: Array<{ id: string; axis: string; x: number; y: number; len: number; locked?: boolean }>;
  gaps: Array<{ id: string; axis: string; x: number; y: number; len: number }>;
};
type FurnitureV1 = { roomBoundsOverride: Record<string, { x2: number }>; furniture: SourceFurniture[] };
type PantryV1 = {
  rooms: SourceRoom[];
  walls: SourceWall[];
  doors: Array<{ id: string; axis: string; x: number; y: number; len: number; locked?: boolean; swing: string; inward?: boolean }>;
  furniture: SourceFurniture[];
};
type WorkareasV4 = {
  overrides: { structure: Array<{ id: string; action: string; axis: string; y: number; x1: number; x2: number; type: string }> };
  board: { id: string; rect: { x1: number; y1: number; x2: number; y2: number }; structural: boolean; interactable: boolean };
  accessAisle: { actor: { w: number; h: number }; start: [number, number]; goal: [number, number] };
  rooms: SourceRoom[];
  walls: SourceWall[];
  furniture: SourceFurniture[];
};

type Sources = { structure: StructureV2; furniture: FurnitureV1; pantry: PantryV1; workareas: WorkareasV4 };

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function loadApprovedSources(dir: string = REVIEW_DIR): Sources {
  const errors: string[] = [];
  const read = <T>(spec: { file: string; sha256: string }, label: string): T => {
    const path = resolve(dir, spec.file);
    const actual = sha256File(path);
    if (actual !== spec.sha256) errors.push(`${label}: sha256 drift for ${spec.file} (want ${spec.sha256}, got ${actual})`);
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  };
  const structure = read<StructureV2>(APPROVED.structure, 'structure-v2');
  const furniture = read<FurnitureV1>(APPROVED.furniture, 'furniture-v1');
  const pantry = read<PantryV1>(APPROVED.pantry, 'pantry-focus-v1');
  const workareas = read<WorkareasV4>(APPROVED.workareas, 'workareas-focus-v4');
  if (errors.length) throw new Error(`approved source validation failed:\n - ${errors.join('\n - ')}`);
  return { structure, furniture, pantry, workareas };
}

// ---------------------------------------------------------------------------
// Zone specs (source pixels). New corridor zones cover the real open
// circulation only; no invented rooms.
// ---------------------------------------------------------------------------

type ZoneSpec = { id: string; name: string; kind: ZoneKind; surface: SurfaceKind; x1: number; y1: number; x2: number; y2: number; source: string; showLabel?: boolean };

const ZONE_SPECS: ZoneSpec[] = [
  { id: 'meeting-1', name: 'Ruang Meeting 1', kind: 'room', surface: 'office', x1: 407, y1: 41, x2: 550, y2: 189, source: 'structure-v2' },
  { id: 'hrga', name: 'Ruangan HRGA', kind: 'room', surface: 'office', x1: 550, y1: 41, x2: 691, y2: 189, source: 'structure-v2' },
  { id: 'komisaris', name: 'Bilik Komisaris', kind: 'room', surface: 'office', x1: 691, y1: 41, x2: 807, y2: 189, source: 'structure-v2' },
  { id: 'product-manager', name: 'Bilik Product Manager', kind: 'room', surface: 'office', x1: 807, y1: 41, x2: 923, y2: 189, source: 'structure-v2' },
  { id: 'it', name: 'Bilik IT', kind: 'room', surface: 'office', x1: 923, y1: 41, x2: 1038, y2: 189, source: 'structure-v2' },
  { id: 'direktur-finance', name: 'Bilik Direktur Finance', kind: 'room', surface: 'office', x1: 1038, y1: 41, x2: 1156, y2: 189, source: 'structure-v2' },
  { id: 'bilik-geng-kami', name: 'Bilik Geng Kami', kind: 'room', surface: 'office', x1: 1156, y1: 41, x2: 1465, y2: 189, source: 'furniture-v1 roomBoundsOverride' },
  { id: 'resepsionis', name: 'Resepsionis', kind: 'room', surface: 'office', x1: 270, y1: 189, x2: 407, y2: 322, source: 'structure-v2' },
  { id: 'lobby-besar', name: 'Lobby Besar', kind: 'lobby', surface: 'lobby', x1: 103, y1: 322, x2: 407, y2: 761, source: 'structure-v2' },
  { id: 'lorong-utama', name: 'Lorong Utama', kind: 'corridor', surface: 'corridor', x1: 407, y1: 189, x2: 1465, y2: 244, source: 'open main circulation (structure-v2 strip below the top row)' },
  // Transit zones carry a name for semantics/zoneAt but are not painted: the
  // approved source leaves this circulation unlabelled.
  { id: 'sirkulasi', name: 'Sirkulasi', kind: 'corridor', surface: 'corridor', x1: 407, y1: 244, x2: 512, y2: 322, source: 'pantry-focus-v1 sirkulasi', showLabel: false },
  { id: 'jalur-terbuka', name: 'Jalur Terbuka', kind: 'corridor', surface: 'corridor', x1: 512, y1: 244, x2: 554, y2: 476, source: 'pantry-focus-v1 jalur-terbuka', showLabel: false },
  { id: 'pantry', name: 'Pantry', kind: 'open', surface: 'service', x1: 407, y1: 322, x2: 512, y2: 389, source: 'pantry-focus-v1 (back wall stops at x=512)' },
  { id: 'gudang', name: 'Gudang', kind: 'service', surface: 'service', x1: 407, y1: 389, x2: 468, y2: 501, source: 'structure-v2' },
  { id: 'toilet-wanita', name: 'Toilet Wanita', kind: 'service', surface: 'service', x1: 468, y1: 424, x2: 512, y2: 501, source: 'structure-v2' },
  // Wastafel keeps its name for semantics but is not painted: its tiny cell
  // makes a 16px label spill over the two neighbouring toilet labels.
  { id: 'wastafel', name: 'Wastafel', kind: 'open', surface: 'service', x1: 512, y1: 476, x2: 554, y2: 501, source: 'pantry-focus-v1', showLabel: false },
  { id: 'toilet-pria', name: 'Toilet Pria', kind: 'service', surface: 'service', x1: 554, y1: 415, x2: 591, y2: 501, source: 'structure-v2' },
  { id: 'meeting-2', name: 'Ruang Meeting 2', kind: 'room', surface: 'office', x1: 554, y1: 243, x2: 695, y2: 381, source: 'structure-v2' },
  { id: 'server', name: 'Ruang Server', kind: 'service', surface: 'service', x1: 591, y1: 381, x2: 695, y2: 501, source: 'structure-v2' },
  { id: 'desk-collection', name: 'Desk Collection', kind: 'open', surface: 'office', x1: 695, y1: 244, x2: 1156, y2: 501, source: 'workareas-focus-v4' },
  { id: 'tele-cs-ca', name: 'Tele / CS / CA', kind: 'open', surface: 'office', x1: 1156, y1: 244, x2: 1465, y2: 501, source: 'workareas-focus-v4' },
];

// ---------------------------------------------------------------------------
// Final wall specs (source segments). OV-TOP-OPEN and the pantry corrections
// are baked into this list; validateWalls asserts they are approved sub-segments.
// ---------------------------------------------------------------------------

type WallSpec = { id: string; kind: 'full' | 'partition'; x1: number; y1: number; x2: number; y2: number };

const WALL_SPECS: WallSpec[] = [
  { id: 'w-top-left', kind: 'full', x1: 407, y1: 41, x2: 691, y2: 41 },
  { id: 'w-toprow-bottom', kind: 'full', x1: 269, y1: 189, x2: 691, y2: 189 },
  { id: 'w-toprow-partition', kind: 'partition', x1: 691, y1: 189, x2: 1388, y2: 189 },
  { id: 'w-toprow-right', kind: 'full', x1: 1388, y1: 189, x2: 1465, y2: 189 },
  { id: 'w-m1-left', kind: 'full', x1: 407, y1: 41, x2: 407, y2: 189 },
  { id: 'w-m1-hrga', kind: 'full', x1: 550, y1: 41, x2: 550, y2: 189 },
  { id: 'w-hrga-komisaris', kind: 'partition', x1: 691, y1: 41, x2: 691, y2: 189 },
  { id: 'w-komisaris-pm', kind: 'partition', x1: 807, y1: 41, x2: 807, y2: 189 },
  { id: 'w-pm-it', kind: 'partition', x1: 923, y1: 41, x2: 923, y2: 189 },
  { id: 'w-it-finance', kind: 'partition', x1: 1038, y1: 41, x2: 1038, y2: 189 },
  { id: 'w-finance-geng', kind: 'partition', x1: 1156, y1: 41, x2: 1156, y2: 189 },
  { id: 'w-recep-left', kind: 'full', x1: 270, y1: 189, x2: 270, y2: 322 },
  { id: 'w-recep-right', kind: 'full', x1: 407, y1: 189, x2: 407, y2: 322 },
  { id: 'w-lobby-top', kind: 'full', x1: 270, y1: 322, x2: 407, y2: 322 },
  { id: 'w-lobby-left', kind: 'full', x1: 103, y1: 322, x2: 103, y2: 761 },
  { id: 'w-lobby-bottom', kind: 'full', x1: 103, y1: 761, x2: 407, y2: 761 },
  { id: 'w-lobby-right', kind: 'full', x1: 407, y1: 322, x2: 407, y2: 761 },
  { id: 'w-pantry-top', kind: 'full', x1: 407, y1: 322, x2: 512, y2: 322 },
  { id: 'w-gudang-top', kind: 'full', x1: 407, y1: 389, x2: 512, y2: 389 },
  { id: 'w-service-bottom', kind: 'full', x1: 407, y1: 501, x2: 591, y2: 501 },
  { id: 'w-tw-left', kind: 'full', x1: 468, y1: 424, x2: 468, y2: 501 },
  { id: 'w-tw-top', kind: 'full', x1: 468, y1: 424, x2: 512, y2: 424 },
  { id: 'w-strip-left', kind: 'full', x1: 512, y1: 389, x2: 512, y2: 501 },
  { id: 'w-wastafel-top', kind: 'full', x1: 512, y1: 476, x2: 554, y2: 476 },
  { id: 'w-strip-right', kind: 'full', x1: 554, y1: 415, x2: 554, y2: 501 },
  { id: 'w-tp-top', kind: 'full', x1: 554, y1: 415, x2: 591, y2: 415 },
  { id: 'w-server-left', kind: 'full', x1: 591, y1: 381, x2: 591, y2: 501 },
  { id: 'w-m2-west', kind: 'full', x1: 554, y1: 243, x2: 554, y2: 381 },
  { id: 'w-m2-top', kind: 'full', x1: 554, y1: 243, x2: 695, y2: 243 },
  { id: 'w-m2-bottom', kind: 'full', x1: 554, y1: 381, x2: 695, y2: 381 },
  { id: 'w-m2-east', kind: 'full', x1: 695, y1: 243, x2: 695, y2: 501 },
  { id: 'w-dc-top-a', kind: 'partition', x1: 695, y1: 244, x2: 704, y2: 244 },
  { id: 'w-dc-top-b', kind: 'partition', x1: 728, y1: 244, x2: 1156, y2: 244 },
  { id: 'w-desk-tele', kind: 'partition', x1: 1156, y1: 244, x2: 1156, y2: 501 },
  { id: 'w-lower-bottom', kind: 'partition', x1: 695, y1: 501, x2: 1465, y2: 501 },
];

// ---------------------------------------------------------------------------
// Openings (doors + doorless gaps). Keep the approved door geometry; C6 follows
// workareas v4 (704..728) and the Wastafel entrance connects the open strip.
// ---------------------------------------------------------------------------

type OpeningSpec = { id: string; axis: 'h' | 'v'; x: number; y: number; len: number; note: string };

const OPENING_SPECS: OpeningSpec[] = [
  { id: 'op-meeting-1', axis: 'h', x: 442, y: 189, len: 46, note: 'D1 Meeting 1' },
  { id: 'op-hrga', axis: 'h', x: 616, y: 189, len: 46, note: 'D2 HRGA' },
  { id: 'op-recep-corridor', axis: 'v', x: 407, y: 212, len: 32, note: 'D3 Reception east door (end of main circulation)' },
  { id: 'op-recep-lobby', axis: 'h', x: 338, y: 322, len: 76, note: 'D4 Reception -> Lobby double door' },
  { id: 'op-meeting-2', axis: 'h', x: 584, y: 243, len: 40, note: 'D5 Meeting 2' },
  { id: 'op-server', axis: 'v', x: 695, y: 448, len: 36, note: 'D6 Server (restricted, approach walkable)' },
  { id: 'op-gudang', axis: 'h', x: 437, y: 389, len: 30, note: 'D7 Gudang (locked)' },
  { id: 'op-toilet-wanita', axis: 'v', x: 512, y: 442, len: 36, note: 'D8 Toilet Wanita east/upper, inward' },
  { id: 'op-toilet-pria', axis: 'v', x: 554, y: 433.5, len: 37, note: 'D9 Toilet Pria west/upper, inward' },
  // C1/C2 are "celah" whose exact centre/width the structure notes call
  // approximate. The approved Komisaris/Product desks sit flush on the bottom
  // wall exactly where the structural centre sat (x738 / x862), which would seal
  // both rooms behind a solid desk. The gaps are moved onto the clear segment of
  // the same bottom partition so the approved rooms stay enterable.
  { id: 'op-komisaris', axis: 'h', x: 785, y: 189, len: 30, note: 'C1 (approximate celah moved clear of the approved desk)' },
  { id: 'op-product-manager', axis: 'h', x: 828, y: 189, len: 30, note: 'C2 (approximate celah moved clear of the approved desk)' },
  { id: 'op-it', axis: 'h', x: 1020, y: 189, len: 26, note: 'C3' },
  { id: 'op-direktur-finance', axis: 'h', x: 1062, y: 189, len: 26, note: 'C4' },
  { id: 'op-geng-kami', axis: 'h', x: 1180, y: 189, len: 26, note: 'C5' },
  { id: 'op-desk-collection', axis: 'h', x: 716, y: 244, len: 24, note: 'C6 Desk Collection top (workareas v4: 704..728, the 716/24 door centers there)' },
  { id: 'op-wastafel', axis: 'h', x: 533, y: 476, len: 26, note: 'open wash strip -> Wastafel cell (cuts the horizontal W-WASTAFEL-TOP wall)' },
];

// ---------------------------------------------------------------------------
// Void / sealed blocks
// ---------------------------------------------------------------------------

function buildVoidBlocks(): Block[] {
  const specs: Array<[string, Rect]> = [
    ['blk-void-top', { x: 0, y: 0, w: 1920, h: 40 }],
    ['blk-void-left', { x: 0, y: 0, w: 60, h: 960 }],
    ['blk-void-right', { x: 1836.25, y: 0, w: 83.75, h: 960 }],
    ['blk-void-bottom', { x: 0, y: 940, w: 1920, h: 20 }],
    ['blk-void-notch', { x: 60, y: 40, w: 453.75, h: 185 }],
    ['blk-void-left-recep', { x: 60, y: 225, w: 282.5, h: 166.25 }],
    ['blk-void-left-bank', { x: 60, y: 391.25, w: 73.75, h: 548.75 }],
    ['blk-void-below-core', { x: 513.75, y: 615, w: 360, h: 325 }],
    ['blk-void-below-desk', { x: 873.75, y: 615, w: 962.5, h: 325 }],
  ];
  return specs.map(([id, rect]) => ({ id, kind: 'void' as const, name: '', rect }));
}

function buildSealedBlocks(): Block[] {
  const specs: Array<[string, string, number, number, number, number]> = [
    ['blk-gudang', 'Gudang', 407, 389, 468, 501],
    ['blk-toilet-wanita', 'Toilet Wanita', 468, 424, 512, 501],
    ['blk-toilet-pria', 'Toilet Pria', 554, 415, 591, 501],
    ['blk-server', 'Ruang Server', 591, 381, 695, 501],
  ];
  const locked = specs.map(([id, name, x1, y1, x2, y2]) => ({ id, kind: 'sealed' as const, name, rect: rectOf(x1, y1, x2, y2) }));
  const liftRects: Array<[number, number, number, number]> = [
    [44, 508, 103, 592],
    [44, 647, 103, 729],
    [407, 508, 464, 592],
    [407, 647, 464, 729],
  ];
  const lifts = liftRects.map(([x1, y1, x2, y2], index) => ({
    id: `blk-lift-${index + 1}`,
    kind: 'sealed' as const,
    name: `Lift ${index + 1}`,
    rect: rectOf(x1, y1, x2, y2),
  }));
  return [...locked, ...lifts];
}

// ---------------------------------------------------------------------------
// Furniture derivation (approved data only)
// ---------------------------------------------------------------------------

const KIND_BY_TYPE: Record<string, FurnitureKind> = {
  table: 'table',
  chair: 'chair',
  desk: 'desk',
  cabinet: 'cabinet',
  dispenser: 'dispenser',
  bank: 'desk',
  counter: 'counter',
  seat: 'sofa',
  board: 'board',
  fridge: 'fridge',
};

const ZONE_ALIAS: Record<string, string> = {
  'geng-kami': 'bilik-geng-kami',
  'corridor-side': 'lorong-utama',
};

const NON_SOLID = new Set(['chair', 'seat', 'board']);

function toFurniture(item: SourceFurniture): Furniture {
  const kind = KIND_BY_TYPE[item.type];
  if (!kind) throw new Error(`unknown approved furniture type "${item.type}" (${item.id})`);
  const zone = ZONE_ALIAS[item.room] ?? item.room;
  const rect = item.shape === 'rect' && item.rect ? rectOf(item.rect.x1, item.rect.y1, item.rect.x2, item.rect.y2) : pointRect(item.point!.x, item.point!.y, item.w!, item.h!);
  return { id: item.id, kind, solid: !NON_SOLID.has(item.type), zone, rect };
}

function buildFurniture(sources: Sources): Furniture[] {
  const supersededV1Rooms = new Set(['desk-collection', 'tele-cs-ca', 'pantry', 'meeting-2']);
  const fromV1 = sources.furniture.furniture.filter((item) => !supersededV1Rooms.has(item.room));
  const all = [...fromV1, ...sources.pantry.furniture, ...sources.workareas.furniture];
  const furniture = all.map(toFurniture);
  const seen = new Set<string>();
  for (const item of furniture) {
    if (seen.has(item.id)) throw new Error(`duplicate furniture id from approved sources: ${item.id}`);
    seen.add(item.id);
  }
  return furniture;
}

// ---------------------------------------------------------------------------

export function buildApprovedManifest(sources: Sources): OfficeManifest {
  const zones: Zone[] = ZONE_SPECS.map((spec) => {
    const zone: Zone = { id: spec.id, name: spec.name, kind: spec.kind, rect: rectOf(spec.x1, spec.y1, spec.x2, spec.y2) };
    if (spec.showLabel === false) zone.showLabel = false;
    return zone;
  });
  const surfaces: Surface[] = ZONE_SPECS.map((spec) => ({ zone: spec.id, kind: spec.surface }));
  surfaces.push({ zone: 'lobby-besar', kind: 'rug', rect: rectOf(150, 620, 360, 730) });

  const walls: Wall[] = WALL_SPECS.map((spec) => ({ id: spec.id, kind: spec.kind, rect: segmentRect(spec.x1, spec.y1, spec.x2, spec.y2, spec.kind === 'full' ? WORLD_WALL : WORLD_PARTITION) }));
  const columns: Column[] = [
    { id: 'col-meeting-1', rect: rectOf(407, 55, 435, 96) },
    { id: 'col-komisaris', rect: rectOf(789, 72, 832, 113) },
    { id: 'col-geng-1', rect: rectOf(1334, 54, 1382, 100) },
  ];
  const blocks: Block[] = [...buildVoidBlocks(), ...buildSealedBlocks()];

  const openings: Opening[] = OPENING_SPECS.map((spec) => {
    const thickness = spec.axis === 'h' ? WORLD_WALL : WORLD_WALL;
    if (spec.axis === 'h') {
      const half = (thickness + OPENING_PAD) / 2;
      return { id: spec.id, orientation: 'horizontal', rect: { x: worldX(spec.x - spec.len / 2), y: round2(worldY(spec.y) - half), w: round2(spec.len * TRANSFORM.scale), h: round2(thickness + OPENING_PAD) } };
    }
    const half = (thickness + OPENING_PAD) / 2;
    return { id: spec.id, orientation: 'vertical', rect: { x: round2(worldX(spec.x) - half), y: worldY(spec.y - spec.len / 2), w: round2(thickness + OPENING_PAD), h: round2(spec.len * TRANSFORM.scale) } };
  });

  const windows: WindowRect[] = [
    { id: 'win-top', side: 'top', rect: segmentRect(691, 41, 1360, 41, 2.5) },
    { id: 'win-chamfer', side: 'top', rect: segmentRect(1360, 41, 1465, 41, 2.5) },
    { id: 'win-right', side: 'right', rect: segmentRect(1465, 146, 1465, 501, 2.5) },
  ];

  const furniture = buildFurniture(sources);
  const byId = new Map(furniture.map((item) => [item.id, item]));
  const rectById = (id: string): Rect => {
    const item = byId.get(id) ?? blocks.find((block) => block.id === id);
    if (!item) throw new Error(`missing approved geometry ${id}`);
    return item.rect;
  };

  const seats: Seat[] = GENG_SEAT_CHARS.map((character, index) => {
    const chair = rectById(`F-GENG-C${index + 1}`);
    return {
      id: `seat-${index + 1}`,
      cid: index + 1,
      character,
      x: round2(chair.x + chair.w / 2),
      y: round2(chair.y + chair.h / 2),
      direction: GENG_SEAT_DIRECTIONS[index]!,
      zone: 'bilik-geng-kami',
    };
  });

  const hotspots: Hotspot[] = [];
  for (const seat of seats) {
    hotspots.push({ id: `hs-seat-${seat.cid}`, kind: 'seat', name: `Kursi ${seat.character}`, zone: 'bilik-geng-kami', action: 'sit', cid: seat.cid, rect: rectById(`F-GENG-C${seat.cid}`) });
  }
  for (let i = 1; i <= 4; i += 1) {
    hotspots.push({ id: `hs-lift-${i}`, kind: 'lift', name: `Lift ${i}`, zone: 'lobby-besar', action: 'message', message: 'Lift/transisi belum aktif di preview.', rect: rectById(`blk-lift-${i}`) });
  }
  hotspots.push({ id: 'hs-gudang', kind: 'gudang', name: 'Gudang', zone: 'gudang', action: 'message', message: 'Gudang terkunci.', rect: openings.find((entry) => entry.id === 'op-gudang')!.rect });
  hotspots.push({ id: 'hs-fridge', kind: 'fridge', name: 'Kulkas', zone: 'pantry', action: 'message', message: 'Kulkas: ambil minum dingin.', rect: rectById('F-PS-PANTRY-FRIDGE') });
  hotspots.push({ id: 'hs-dispenser-pantry', kind: 'dispenser', name: 'Dispenser Pantry', zone: 'pantry', action: 'message', message: 'Dispenser: isi air minum.', rect: rectById('F-PS-PANTRY-DISPENSER') });
  hotspots.push({ id: 'hs-dispenser-hrga', kind: 'dispenser', name: 'Dispenser HRGA', zone: 'hrga', action: 'message', message: 'Dispenser: isi air minum.', rect: rectById('F-HRGA-DISPENSER') });
  hotspots.push({ id: 'hs-dispenser-it', kind: 'dispenser', name: 'Dispenser IT', zone: 'lorong-utama', action: 'message', message: 'Dispenser koridor: isi air minum.', rect: rectById('F-IT-DISPENSER') });
  hotspots.push({ id: 'hs-dispenser-finance', kind: 'dispenser', name: 'Dispenser Finance', zone: 'lorong-utama', action: 'message', message: 'Dispenser koridor: isi air minum.', rect: rectById('F-FIN-DISPENSER') });
  hotspots.push({ id: 'hs-board', kind: 'board', name: 'Best Agent Performance', zone: 'desk-collection', action: 'message', message: 'Papan Best Agent Performance.', rect: rectById('F-WA-BOARD-BAP') });
  hotspots.push({ id: 'hs-cert-table', kind: 'certificate-table', name: 'Meja Sertifikat', zone: 'sirkulasi', action: 'message', message: 'Meja sertifikat.', rect: rectById('F-PS-CERT-TABLE') });
  hotspots.push({ id: 'hs-server', kind: 'server', name: 'Ruang Server', zone: 'server', action: 'message', message: 'Ruang server terbatas. Hanya tim IT.', rect: openings.find((entry) => entry.id === 'op-server')!.rect });
  hotspots.push({ id: 'hs-reception', kind: 'reception', name: 'Resepsionis', zone: 'resepsionis', action: 'message', message: 'Resepsionis: selamat datang di kantor.', rect: rectById('F-REC-COUNTER') });
  hotspots.push({ id: 'hs-exit', kind: 'exit', name: 'Pintu Keluar', zone: 'lobby-besar', action: 'status-pulang', message: 'Kamu pulang. Sampai jumpa!', rect: rectOf(230, 720, 300, 755) });

  return {
    id: 'homebase-office',
    name: 'Nongkrong Kantor - Blugreen Lt. 6',
    width: TRANSFORM.world.width,
    height: TRANSFORM.world.height,
    margin: 40,
    wallThickness: WORLD_WALL,
    partitionThickness: WORLD_PARTITION,
    actor: { ...ACTOR },
    spawn: { x: seats[0]!.x, y: seats[0]!.y, direction: seats[0]!.direction },
    seats,
    zones,
    walls,
    columns,
    blocks,
    furniture,
    openings,
    windows,
    surfaces,
    hotspots,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isSubSegment(candidate: SourceWall, source: SourceWall): boolean {
  if (candidate.type !== source.type) return false;
  const candidateH = candidate.y1 === candidate.y2;
  const sourceH = source.y1 === source.y2;
  if (candidateH !== sourceH) return false;
  if (candidateH) {
    if (candidate.y1 !== source.y1) return false;
    const c = [Math.min(candidate.x1, candidate.x2), Math.max(candidate.x1, candidate.x2)];
    const s = [Math.min(source.x1, source.x2), Math.max(source.x1, source.x2)];
    return c[0]! >= s[0]! - 1e-9 && c[1]! <= s[1]! + 1e-9;
  }
  if (candidate.x1 !== source.x1) return false;
  const c = [Math.min(candidate.y1, candidate.y2), Math.max(candidate.y1, candidate.y2)];
  const s = [Math.min(source.y1, source.y2), Math.max(source.y1, source.y2)];
  return c[0]! >= s[0]! - 1e-9 && c[1]! <= s[1]! + 1e-9;
}

function walkableAt(manifest: OfficeManifest, x: number, y: number): boolean {
  const box = { x: x - manifest.actor.halfWidth, y: y - manifest.actor.feet, w: manifest.actor.halfWidth * 2, h: manifest.actor.feet };
  if (box.x < 0 || box.y < 0 || box.x + box.w > manifest.width || box.y + box.h > manifest.height) return false;
  const colliders: Rect[] = [];
  for (const wall of manifest.walls) colliders.push(wall.rect);
  for (const column of manifest.columns) colliders.push(column.rect);
  for (const block of manifest.blocks) colliders.push(block.rect);
  for (const item of manifest.furniture) if (item.solid) colliders.push(item.rect);
  for (const collider of colliders) {
    const ox = Math.max(box.x, collider.x);
    const oy = Math.max(box.y, collider.y);
    const ox2 = Math.min(box.x + box.w, collider.x + collider.w);
    const oy2 = Math.min(box.y + box.h, collider.y + collider.h);
    if (ox2 <= ox || oy2 <= oy) continue;
    const covered = manifest.openings.some((opening) => opening.rect.x <= ox && opening.rect.y <= oy && opening.rect.x + opening.rect.w >= ox2 && opening.rect.y + opening.rect.h >= oy2);
    if (!covered) return false;
  }
  return true;
}

function zoneWise(furniture: Furniture[]): Map<string, Map<FurnitureKind, number>> {
  const out = new Map<string, Map<FurnitureKind, number>>();
  for (const item of furniture) {
    const inner = out.get(item.zone) ?? new Map<FurnitureKind, number>();
    inner.set(item.kind, (inner.get(item.kind) ?? 0) + 1);
    out.set(item.zone, inner);
  }
  return out;
}

const EXPECTED_COUNTS: Record<string, Partial<Record<FurnitureKind, number>>> = {
  'meeting-1': { table: 1, chair: 6 },
  hrga: { desk: 2, chair: 4, cabinet: 1, dispenser: 1 },
  komisaris: { desk: 1, chair: 1 },
  'product-manager': { desk: 1, chair: 1 },
  it: { desk: 2, chair: 2 },
  'direktur-finance': { desk: 2, counter: 1, chair: 2 },
  'bilik-geng-kami': { desk: 2, chair: 6, cabinet: 1 },
  resepsionis: { counter: 1, chair: 1, sofa: 4 },
  pantry: { counter: 1, dispenser: 1, fridge: 1 },
  'meeting-2': { table: 2, chair: 6 },
  sirkulasi: { table: 2, chair: 2 },
  'desk-collection': { desk: 2, chair: 34, board: 1 },
  'tele-cs-ca': { desk: 2, chair: 24 },
  'lorong-utama': { dispenser: 2 },
};

export function validateApprovedManifest(manifest: OfficeManifest, sources: Sources): void {
  const errors: string[] = [];

  // 1. Approved overrides present in the sources.
  const pantryTop = sources.pantry.walls.find((wall) => wall.id === 'W-PANTRY-TOP');
  if (!pantryTop || pantryTop.x2 !== 512) errors.push('pantry-focus v1 must keep the pantry back wall stopped at x=512');
  const ov = sources.workareas.overrides.structure.find((entry) => entry.id === 'OV-TOP-OPEN');
  if (!ov || ov.y !== 244 || ov.x1 !== 1156 || ov.x2 !== 1465) errors.push('workareas v4 OV-TOP-OPEN must omit x1156..1465 at y=244');
  const board = sources.workareas.board;
  if (board.structural !== false || board.interactable !== true || board.rect.x1 !== 697 || board.rect.x2 !== 704) {
    errors.push('workareas v4 board must be slim (x697..704) non-structural interactable furniture');
  }
  const aisle = sources.workareas.accessAisle;
  if (aisle.actor.w !== ACTOR.halfWidth * 2 || aisle.actor.h !== ACTOR.feet) errors.push('workareas v4 access aisle must use the real 18x12 actor footprint');

  // 2. Every final wall is an approved sub-segment.
  const approvedWalls: SourceWall[] = [
    ...sources.structure.walls,
    ...sources.pantry.walls.map((wall) => ({ ...wall, type: wall.type })),
    ...sources.workareas.walls,
  ];
  for (const spec of WALL_SPECS) {
    const candidate: SourceWall = { id: spec.id, type: spec.kind, x1: spec.x1, y1: spec.y1, x2: spec.x2, y2: spec.y2 };
    if (!approvedWalls.some((source) => isSubSegment(candidate, source))) errors.push(`wall ${spec.id} is not an approved source sub-segment`);
  }

  // 3. Forbidden zone/label names.
  const named: Array<{ id: string; name: string }> = [...manifest.zones, ...manifest.blocks, ...manifest.furniture.map((item) => ({ id: item.id, name: item.id }))];
  for (const entry of named) {
    const haystack = `${entry.id} ${entry.name}`.toLowerCase();
    for (const forbidden of FORBIDDEN) if (haystack.includes(forbidden)) errors.push(`forbidden name "${forbidden}" in ${entry.id}`);
  }

  // 4. Exactly three structural columns.
  if (manifest.columns.length !== COLUMN_COUNT) errors.push(`expected ${COLUMN_COUNT} columns, got ${manifest.columns.length}`);

  // 5. Open Tele/CS/CA top: no horizontal wall runs east of the x=1156 separator at y=244.
  const seamY = worldY(244);
  const separatorX = worldX(1156);
  for (const wall of manifest.walls) {
    const horizontal = wall.rect.w > wall.rect.h;
    const onSeam = wall.rect.y <= seamY && wall.rect.y + wall.rect.h >= seamY;
    if (horizontal && onSeam && wall.rect.x + wall.rect.w > separatorX + 1e-6) {
      errors.push(`wall ${wall.id} crosses the open Tele/CS/CA top span (x1156..1465 at y=244)`);
    }
  }
  for (const sample of [1180, 1300, 1440]) {
    if (!walkableAt(manifest, worldX(sample), worldY(270))) errors.push(`Tele/CS/CA top is not open at source x=${sample}`);
  }

  // 6. Open vertical path above the Wastafel to the main circulation.
  for (let sourceY = 232; sourceY <= 472; sourceY += 20) {
    if (!walkableAt(manifest, worldX(537), worldY(sourceY))) errors.push(`Wastafel north path blocked at source y=${sourceY}`);
  }

  // 7. No fake lower extension for Desk Collection / Tele.
  for (const id of ['desk-collection', 'tele-cs-ca']) {
    const zone = manifest.zones.find((entry) => entry.id === id)!;
    if (zone.rect.y + zone.rect.h > worldY(501) + 1e-6) errors.push(`${id} extends below the approved service block`);
  }

  // 8. Six Bilik Geng Kami seats mapped to the six approved chairs.
  if (manifest.seats.length !== 6) errors.push(`expected 6 seats, got ${manifest.seats.length}`);
  const cids = manifest.seats.map((seat) => seat.cid).sort((a, b) => a - b);
  if (JSON.stringify(cids) !== JSON.stringify([1, 2, 3, 4, 5, 6])) errors.push('seat cids must be exactly 1..6');
  for (let i = 1; i <= 6; i += 1) {
    const to = manifest.furniture.find((item) => item.id === `F-GENG-C${i}`);
    const seat = manifest.seats.find((entry) => entry.cid === i);
    if (!to || !seat) {
      errors.push(`missing seat/chair ${i}`);
      continue;
    }
    const cx = round2(to.rect.x + to.rect.w / 2);
    const cy = round2(to.rect.y + to.rect.h / 2);
    if (seat.x !== cx || seat.y !== cy) errors.push(`seat-${i} is not at approved chair f-geng-chair-${i}`);
    if (seat.zone !== 'bilik-geng-kami') errors.push(`seat-${i} must be inside Bilik Geng Kami`);
  }

  // 9. Exactly the approved furniture counts per zone.
  const counts = zoneWise(manifest.furniture);
  for (const [zone, expected] of Object.entries(EXPECTED_COUNTS)) {
    const got = counts.get(zone) ?? new Map<FurnitureKind, number>();
    for (const [kind, want] of Object.entries(expected)) {
      const have = got.get(kind as FurnitureKind) ?? 0;
      if (have !== want) errors.push(`${zone} ${kind}: expected ${want}, got ${have}`);
    }
    for (const [kind, have] of got) {
      if (!(kind in expected) && have > 0) errors.push(`${zone} has unexpected ${kind} x${have}`);
    }
  }
  const dcChairs = manifest.furniture.filter((item) => item.zone === 'desk-collection' && item.kind === 'chair').length;
  const tcChairs = manifest.furniture.filter((item) => item.zone === 'tele-cs-ca' && item.kind === 'chair').length;
  if (dcChairs !== 34) errors.push(`Desk Collection visible chairs: expected 34, got ${dcChairs}`);
  if (tcChairs !== 24) errors.push(`Tele/CS/CA visible chairs: expected 24, got ${tcChairs}`);

  // 10. Board: slim, non-solid, with a hotspot; no invented Meeting-2 screen.
  const boardItem = manifest.furniture.find((item) => item.id === 'F-WA-BOARD-BAP');
  if (!boardItem || boardItem.kind !== 'board' || boardItem.solid !== false) errors.push('the Best Agent board must exist as non-solid board furniture');
  if (!manifest.hotspots.some((hotspot) => hotspot.id === 'hs-board')) errors.push('the Best Agent board needs a hotspot');
  if (manifest.hotspots.some((hotspot) => hotspot.id === 'hs-screen-meeting-2')) errors.push('Meeting 2 must not have an invented screen hotspot');
  if (manifest.furniture.some((item) => item.zone === 'meeting-2' && item.kind === 'screen')) errors.push('Meeting 2 must not have an invented screen');

  // 11. Six seats walkable + spawn walkable (also enforced by validateManifest).
  for (const seat of manifest.seats) if (!walkableAt(manifest, seat.x, seat.y)) errors.push(`seat ${seat.id} is not walkable`);

  if (errors.length) throw new Error(`approved manifest validation failed:\n - ${errors.join('\n - ')}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main(): void {
  const sources = loadApprovedSources();
  const manifest = buildApprovedManifest(sources);
  validateManifest(manifest);
  validateApprovedManifest(manifest, sources);

  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(OUT_PATH, json);
  const hash = createHash('sha256').update(json).digest('hex');
  const furnitureTotal = manifest.furniture.length;
  const chairTotal = manifest.furniture.filter((item) => item.kind === 'chair').length;
  console.log(`wrote ${OUT_PATH}`);
  console.log(`zones ${manifest.zones.length} walls ${manifest.walls.length} columns ${manifest.columns.length} blocks ${manifest.blocks.length} furniture ${furnitureTotal} (chairs ${chairTotal}) openings ${manifest.openings.length} windows ${manifest.windows.length} hotspots ${manifest.hotspots.length} seats ${manifest.seats.length}`);
  console.log(`bytes ${Buffer.byteLength(json)} sha256 ${hash}`);
}

const invokedDirectly = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (invokedDirectly) main();
