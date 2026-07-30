// payload/hooks/lib/statusline-lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCurrentTokens, formatContextWindow, computeContext } from "./statusline-lib.mjs";

test("formatCurrentTokens: thousands with one decimal digit", () => {
  assert.equal(formatCurrentTokens(123400), "123.4K");
  assert.equal(formatCurrentTokens(0), "0.0K");
});

test("formatContextWindow: compact K/M label, trailing .0 stripped", () => {
  assert.equal(formatContextWindow(200000), "200K");
  assert.equal(formatContextWindow(1000000), "1M");
  assert.equal(formatContextWindow(1500000), "1.5M");
});

test("computeContext: window size comes from context_window_size", () => {
  assert.equal(
    computeContext({ context_window: { context_window_size: 200000, used_percentage: 22,
      current_usage: { input_tokens: 40000, cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 2000, output_tokens: 500 } } }),
    "43.5K/200K 22%");
});

test("computeContext: falls back to total_tokens, then to 1M", () => {
  assert.equal(computeContext({ context_window: { total_tokens: 200000, used_percentage: 10 } }),
    "20.0K/200K 10%");
  assert.equal(computeContext({ context_window: { used_percentage: 10 } }), "100.0K/1M 10%");
});

test("computeContext: the real usage sum wins over the percentage estimate", () => {
  const out = computeContext({ context_window: { context_window_size: 1000000, used_percentage: 50,
    current_usage: { input_tokens: 1000, output_tokens: 500 } } });
  assert.equal(out, "1.5K/1M 50%");
});

test("computeContext: tokens without a percentage, and a percentage without tokens", () => {
  assert.equal(computeContext({ context_window: { context_window_size: 200000,
    current_usage: { input_tokens: 5000 } } }), "5.0K/200K");
  assert.equal(computeContext({ context_window: { context_window_size: 200000, used_percentage: 3 } }),
    "6.0K/200K 3%");
});

test("computeContext: nothing to show yields an empty segment", () => {
  assert.equal(computeContext({}), "");
  assert.equal(computeContext({ context_window: {} }), "");
  assert.equal(computeContext({ context_window: { current_usage: {} } }), "");
  assert.equal(computeContext(null), "");
});

test("computeContext: the autocompact env var no longer changes anything", () => {
  const data = { context_window: { context_window_size: 1000000, used_percentage: 20 } };
  const before = computeContext(data);
  process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = "500000";
  try { assert.equal(computeContext(data), before); }
  finally { delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW; }
});
