// payload/hooks/statusline.test.mjs
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { renderUpdates, renderGsd, renderSdd, renderPhase, roadmapPhases, render, installedProfile } from "./statusline.mjs";

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

test("nothing pending renders no updates segment", () => {
  assert.equal(renderUpdates([]), "");
  assert.equal(renderUpdates(null), "");
});

test("up to two components are named, the rest collapse", () => {
  assert.equal(strip(renderUpdates(["context-mode"])), "⬆ context-mode");
  assert.equal(strip(renderUpdates(["context-mode", "graphify"])), "⬆ context-mode graphify");
  assert.equal(strip(renderUpdates(["a", "b", "c", "d"])), "⬆ a b +2");
});

test("the gsd segment mirrors gsd-core's own vocabulary", () => {
  assert.equal(renderGsd({ milestone: "v2.0", phase: "4.5", status: "executing", percent: 40 }),
    "v2.0 [██░] 40% · Phase 4.5 executing");
});

test("the sdd segment names the plan and where to resume", () => {
  assert.equal(renderSdd({ plan: "planning-tree", complete: 3, next: 4 }), "planning-tree ✔3 →4");
});

test("renderPhase prints a tally and never a percentage", () => {
  assert.equal(renderPhase({ id: "08", done: 2, total: 6, status: "running" }), "08 ✔2/6 running");
  assert.doesNotMatch(renderPhase({ id: "08", done: 6, total: 7, status: "complete" }), /%/);
});

test("renderPhase subtracts dropped tasks from the denominator", () => {
  assert.equal(renderPhase({ id: "07", done: 6, total: 7, dropped: 1, status: "complete" }),
    "07 ✔6/6 complete");
});

// null is the shape phaseSegment really supplies, because fmField returns null for an absent key.
test("renderPhase omits the tally when the phase has no plan yet", () => {
  assert.equal(renderPhase({ id: "08", status: "planned" }), "08 planned");
  assert.equal(renderPhase({ id: "08", done: null, total: null, dropped: null, status: "planned" }),
    "08 planned");
  assert.equal(renderPhase({ id: "08", done: 5, total: null, dropped: null, status: "planned" }),
    "08 planned");
});

test("renderPhase never interpolates undefined", () => {
  assert.equal(renderPhase(), "");
  assert.doesNotMatch(renderPhase({ id: "08" }), /undefined/);
  assert.doesNotMatch(renderPhase({ id: "08", done: null, total: null }), /undefined|NaN/);
});

test("roadmapPhases parses the inline maps", () => {
  const rows = roadmapPhases([
    "---",
    'current: "08"',
    "phases:",
    '  - { phase: "07", slug: a, status: complete, integration: merged }',
    '  - { phase: "08", slug: b, status: running, delivery: branch }',
    "---",
  ].join("\n"));
  assert.deepEqual(rows.map((r) => [r.phase, r.status]), [["07", "complete"], ["08", "running"]]);
});

test("roadmapPhases parses CRLF frontmatter", () => {
  const rows = roadmapPhases([
    "---",
    'current: "08"',
    "phases:",
    '  - { phase: "07", slug: a, status: complete }',
    '  - { phase: "08", slug: b, status: running }',
    "---",
  ].join("\r\n"));
  assert.deepEqual(rows.map((r) => [r.phase, r.status]), [["07", "complete"], ["08", "running"]]);
});

test("render joins the floor in order", () => {
  const line = strip(render({ updates: [], model: "Opus 5 (1M)", context: "45.0K/200K 22%",
    project: "claude-config" }));
  assert.equal(line, "Opus 5 (1M) │ 45.0K/200K 22% │ claude-config");
});

test("render puts updates first, named", () => {
  const line = strip(render({ updates: ["context-mode"], model: "Opus", context: "1.0K/1M 0%",
    project: "p" }));
  assert.equal(line, "⬆ context-mode │ Opus │ 1.0K/1M 0% │ p");
});

test("render appends gsd then up, and omits either when absent", () => {
  const base = { updates: [], model: "Opus", context: "", project: "p" };
  assert.equal(strip(render({ ...base, gsd: "v1.0 · Phase 3 executing" })),
    "Opus │ p │ v1.0 · Phase 3 executing");
  assert.equal(strip(render({ ...base, up: "08 ✔2/6 running" })), "Opus │ p │ 08 ✔2/6 running");
  assert.equal(strip(render({ ...base, gsd: "v1.0", up: "08 planned" })),
    "Opus │ p │ v1.0 │ 08 planned");
});

test("render survives every segment being empty", () => {
  assert.equal(strip(render({ updates: [], model: "", context: "", project: "" })), "");
  assert.equal(strip(render()), "");
});

test("the gsd bar is full only at 100% and empty only at 0%", () => {
  const bar = (percent) => /\[(.*?)\]/.exec(renderGsd({ milestone: "v1", phase: "1", status: "x", percent }))[1];
  assert.equal(bar(0), "░░░");
  assert.equal(bar(1), "█░░");
  assert.equal(bar(83), "██░");
  assert.equal(bar(99), "██░");
  assert.equal(bar(100), "███");
});

test("the gsd segment drops the bar rather than claim 0% it does not know", () => {
  assert.equal(renderGsd({ milestone: "v1.0", phase: "05.1", status: "verifying" }),
    "v1.0 · Phase 05.1 verifying");
  assert.equal(renderGsd({ milestone: "v1.0", phase: "05.1", percent: 50 }), "v1.0 [██░] 50% · Phase 05.1");
});

test("the pure renderers never throw on absent or malformed input", () => {
  assert.equal(renderUpdates("context-mode"), "");
  assert.equal(renderUpdates({}), "");
  assert.doesNotThrow(() => renderGsd());
  assert.doesNotThrow(() => renderSdd());
  assert.doesNotThrow(() => render());
});

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), "statusline.mjs");
const TMP = mkdtempSync(join(tmpdir(), "statusline-test-"));
after(() => rmSync(TMP, { recursive: true, force: true }));

const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); return path; };
const dir = (...parts) => { const p = join(TMP, ...parts); mkdirSync(p, { recursive: true }); return p; };

const EMPTY_CLAUDE_DIR = dir("claude-empty");
// The gsd segment requires gsd-core installed, so every gsd assertion needs a claudeDir that has it.
const GSD_CLAUDE_DIR = dir("claude-gsd-core");
write(join(GSD_CLAUDE_DIR, "gsd-core", "VERSION"), "1.8.0\n");

function runEntry(input, { claudeDir = EMPTY_CLAUDE_DIR } = {}) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: claudeDir };
  delete env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  return spawnSync(process.execPath, [ENTRY], { input, encoding: "utf8", env, cwd: TMP });
}

const payload = (root, extra = {}) => JSON.stringify({ workspace: { current_dir: root }, ...extra });

test("entry point: the project segment is the directory name and nothing else", () => {
  const root = dir("proj-only");
  const out = runEntry(payload(root, { model: { display_name: "Opus 5" } }));
  assert.equal(out.status, 0);
  assert.equal(strip(out.stdout), "Opus 5 │ proj-only");
});

test("entry point: malformed JSON on stdin yields a clean line and a zero exit", () => {
  const root = dir("plain-malformed");
  const bad = runEntry("{ this is not json");
  assert.equal(bad.status, 0);
  assert.equal(bad.stderr, "");
  assert.doesNotMatch(bad.stdout, /Error|at .*\.mjs/);
  const rooted = runEntry(`{ "workspace": broken ${root}`);
  assert.equal(rooted.status, 0);
  assert.equal(rooted.stderr, "");
});

test("entry point: empty stdin yields a zero exit and no stack trace", () => {
  const out = runEntry("");
  assert.equal(out.status, 0);
  assert.equal(out.stderr, "");
  assert.doesNotMatch(out.stdout, /Error|at .*\.mjs/);
  assert.ok(strip(out.stdout).startsWith(basename(TMP)), `got: ${JSON.stringify(out.stdout)}`);
});

test("entry point: a missing state file renders no updates segment", () => {
  const root = dir("plain-nostate");
  const out = runEntry(payload(root));
  assert.equal(out.status, 0);
  assert.equal(out.stderr, "");
  assert.doesNotMatch(out.stdout, /⬆/);
  assert.ok(strip(out.stdout).startsWith("plain-nostate"), `got: ${JSON.stringify(out.stdout)}`);
});

test("entry point: an unreadable state file renders no updates segment", () => {
  const claudeDir = dir("claude-unreadable");
  mkdirSync(join(claudeDir, "state", "component-updates.json"), { recursive: true });
  const root = dir("plain-unreadable");
  const out = runEntry(payload(root), { claudeDir });
  assert.equal(out.status, 0);
  assert.equal(out.stderr, "");
  assert.doesNotMatch(out.stdout, /⬆/);
  assert.ok(strip(out.stdout).startsWith("plain-unreadable"));
});

test("entry point: a malformed state file renders no updates segment", () => {
  const claudeDir = dir("claude-badjson");
  write(join(claudeDir, "state", "component-updates.json"), "{ not json");
  const out = runEntry(payload(dir("plain-badjson")), { claudeDir });
  assert.equal(out.status, 0);
  assert.equal(out.stderr, "");
  assert.doesNotMatch(out.stdout, /⬆/);
});

test("entry point: a registry in an unexpected shape renders no updates segment", () => {
  for (const shape of ['"a string"', "[1,2,3]", "null", "42", '{"context-mode":null}', '{"context-mode":"yes"}']) {
    const claudeDir = dir(`claude-shape-${Buffer.from(shape).toString("hex")}`);
    write(join(claudeDir, "state", "component-updates.json"), shape);
    const out = runEntry(payload(dir("plain-shape")), { claudeDir });
    assert.equal(out.status, 0, `shape ${shape}`);
    assert.equal(out.stderr, "", `shape ${shape}`);
    assert.doesNotMatch(out.stdout, /⬆/, `shape ${shape}`);
  }
});

test("entry point: pending components are named first, in registry order", () => {
  const claudeDir = dir("claude-pending");
  write(join(claudeDir, "state", "component-updates.json"), JSON.stringify({
    graphify: { updateAvailable: true },
    "context-mode": { updateAvailable: true },
    zzz: { updateAvailable: true },
    quiet: { updateAvailable: false },
  }));
  const out = runEntry(payload(dir("plain-pending")), { claudeDir });
  assert.equal(out.status, 0);
  assert.ok(strip(out.stdout).startsWith("⬆ context-mode graphify +1 │ "), `got: ${JSON.stringify(out.stdout)}`);
});

test("entry point: the context segment shows the real current_usage sum", () => {
  const out = runEntry(payload(dir("plain-ctx"), {
    context_window: {
      context_window_size: 200000,
      used_percentage: 22,
      current_usage: { input_tokens: 40000, cache_creation_input_tokens: 1000, cache_read_input_tokens: 2000, output_tokens: 500 },
    },
  }));
  assert.equal(out.status, 0);
  assert.ok(strip(out.stdout).startsWith("43.5K/200K 22% │ "), `got: ${JSON.stringify(out.stdout)}`);
});

test("entry point: the context segment falls back to the estimate without current_usage", () => {
  const out = runEntry(payload(dir("plain-ctx-est"), { context_window: { total_tokens: 200000, used_percentage: 10 } }));
  assert.equal(out.status, 0);
  assert.ok(strip(out.stdout).startsWith("20.0K/200K 10% │ "), `got: ${JSON.stringify(out.stdout)}`);
});

test("entry point: no context_window means no context segment, not a broken one", () => {
  const out = runEntry(payload(dir("plain-noctx")));
  assert.equal(out.status, 0);
  assert.equal(strip(out.stdout).includes("NaN"), false);
  assert.equal(strip(out.stdout).includes("undefined"), false);
  assert.ok(strip(out.stdout).startsWith("plain-noctx"));
});

const GSD_STATE = `---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 05.1
current_phase_name: nas-transport-robustness-hardening
status: verifying
progress:
  total_phases: 6
  completed_phases: 5
---

# Project State
`;

test("entry point: a real GSD project renders the gsd segment", () => {
  const root = dir("gsd-proj");
  write(join(root, ".planning", "config.json"), "{}");
  write(join(root, ".planning", "STATE.md"), GSD_STATE);
  const out = runEntry(payload(root), { claudeDir: GSD_CLAUDE_DIR });
  assert.equal(out.status, 0);
  assert.equal(strip(out.stdout), "gsd-proj │ v1.0 [██░] 83% · Phase 05.1 verifying");
});

test("entry point: a .planning this parser cannot read falls through, it does not guess", () => {
  const root = dir("gsd-unparseable");
  write(join(root, ".planning", "config.json"), "{}");
  write(join(root, ".planning", "STATE.md"), "# nothing this parser understands\n");
  const out = runEntry(payload(root), { claudeDir: GSD_CLAUDE_DIR });
  assert.equal(out.status, 0);
  assert.equal(out.stderr, "");
  assert.equal(strip(out.stdout).includes("undefined"), false);
  assert.ok(strip(out.stdout).startsWith("gsd-unparseable"));
});

test("entry point: a .planning with no STATE.md at all falls through", () => {
  const root = dir("gsd-nostate");
  write(join(root, ".planning", "config.json"), "{}");
  const out = runEntry(payload(root), { claudeDir: GSD_CLAUDE_DIR });
  assert.equal(out.status, 0);
  assert.equal(out.stderr, "");
  assert.ok(strip(out.stdout).startsWith("gsd-nostate"));
});

const LEDGER = `# SDD ledger — plan: docs/plans/2026-07-28-planning-tree.md

## Progress
Task 1: complete (commits aaa..bbb)
Task 1: review NEEDS FIXES
Task 2: complete
Task 3: complete
Task 4: in progress
`;

test("entry point: an SDD plan in flight renders the sdd segment", () => {
  const root = dir("sdd-proj");
  write(join(root, ".ultrapowers", "sdd", "2026-01-01-old", "progress.md"), "# SDD ledger — plan: docs/plans/old.md\nTask 1: complete\n");
  write(join(root, ".ultrapowers", "sdd", "2026-07-28-current", "progress.md"), LEDGER);
  const out = runEntry(payload(root));
  assert.equal(out.status, 0);
  assert.equal(strip(out.stdout), "sdd-proj │ 2026-07-28-planning-tree ✔3 →4");
});

test("entry point: the most recently written ledger wins, not the last name", () => {
  const root = dir("sdd-mtime");
  const stale = write(join(root, ".ultrapowers", "sdd", "2026-07-28-zzz-last-by-name", "progress.md"),
    "# SDD ledger — plan: docs/plans/stale.md\nTask 1: complete\n");
  const live = write(join(root, ".ultrapowers", "sdd", "2026-07-28-aaa-first-by-name", "progress.md"), LEDGER);
  utimesSync(stale, 1_000_000, 1_000_000);
  utimesSync(live, 2_000_000, 2_000_000);
  assert.equal(strip(runEntry(payload(root)).stdout), "sdd-mtime │ 2026-07-28-planning-tree ✔3 →4");
});

test("entry point: an .ultrapowers/sdd with no ledger falls through", () => {
  const root = dir("sdd-empty");
  mkdirSync(join(root, ".ultrapowers", "sdd", "2026-01-01-x"), { recursive: true });
  const out = runEntry(payload(root));
  assert.equal(out.status, 0);
  assert.equal(out.stderr, "");
  assert.ok(strip(out.stdout).startsWith("sdd-empty"));
});

test("entry point: gsd and up both render when a project has both", () => {
  const root = dir("both-proj");
  write(join(root, ".planning", "config.json"), "{}");
  write(join(root, ".planning", "STATE.md"), GSD_STATE);
  write(join(root, ".ultrapowers", "sdd", "2026-07-28-x", "progress.md"), LEDGER);
  const out = runEntry(payload(root), { claudeDir: GSD_CLAUDE_DIR });
  assert.equal(strip(out.stdout),
    "both-proj │ v1.0 [██░] 83% · Phase 05.1 verifying │ 2026-07-28-planning-tree ✔3 →4");
});

const phaseTree = (name, { current, rows = [], phases = {}, eol = "\n" }) => {
  const root = dir(name);
  const fm = ["---", `current: ${current === null ? "null" : `"${current}"`}`, "phases:",
    ...rows.map((r) => `  - { phase: "${r.phase}", slug: ${r.slug}, status: ${r.status} }`),
    "---", "", "# Roadmap"].join(eol);
  write(join(root, ".ultrapowers", "ROADMAP.md"), fm);
  for (const [id, body] of Object.entries(phases))
    write(join(root, ".ultrapowers", "phases", id, `${id.slice(0, 2)}-STATE.md`), body.replaceAll("\n", eol));
  return root;
};

const STATE_08 = '---\nphase: "08"\nstatus: running\ntasks_done: 2\ntasks_total: 6\n---\n';
const STATE_07_RUNNING = '---\nphase: "07"\nstatus: running\ntasks_done: 5\ntasks_total: 5\n---\n';
const STATE_07_DONE = '---\nphase: "07"\nstatus: complete\ntasks_done: 6\ntasks_total: 7\ntasks_dropped: 1\n---\n';

test("entry point: ROADMAP current names the phase in flight", () => {
  const root = phaseTree("sel-current", { current: "08", phases: { "08-unified": STATE_08 } });
  assert.match(strip(runEntry(payload(root)).stdout), /08 ✔2\/6 running/);
});

test("entry point: current null falls back to exactly one running phase", () => {
  const one = phaseTree("sel-one", {
    current: null,
    rows: [{ phase: "07", slug: "a", status: "complete" }, { phase: "08", slug: "b", status: "running" }],
    phases: { "08-unified": STATE_08 },
  });
  assert.match(strip(runEntry(payload(one)).stdout), /08 ✔2\/6 running/);
});

// Both fixtures give every listed phase a readable STATE.md, so a gate that picked a phase it
// should not have would render a tally here instead of silently finding no directory.
test("entry point: zero or several running phases render no phase segment", () => {
  const none = phaseTree("sel-none", {
    current: null,
    rows: [{ phase: "07", slug: "a", status: "complete" }],
    phases: { "07-earlier": STATE_07_DONE },
  });
  assert.doesNotMatch(strip(runEntry(payload(none)).stdout), /✔/);

  const many = phaseTree("sel-many", {
    current: null,
    rows: [{ phase: "07", slug: "a", status: "running" }, { phase: "08", slug: "b", status: "running" }],
    phases: { "07-earlier": STATE_07_RUNNING, "08-unified": STATE_08 },
  });
  assert.doesNotMatch(strip(runEntry(payload(many)).stdout), /✔/);
});

test("entry point: a phase whose STATE.md predates its plan renders no tally", () => {
  const root = phaseTree("sel-planned", { current: "09", phases: { "09-later": '---\nstatus: planned\n---\n' } });
  const out = strip(runEntry(payload(root)).stdout);
  assert.match(out, /09 planned$/);
  assert.doesNotMatch(out, /✔/);
});

test("entry point: tasks_done without tasks_total renders no tally", () => {
  const root = phaseTree("sel-half-planned", {
    current: "09",
    phases: { "09-later": '---\nstatus: planned\ntasks_done: 5\n---\n' },
  });
  const out = strip(runEntry(payload(root)).stdout);
  assert.match(out, /09 planned$/);
  assert.doesNotMatch(out, /✔/);
});

test("entry point: tasks_dropped shrinks the denominator end to end", () => {
  const root = phaseTree("sel-dropped", { current: "07", phases: { "07-earlier": STATE_07_DONE } });
  assert.match(strip(runEntry(payload(root)).stdout), /07 ✔6\/6 complete/);
});

// .trim() in fmField: CR is a JS LineTerminator so `(.+)$` never captures it, but trailing
// spaces are captured and would leave a quoted id closing-quote intact.
test("entry point: trailing whitespace in frontmatter does not corrupt the id or status", () => {
  const root = dir("sel-pad");
  write(join(root, ".ultrapowers", "ROADMAP.md"), '---\ncurrent: "08"   \nphases:\n---\n');
  write(join(root, ".ultrapowers", "phases", "08-unified", "08-STATE.md"),
    '---\nstatus: running  \ntasks_done: 2\ntasks_total: 6\n---\n');
  assert.match(strip(runEntry(payload(root)).stdout), /08 ✔2\/6 running$/);
});

test("entry point: a phase outranks an SDD ledger, and mtime cannot change that", () => {
  const root = phaseTree("sel-outrank", { current: "08", phases: { "08-unified": STATE_08 } });
  const ledger = write(join(root, ".ultrapowers", "sdd", "p", "progress.md"),
    "# SDD ledger — plan: stale-plan.md\nTask 1: complete\n");
  const future = Date.now() / 1000 + 3600;
  utimesSync(ledger, future, future);
  const out = strip(runEntry(payload(root)).stdout);
  assert.match(out, /08 ✔2\/6 running/);
  assert.doesNotMatch(out, /stale-plan/);
});

test("entry point: CRLF frontmatter resolves the same phase", () => {
  const named = phaseTree("sel-crlf-current", { current: "08", eol: "\r\n", phases: { "08-unified": STATE_08 } });
  assert.match(strip(runEntry(payload(named)).stdout), /08 ✔2\/6 running/);

  const running = phaseTree("sel-crlf-running", {
    current: null,
    eol: "\r\n",
    rows: [{ phase: "07", slug: "a", status: "complete" }, { phase: "08", slug: "b", status: "running" }],
    phases: { "08-unified": STATE_08 },
  });
  assert.match(strip(runEntry(payload(running)).stdout), /08 ✔2\/6 running/);
});

test("entry point: a ROADMAP without a resolvable phase still falls back to the ledger", () => {
  const root = phaseTree("sel-fallback", { current: "09", phases: { "08-unified": STATE_08 } });
  write(join(root, ".ultrapowers", "sdd", "p", "progress.md"),
    "# SDD ledger — plan: live-plan.md\nTask 1: complete\n");
  assert.match(strip(runEntry(payload(root)).stdout), /live-plan ✔1 →2/);
});

test("entry point: the gsd segment needs gsd-core installed, not just .planning", () => {
  const root = dir("gsd-gate");
  write(join(root, ".planning", "config.json"), "{}");
  write(join(root, ".planning", "STATE.md"),
    '---\nmilestone: v1.0\ncurrent_phase: 3\nstatus: executing\npercent: 40\n---\n');

  const without = runEntry(payload(root), { claudeDir: dir("cd-nogsd") });
  assert.doesNotMatch(strip(without.stdout), /v1\.0/);

  const withCore = dir("cd-gsd");
  write(join(withCore, "gsd-core", "VERSION"), "1.8.0\n");
  assert.match(strip(runEntry(payload(root), { claudeDir: withCore }).stdout), /v1\.0/);
});

test("entry point: a workspace directory that does not exist still renders", () => {
  const out = runEntry(payload(join(TMP, "does", "not", "exist")));
  assert.equal(out.status, 0);
  assert.equal(out.stderr, "");
  assert.equal(strip(out.stdout), "exist");
});

test("entry point: the same input renders the same line twice", () => {
  const root = dir("gsd-proj");
  const input = payload(root, { context_window: { remaining_percentage: 72.3, total_tokens: 200000 } });
  assert.equal(runEntry(input).stdout, runEntry(input).stdout);
});

const claudeDirWithProfile = (name, profile) => {
  const d = dir(name);
  if (profile !== undefined) write(join(d, "state", "bundle-manifest.json"), JSON.stringify({ profile }));
  return d;
};

test("installedProfile reads the manifest, and null when there is none", () => {
  assert.equal(installedProfile(claudeDirWithProfile("prof-lite", "lite")), "lite");
  assert.equal(installedProfile(claudeDirWithProfile("prof-none")), null);
});

test("entry point: lite suppresses the ultrapowers segment, base keeps it", () => {
  const root = dir("up-gate");
  write(join(root, ".ultrapowers", "sdd", "p", "progress.md"),
    "# SDD ledger — plan: my-plan.md\nTask 1: complete\n");

  const onLite = runEntry(payload(root), { claudeDir: claudeDirWithProfile("cd-lite", "lite") });
  assert.doesNotMatch(strip(onLite.stdout), /my-plan/);

  const onBase = runEntry(payload(root), { claudeDir: claudeDirWithProfile("cd-base", "base") });
  assert.match(strip(onBase.stdout), /my-plan/);

  const noManifest = runEntry(payload(root), { claudeDir: claudeDirWithProfile("cd-nomanifest") });
  assert.match(strip(noManifest.stdout), /my-plan/, "an absent manifest must fail open");
});
