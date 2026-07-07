// skills/update-changelog/tests/config.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, partName, aggregatePath } from '../scripts/config.mjs';

test('loadConfig returns null when file absent', () => {
  const d = mkdtempSync(join(tmpdir(), 'cl-'));
  assert.equal(loadConfig(d), null);
});

test('loadConfig parses aggregate + names', () => {
  const d = mkdtempSync(join(tmpdir(), 'cl-'));
  writeFileSync(join(d, '.changelog.config.json'), JSON.stringify({
    aggregate: { part: 'apps/web', file: 'changelog.all.json' },
    names: { 'apps/web': 'сайт' },
  }));
  const c = loadConfig(d);
  assert.equal(aggregatePath(c), join('apps/web', 'changelog.all.json'));
  assert.equal(partName(c, 'apps/web'), 'сайт');
  assert.equal(partName(c, 'apps/backend'), 'backend'); // fallback
});
