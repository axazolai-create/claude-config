// payload/hooks/lib/phase-segment.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPhaseSegment } from "./phase-segment.mjs";

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const EXEC = { mode: "executing", id: "09", name: "ctx-severity",
  counts: { done: 2, active: 1, fixing: 0, queued: 3, blocked: 0 } };

test("executing mode prints id, three counts, em dash and name", () => {
  assert.equal(strip(renderPhaseSegment(EXEC)), "09 2/1/3 — ctx-severity");
});

test("the blocked count is appended only when it is non-zero", () => {
  const blocked = { ...EXEC, counts: { ...EXEC.counts, blocked: 1 } };
  assert.equal(strip(renderPhaseSegment(blocked)), "09 2/1/3/1 — ctx-severity");
});

test("done is green, in-work is cyan, queued is uncoloured", () => {
  const out = renderPhaseSegment(EXEC);
  assert.ok(out.includes("\x1b[32m2\x1b[0m"), "done green");
  assert.ok(out.includes("\x1b[36m1\x1b[0m"), "in work cyan");
  assert.ok(out.includes("/3 "), "queued carries no escape");
});

test("the in-work position turns yellow when any task is in the fix loop", () => {
  const fixing = { ...EXEC, counts: { done: 2, active: 1, fixing: 1, queued: 2, blocked: 0 } };
  const out = renderPhaseSegment(fixing);
  assert.equal(strip(out), "09 2/2/2 — ctx-severity");
  assert.ok(out.includes("\x1b[33m2\x1b[0m"), "in work yellow");
  assert.ok(!out.includes("\x1b[36m"), "cyan is not used when fixing");
});

test("the blocked count is red", () => {
  const out = renderPhaseSegment({ ...EXEC, counts: { ...EXEC.counts, blocked: 2 } });
  assert.ok(out.includes("\x1b[31m2\x1b[0m"));
});

test("action mode prints the action in parentheses between id and name", () => {
  assert.equal(strip(renderPhaseSegment({ mode: "action", id: "09", name: "ctx-severity",
    action: "planning", status: "running" })), "09 (planning) ctx-severity");
});

test("the action is cyan, and red when the phase is blocked", () => {
  const running = renderPhaseSegment({ mode: "action", id: "09", name: "n", action: "review", status: "running" });
  const blocked = renderPhaseSegment({ mode: "action", id: "09", name: "n", action: "review", status: "blocked" });
  assert.ok(running.includes("\x1b[36mreview\x1b[0m"));
  assert.ok(blocked.includes("\x1b[31mreview\x1b[0m"));
});

test("a phase with no action prints its id and name alone", () => {
  assert.equal(strip(renderPhaseSegment({ mode: "action", id: "09", name: "ctx-severity" })),
    "09 ctx-severity");
});

test("tally mode prints done over total and the phase name", () => {
  const out = renderPhaseSegment({ mode: "tally", name: "unified-statusline", phasesDone: 8, phasesTotal: 9 });
  assert.equal(strip(out), "8/9 unified-statusline");
  assert.ok(out.includes("\x1b[32m8\x1b[0m"), "numerator green");
  assert.ok(out.includes("/9 "), "denominator plain");
});

test("a negative queue prints the action instead of provably wrong arithmetic", () => {
  const broken = { mode: "executing", id: "09", name: "n", action: "review", status: "running",
    counts: { done: 5, active: 1, fixing: 0, queued: -2, blocked: 0 } };
  assert.equal(strip(renderPhaseSegment(broken)), "09 (review) n");
});

test("no input class throws, and unrenderable input yields an empty string", () => {
  for (const bad of [null, undefined, 42, "x", [], true, {}, { mode: "executing" }, { mode: "tally" }])
    assert.equal(renderPhaseSegment(bad), "");
});
