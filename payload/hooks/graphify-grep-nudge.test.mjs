import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "graphify-grep-nudge.mjs");
function run(payload) {
  const out = execFileSync("node", [HOOK], { input: JSON.stringify(payload), encoding: "utf8" });
  return out.trim() ? JSON.parse(out) : null;
}
function withGraph(has) {
  const root = mkdtempSync(join(tmpdir(), "gn-"));
  if (has) { mkdirSync(join(root, "graphify-out"), { recursive: true }); writeFileSync(join(root, "graphify-out", "graph.json"), "{}"); }
  return root;
}
// Real (local, no-network) git repo so staleness can be computed against an actual HEAD
// commit time, per graphMtimeSec vs graphMtime.
function withGitGraph(graphMtimeOffsetMs) {
  const root = mkdtempSync(join(tmpdir(), "gn-git-"));
  const gitOpts = { cwd: root, stdio: "ignore" };
  execFileSync("git", ["init", "-q"], gitOpts);
  execFileSync("git", ["config", "user.email", "test@example.com"], gitOpts);
  execFileSync("git", ["config", "user.name", "test"], gitOpts);
  writeFileSync(join(root, "a.txt"), "x");
  execFileSync("git", ["add", "."], gitOpts);
  execFileSync("git", ["commit", "-q", "-m", "init"], gitOpts);
  mkdirSync(join(root, "graphify-out"), { recursive: true });
  const graphPath = join(root, "graphify-out", "graph.json");
  writeFileSync(graphPath, "{}");
  const t = new Date(Date.now() + graphMtimeOffsetMs);
  utimesSync(graphPath, t, t);
  return root;
}

test("architectural grep + graph present -> suggests graphify query", () => {
  const root = withGraph(true);
  const res = run({ tool_name: "Grep", tool_input: { pattern: "what calls AuthModule" }, cwd: root });
  assert.ok(res);
  assert.match(res.hookSpecificOutput.additionalContext, /graphify query/);
  assert.equal(res.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.ok(!("permissionDecision" in res.hookSpecificOutput), "must never deny");
  rmSync(root, { recursive: true, force: true });
});

test("no graph -> silent", () => {
  const root = withGraph(false);
  assert.equal(run({ tool_name: "Grep", tool_input: { pattern: "what calls X" }, cwd: root }), null);
  rmSync(root, { recursive: true, force: true });
});

test("non-architectural grep -> silent even with graph", () => {
  const root = withGraph(true);
  assert.equal(run({ tool_name: "Grep", tool_input: { pattern: "TODO fixme" }, cwd: root }), null);
  rmSync(root, { recursive: true, force: true });
});

test("graph older than HEAD commit -> nudge says stale and suggests update", () => {
  const root = withGitGraph(-60 * 60 * 1000); // graph.json mtime 1h before the commit
  const res = run({ tool_name: "Grep", tool_input: { pattern: "what calls AuthModule" }, cwd: root });
  assert.ok(res);
  assert.match(res.hookSpecificOutput.additionalContext, /looks stale/i);
  assert.match(res.hookSpecificOutput.additionalContext, /graphify update/);
  assert.ok(!("permissionDecision" in res.hookSpecificOutput), "must never deny");
  rmSync(root, { recursive: true, force: true });
});

test("graph newer than HEAD commit -> no stale note", () => {
  const root = withGitGraph(60 * 60 * 1000); // graph.json mtime 1h after the commit
  const res = run({ tool_name: "Grep", tool_input: { pattern: "what calls AuthModule" }, cwd: root });
  assert.ok(res);
  assert.doesNotMatch(res.hookSpecificOutput.additionalContext, /looks stale/i);
  assert.doesNotMatch(res.hookSpecificOutput.additionalContext, /graphify update/);
  rmSync(root, { recursive: true, force: true });
});
