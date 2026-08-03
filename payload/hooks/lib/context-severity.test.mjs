import { test } from "node:test";
import assert from "node:assert/strict";
import { severityOf } from "./context-severity.mjs";

test("severityOf: colour follows the window ladder", () => {
  assert.equal(severityOf({ windowPct: 0, acProgress: 0 }).colour, "2");
  assert.equal(severityOf({ windowPct: 15, acProgress: 0 }).colour, "2");
  assert.equal(severityOf({ windowPct: 16, acProgress: 0 }).colour, "32");
  assert.equal(severityOf({ windowPct: 30, acProgress: 0 }).colour, "32");
  assert.equal(severityOf({ windowPct: 31, acProgress: 0 }).colour, "33");
  assert.equal(severityOf({ windowPct: 55, acProgress: 0 }).colour, "33");
  assert.equal(severityOf({ windowPct: 56, acProgress: 0 }).colour, "38;5;208");
  assert.equal(severityOf({ windowPct: 80, acProgress: 0 }).colour, "38;5;208");
  assert.equal(severityOf({ windowPct: 81, acProgress: 0 }).colour, "31");
  assert.equal(severityOf({ windowPct: 100, acProgress: 0 }).colour, "31");
  assert.equal(severityOf({ windowPct: 140, acProgress: 0 }).colour, "31");
});

test("severityOf: a fractional percent lands on the band its rounded label shows", () => {
  assert.equal(severityOf({ windowPct: 15.4, acProgress: 0 }).colour, "2");
  assert.equal(severityOf({ windowPct: 15.5, acProgress: 0 }).colour, "32");
  assert.equal(severityOf({ windowPct: 80.6, acProgress: 0 }).colour, "31");
  assert.equal(severityOf({ windowPct: 0, acProgress: 39.4 }).icon, "");
  assert.equal(severityOf({ windowPct: 0, acProgress: 39.5 }).icon, "💡");
});

test("severityOf: the icon follows the autocompact ladder and is silent below 40", () => {
  assert.equal(severityOf({ windowPct: 99, acProgress: 0 }).icon, "");
  assert.equal(severityOf({ windowPct: 99, acProgress: 39 }).icon, "");
  assert.equal(severityOf({ windowPct: 0, acProgress: 40 }).icon, "💡");
  assert.equal(severityOf({ windowPct: 0, acProgress: 59 }).icon, "💡");
  assert.equal(severityOf({ windowPct: 0, acProgress: 60 }).icon, "❗");
  assert.equal(severityOf({ windowPct: 0, acProgress: 74 }).icon, "❗");
  assert.equal(severityOf({ windowPct: 0, acProgress: 75 }).icon, "🔥");
  assert.equal(severityOf({ windowPct: 0, acProgress: 89 }).icon, "🔥");
  assert.equal(severityOf({ windowPct: 0, acProgress: 90 }).icon, "💀");
  assert.equal(severityOf({ windowPct: 0, acProgress: 300 }).icon, "💀");
});

test("severityOf: every icon renders as a colour glyph, not a monochrome one", () => {
  for (const acProgress of [40, 60, 75, 90]) {
    const { icon } = severityOf({ windowPct: 0, acProgress });
    assert.match(icon, /^\p{Emoji_Presentation}$/u,
      `${JSON.stringify(icon)} needs U+FE0F to show colour, and xterm.js ignores it`);
  }
});

test("severityOf: the two scales are independent", () => {
  assert.deepEqual(severityOf({ windowPct: 32, acProgress: 96 }), { colour: "33", icon: "💀" });
  assert.deepEqual(severityOf({ windowPct: 96, acProgress: 32 }), { colour: "31", icon: "" });
});

test("severityOf: junk degrades to grey and no icon, never throws", () => {
  assert.deepEqual(severityOf(), { colour: "2", icon: "" });
  assert.deepEqual(severityOf({}), { colour: "2", icon: "" });
  assert.deepEqual(severityOf(null), { colour: "2", icon: "" });
  assert.deepEqual(severityOf({ windowPct: null, acProgress: undefined }), { colour: "2", icon: "" });
  assert.deepEqual(severityOf({ windowPct: NaN, acProgress: "x" }), { colour: "2", icon: "" });
});
