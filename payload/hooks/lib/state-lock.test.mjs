import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isHeld, take, release, STALE_LOCK_MS } from "./state-lock.mjs";

const fresh = () => join(mkdtempSync(join(tmpdir(), "lock-")), "a.lock");

test("a lock that does not exist is not held", () => {
  assert.equal(isHeld(fresh()), false);
});

test("a lock just taken is held", () => {
  const p = fresh();
  take(p);
  assert.ok(existsSync(p));
  assert.equal(isHeld(p), true);
});

// A crashed run must not wedge the sync forever, which is what the TTL is for.
test("a lock older than the TTL is not held", () => {
  const p = fresh();
  take(p);
  const now = statSync(p).mtimeMs + STALE_LOCK_MS + 1;
  assert.equal(isHeld(p, { now }), false);
});

test("release removes the lock and is safe to repeat", () => {
  const p = fresh();
  take(p);
  release(p);
  assert.equal(existsSync(p), false);
  release(p);
});

test("taking a lock in a directory that does not exist yet still works", () => {
  const p = join(mkdtempSync(join(tmpdir(), "lock-")), "nested", "b.lock");
  take(p);
  assert.ok(existsSync(p));
});

test("an unreadable lock reads as not held, so a broken state file never wedges the sync", () => {
  const p = fresh();
  writeFileSync(p, "x");
  assert.equal(isHeld(p, { now: NaN }), false);
});
