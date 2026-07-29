// payload/hooks/lib/statusline-lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCurrentTokens, formatContextWindow, computeUsedTokenMetrics, appendUpdatesSegment } from "./statusline-lib.mjs";

test("formatCurrentTokens: thousands with one decimal digit", () => {
  assert.equal(formatCurrentTokens(123400), "123.4K");
  assert.equal(formatCurrentTokens(0), "0.0K");
});

test("formatContextWindow: compact K/M label, trailing .0 stripped", () => {
  assert.equal(formatContextWindow(200000), "200K");
  assert.equal(formatContextWindow(1000000), "1M");
  assert.equal(formatContextWindow(1500000), "1.5M");
});

test("computeUsedTokenMetrics: null when remaining_percentage absent", () => {
  assert.equal(computeUsedTokenMetrics({}), null);
  assert.equal(computeUsedTokenMetrics(null), null);
  assert.equal(computeUsedTokenMetrics({ context_window: {} }), null);
});

test("computeUsedTokenMetrics: sums current_usage fields, default 16.5% buffer", () => {
  const result = computeUsedTokenMetrics({
    context_window: {
      remaining_percentage: 72.3,
      total_tokens: 200000,
      current_usage: { input_tokens: 40000, cache_creation_input_tokens: 1000, cache_read_input_tokens: 2000, output_tokens: 500 },
    },
  });
  assert.equal(result.totalCtx, 200000);
  assert.equal(result.usedTokens, 43500);
  assert.equal(result.used.toFixed(1), "33.2");
});

test("computeUsedTokenMetrics: usedTokens null when current_usage absent, defaults totalCtx to 1M", () => {
  const result = computeUsedTokenMetrics({ context_window: { remaining_percentage: 40 } });
  assert.equal(result.usedTokens, null);
  assert.equal(result.totalCtx, 1_000_000);
  assert.equal(result.used.toFixed(1), "71.9");
});

test("computeUsedTokenMetrics: usedTokens null when current_usage sums to zero", () => {
  const result = computeUsedTokenMetrics({ context_window: { remaining_percentage: 50, total_tokens: 100000, current_usage: {} } });
  assert.equal(result.usedTokens, null);
});

test("computeUsedTokenMetrics: derives buffer from CLAUDE_CODE_AUTO_COMPACT_WINDOW when set", () => {
  const prev = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = "50000";
  try {
    const result = computeUsedTokenMetrics({ context_window: { remaining_percentage: 90, total_tokens: 100000 } });
    assert.equal(result.used.toFixed(1), "20.0");
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
    else process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = prev;
  }
});

test("computeUsedTokenMetrics: used is clamped to [0, 100]", () => {
  const low = computeUsedTokenMetrics({ context_window: { remaining_percentage: 100, total_tokens: 100000 } });
  assert.equal(low.used, 0);
  const high = computeUsedTokenMetrics({ context_window: { remaining_percentage: 0, total_tokens: 100000 } });
  assert.equal(high.used, 100);
});

test("appendUpdatesSegment: appends when count>0, no-op otherwise", () => {
  assert.equal(appendUpdatesSegment("bar", 0), "bar");
  assert.equal(appendUpdatesSegment("bar", undefined), "bar");
  assert.equal(appendUpdatesSegment(null, 2), null);
  const out = appendUpdatesSegment("bar", 2);
  assert.match(out, /⬆2/);
  assert.ok(out.startsWith("bar"));
});

test("appendUpdatesSegment: inserts before a trailing newline", () => {
  const out = appendUpdatesSegment("bar\n", 1);
  assert.ok(out.endsWith("\n"));
  assert.match(out, /⬆1[^\n]*\n$/);
});
