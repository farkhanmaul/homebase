// Direct tests for the canvas op painter.
//
// The SVG and Pillow backends honour a text op's `rotate`, so the in-app canvas
// must too — otherwise the four service labels (which are emitted with
// rotate:-90 because their cells are tall and narrow) would be painted
// horizontally across their neighbours. These tests drive `paintOps` with a fake
// 2D context and assert the exact call sequence, which is the only observable
// behaviour a canvas has.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { paintOps } from '../lib/office-renderer.ts';
import type { Op } from '../lib/office-render-ops.ts';

function createFakeContext(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = [];
  const ctx = {
    globalAlpha: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: 'round',
    save: () => { calls.push('save'); },
    restore: () => { calls.push('restore'); },
    translate: (x: number, y: number) => { calls.push(`translate(${x},${y})`); },
    rotate: (angle: number) => { calls.push(`rotate(${angle})`); },
    strokeText: (text: string, x: number, y: number) => { calls.push(`strokeText(${text},${x},${y})`); },
    fillText: (text: string, x: number, y: number) => { calls.push(`fillText(${text},${x},${y})`); },
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    stroke: () => {},
    ellipse: () => {},
    drawImage: () => {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const rotatedLabel: Op = {
  t: 'text',
  x: 610,
  y: 620,
  size: 16,
  fill: '#f4efdf',
  text: 'Gudang',
  anchor: 'start',
  weight: 700,
  halo: true,
  rotate: -90,
};

const plainLabel: Op = {
  t: 'text',
  x: 40,
  y: 30,
  size: 16,
  fill: '#f4efdf',
  text: 'Pantry',
  anchor: 'start',
  weight: 700,
  halo: true,
};

void test('paintOps rotates a rotated text op about its own origin', () => {
  const { ctx, calls } = createFakeContext();
  paintOps(ctx, [rotatedLabel]);

  assert.deepEqual(calls, [
    'save',
    'translate(610,620)',
    `rotate(${-Math.PI / 2})`,
    'strokeText(Gudang,0,0)',
    'fillText(Gudang,0,0)',
    'restore',
  ]);
});

void test('paintOps paints ordinary text unrotated, without touching the transform', () => {
  const { ctx, calls } = createFakeContext();
  paintOps(ctx, [plainLabel]);

  assert.deepEqual(calls, ['strokeText(Pantry,40,30)', 'fillText(Pantry,40,30)']);
});

void test('a rotated op without a halo still shares one transform for the fill', () => {
  const { ctx, calls } = createFakeContext();
  paintOps(ctx, [{ ...rotatedLabel, halo: false }]);

  assert.deepEqual(calls, ['save', 'translate(610,620)', `rotate(${-Math.PI / 2})`, 'fillText(Gudang,0,0)', 'restore']);
});

void test('paintOps balances save/restore and leaves globalAlpha at 1', () => {
  const { ctx, calls } = createFakeContext();
  paintOps(ctx, [rotatedLabel, plainLabel, { ...rotatedLabel, x: 700, y: 620, text: 'Wastafel' }]);

  assert.equal(calls.filter((call) => call === 'save').length, 2);
  assert.equal(calls.filter((call) => call === 'restore').length, 2);
  assert.equal(ctx.globalAlpha, 1);
});

void test('rotated text is translated to the op coordinates, not painted there directly', () => {
  const { ctx, calls } = createFakeContext();
  paintOps(ctx, [{ ...rotatedLabel, x: 1234, y: 567 }]);

  assert.ok(calls.includes('translate(1234,567)'));
  assert.equal(calls.includes('fillText(Gudang,1234,567)'), false, 'the fill happens in local coordinates');
});
