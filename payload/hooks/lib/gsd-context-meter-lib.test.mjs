// payload/hooks/lib/gsd-context-meter-lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendUpdatesSegment } from "./gsd-context-meter-lib.mjs";

test("appendUpdatesSegment: appends when count>0, no-op otherwise", () => {
  assert.equal(appendUpdatesSegment("bar", 0), "bar");
  assert.equal(appendUpdatesSegment("bar", undefined), "bar");
  assert.equal(appendUpdatesSegment(null, 2), null);
  const out = appendUpdatesSegment("bar", 2);
  assert.match(out, /⬆2/);          // ⬆2
  assert.ok(out.startsWith("bar"));
});

test("appendUpdatesSegment: inserts before a trailing newline", () => {
  const out = appendUpdatesSegment("bar\n", 1);
  assert.ok(out.endsWith("\n"));
  assert.match(out, /⬆1[^\n]*\n$/);
});
