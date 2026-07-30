import { test } from "node:test";
import assert from "node:assert/strict";
import { severityOf } from "./context-severity.mjs";

test("severityOf: colour follows the window ladder", () => {
  assert.equal(severityOf({ windowPct: 0, acProgress: 0 }).colour, "2");
  assert.equal(severityOf({ windowPct: 14.9, acProgress: 0 }).colour, "2");
  assert.equal(severityOf({ windowPct: 15, acProgress: 0 }).colour, "32");
  assert.equal(severityOf({ windowPct: 44.9, acProgress: 0 }).colour, "32");
  assert.equal(severityOf({ windowPct: 45, acProgress: 0 }).colour, "33");
  assert.equal(severityOf({ windowPct: 70, acProgress: 0 }).colour, "38;5;208");
  assert.equal(severityOf({ windowPct: 85, acProgress: 0 }).colour, "31");
  assert.equal(severityOf({ windowPct: 95, acProgress: 0 }).colour, "91");
  assert.equal(severityOf({ windowPct: 140, acProgress: 0 }).colour, "91");
});

test("severityOf: the icon follows the autocompact ladder and is silent below 45", () => {
  assert.equal(severityOf({ windowPct: 99, acProgress: 0 }).icon, "");
  assert.equal(severityOf({ windowPct: 99, acProgress: 44.9 }).icon, "");
  assert.equal(severityOf({ windowPct: 0, acProgress: 45 }).icon, "💡");
  assert.equal(severityOf({ windowPct: 0, acProgress: 70 }).icon, "⚠️");
  assert.equal(severityOf({ windowPct: 0, acProgress: 85 }).icon, "🔥");
  assert.equal(severityOf({ windowPct: 0, acProgress: 95 }).icon, "💀");
  assert.equal(severityOf({ windowPct: 0, acProgress: 300 }).icon, "💀");
});

test("severityOf: the two scales are independent", () => {
  assert.deepEqual(severityOf({ windowPct: 32, acProgress: 96 }), { colour: "32", icon: "💀" });
  assert.deepEqual(severityOf({ windowPct: 96, acProgress: 32 }), { colour: "91", icon: "" });
});

test("severityOf: junk degrades to grey and no icon, never throws", () => {
  assert.deepEqual(severityOf(), { colour: "2", icon: "" });
  assert.deepEqual(severityOf({}), { colour: "2", icon: "" });
  assert.deepEqual(severityOf(null), { colour: "2", icon: "" });
  assert.deepEqual(severityOf({ windowPct: null, acProgress: undefined }), { colour: "2", icon: "" });
  assert.deepEqual(severityOf({ windowPct: NaN, acProgress: "x" }), { colour: "2", icon: "" });
});
