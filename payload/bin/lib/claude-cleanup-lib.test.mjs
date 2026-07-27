import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KEEP_DAYS, AUTO_DAYS, DAY_MS, newestMtime, dirSize, ageBucket } from "./claude-cleanup-lib.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "cc-"));
const setMtime = (p, ms) => utimesSync(p, new Date(ms), new Date(ms));

test("constants", () => {
  assert.equal(KEEP_DAYS, 7); assert.equal(AUTO_DAYS, 14); assert.equal(DAY_MS, 86_400_000);
});

test("ageBucket edges (now-relative)", () => {
  const now = 1_000 * DAY_MS;
  assert.equal(ageBucket(now - 6 * DAY_MS, now), "keep");   // < 7d
  assert.equal(ageBucket(now - 8 * DAY_MS, now), "list");   // 7–14d
  assert.equal(ageBucket(now - 15 * DAY_MS, now), "auto");  // > 14d
  assert.equal(ageBucket(now - 7 * DAY_MS, now), "list");   // exactly 7d → not keep
  assert.equal(ageBucket(now - 14 * DAY_MS, now), "list");  // exactly 14d → not yet auto
});

test("newestMtime returns the newest file mtime, recursively (not the dir's own)", () => {
  const d = tmp();
  const sub = join(d, "a"); mkdirSync(sub);
  const old = join(sub, "old.txt"); writeFileSync(old, "x"); setMtime(old, 1000 * DAY_MS);
  const neu = join(sub, "new.txt"); writeFileSync(neu, "y"); setMtime(neu, 2000 * DAY_MS);
  assert.equal(newestMtime(d), 2000 * DAY_MS);
  rmSync(d, { recursive: true, force: true });
});

test("dirSize sums file bytes recursively", () => {
  const d = tmp();
  writeFileSync(join(d, "a"), "12345");           // 5
  mkdirSync(join(d, "s")); writeFileSync(join(d, "s", "b"), "678"); // 3
  assert.equal(dirSize(d), 8);
  rmSync(d, { recursive: true, force: true });
});
