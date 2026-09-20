// User correction Batch C: Desk Collection side chairs must not sit inside
// their desks or overlap neighbouring chairs. Written RED before implementation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intersectRect, officeMap } from '../lib/office-map.ts';

const desks = officeMap.furniture.filter((item) => item.zone === 'desk-collection' && item.kind === 'desk');
const chairs = officeMap.furniture.filter((item) => item.zone === 'desk-collection' && item.kind === 'chair');

void test('no Desk Collection chair overlaps either solid desk bank', () => {
  for (const chair of chairs) {
    for (const desk of desks) {
      assert.equal(intersectRect(chair.rect, desk.rect), null, `${chair.id} must clear ${desk.id}`);
    }
  }
});

void test('Desk Collection chairs do not overlap each other', () => {
  for (let i = 0; i < chairs.length; i += 1) {
    for (let j = i + 1; j < chairs.length; j += 1) {
      assert.equal(intersectRect(chairs[i]!.rect, chairs[j]!.rect), null, `${chairs[i]!.id} must clear ${chairs[j]!.id}`);
    }
  }
});

void test('side chairs keep their size and sit left of each bank top row', () => {
  for (const [sideId, rowId] of [['F-DC-T-SIDE', 'F-DC-T-UP-1'], ['F-DC-B-SIDE', 'F-DC-B-UP-1']] as const) {
    const side = chairs.find((item) => item.id === sideId)!;
    const row = chairs.find((item) => item.id === rowId)!;
    assert.deepEqual({ w: side.rect.w, h: side.rect.h, solid: side.solid }, { w: 32.5, h: 30, solid: false });
    assert.equal(side.rect.y, row.rect.y, `${sideId} aligns to ${rowId}`);
    assert.ok(side.rect.x + side.rect.w <= row.rect.x - 4, `${sideId} leaves a visible gap before ${rowId}`);
  }
});
