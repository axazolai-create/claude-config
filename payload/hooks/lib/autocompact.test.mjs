import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAutocompact, observationFrom, promotePending, autoCompactEnabledFrom } from "./autocompact.mjs";

test("resolveAutocompact: an explicit env override wins", () => {
  const r = resolveAutocompact({ windowSize: 1_000_000, modelId: "m", state: null,
    env: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "80" }, enabled: true });
  assert.deepEqual(r, { tokens: 800000, source: "env" });
});

test("resolveAutocompact: an observation for this model beats the assumption", () => {
  const state = { models: { m: { tokens: 835000, windowSize: 1_000_000 } } };
  assert.deepEqual(resolveAutocompact({ windowSize: 1_000_000, modelId: "m", state, env: {}, enabled: true }),
    { tokens: 835000, source: "observed" });
});

test("resolveAutocompact: an observation for another model is not borrowed", () => {
  const state = { models: { other: { tokens: 180000, windowSize: 200000 } } };
  assert.deepEqual(resolveAutocompact({ windowSize: 1_000_000, modelId: "m", state, env: {}, enabled: true }),
    { tokens: 1_000_000, source: "assumed" });
});

test("resolveAutocompact: an observation larger than the current window is ignored", () => {
  const state = { models: { m: { tokens: 900000, windowSize: 1_000_000 } } };
  assert.deepEqual(resolveAutocompact({ windowSize: 200000, modelId: "m", state, env: {}, enabled: true }),
    { tokens: 200000, source: "assumed" });
});

test("resolveAutocompact: with nothing known the point is the window itself", () => {
  assert.deepEqual(resolveAutocompact({ windowSize: 200000, modelId: "m", state: null, env: {}, enabled: true }),
    { tokens: 200000, source: "assumed" });
});

test("resolveAutocompact: compaction turned off means there is nothing to warn about", () => {
  assert.deepEqual(resolveAutocompact({ windowSize: 200000, modelId: "m",
    state: { models: { m: { tokens: 100000 } } }, env: {}, enabled: false }),
    { tokens: 200000, source: "disabled" });
});

test("resolveAutocompact: a junk env value is ignored, not obeyed", () => {
  for (const v of ["0", "-5", "101", "abc", ""]) {
    assert.equal(resolveAutocompact({ windowSize: 200000, modelId: "m", state: null,
      env: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: v }, enabled: true }).source, "assumed");
  }
});

test("resolveAutocompact: CLAUDE_CODE_AUTO_COMPACT_WINDOW sets the effective capacity", () => {
  const r = resolveAutocompact({ windowSize: 1_000_000, modelId: "m", state: null,
    env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "500000" }, enabled: true });
  assert.deepEqual(r, { tokens: 500000, source: "assumed" });
});

test("resolveAutocompact: CLAUDE_CODE_AUTO_COMPACT_WINDOW is capped at the model window", () => {
  const r = resolveAutocompact({ windowSize: 1_000_000, modelId: "m", state: null,
    env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "2000000" }, enabled: true });
  assert.deepEqual(r, { tokens: 1_000_000, source: "assumed" });
});

test("resolveAutocompact: a junk CLAUDE_CODE_AUTO_COMPACT_WINDOW is ignored, not obeyed", () => {
  for (const v of ["0", "-5", "abc", ""]) {
    const r = resolveAutocompact({ windowSize: 1_000_000, modelId: "m", state: null,
      env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: v }, enabled: true });
    assert.deepEqual(r, { tokens: 1_000_000, source: "assumed" }, `v=${v}`);
  }
});

test("resolveAutocompact: an observation above the narrowed capacity is stale, falls through to assumed", () => {
  const state = { models: { m: { tokens: 900000, windowSize: 1_000_000 } } };
  const r = resolveAutocompact({ windowSize: 1_000_000, modelId: "m", state,
    env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "500000" }, enabled: true });
  assert.deepEqual(r, { tokens: 500000, source: "assumed" });
});

test("resolveAutocompact: null without a usable window", () => {
  assert.equal(resolveAutocompact({ windowSize: 0, modelId: "m", state: null, env: {}, enabled: true }), null);
  assert.equal(resolveAutocompact({ windowSize: NaN, modelId: "m", state: null, env: {}, enabled: true }), null);
  assert.equal(resolveAutocompact(null), null);
});

test("observationFrom: sums the last assistant usage", () => {
  const records = [
    { type: "user", message: { content: "hi" } },
    { type: "assistant", message: { model: "claude-opus-5", usage: { input_tokens: 1, output_tokens: 2,
      cache_creation_input_tokens: 3, cache_read_input_tokens: 4 } } },
    { type: "assistant", message: { model: "claude-opus-5", usage: { input_tokens: 10, output_tokens: 20,
      cache_creation_input_tokens: 30, cache_read_input_tokens: 40 } } },
  ];
  assert.deepEqual(observationFrom(records), { tokens: 100, model: "claude-opus-5" });
});

test("observationFrom: nothing usable yields null", () => {
  assert.equal(observationFrom([]), null);
  assert.equal(observationFrom([{ type: "user", message: { content: "x" } }]), null);
  assert.equal(observationFrom([{ type: "assistant", message: {} }]), null);
  assert.equal(observationFrom([{ type: "assistant", message: { usage: { input_tokens: 0 } } }]), null);
});

test("promotePending: an unkeyed record becomes a keyed one and the pending clears", () => {
  const state = { pending: { tokens: 835000, model: "claude-opus-5", at: "2026-07-30T18:00:00Z" } };
  const { next, changed } = promotePending(state, { modelId: "claude-opus-5[1m]", windowSize: 1_000_000 });
  assert.equal(changed, true);
  assert.equal(next.pending, undefined);
  assert.equal(next.models["claude-opus-5[1m]"].tokens, 835000);
  assert.equal(next.models["claude-opus-5[1m]"].windowSize, 1_000_000);
});

test("promotePending: a figure bigger than this window is discarded, not promoted", () => {
  const state = { pending: { tokens: 835000, model: "claude-opus-5", at: "2026-07-30T18:00:00Z" },
    models: { "claude-sonnet-5": { tokens: 100000, windowSize: 200000 } } };
  const { next, changed } = promotePending(state, { modelId: "claude-opus-5", windowSize: 200000 });
  assert.equal(changed, true);
  assert.equal(next.pending, undefined);
  // Discarded, not wiped: an unrelated model's entry must survive the clamp branch.
  assert.deepEqual(next.models, { "claude-sonnet-5": { tokens: 100000, windowSize: 200000 } });
});

test("promotePending: an observation from a different model is not promoted, pending survives", () => {
  const state = { pending: { tokens: 180000, model: "claude-sonnet-5", at: "2026-07-30T18:00:00Z" } };
  const { next, changed } = promotePending(state, { modelId: "claude-opus-5[1m]", windowSize: 1_000_000 });
  assert.equal(changed, false);
  assert.deepEqual(next.pending, { tokens: 180000, model: "claude-sonnet-5", at: "2026-07-30T18:00:00Z" });
  assert.equal(next.models, undefined);
});

test("promotePending: a variant suffix or a date suffix does not block promotion", () => {
  const variant = promotePending({ pending: { tokens: 500000, model: "claude-opus-5", at: "2026-07-30T18:00:00Z" } },
    { modelId: "claude-opus-5[1m]", windowSize: 1_000_000 });
  assert.equal(variant.changed, true);
  assert.equal(variant.next.models["claude-opus-5[1m]"].tokens, 500000);

  const dated = promotePending(
    { pending: { tokens: 150000, model: "claude-opus-5-20250514", at: "2026-07-30T18:00:00Z" } },
    { modelId: "claude-opus-5", windowSize: 200000 });
  assert.equal(dated.changed, true);
  assert.equal(dated.next.models["claude-opus-5"].tokens, 150000);
});

test("promotePending: an over-age pending record is discarded, not promoted", () => {
  const state = { pending: { tokens: 500000, model: "claude-opus-5", at: "2026-07-30T00:00:00Z" } };
  const justPastCutoff = new Date("2026-07-30T06:00:01Z").getTime();
  const { next, changed } = promotePending(state,
    { modelId: "claude-opus-5", windowSize: 1_000_000, now: justPastCutoff });
  assert.equal(changed, true);
  assert.equal(next.pending, undefined);
  assert.equal(next.models, undefined);
});

test("promotePending: a record just under the age cutoff is still promoted", () => {
  const state = { pending: { tokens: 500000, model: "claude-opus-5", at: "2026-07-30T00:00:00Z" } };
  const justUnderCutoff = new Date("2026-07-30T05:59:59Z").getTime();
  const { next, changed } = promotePending(state,
    { modelId: "claude-opus-5", windowSize: 1_000_000, now: justUnderCutoff });
  assert.equal(changed, true);
  assert.equal(next.models["claude-opus-5"].tokens, 500000);
});

test("promotePending: does not mutate the caller's original state object", () => {
  const state = { pending: { tokens: 835000, model: "claude-opus-5", at: "2026-07-30T18:00:00Z" } };
  const before = JSON.parse(JSON.stringify(state));
  promotePending(state, { modelId: "claude-opus-5[1m]", windowSize: 1_000_000 });
  assert.deepEqual(state, before);
});

test("promotePending: no pending means no write", () => {
  assert.deepEqual(promotePending({ models: {} }, { modelId: "m", windowSize: 1000 }),
    { next: { models: {} }, changed: false });
  assert.equal(promotePending(null, { modelId: "m", windowSize: 1000 }).changed, false);
  assert.deepEqual(promotePending({}, null),
    { next: {}, changed: false });
});

test("autoCompactEnabledFrom: absent means on", () => {
  assert.equal(autoCompactEnabledFrom({}), true);
  assert.equal(autoCompactEnabledFrom(null), true);
  assert.equal(autoCompactEnabledFrom({ autoCompactEnabled: true }), true);
  assert.equal(autoCompactEnabledFrom({ autoCompactEnabled: false }), false);
});
