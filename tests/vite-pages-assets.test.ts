import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = readFileSync(resolve(ROOT, 'vite.pages.config.ts'), 'utf8');
const RUNTIME_FILES = [
  '.nojekyll',
  'robots.txt',
  'config.json',
  'favicon.svg',
  'avatar/team-six.png',
  'room/bilik-geng-zone.png',
] as const;

void test('Pages build disables blanket public copying and allowlists runtime files only', () => {
  assert.match(CONFIG, /publicDir:\s*false/);
  assert.match(CONFIG, /copy-runtime-public-files/);
  for (const file of RUNTIME_FILES) {
    assert.match(CONFIG, new RegExp(file.replace(/[./-]/g, '\\$&')), `${file} is allowlisted`);
    assert.equal(existsSync(resolve(ROOT, 'public', file)), true, `${file} exists`);
  }
});

void test('Pages runtime allowlist excludes source and legacy preview assets', () => {
  for (const forbidden of ['team-six-source.png', 'bilik-geng-v4.png', 'office-pixel.png', 'office-idle-sheet.png']) {
    assert.doesNotMatch(CONFIG, new RegExp(forbidden.replace(/[./-]/g, '\\$&')));
  }
});
