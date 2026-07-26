import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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
