// payload/bin/lib/supervise-lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSuperviseArgs, hangCheck, formatHang, DEFAULT_TIMEOUT_S, DEFAULT_STALE_S } from "./supervise-lib.mjs";

test("parseSuperviseArgs reads flags and command after --", () => {
  const r = parseSuperviseArgs(["--timeout", "600", "--stale", "120", "--label", "build", "--", "pnpm", "build"]);
  assert.equal(r.timeout, 600);
  assert.equal(r.stale, 120);
  assert.equal(r.label, "build");
  assert.deepEqual(r.cmd, ["pnpm", "build"]);
});

test("parseSuperviseArgs defaults, and command without an explicit --", () => {
  const r = parseSuperviseArgs(["pnpm", "dev"]);
  assert.equal(r.timeout, DEFAULT_TIMEOUT_S);
  assert.equal(r.stale, DEFAULT_STALE_S);
  assert.equal(r.label, "");
  assert.deepEqual(r.cmd, ["pnpm", "dev"]);
});

test("hangCheck: healthy => null", () => {
  assert.equal(hangCheck({ now: 1000, startTs: 0, lastOutputTs: 900, timeoutMs: 10000, staleMs: 500 }), null);
});

test("hangCheck: wall-clock timeout wins over staleness", () => {
  const h = hangCheck({ now: 10000, startTs: 0, lastOutputTs: 0, timeoutMs: 5000, staleMs: 1000 });
  assert.equal(h.type, "timeout");
});

test("hangCheck: output staleness when under wall cap", () => {
  const h = hangCheck({ now: 10000, startTs: 6000, lastOutputTs: 6000, timeoutMs: 60000, staleMs: 2000 });
  assert.equal(h.type, "stale");
});

test("formatHang produces a greppable HANG marker", () => {
  assert.match(formatHang("build", { type: "timeout", elapsedS: 600 }), /^\[supervise:build\] HANG/);
  assert.match(formatHang("", { type: "stale", elapsedS: 300 }), /^\[supervise\] HANG/);
});
