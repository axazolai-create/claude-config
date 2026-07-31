// payload/hooks/lib/phase-segment.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { renderPhaseSegment, readPhaseState, roadmapPhases } from "./phase-segment.mjs";

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

const dir = (name) => {
  const d = join(mkdtempSync(join(tmpdir(), "phaseseg-")), name);
  mkdirSync(d, { recursive: true });
  return d;
};
const write = (p, body) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); return p; };

const roadmap = ({ current = null, rows = [], eol = "\n" }) =>
  (`---\ncurrent: ${current === null ? "null" : `"${current}"`}\nphases:\n` +
    rows.map((r) => `  - { phase: "${r.phase}", slug: ${r.slug}, status: ${r.status} }`).join("\n") +
    `\n---\n\n# Roadmap\n`).replace(/\n/g, eol);

const ROWS = [
  { phase: "08", slug: "unified-statusline", status: "complete" },
  { phase: "09", slug: "ctx-severity", status: "running" },
];

test("roadmapPhases parses the inline maps", () => {
  const rows = roadmapPhases(roadmap({ current: "09", rows: ROWS }));
  assert.equal(rows.length, 2);
  assert.equal(rows[1].phase, "09");
  assert.equal(rows[1].slug, "ctx-severity");
  assert.equal(rows[1].status, "running");
});

test("roadmapPhases parses CRLF frontmatter", () => {
  const rows = roadmapPhases(roadmap({ current: "09", rows: ROWS, eol: "\r\n" }));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].slug, "unified-statusline");
});

test("no ROADMAP means no segment at all", () => {
  assert.equal(readPhaseState(dir("empty")), null);
});

test("current names the phase, and its state file supplies the action", () => {
  const root = dir("by-current");
  write(join(root, ".ultrapowers", "ROADMAP.md"), roadmap({ current: "09", rows: ROWS }));
  write(join(root, ".ultrapowers", "phases", "09-ctx-severity", "09-STATE.md"),
    '---\nphase: "09"\nstatus: running\naction: planning\n---\n');
  const st = readPhaseState(root);
  assert.equal(st.mode, "action");
  assert.equal(st.id, "09");
  assert.equal(st.name, "ctx-severity");
  assert.equal(st.action, "planning");
});

test("with current null, exactly one running phase resolves", () => {
  const root = dir("by-running");
  write(join(root, ".ultrapowers", "ROADMAP.md"), roadmap({ current: null, rows: ROWS }));
  write(join(root, ".ultrapowers", "phases", "09-ctx-severity", "09-STATE.md"),
    '---\nphase: "09"\nstatus: running\naction: review\n---\n');
  assert.equal(readPhaseState(root).action, "review");
});

test("several running phases resolve to the tally instead of a guess", () => {
  const root = dir("ambiguous");
  write(join(root, ".ultrapowers", "ROADMAP.md"), roadmap({ current: null, rows: [
    { phase: "08", slug: "a", status: "running" }, { phase: "09", slug: "b", status: "running" }] }));
  assert.equal(readPhaseState(root).mode, "tally");
});

test("the tally counts every phase except abandoned ones", () => {
  const root = dir("tally");
  write(join(root, ".ultrapowers", "ROADMAP.md"), roadmap({ current: null, rows: [
    { phase: "01", slug: "a", status: "complete" },
    { phase: "02", slug: "b", status: "abandoned" },
    { phase: "03", slug: "c", status: "superseded" },
    { phase: "04", slug: "last-one", status: "complete" }] }));
  const st = readPhaseState(root);
  assert.equal(st.mode, "tally");
  assert.equal(st.phasesDone, 2);
  assert.equal(st.phasesTotal, 3);
  assert.equal(st.name, "last-one");
});

test("a live ledger with an unreported brief switches to executing and supplies the counts", () => {
  const root = dir("executing");
  write(join(root, ".ultrapowers", "ROADMAP.md"), roadmap({ current: "09", rows: ROWS }));
  write(join(root, ".ultrapowers", "phases", "09-ctx-severity", "09-STATE.md"),
    '---\nphase: "09"\nstatus: running\naction: planning\ntasks_total: 99\ntasks_done: 99\n---\n');
  const sdd = join(root, ".ultrapowers", "sdd", "phases-09-ctx-severity");
  for (const n of [1, 2, 3, 4, 5, 6]) write(join(sdd, `task-${n}-brief.md`), "b");
  for (const n of [1, 2]) write(join(sdd, `task-${n}-report.md`), "r");
  const st = readPhaseState(root);
  assert.equal(st.mode, "executing");
  assert.deepEqual(st.counts, { done: 2, active: 4, fixing: 0, queued: 0, blocked: 0 });
});

test("fixing and blocked come from frontmatter, and the queue is what is left", () => {
  const root = dir("fixing");
  write(join(root, ".ultrapowers", "ROADMAP.md"), roadmap({ current: "09", rows: ROWS }));
  write(join(root, ".ultrapowers", "phases", "09-ctx-severity", "09-STATE.md"),
    '---\nphase: "09"\nstatus: running\ntasks_fixing: 1\ntasks_blocked: 1\n---\n');
  const sdd = join(root, ".ultrapowers", "sdd", "phases-09-ctx-severity");
  for (const n of [1, 2, 3, 4, 5, 6]) write(join(sdd, `task-${n}-brief.md`), "b");
  write(join(sdd, "task-1-report.md"), "r");
  const st = readPhaseState(root);
  // 6 briefs, 1 reported, 5 unreported. 1 of those is fixing and 1 is blocked, so 3 remain active.
  assert.deepEqual(st.counts, { done: 1, active: 3, fixing: 1, queued: 0, blocked: 1 });
});

test("a ledger belonging to another phase is never consulted", () => {
  const root = dir("other-ledger");
  write(join(root, ".ultrapowers", "ROADMAP.md"), roadmap({ current: "09", rows: ROWS }));
  write(join(root, ".ultrapowers", "phases", "09-ctx-severity", "09-STATE.md"),
    '---\nphase: "09"\nstatus: running\naction: planning\n---\n');
  write(join(root, ".ultrapowers", "sdd", "phases-08-unified-statusline", "task-1-brief.md"), "b");
  assert.equal(readPhaseState(root).mode, "action");
});

test("a ledger whose briefs are all reported is not executing", () => {
  const root = dir("ledger-done");
  write(join(root, ".ultrapowers", "ROADMAP.md"), roadmap({ current: "09", rows: ROWS }));
  write(join(root, ".ultrapowers", "phases", "09-ctx-severity", "09-STATE.md"),
    '---\nphase: "09"\nstatus: running\naction: review\n---\n');
  const sdd = join(root, ".ultrapowers", "sdd", "phases-09-ctx-severity");
  write(join(sdd, "task-1-brief.md"), "b");
  write(join(sdd, "task-1-report.md"), "r");
  assert.equal(readPhaseState(root).mode, "action");
});

test("a current naming a phase with no directory falls to the tally", () => {
  const root = dir("dangling");
  write(join(root, ".ultrapowers", "ROADMAP.md"), roadmap({ current: "07", rows: ROWS }));
  assert.equal(readPhaseState(root).mode, "tally");
});
