import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatTokenCount,
  computeUsedTokenMetrics,
  rewriteContextBar,
} from "../../payload/hooks/lib/gsd-context-meter-lib.mjs";

test("formatTokenCount: rounds to nearest thousand with a 'k' suffix", () => {
  assert.equal(formatTokenCount(250000), "250k");
  assert.equal(formatTokenCount(1000000), "1000k");
  assert.equal(formatTokenCount(1499), "1k");
});

test("computeUsedTokenMetrics: returns null when remaining_percentage is absent", () => {
  assert.equal(computeUsedTokenMetrics({ context_window: {} }), null);
  assert.equal(computeUsedTokenMetrics({}), null);
});

test("computeUsedTokenMetrics: computes buffer-normalized used% and totalCtx", () => {
  const data = { context_window: { remaining_percentage: 90, total_tokens: 1000000 } };
  const result = computeUsedTokenMetrics(data);
  assert.equal(result.totalCtx, 1000000);
  // remaining=90, buffer=16.5 (default) -> usableRemaining = ((90-16.5)/(100-16.5))*100 = ~88.02 -> used = round(100-88.02) = 12
  assert.equal(result.used, 12);
});

test("computeUsedTokenMetrics: defaults total_tokens to 1_000_000 when absent", () => {
  const data = { context_window: { remaining_percentage: 50 } };
  const result = computeUsedTokenMetrics(data);
  assert.equal(result.totalCtx, 1000000);
});

test("rewriteContextBar: replaces a green (<50%) bar segment with token counts, same color", () => {
  const original = "model | \x1b[32m████░░░░░░ 42%\x1b[0m | dir";
  const result = rewriteContextBar(original, { totalCtx: 1000000, used: 42 });
  assert.equal(result, "model | \x1b[32m[420k/1000k] 42%\x1b[0m | dir");
});

test("rewriteContextBar: preserves the skull-emoji prefix on the >=80% red segment", () => {
  const original = "model | \x1b[5;31m💀 ██████████ 92%\x1b[0m | dir";
  const result = rewriteContextBar(original, { totalCtx: 200000, used: 92 });
  assert.equal(result, "model | \x1b[5;31m💀 [184k/200k] 92%\x1b[0m | dir");
});

test("rewriteContextBar: returns text unchanged when no bar segment is present", () => {
  const original = "model | no context segment here | dir";
  assert.equal(rewriteContextBar(original, { totalCtx: 1000000, used: 42 }), original);
});

test("rewriteContextBar: returns text unchanged when metrics are missing", () => {
  const original = "model | \x1b[32m████░░░░░░ 42%\x1b[0m | dir";
  assert.equal(rewriteContextBar(original, { totalCtx: null, used: null }), original);
});
