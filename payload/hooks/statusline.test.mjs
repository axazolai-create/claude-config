// payload/hooks/statusline.test.mjs
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { renderUpdates, renderGsd, render, installedProfile, paintContext } from "./statusline.mjs";

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

// renderSdd, renderPhase and roadmapPhases moved to lib/phase-segment.mjs and are tested there.
// What stays here is the entry point's behaviour, which is what this file is for.

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
  assert.equal(strip(render({ ...base, up: "08 (2/6) running" })), "Opus │ p │ 08 (2/6) running");
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
  assert.doesNotThrow(() => render());
});

test("the pure renderers never interpolate undefined", () => {
  assert.equal(renderGsd(), "");
  assert.doesNotMatch(renderGsd({ milestone: "v1" }), /undefined/);
  // field()/fmField() return null (not undefined) for an absent key, the shape production
  // actually passes; a guard tested only against omitted arguments can miss this.
  // milestone:null alone is not load-bearing: filter(Boolean) already drops a lone null/undefined
  // milestone with no phase, guard or not - phase+status is what makes the guard's absence visible.
  assert.equal(renderGsd({ milestone: null }), "");
  assert.equal(renderGsd({ milestone: null, phase: "3", status: "x" }), "");
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

function runEntry(input, { claudeDir = EMPTY_CLAUDE_DIR, env: extraEnv = {} } = {}) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: claudeDir };
  delete env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  delete env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE;
  Object.assign(env, extraEnv);
  return spawnSync(process.execPath, [ENTRY], { input, encoding: "utf8", env, cwd: TMP });
}

const payload = (root, extra = {}) => JSON.stringify({ workspace: { current_dir: root }, ...extra });

// Rendering without a subprocess is the reason the git segment was dropped, so it is a property of
// the source and not of any one render: a reintroduced spawn would still pass every test below.
// Method calls are excluded by the lookbehind - `.exec(` on a RegExp is all over this renderer.
test("no subprocess: neither the entry point nor any lib it imports can spawn one", () => {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    const where = basename(file);
    assert.doesNotMatch(src, /child_process/, `${where} reaches for child_process`);
    assert.doesNotMatch(src, /(?<![.\w])(?:spawn|spawnSync|exec|execSync|execFile|execFileSync)\s*\(/,
      `${where} calls a subprocess`);
    for (const m of src.matchAll(/from\s*["'](\.[^"']+)["']/g)) visit(join(dirname(file), m[1]));
  };
  visit(ENTRY);
  assert.ok(seen.size > 1, `the import walk found no libs (${seen.size} file) - it proved nothing`);
});

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

test("entry point: CLAUDE_CODE_AUTO_COMPACT_WINDOW narrows the icon ladder, not the colour ladder", () => {
  const root = dir("plain-window-narrow");
  const out = runEntry(payload(root, {
    context_window: { context_window_size: 1000000, used_percentage: 32 },
  }), { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "600000" } });
  assert.equal(out.status, 0);
  // colour: 32% of the full 1M window is the green band - windowPct is never narrowed.
  assert.match(out.stdout, /\x1b\[32m320\.0K\/1M 32%\x1b\[0m/, `colour: got ${JSON.stringify(out.stdout)}`);
  // icon: 320K of a 600K capacity is 53% of the way to compaction - past the 💡 floor.
  // Asserting both, on the same render, fails if colour and icon ever collapse onto one number.
  assert.match(strip(out.stdout), /320\.0K\/1M 32% 💡/, `icon: got ${JSON.stringify(out.stdout)}`);
});

test("entry point: a disabled autocompact collapses the icon onto windowPct, not the raw ratio", () => {
  const claudeDir = dir("claude-ac-disabled");
  write(join(claudeDir, "settings.json"), JSON.stringify({ autoCompactEnabled: false }));
  const root = dir("plain-ac-disabled");
  const out = runEntry(payload(root, {
    context_window: { context_window_size: 200000, used_percentage: 44,
      current_usage: { input_tokens: 91000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 } },
  }), { claudeDir });
  assert.equal(out.status, 0);
  // 91K/200K is 45.5% raw - past the icon floor - but windowPct (the payload's own 44%) is not;
  // disabled autocompact has nothing to warn about, so the icon must not fire ahead of the colour.
  assert.match(out.stdout, /\x1b\[32m91\.0K\/200K 44%\x1b\[0m/, `colour: got ${JSON.stringify(out.stdout)}`);
  assert.doesNotMatch(strip(out.stdout), /💡|⚠️|🔥|💀/, `icon leaked ahead of windowPct: got ${JSON.stringify(out.stdout)}`);
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

test("entry point: an .ultrapowers without a ROADMAP renders no work segment", () => {
  const root = dir("sdd-empty");
  mkdirSync(join(root, ".ultrapowers", "sdd", "phases-01-x"), { recursive: true });
  const out = runEntry(payload(root));
  assert.equal(out.status, 0);
  assert.equal(out.stderr, "");
  assert.equal(strip(out.stdout), "sdd-empty");
});

test("entry point: a ledger belonging to another phase never becomes the segment", () => {
  const root = phaseTree("ledger-other", {
    current: "09",
    rows: [{ phase: "09", slug: "ctx-severity", status: "running" }],
    phases: { "09-ctx-severity": '---\nphase: "09"\nstatus: running\naction: review\n---\n' },
  });
  write(join(root, ".ultrapowers", "sdd", "phases-08-unified", "task-1-brief.md"), "b");
  const out = strip(runEntry(payload(root)).stdout);
  assert.match(out, /09 \(review\) ctx-severity$/);
});

test("entry point: gsd and up both render when a project has both", () => {
  const root = dir("both-proj");
  write(join(root, ".planning", "config.json"), "{}");
  write(join(root, ".planning", "STATE.md"), GSD_STATE);
  write(join(root, ".ultrapowers", "ROADMAP.md"), ["---", "current: null", "phases:",
    '  - { phase: "01", slug: only-one, status: complete }', "---", "", "# Roadmap"].join("\n"));
  const out = runEntry(payload(root), { claudeDir: GSD_CLAUDE_DIR });
  assert.equal(strip(out.stdout),
    "both-proj │ v1.0 [██░] 83% · Phase 05.1 verifying │ 1/1 only-one");
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
  assert.match(strip(runEntry(payload(root)).stdout), /08 unified$/);
});

test("entry point: current null falls back to exactly one running phase", () => {
  const one = phaseTree("sel-one", {
    current: null,
    rows: [{ phase: "07", slug: "a", status: "complete" }, { phase: "08", slug: "b", status: "running" }],
    phases: { "08-unified": STATE_08 },
  });
  assert.match(strip(runEntry(payload(one)).stdout), /08 b$/);
});

// Zero or several running phases means the tree does not know which phase is in flight. The bar
// says so by rendering the tally rather than picking one.
test("entry point: zero or several running phases render the tally, never a guess", () => {
  const none = phaseTree("sel-none", {
    current: null,
    rows: [{ phase: "07", slug: "a", status: "complete" }],
    phases: { "07-earlier": STATE_07_DONE },
  });
  assert.match(strip(runEntry(payload(none)).stdout), /1\/1 a$/);

  const many = phaseTree("sel-many", {
    current: null,
    rows: [{ phase: "07", slug: "a", status: "running" }, { phase: "08", slug: "b", status: "running" }],
    phases: { "07-earlier": STATE_07_RUNNING, "08-unified": STATE_08 },
  });
  assert.match(strip(runEntry(payload(many)).stdout), /0\/2 b$/);
});

test("entry point: an action names what is happening in the phase", () => {
  const root = phaseTree("sel-action", {
    current: "09",
    phases: { "09-later": '---\nstatus: running\naction: planning\n---\n' },
  });
  assert.match(strip(runEntry(payload(root)).stdout), /09 \(planning\) later$/);
});

test("entry point: a phase with no action prints its id and name alone", () => {
  const root = phaseTree("sel-planned", { current: "09", phases: { "09-later": '---\nstatus: planned\n---\n' } });
  const out = strip(runEntry(payload(root)).stdout);
  assert.match(out, /09 later$/);
  assert.doesNotMatch(out, /undefined|null|\(\)/);
});

test("entry point: counters come from the live ledger, not from stale frontmatter", () => {
  const root = phaseTree("sel-counters", {
    current: "09",
    rows: [{ phase: "09", slug: "later", status: "running" }],
    phases: { "09-later": '---\nstatus: running\naction: planning\ntasks_done: 99\ntasks_total: 99\n---\n' },
  });
  const sdd = join(root, ".ultrapowers", "sdd", "phases-09-later");
  for (const n of [1, 2, 3]) write(join(sdd, `task-${n}-brief.md`), "b");
  write(join(sdd, "task-1-report.md"), "r");
  assert.match(strip(runEntry(payload(root)).stdout), /09 1\/2\/0 — later$/);
});

// tasks_dropped belongs to a frontmatter tally and must not touch ledger-derived counts: a
// retired task is either already among the unreported briefs or was never written as one.
test("entry point: tasks_dropped does not drive the ledger's queue negative", () => {
  const root = phaseTree("sel-dropped", {
    current: "07",
    rows: [{ phase: "07", slug: "earlier", status: "running" }],
    phases: { "07-earlier": '---\nstatus: running\ntasks_dropped: 1\n---\n' },
  });
  const sdd = join(root, ".ultrapowers", "sdd", "phases-07-earlier");
  for (const n of [1, 2, 3, 4]) write(join(sdd, `task-${n}-brief.md`), "b");
  for (const n of [1, 2]) write(join(sdd, `task-${n}-report.md`), "r");
  assert.match(strip(runEntry(payload(root)).stdout), /07 2\/2\/0 — earlier$/);
});

// .trim() in fmField: CR is a JS LineTerminator so `(.+)$` never captures it, but trailing
// spaces are captured and would leave a quoted id closing-quote intact.
test("entry point: trailing whitespace in frontmatter does not corrupt the id or action", () => {
  const root = dir("sel-pad");
  write(join(root, ".ultrapowers", "ROADMAP.md"), '---\ncurrent: "08"   \nphases:\n---\n');
  write(join(root, ".ultrapowers", "phases", "08-unified", "08-STATE.md"),
    '---\nstatus: running  \naction: review  \n---\n');
  assert.match(strip(runEntry(payload(root)).stdout), /08 \(review\) unified$/);
});

// mtime used to decide which ledger the bar showed. It no longer decides anything: only the
// resolved phase's own ledger is read, so a newer unrelated one cannot take the segment.
test("entry point: a foreign ledger cannot take the segment however new it is", () => {
  const root = phaseTree("sel-outrank", { current: "08", phases: { "08-unified": STATE_08 } });
  const ledger = write(join(root, ".ultrapowers", "sdd", "phases-99-stale-plan", "task-1-brief.md"), "b");
  const future = Date.now() / 1000 + 3600;
  utimesSync(ledger, future, future);
  const out = strip(runEntry(payload(root)).stdout);
  assert.match(out, /08 unified$/);
  assert.doesNotMatch(out, /stale-plan/);
});

test("entry point: CRLF frontmatter resolves the same phase", () => {
  const named = phaseTree("sel-crlf-current", { current: "08", eol: "\r\n", phases: { "08-unified": STATE_08 } });
  assert.match(strip(runEntry(payload(named)).stdout), /08 unified$/);

  const running = phaseTree("sel-crlf-running", {
    current: null,
    eol: "\r\n",
    rows: [{ phase: "07", slug: "a", status: "complete" }, { phase: "08", slug: "b", status: "running" }],
    phases: { "08-unified": STATE_08 },
  });
  assert.match(strip(runEntry(payload(running)).stdout), /08 b$/);
});

// This is the defect the phase was opened for: with no phase resolvable the bar used to render
// the newest ledger's tally, which belonged to finished work.
test("entry point: an unresolvable current renders the tally, not a ledger", () => {
  const root = phaseTree("sel-fallback", {
    current: "09",
    rows: [{ phase: "07", slug: "a", status: "complete" }, { phase: "08", slug: "unified", status: "complete" }],
    phases: { "08-unified": STATE_08 },
  });
  write(join(root, ".ultrapowers", "sdd", "phases-08-unified", "task-1-brief.md"), "b");
  assert.match(strip(runEntry(payload(root)).stdout), /2\/2 unified$/);
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

// A machine installed by a pre-`profile` bundle carries `variant` only. Without the fallback a
// legacy lite install resolves to null, fails open, and shows the segment lite exists to suppress.
test("installedProfile falls back to a pre-profile manifest's variant key", () => {
  const d = dir("prof-legacy");
  write(join(d, "state", "bundle-manifest.json"), JSON.stringify({ variant: "lite" }));
  assert.equal(installedProfile(d), "lite");
});

test("entry point: lite suppresses the ultrapowers segment, base keeps it", () => {
  const root = dir("up-gate");
  write(join(root, ".ultrapowers", "ROADMAP.md"), ["---", "current: null", "phases:",
    '  - { phase: "01", slug: my-plan, status: complete }', "---", "", "# Roadmap"].join("\n"));

  const onLite = runEntry(payload(root), { claudeDir: claudeDirWithProfile("cd-lite", "lite") });
  assert.doesNotMatch(strip(onLite.stdout), /my-plan/);

  const onBase = runEntry(payload(root), { claudeDir: claudeDirWithProfile("cd-base", "base") });
  assert.match(strip(onBase.stdout), /my-plan/);

  const noManifest = runEntry(payload(root), { claudeDir: claudeDirWithProfile("cd-nomanifest") });
  assert.match(strip(noManifest.stdout), /my-plan/, "an absent manifest must fail open");
});

// child.stdin is deliberately never end()ed - that is the condition under test. spawnSync's
// input option closes stdin for the caller, so it cannot reproduce a hang; only spawn can.
test("entry point: stdin that never closes still renders and exits", async () => {
  const root = dir("hang-guard");
  const child = spawn(process.execPath, [ENTRY], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: EMPTY_CLAUDE_DIR, CLAUDE_STATUSLINE_STDIN_MS: "50" },
    cwd: TMP,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.write(payload(root));
  let out = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (c) => { out += c; });
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(code, 0);
  assert.ok(strip(out).includes("hang-guard"), `got: ${JSON.stringify(out)}`);
});

test("paintContext: wraps in the colour and hangs the icon outside it", () => {
  assert.equal(paintContext("12K/1M 12%", { colour: "32", icon: "" }), "\x1b[32m12K/1M 12%\x1b[0m");
  assert.equal(paintContext("12K/1M 12%", { colour: "91", icon: "💀" }), "\x1b[91m12K/1M 12%\x1b[0m 💀");
  assert.equal(paintContext("", { colour: "91", icon: "💀" }), "");
});

test("paintContext: a null opts argument does not throw", () => {
  assert.equal(paintContext("12K/1M 12%", null), "12K/1M 12%");
});

test("entry point: a full window is bright red and carries the skull", () => {
  const out = runEntry(payload(dir("proj-hot"), {
    context_window: { context_window_size: 200000, used_percentage: 96,
      current_usage: { input_tokens: 192000, cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0, output_tokens: 0 } },
  }), { claudeDir: dir("claude-hot") });
  assert.equal(out.status, 0);
  assert.ok(out.stdout.includes("\x1b[91m"), `no bright red: ${JSON.stringify(out.stdout)}`);
  assert.ok(out.stdout.includes("💀"), `no skull: ${JSON.stringify(out.stdout)}`);
});

test("entry point: an empty window is grey and silent", () => {
  const out = runEntry(payload(dir("proj-cold"), {
    context_window: { context_window_size: 1000000, used_percentage: 3,
      current_usage: { input_tokens: 30000, cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0, output_tokens: 0 } },
  }), { claudeDir: dir("claude-cold") });
  assert.equal(out.status, 0);
  assert.ok(out.stdout.includes("\x1b[2m30.0K/1M 3%\x1b[0m"), `got: ${JSON.stringify(out.stdout)}`);
  for (const icon of ["💡", "⚠️", "🔥", "💀"]) assert.equal(out.stdout.includes(icon), false);
});

test("entry point: an observed autocompact point makes the icon lead the colour", () => {
  const claudeDir = dir("claude-lead");
  write(join(claudeDir, "state", "autocompact.json"), JSON.stringify({
    models: { "claude-opus-5[1m]": { tokens: 600000, windowSize: 1000000 } },
  }));
  const out = runEntry(payload(dir("proj-lead"), {
    model: { id: "claude-opus-5[1m]", display_name: "Opus 5 (1M context)" },
    context_window: { context_window_size: 1000000, used_percentage: 32,
      current_usage: { input_tokens: 320000, cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0, output_tokens: 0 } },
  }), { claudeDir });
  assert.equal(out.status, 0);
  assert.ok(out.stdout.includes("\x1b[32m"), `expected green: ${JSON.stringify(out.stdout)}`);
  assert.ok(out.stdout.includes("💡"), `expected the lamp: ${JSON.stringify(out.stdout)}`);
});

test("entry point: a default-configuration render never shows an icon while the colour disagrees", () => {
  const out = runEntry(payload(dir("proj-collapse"), {
    context_window: { context_window_size: 1000000, used_percentage: 44,
      current_usage: { input_tokens: 452000, cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0, output_tokens: 0 } },
  }), { claudeDir: dir("claude-collapse") });
  assert.equal(out.status, 0);
  assert.ok(out.stdout.includes("\x1b[32m"), `expected green: ${JSON.stringify(out.stdout)}`);
  for (const icon of ["💡", "⚠️", "🔥", "💀"]) {
    assert.equal(out.stdout.includes(icon), false, `unexpected ${icon}: ${JSON.stringify(out.stdout)}`);
  }
});

test("entry point: a pending observation is promoted and cleared", () => {
  const claudeDir = dir("claude-promote");
  const statePath = join(claudeDir, "state", "autocompact.json");
  write(statePath, JSON.stringify({
    pending: { tokens: 400000, model: "claude-opus-5", at: "2026-07-30T18:00:00Z" },
  }));
  const out = runEntry(payload(dir("proj-promote"), {
    model: { id: "claude-opus-5[1m]", display_name: "Opus 5 (1M context)" },
    context_window: { context_window_size: 1000000, used_percentage: 10,
      current_usage: { input_tokens: 100000, cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0, output_tokens: 0 } },
  }), { claudeDir });
  assert.equal(out.status, 0);
  const after = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(after.pending, undefined);
  assert.equal(after.models["claude-opus-5[1m]"].tokens, 400000);
});

test("entry point: a pending observation from another model does not get claimed by this render", () => {
  const claudeDir = dir("claude-cross-model");
  const statePath = join(claudeDir, "state", "autocompact.json");
  write(statePath, JSON.stringify({
    pending: { tokens: 180000, model: "claude-sonnet-5", at: "2026-07-30T18:00:00Z" },
  }));
  const out = runEntry(payload(dir("proj-cross-model"), {
    model: { id: "claude-opus-5[1m]", display_name: "Opus 5 (1M context)" },
    context_window: { context_window_size: 1000000, used_percentage: 17.5,
      current_usage: { input_tokens: 175000, cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0, output_tokens: 0 } },
  }), { claudeDir });
  assert.equal(out.status, 0);
  const after = JSON.parse(readFileSync(statePath, "utf8"));
  assert.deepEqual(after.pending, { tokens: 180000, model: "claude-sonnet-5", at: "2026-07-30T18:00:00Z" });
  assert.equal(after.models, undefined);
  assert.equal(out.stdout.includes("💀"), false, `unexpected skull: ${JSON.stringify(out.stdout)}`);
});
