// skills/update-changelog/tests/write-aggregate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertAggregate } from '../scripts/write-aggregate.mjs';

const e = (name, version, date, changes = []) => ({ name, version, date, changes });

test('sorts by date descending', () => {
  const out = upsertAggregate(
    [e('сайт', 'v1.0.0', '2026-01-01T00:00:00Z')],
    [e('сервер', 'v0.4.5', '2026-02-01T00:00:00Z')]);
  assert.deepEqual(out.map(x => x.name), ['сервер', 'сайт']);
});

test('idempotent upsert on name|version, last write wins', () => {
  const base = [e('сайт', 'v1.0.0', '2026-01-01T00:00:00Z', ['a'])];
  const out = upsertAggregate(base, [e('сайт', 'v1.0.0', '2026-01-01T00:00:00Z', ['b'])]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].changes, ['b']);
});
