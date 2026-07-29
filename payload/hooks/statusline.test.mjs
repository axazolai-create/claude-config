// payload/hooks/statusline.test.mjs
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { renderUpdates, renderGit, renderGsd, renderSdd, render } from "./statusline.mjs";

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

test("a clean branch renders with a tick", () => {
  assert.equal(renderGit("## main...origin/main\n"), "main✓");
});

test("staged, modified, untracked, ahead and behind all render", () => {
  const out = renderGit([
    "## main...origin/main [ahead 1, behind 2]",
    "M  staged.txt",
    " M dirty.txt",
    "?? new.txt",
    "?? other.txt",
    "?? third.txt",
    "",
  ].join("\n"));
  assert.equal(out, "main+1~1?3↑1↓2");
});

test("a detached head says so", () => {
  assert.equal(renderGit("## HEAD (no branch)\n"), "(detached)");
});

test("an initial branch with no upstream still renders", () => {
  assert.equal(renderGit("## No commits yet on master\n"), "master✓");
});

test("the gsd segment mirrors gsd-core's own vocabulary", () => {
  assert.equal(renderGsd({ milestone: "v2.0", phase: "4.5", status: "executing", percent: 40 }),
    "v2.0 [██░] 40% · Phase 4.5 executing");
});

test("the sdd segment names the plan and where to resume", () => {
  assert.equal(renderSdd({ plan: "planning-tree", complete: 3, next: 4 }), "planning-tree ✔3 →4");
});

test("render omits the updates segment and joins the rest", () => {
  const line = strip(render({ updates: [], context: "45k/200k 22%", state: "claude-config main✓" }));
  assert.equal(line, "45k/200k 22% │ claude-config main✓");
});

test("render puts updates first when there are any", () => {
  const line = strip(render({ updates: ["context-mode"], context: "45k/200k 22%", state: "x" }));
  assert.equal(line, "⬆ context-mode │ 45k/200k 22% │ x");
});

test("render survives every segment being empty", () => {
  assert.equal(strip(render({ updates: [], context: "", state: "" })), "");
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
  assert.equal(renderGit(null), "");
  assert.equal(renderGit(undefined), "");
  assert.equal(renderGit(""), "");
  assert.equal(renderGit("not porcelain at all"), "");
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

function runEntry(input, { claudeDir = EMPTY_CLAUDE_DIR } = {}) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: claudeDir };
  delete env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  return spawnSync(process.execPath, [ENTRY], { input, encoding: "utf8", env, cwd: TMP });
}

const payload = (root, extra = {}) => JSON.stringify({ workspace: { current_dir: root }, ...extra });

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
      remaining_percentage: 72.3,
      total_tokens: 200000,
      current_usage: { input_tokens: 40000, cache_creation_input_tokens: 1000, cache_read_input_tokens: 2000, output_tokens: 500 },
    },
  }));
  assert.equal(out.status, 0);
  assert.ok(strip(out.stdout).startsWith("43.5K/200K 33.2% │ "), `got: ${JSON.stringify(out.stdout)}`);
});

test("entry point: the context segment falls back to the estimate without current_usage", () => {
  const out = runEntry(payload(dir("plain-ctx-est"), { context_window: { remaining_percentage: 40 } }));
  assert.equal(out.status, 0);
  assert.ok(strip(out.stdout).startsWith("718.6K/1M 71.9% │ "), `got: ${JSON.stringify(out.stdout)}`);
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
  const out = runEntry(payload(root));
  assert.equal(out.status, 0);
  assert.equal(strip(out.stdout), "v1.0 [██░] 83% · Phase 05.1 verifying");
});

test("entry point: a .planning this parser cannot read falls through, it does not guess", () => {
  const root = dir("gsd-unparseable");
  write(join(root, ".planning", "config.json"), "{}");
  write(join(root, ".planning", "STATE.md"), "# nothing this parser understands\n");
  const out = runEntry(payload(root));
  assert.equal(out.status, 0);
  assert.equal(out.stderr, "");
  assert.equal(strip(out.stdout).includes("undefined"), false);
  assert.ok(strip(out.stdout).startsWith("gsd-unparseable"));
});

test("entry point: a .planning with no STATE.md at all falls through", () => {
  const root = dir("gsd-nostate");
  write(join(root, ".planning", "config.json"), "{}");
  const out = runEntry(payload(root));
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
  assert.equal(strip(out.stdout), "2026-07-28-planning-tree ✔3 →4");
});

test("entry point: the most recently written ledger wins, not the last name", () => {
  const root = dir("sdd-mtime");
  const stale = write(join(root, ".ultrapowers", "sdd", "2026-07-28-zzz-last-by-name", "progress.md"),
    "# SDD ledger — plan: docs/plans/stale.md\nTask 1: complete\n");
  const live = write(join(root, ".ultrapowers", "sdd", "2026-07-28-aaa-first-by-name", "progress.md"), LEDGER);
  utimesSync(stale, 1_000_000, 1_000_000);
  utimesSync(live, 2_000_000, 2_000_000);
  assert.equal(strip(runEntry(payload(root)).stdout), "2026-07-28-planning-tree ✔3 →4");
});

test("entry point: an .ultrapowers/sdd with no ledger falls through", () => {
  const root = dir("sdd-empty");
  mkdirSync(join(root, ".ultrapowers", "sdd", "2026-01-01-x"), { recursive: true });
  const out = runEntry(payload(root));
  assert.equal(out.status, 0);
  assert.equal(out.stderr, "");
  assert.ok(strip(out.stdout).startsWith("sdd-empty"));
});

test("entry point: gsd wins over sdd when a project has both", () => {
  const root = dir("both-proj");
  write(join(root, ".planning", "config.json"), "{}");
  write(join(root, ".planning", "STATE.md"), GSD_STATE);
  write(join(root, ".ultrapowers", "sdd", "2026-07-28-x", "progress.md"), LEDGER);
  const out = runEntry(payload(root));
  assert.equal(strip(out.stdout), "v1.0 [██░] 83% · Phase 05.1 verifying");
});

test("entry point: a workspace directory that does not exist still renders", () => {
  const out = runEntry(payload(join(TMP, "does", "not", "exist")));
  assert.equal(out.status, 0);
  assert.equal(out.stderr, "");
  assert.equal(strip(out.stdout), "exist");
});

test("entry point: a real repository renders its branch", () => {
  const root = dir("git-proj");
  const init = spawnSync("git", ["-C", root, "init", "-b", "fixture"], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  const out = runEntry(payload(root));
  assert.equal(out.status, 0);
  assert.equal(strip(out.stdout), "git-proj fixture✓");
});

test("entry point: the same input renders the same line twice", () => {
  const root = dir("gsd-proj");
  const input = payload(root, { context_window: { remaining_percentage: 72.3, total_tokens: 200000 } });
  assert.equal(runEntry(input).stdout, runEntry(input).stdout);
});
