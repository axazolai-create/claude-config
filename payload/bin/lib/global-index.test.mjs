import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex, queryIndex } from "./global-index.mjs";

const graph = {
  nodes: [
    { label: "buildSyncCommand()", repo: "claude-config", source_file: "hooks/sync.mjs", source_location: "L4", file_type: "code" },
    { label: "buildSyncCommand()", repo: "claude-config-wt-plan13", source_file: "hooks/sync.mjs", source_location: "L5", file_type: "code" },
    { label: "isHeld()", repo: "claude-config", source_file: "hooks/lock.mjs", source_location: "L8", file_type: "code" },
    { label: "parseEnvFile()", repo: "other-project", source_file: "src/env.ts", source_location: "L12", file_type: "code" },
    { label: "", repo: "x", source_file: "y", source_location: "", file_type: "code" },
  ],
};

test("every labelled node becomes one row; unlabelled nodes are dropped", () => {
  const rows = buildIndex(graph).split("\n").filter(Boolean);
  assert.equal(rows.length, 4);
});

test("a row carries label, repo, file and location, tab separated", () => {
  const row = buildIndex(graph).split("\n").find((r) => r.startsWith("isHeld()"));
  assert.deepEqual(row.split("\t"), ["isHeld()", "claude-config", "hooks/lock.mjs", "L8", "code"]);
});

test("a query finds the symbol regardless of case", () => {
  const idx = buildIndex(graph);
  assert.equal(queryIndex(idx, "buildsynccommand").length, 1);
  assert.equal(queryIndex(idx, "BUILDSYNCCOMMAND").length, 1);
});

// The same file reached through a git worktree is the same code, not a second implementation.
// Collapsing them is what makes "have I written this before" answerable.
test("the same label in the same file across repos collapses to one hit that names them all", () => {
  const hits = queryIndex(buildIndex(graph), "buildSyncCommand");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].file, "hooks/sync.mjs");
  assert.deepEqual(hits[0].repos.sort(), ["claude-config", "claude-config-wt-plan13"]);
});

test("the same label in a different file stays a separate hit", () => {
  const g = { nodes: [
    { label: "run()", repo: "a", source_file: "one.mjs", source_location: "L1", file_type: "code" },
    { label: "run()", repo: "b", source_file: "two.mjs", source_location: "L1", file_type: "code" },
  ] };
  assert.equal(queryIndex(buildIndex(g), "run").length, 2);
});

test("a miss is an empty list, not a throw", () => {
  assert.deepEqual(queryIndex(buildIndex(graph), "nothing-like-this"), []);
});

test("the limit caps the hits returned", () => {
  const g = { nodes: Array.from({ length: 50 }, (_, i) => (
    { label: `handler${i}()`, repo: "r", source_file: `f${i}.mjs`, source_location: "L1", file_type: "code" })) };
  assert.equal(queryIndex(buildIndex(g), "handler", { limit: 5 }).length, 5);
});
