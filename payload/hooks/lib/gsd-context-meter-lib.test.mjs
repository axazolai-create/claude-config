// payload/hooks/lib/gsd-context-meter-lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCurrentTokens, formatContextWindow, computeUsedTokenMetrics, appendUpdatesSegment, rewriteContextBar } from "./gsd-context-meter-lib.mjs";

test("re-exports the statusline-lib functions unchanged, alongside rewriteContextBar", () => {
  for (const fn of [formatCurrentTokens, formatContextWindow, computeUsedTokenMetrics, appendUpdatesSegment, rewriteContextBar])
    assert.equal(typeof fn, "function");
});

const METRICS = { totalCtx: 200000, used: 33.2, usedTokens: 43500 };
const withBarAfterModel = "\x1b[2mSonnet 5\x1b[0m │  \x1b[32m██████████ 12%\x1b[0m │ ~/project";

test("rewriteContextBar: replaces the bar with a token-count segment after the model segment", () => {
  const out = rewriteContextBar(withBarAfterModel, METRICS);
  assert.equal(out, "\x1b[2mSonnet 5\x1b[0m │ \x1b[32m[43.5K/200K] 33.2%\x1b[0m │  │ ~/project");
});

test("rewriteContextBar: appends the native suffix when present", () => {
  const text = "\x1b[2mSonnet 5\x1b[0m │  \x1b[32m██████████ 12% (156k)\x1b[0m │ ~/project";
  const out = rewriteContextBar(text, METRICS);
  assert.match(out, /\[43\.5K\/200K\] 33\.2% \(156k\) 12%\x1b\[0m/);
});

test("rewriteContextBar: relocates the bar when it originally sits before the model segment", () => {
  const text = " \x1b[32m██████████ 12%\x1b[0m │ \x1b[2mSonnet 5\x1b[0m";
  const out = rewriteContextBar(text, METRICS);
  assert.equal(out, " │ \x1b[2mSonnet 5\x1b[0m │ \x1b[32m[43.5K/200K] 33.2%\x1b[0m");
});

test("rewriteContextBar: falls back to plain in-place replace when no model segment exists", () => {
  const text = "before \x1b[32m██████████ 12%\x1b[0m after";
  const out = rewriteContextBar(text, METRICS);
  assert.equal(out, "before \x1b[32m[43.5K/200K] 33.2%\x1b[0m after");
});

test("rewriteContextBar: returns text unchanged when there's no bar to match", () => {
  assert.equal(rewriteContextBar("no bar here", METRICS), "no bar here");
});

test("rewriteContextBar: returns text unchanged on invalid input rather than throwing", () => {
  assert.equal(rewriteContextBar(null, METRICS), null);
  assert.equal(rewriteContextBar(withBarAfterModel, { totalCtx: null, used: 1 }), withBarAfterModel);
  assert.equal(rewriteContextBar(withBarAfterModel, { totalCtx: 1, used: null }), withBarAfterModel);
});
