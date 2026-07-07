// skills/update-changelog/tests/queue.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendHash, readQueue, clearHashes, lock, unlock, isLocked } from '../scripts/queue.mjs';

test('append/read/clear roundtrip with dedup', () => {
  const d = mkdtempSync(join(tmpdir(), 'q-'));
  appendHash(d, 'aaa'); appendHash(d, 'aaa'); appendHash(d, 'bbb');
  assert.deepEqual(readQueue(d), ['aaa', 'bbb']);
  clearHashes(d, ['aaa']);
  assert.deepEqual(readQueue(d), ['bbb']);
});

test('lock lifecycle', () => {
  const d = mkdtempSync(join(tmpdir(), 'q-'));
  assert.equal(isLocked(d), false);
  lock(d); assert.equal(isLocked(d), true);
  unlock(d); assert.equal(isLocked(d), false);
});
