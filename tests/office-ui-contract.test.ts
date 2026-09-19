// UI contract tests: the muted-light theme tokens and the two-row mobile
// movement controller.
//
// app/page.tsx and app/office.css have no DOM test harness, so — like the spawn
// wiring guard — these read the shipped source and assert the structural
// contract: the page commits E and the on-screen action button through the same
// pure interaction module, the mobile pad is exactly two rows of >=44px targets,
// and the theme keeps WCAG-readable contrast instead of glaring white or night.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(resolve(ROOT, 'app', 'page.tsx'), 'utf8');
const css = readFileSync(resolve(ROOT, 'app', 'office.css'), 'utf8');

// ---------------------------------------------------------------------------
// Interaction wiring
// ---------------------------------------------------------------------------

void test('the page commits interactions through the pure interaction module', () => {
  assert.match(page, /from '\.\.\/lib\/office-interactions'/, 'imports the interaction module');
  assert.match(page, /applyInteraction\(/, 'E commits through applyInteraction');
  assert.match(page, /describeInteraction\(/, 'the contextual label comes from describeInteraction');
  assert.match(page, /isBlockedWithDoors\(/, 'movement collision accounts for closed doors');
  assert.match(page, /standOnMove\(/, 'movement stands the actor through standOnMove');
  assert.match(page, /drawInteractionState\(/, 'open fridges and closed doors are painted in the world');
});

void test('the keyboard E key and the on-screen action button run the same action', () => {
  const keyboard = page.match(/\['e',\s*'x'\]\.includes\(key\)\)\s*interact\(\)/);
  assert.ok(keyboard, "the E/X key handler calls interact()");

  const button = page.match(/<button[^>]*onClick=\{interact\}[^>]*>\{actionLabel\}/);
  assert.ok(button, 'an accessible on-screen button labelled with the contextual action calls the same interact()');
  assert.match(page, /aria-label=\{`Aksi: \$\{actionLabel\}`\}/, 'the action button exposes its label to assistive tech');
});

// ---------------------------------------------------------------------------
// Mobile movement controller: exactly two rows, centered up then left/down/right
// ---------------------------------------------------------------------------

void test('the mobile pad is exactly two rows with up above left/down/right', () => {
  const rows = page.match(/office-dpad-row/g) ?? [];
  assert.equal(rows.length, 2, 'the movement controller has exactly two rows');

  assert.match(page, /aria-label="Gerak atas"/);
  assert.match(page, /aria-label="Gerak kiri"/);
  assert.match(page, /aria-label="Gerak bawah"/);
  assert.match(page, /aria-label="Gerak kanan"/);
  assert.doesNotMatch(page, /aria-label="Interaksi \(E\)"/, 'the action moved out of the movement pad into one shared button');
});

void test('the mobile pad CSS centers row one and keeps >=44px touch targets', () => {
  assert.match(css, /\.office-dpad\{[^}]*flex-direction:column/, 'the pad stacks its rows');
  assert.match(css, /\.office-dpad-row\{[^}]*justify-content:center/, 'each row is centered');

  const buttonRule = css.match(/\.office-dpad button\{[^}]*\}/);
  assert.ok(buttonRule, 'the pad styles its buttons');
  assert.match(buttonRule[0], /min-width:44px/, 'touch target width is at least 44px');
  assert.match(buttonRule[0], /min-height:44px/, 'touch target height is at least 44px');

  assert.match(css, /\.office-dpad,\.open-mobile-chat\{display:none/, 'the pad stays hidden on desktop');
});

// ---------------------------------------------------------------------------
// Muted-light theme + WCAG contrast
// ---------------------------------------------------------------------------

function token(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'));
  assert.ok(match, `theme defines --${name}`);
  return match[1]!;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

void test('the default theme is muted light, not glaring white and not night', () => {
  assert.match(css, /\.office-app\{[^}]*background:var\(--oc-bg\)/, 'the app uses the light token');
  assert.doesNotMatch(css, /#101f2d/i, 'the old near-black app chrome is gone');

  // Warm off-white / soft gray, not pure white and not a dark night theme.
  const bg = token('oc-bg');
  const [r, g, bl] = [1, 3, 5].map((i) => Number.parseInt(bg.slice(i, i + 2), 16));
  assert.ok((r! + g! + bl!) / 3 > 200 && (r! + g! + bl!) / 3 < 250, `${bg} is off-white, not glaring or dark`);
  assert.ok(r! >= bl!, 'the background leans warm, not cool white');
});

void test('the muted-light palette keeps WCAG AA contrast', () => {
  const bg = token('oc-bg');
  const ink = token('oc-ink');
  const muted = token('oc-muted');
  const teal = token('oc-teal');
  const tealInk = token('oc-teal-ink');

  assert.ok(contrast(ink, bg) >= 7, `near-black text on ${bg} (body)`);
  assert.ok(contrast(muted, bg) >= 4.5, `muted text on ${bg}`);
  assert.ok(contrast(teal, bg) >= 4.5, `teal accent text on ${bg}`);
  assert.ok(contrast(tealInk, teal) >= 4.5, `button text on the teal accent`);
});
