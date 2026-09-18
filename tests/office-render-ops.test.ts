// Preview op-list invariants (slice B polish lock-in).
//
// The review artifact and the in-app canvas are painted from the same manifest
// derived op list. These tests pin the two review fixes (labels never collide
// with hotspot markers; the footer title/subtitle never collide with the legend)
// and the determinism of the op builder, so a later geometry or palette change
// cannot silently reintroduce them.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { officeMap, type Rect } from '../lib/office-map.ts';
import { LABEL_SIZE, LEGEND_HEIGHT, PREVIEW_COLORS, buildPreviewOps, buildWorldOps, type Op } from '../lib/office-render-ops.ts';

function overlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function rects(ops: readonly Op[]): Extract<Op, { t: 'rect' }>[] {
  return ops.filter((op): op is Extract<Op, { t: 'rect' }> => op.t === 'rect');
}

function circles(ops: readonly Op[]): Extract<Op, { t: 'circle' }>[] {
  return ops.filter((op): op is Extract<Op, { t: 'circle' }> => op.t === 'circle');
}

function texts(ops: readonly Op[]): Extract<Op, { t: 'text' }>[] {
  return ops.filter((op): op is Extract<Op, { t: 'text' }> => op.t === 'text');
}

void test('the op builder is deterministic', () => {
  assert.equal(JSON.stringify(buildWorldOps(officeMap)), JSON.stringify(buildWorldOps(officeMap)));
  assert.equal(JSON.stringify(buildPreviewOps(officeMap)), JSON.stringify(buildPreviewOps(officeMap)));
});

void test('no label band overlaps a hotspot or seat marker', () => {
  const ops = buildWorldOps(officeMap);
  const bands = rects(ops).filter((op) => op.fill === PREVIEW_COLORS.labelBand);
  const markers = circles(ops);

  const labelledZones = officeMap.zones.filter((zone) => zone.showLabel !== false);
  assert.ok(bands.length >= labelledZones.length, 'every labelled zone has a label band');
  assert.ok(markers.length > 0, 'the map has markers');

  for (const band of bands) {
    for (const marker of markers) {
      const box: Rect = { x: marker.cx - marker.r, y: marker.cy - marker.r, w: marker.r * 2, h: marker.r * 2 };
      assert.equal(overlap(band, box), false, `band at ${band.x},${band.y} overlaps a marker at ${marker.cx},${marker.cy}`);
    }
  }
});

void test('zones marked unlabelled emit no room label band, while real rooms do', () => {
  const bands = rects(buildWorldOps(officeMap)).filter((op) => op.fill === PREVIEW_COLORS.labelBand);
  const bandCentreInside = (rect: Rect): boolean =>
    bands.some((band) => {
      const cx = band.x + band.w / 2;
      const cy = band.y + band.h / 2;
      return cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h;
    });

  for (const id of ['sirkulasi', 'jalur-terbuka', 'wastafel']) {
    const zone = officeMap.zones.find((entry) => entry.id === id)!;
    assert.equal(zone.showLabel, false, `${id} is unlabelled`);
    assert.ok(zone.name.length > 0, `${id} keeps its name for zoneAt/UI`);
    assert.equal(bandCentreInside(zone.rect), false, `${id} must not emit a label band`);
  }

  const labelled = officeMap.zones.filter((zone) => zone.showLabel !== false);
  for (const zone of labelled) {
    assert.equal(bandCentreInside(zone.rect), true, `${zone.id} emits a room label band`);
  }
});

void test('the pantry label clears the pantry hotspot markers', () => {
  const pantry = officeMap.zones.find((zone) => zone.id === 'pantry')!;
  const band = rects(buildWorldOps(officeMap))
    .filter((op) => op.fill === PREVIEW_COLORS.labelBand)
    .find((op) => op.x >= pantry.rect.x && op.x <= pantry.rect.x + pantry.rect.w && op.y >= pantry.rect.y && op.y <= pantry.rect.y + pantry.rect.h);
  assert.ok(band, 'the pantry has a label band');

  const pantryHotspots = officeMap.hotspots.filter((hotspot) => hotspot.zone === 'pantry');
  assert.ok(pantryHotspots.length >= 2);
  for (const hotspot of pantryHotspots) {
    const box: Rect = { x: hotspot.rect.x + hotspot.rect.w / 2 - 11, y: hotspot.rect.y + hotspot.rect.h / 2 - 11, w: 22, h: 22 };
    assert.equal(overlap(band!, box), false, `${hotspot.id} clears the pantry label`);
  }
});

void test('footer title and subtitle never overlap the legend swatches', () => {
  const preview = buildPreviewOps(officeMap);
  const footer = preview.ops.filter((op) => op.t !== 'text' || op.y >= officeMap.height);
  const title = texts(footer).find((op) => op.text.startsWith('DENAH KANTOR'))!;
  const subtitle = texts(footer).find((op) => op.text.startsWith('Preview vektor'))!;
  assert.ok(title, 'the footer has a title');
  assert.ok(subtitle, 'the footer has a subtitle');

  const swatchRects = rects(footer).filter((op) => op.w === 22 && op.h === 14);
  const swatchLabels = texts(footer).filter((op) => op.size === LABEL_SIZE && op.x > 700 && op.y > officeMap.height);
  assert.ok(swatchRects.length >= 8, 'the legend has swatches');
  assert.ok(swatchLabels.length >= 8, 'the legend has labels');

  const titleRight = title.x + title.text.length * title.size * 0.6;
  const firstSwatchX = Math.min(...swatchRects.map((op) => op.x));
  assert.ok(titleRight + 8 <= firstSwatchX, `title ends at ${titleRight}, legend starts at ${firstSwatchX}`);

  const lowestSwatchText = Math.max(...swatchLabels.map((op) => op.y));
  assert.ok(subtitle.y - subtitle.size >= lowestSwatchText + 4, 'subtitle sits below the legend row');

  assert.equal(preview.height, officeMap.height + LEGEND_HEIGHT);
});
