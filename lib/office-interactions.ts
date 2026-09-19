// Deterministic, DOM-free office interaction state machine.
//
// app/page.tsx owns one InteractionState for the local actor and commits every
// E/X keypress — and the on-screen action tap, which runs the same commit —
// through here. Nothing in this module touches React, the DOM or the network:
// it resolves the actor's surroundings into one contextual Intent by a fixed
// priority, then folds that intent into the next state. Sit/stand, the held
// drink, the fridge and the wall doors therefore stay testable on the stock Node
// type-stripping toolchain, exactly like the pointer helpers in
// lib/office-interaction.ts.

import {
  DEFAULT_HOTSPOT_RANGE,
  actorFootBox,
  intersectRect,
  isBlocked,
  seatFor,
  type ActorFootprint,
  type Direction,
  type Hotspot,
  type OfficeManifest,
  type Opening,
  type Rect,
  type Seat,
} from './office-map.ts';

/** The acting character, in the same shape the pointer helpers use. */
export type InteractionActor = { cid: number; x: number; y: number };

export type InteractionState = {
  /** True while the actor is anchored on a seat. Movement clears it. */
  sitting: boolean;
  /** The seat id the actor sat on, or null when standing. */
  seatId: string | null;
  /** Simple held-drink flag, set at a dispenser or an open fridge. */
  holdingDrink: boolean;
  /** Fridge hotspot ids the actor left open. */
  openFridgeIds: readonly string[];
  /** Opening ids the actor closed; each closed door is a collision rectangle. */
  closedDoorIds: readonly string[];
};

export const INITIAL_INTERACTION_STATE: InteractionState = {
  sitting: false,
  seatId: null,
  holdingDrink: false,
  openFridgeIds: [],
  closedDoorIds: [],
};

export type InteractionAction =
  | 'none'
  | 'sit'
  | 'stand'
  | 'drink'
  | 'open-fridge'
  | 'close-fridge'
  | 'open-door'
  | 'close-door'
  | 'door-blocked'
  | 'message'
  | 'pulang';

export type SeatPlacement = { seatId: string; x: number; y: number; direction: Direction };

export type InteractionResult = {
  action: InteractionAction;
  hint: string;
  announce: string;
  /** Present for `sit`: the feet-anchored seat placement to apply. */
  seat?: SeatPlacement;
  /** The hotspot/opening id the action touched. */
  targetId?: string;
};

/** What E (or the shared action button) would do right now, without committing. */
export type InteractionDescription = { action: InteractionAction; label: string; hint: string };

export type InteractionVisual =
  | { kind: 'open-fridge'; id: string; rect: Rect }
  | { kind: 'closed-door'; id: string; rect: Rect; orientation: Opening['orientation'] };

// The action-button label per resolved action. Because the button and the E key
// run the same commit, the label always names exactly what E will do.
const ACTION_LABELS: Record<InteractionAction, string> = {
  none: 'Interaksi',
  sit: 'Duduk',
  stand: 'Berdiri',
  drink: 'Ambil minum',
  'open-fridge': 'Buka kulkas',
  'close-fridge': 'Tutup kulkas',
  'open-door': 'Buka pintu',
  'close-door': 'Tutup pintu',
  'door-blocked': 'Pintu terhalang',
  message: 'Periksa',
  pulang: 'Pulang',
};

type Intent =
  | { kind: 'none' }
  | { kind: 'stand' }
  | { kind: 'sit'; seat: Seat }
  | { kind: 'drink'; source: 'fridge' | 'dispenser'; targetId: string; name: string }
  | { kind: 'open-fridge'; targetId: string; name: string }
  | { kind: 'close-fridge'; targetId: string; name: string }
  | { kind: 'open-door'; targetId: string }
  | { kind: 'close-door'; targetId: string }
  | { kind: 'door-blocked'; targetId: string }
  | { kind: 'message'; message: string }
  | { kind: 'pulang'; message: string };

function distanceToRect(x: number, y: number, rect: Rect): number {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.w));
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.h));
  return Math.hypot(dx, dy);
}

// A surrounding object within interaction range, tagged with its family rank.
// Proximity decides first; the rank only breaks an exact distance tie, so a
// closer real object is never overridden by a farther higher-ranked one.
type Candidate =
  | { rank: 3; distance: number; kind: 'seat'; seat: Seat }
  | { rank: 2; distance: number; kind: 'source'; hotspot: Hotspot }
  | { rank: 1; distance: number; kind: 'hotspot'; hotspot: Hotspot }
  | { rank: 0; distance: number; kind: 'door'; opening: Opening };

function gatherCandidates(manifest: OfficeManifest, actor: InteractionActor, range: number): Candidate[] {
  const found: Candidate[] = [];

  for (const hotspot of manifest.hotspots) {
    const distance = distanceToRect(actor.x, actor.y, hotspot.rect);
    if (distance > range) continue;
    if (hotspot.kind === 'seat') {
      const seat = hotspot.cid === actor.cid ? seatFor(manifest, actor.cid) : undefined;
      if (seat) found.push({ rank: 3, distance, kind: 'seat', seat });
      else found.push({ rank: 1, distance, kind: 'hotspot', hotspot });
    } else if (hotspot.kind === 'fridge' || hotspot.kind === 'dispenser') {
      found.push({ rank: 2, distance, kind: 'source', hotspot });
    } else {
      found.push({ rank: 1, distance, kind: 'hotspot', hotspot });
    }
  }

  for (const opening of manifest.openings) {
    const distance = distanceToRect(actor.x, actor.y, opening.rect);
    if (distance <= range) found.push({ rank: 0, distance, kind: 'door', opening });
  }

  return found;
}

/**
 * Resolves the actor's surroundings into ONE intent: nearest first, with the
 * family priority — own seat > drink source > named hotspot > bare doorway —
 * breaking an exact distance tie. (A dispenser can sit metres from a locked
 * door, so priority must never override proximity, or the sealed Gudang/Server
 * doorways would be unreachable.)
 *
 *   1. stand  — E while seated is always an explicit stand (never stuck).
 *   2. sit    — your own seat when you stand close enough to it.
 *   3. drink  — a fridge/dispenser: open a closed fridge, take a drink from an
 *               open fridge or a dispenser, or close a fridge you drank from.
 *   4. hotspot— a named manifest hotspot (exit/pulang, another character's seat,
 *               or its message).
 *   5. door   — a wall opening: open a closed door, refuse to close one you are
 *               standing in, otherwise close it.
 *   6. none.
 */
function resolveIntent(manifest: OfficeManifest, state: InteractionState, actor: InteractionActor, range: number): Intent {
  if (state.sitting) return { kind: 'stand' };

  const candidates = gatherCandidates(manifest, actor, range);
  if (!candidates.length) return { kind: 'none' };
  candidates.sort((a, b) => a.distance - b.distance || b.rank - a.rank);
  const nearest = candidates[0]!;

  if (nearest.kind === 'seat') return { kind: 'sit', seat: nearest.seat };

  if (nearest.kind === 'source') {
    const hotspot = nearest.hotspot;
    if (hotspot.kind === 'fridge') {
      if (!state.openFridgeIds.includes(hotspot.id)) return { kind: 'open-fridge', targetId: hotspot.id, name: hotspot.name };
      if (!state.holdingDrink) return { kind: 'drink', source: 'fridge', targetId: hotspot.id, name: hotspot.name };
      return { kind: 'close-fridge', targetId: hotspot.id, name: hotspot.name };
    }
    if (state.holdingDrink) return { kind: 'message', message: 'Kamu masih membawa minuman.' };
    return { kind: 'drink', source: 'dispenser', targetId: hotspot.id, name: hotspot.name };
  }

  if (nearest.kind === 'hotspot') {
    const hotspot = nearest.hotspot;
    if (hotspot.action === 'status-pulang') return { kind: 'pulang', message: hotspot.message ?? 'Kamu pulang.' };
    if (hotspot.kind === 'seat') return { kind: 'message', message: `${hotspot.name} bukan kursimu.` };
    return { kind: 'message', message: hotspot.message ?? hotspot.name };
  }

  const opening = nearest.opening;
  if (state.closedDoorIds.includes(opening.id)) return { kind: 'open-door', targetId: opening.id };
  const footBox = actorFootBox(actor.x, actor.y, manifest.actor);
  if (intersectRect(footBox, opening.rect)) return { kind: 'door-blocked', targetId: opening.id };
  return { kind: 'close-door', targetId: opening.id };
}

/** Maps an intent to its user-facing action, hint and announcement. */
function interpret(intent: Intent): InteractionResult {
  switch (intent.kind) {
    case 'stand':
      return { action: 'stand', hint: 'Kembali berdiri.', announce: 'Kembali berdiri.' };
    case 'sit':
      return {
        action: 'sit',
        hint: 'Sedang duduk · bergerak untuk berdiri',
        announce: `Duduk di ${intent.seat.id}.`,
        seat: { seatId: intent.seat.id, x: intent.seat.x, y: intent.seat.y, direction: intent.seat.direction },
      };
    case 'drink':
      return intent.source === 'fridge'
        ? { action: 'drink', hint: `Mengambil minuman dari ${intent.name}.`, announce: 'Kamu membawa minuman dingin.', targetId: intent.targetId }
        : { action: 'drink', hint: 'Mengisi air minum.', announce: 'Kamu membawa air minum.', targetId: intent.targetId };
    case 'open-fridge':
      return { action: 'open-fridge', hint: `${intent.name} dibuka.`, announce: `${intent.name} terbuka.`, targetId: intent.targetId };
    case 'close-fridge':
      return { action: 'close-fridge', hint: `${intent.name} ditutup.`, announce: `${intent.name} tertutup.`, targetId: intent.targetId };
    case 'open-door':
      return { action: 'open-door', hint: 'Pintu dibuka.', announce: 'Pintu dibuka.', targetId: intent.targetId };
    case 'close-door':
      return { action: 'close-door', hint: 'Pintu ditutup.', announce: 'Pintu ditutup.', targetId: intent.targetId };
    case 'door-blocked':
      return { action: 'door-blocked', hint: 'Minggir dulu untuk menutup pintu.', announce: 'Tidak bisa menutup pintu dari ambang.', targetId: intent.targetId };
    case 'pulang':
      return { action: 'pulang', hint: intent.message, announce: intent.message };
    case 'message':
      return { action: 'message', hint: intent.message, announce: intent.message };
    case 'none':
      return { action: 'none', hint: 'Dekati objek di sekitarmu lalu tekan E.', announce: '' };
  }
}

/** Folds an intent into the next interaction state (never mutates the input). */
function nextState(state: InteractionState, intent: Intent): InteractionState {
  switch (intent.kind) {
    case 'sit':
      return { ...state, sitting: true, seatId: intent.seat.id };
    case 'stand':
      return standOnMove(state);
    case 'drink':
      return { ...state, holdingDrink: true };
    case 'open-fridge':
      return state.openFridgeIds.includes(intent.targetId)
        ? state
        : { ...state, openFridgeIds: [...state.openFridgeIds, intent.targetId] };
    case 'close-fridge':
      return { ...state, openFridgeIds: state.openFridgeIds.filter((id) => id !== intent.targetId) };
    case 'close-door':
      return state.closedDoorIds.includes(intent.targetId)
        ? state
        : { ...state, closedDoorIds: [...state.closedDoorIds, intent.targetId] };
    case 'open-door':
      return { ...state, closedDoorIds: state.closedDoorIds.filter((id) => id !== intent.targetId) };
    default:
      return state;
  }
}

/** What the shared action button (and the E key) would do right now. */
export function describeInteraction(
  manifest: OfficeManifest,
  state: InteractionState,
  actor: InteractionActor,
  options: { range?: number } = {},
): InteractionDescription {
  const result = interpret(resolveIntent(manifest, state, actor, options.range ?? DEFAULT_HOTSPOT_RANGE));
  return { action: result.action, label: ACTION_LABELS[result.action], hint: result.hint };
}

/** Commits the contextual action, returning the next state and its outcome. */
export function applyInteraction(
  manifest: OfficeManifest,
  state: InteractionState,
  actor: InteractionActor,
  options: { range?: number } = {},
): { state: InteractionState; result: InteractionResult } {
  const intent = resolveIntent(manifest, state, actor, options.range ?? DEFAULT_HOTSPOT_RANGE);
  return { state: nextState(state, intent), result: interpret(intent) };
}

/** Clears the seat anchor. The single transition shared by stand and movement. */
export function standOnMove(state: InteractionState): InteractionState {
  if (!state.sitting && state.seatId === null) return state;
  return { ...state, sitting: false, seatId: null };
}

/** The collision rectangles of every door the actor has closed. */
export function closedDoorRects(manifest: OfficeManifest, state: InteractionState): Rect[] {
  if (!state.closedDoorIds.length) return [];
  const closed = new Set(state.closedDoorIds);
  return manifest.openings.filter((opening) => closed.has(opening.id)).map((opening) => opening.rect);
}

/** Manifest-aligned dynamic visuals, ordered deterministically for rendering/tests. */
export function interactionVisuals(manifest: OfficeManifest, state: InteractionState): InteractionVisual[] {
  const openFridges = new Set(state.openFridgeIds);
  const closedDoors = new Set(state.closedDoorIds);
  const visuals: InteractionVisual[] = [];
  for (const hotspot of manifest.hotspots) {
    if (hotspot.kind === 'fridge' && openFridges.has(hotspot.id)) {
      visuals.push({ kind: 'open-fridge', id: hotspot.id, rect: hotspot.rect });
    }
  }
  for (const opening of manifest.openings) {
    if (closedDoors.has(opening.id)) {
      visuals.push({ kind: 'closed-door', id: opening.id, rect: opening.rect, orientation: opening.orientation });
    }
  }
  return visuals;
}

/** Paints dynamic doors/fridges after the static crop, before actors. */
export function drawInteractionState(
  ctx: CanvasRenderingContext2D,
  manifest: OfficeManifest,
  state: InteractionState,
  camera: { x: number; y: number },
): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (const visual of interactionVisuals(manifest, state)) {
    const x = Math.round(visual.rect.x - camera.x);
    const y = Math.round(visual.rect.y - camera.y);
    const w = Math.max(1, Math.round(visual.rect.w));
    const h = Math.max(1, Math.round(visual.rect.h));
    if (visual.kind === 'closed-door') {
      ctx.fillStyle = '#5f4432';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#b88858';
      ctx.fillRect(x + 2, y + 2, Math.max(1, w - 4), Math.max(1, h - 4));
      ctx.fillStyle = '#e7c46f';
      ctx.fillRect(x + Math.max(1, w - 3), y + Math.max(1, Math.floor(h / 2)), 1, 1);
      continue;
    }
    // The static cabinet remains below; the bright side panel reads as an open door.
    ctx.fillStyle = '#26353a';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#d9e5df';
    ctx.fillRect(x + w, y + 1, Math.max(3, Math.min(8, Math.round(w * 0.45))), Math.max(2, h - 2));
    ctx.fillStyle = '#f6e6a8';
    ctx.fillRect(x + 2, y + 2, Math.max(1, w - 4), 2);
  }
  ctx.restore();
}

/**
 * `isBlocked` plus the closed-door collision rectangles. A closed door re-seals
 * the walkable opening it came from, while the manifest's sealed rooms stay
 * sealed because their block colliders are independent of every door.
 */
export function isBlockedWithDoors(
  manifest: OfficeManifest,
  x: number,
  y: number,
  state: InteractionState,
  actor: ActorFootprint = manifest.actor,
): boolean {
  if (isBlocked(manifest, x, y, actor)) return true;
  const footBox = actorFootBox(x, y, actor);
  for (const rect of closedDoorRects(manifest, state)) {
    if (intersectRect(footBox, rect)) return true;
  }
  return false;
}
