import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deepMergeExistingWins,
  mergeReferenceWins,
  findProjectRoot,
  syncGsdGlobalDefaults,
  syncProjectConfig,
} from "../../payload/hooks/lib/gsd-defaults-sync.mjs";

test("deepMergeExistingWins: existing scalar wins over incoming", () => {
  const result = deepMergeExistingWins({ a: 1 }, { a: 2, b: 3 });
  assert.deepEqual(result, { a: 1, b: 3 });
});

test("deepMergeExistingWins: recurses into nested plain objects", () => {
  const result = deepMergeExistingWins(
    { workflow: { research: false } },
    { workflow: { research: true, verifier: true } }
  );
  assert.deepEqual(result, { workflow: { research: false, verifier: true } });
});

test("deepMergeExistingWins: unions arrays without duplicating existing items", () => {
  const result = deepMergeExistingWins({ tags: ["a", "b"] }, { tags: ["b", "c"] });
  assert.deepEqual(result, { tags: ["a", "b", "c"] });
});

test("mergeReferenceWins: patch scalar overwrites target scalar", () => {
  const target = { branching_strategy: "none" };
  mergeReferenceWins(target, { branching_strategy: "phase" });
  assert.equal(target.branching_strategy, "phase");
});

test("mergeReferenceWins: nested object merges key-by-key, patch wins per key", () => {
  const target = { workflow: { research: false, code_review: true, project_only: "keep" } };
  mergeReferenceWins(target, { workflow: { research: true, code_review: false } });
  assert.deepEqual(target.workflow, { research: true, code_review: false, project_only: "keep" });
});

test("mergeReferenceWins: keys the patch never mentions are left untouched", () => {
  const target = { project_code: "CK", ship: { pr_body_sections: [] } };
  mergeReferenceWins(target, { commit_docs: true });
  assert.deepEqual(target, { project_code: "CK", ship: { pr_body_sections: [] }, commit_docs: true });
});

test("mergeReferenceWins: returns the mutated target", () => {
  const target = {};
  const result = mergeReferenceWins(target, { a: 1 });
  assert.equal(result, target);
});

test("findProjectRoot: finds a directory containing .planning walking upward", () => {
  const base = mkdtempSync(join(tmpdir(), "gsd-defaults-sync-test-"));
  const projectRoot = join(base, "project");
  const nested = join(projectRoot, "sub", "deep");
  mkdirSync(join(projectRoot, ".planning"), { recursive: true });
  mkdirSync(nested, { recursive: true });
  try {
    assert.equal(findProjectRoot(nested), projectRoot);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("findProjectRoot: falls back to resolve(startDir) when nothing found", () => {
  const base = mkdtempSync(join(tmpdir(), "gsd-defaults-sync-test-"));
  try {
    assert.equal(findProjectRoot(base), base);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("syncGsdGlobalDefaults: creates ~/.gsd/defaults.json when absent", () => {
  const home = mkdtempSync(join(tmpdir(), "gsd-defaults-sync-test-"));
  try {
    const result = syncGsdGlobalDefaults({ homeDir: home, partial: { commit_docs: true } });
    assert.equal(result.changed, true);
    const written = JSON.parse(readFileSync(join(home, ".gsd", "defaults.json"), "utf8"));
    assert.deepEqual(written, { commit_docs: true });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("syncGsdGlobalDefaults: existing user value is not overwritten", () => {
  const home = mkdtempSync(join(tmpdir(), "gsd-defaults-sync-test-"));
  mkdirSync(join(home, ".gsd"), { recursive: true });
  writeFileSync(join(home, ".gsd", "defaults.json"), JSON.stringify({ model_profile: "balanced" }));
  try {
    const result = syncGsdGlobalDefaults({ homeDir: home, partial: { model_profile: "adaptive", commit_docs: true } });
    assert.equal(result.changed, true);
    const written = JSON.parse(readFileSync(join(home, ".gsd", "defaults.json"), "utf8"));
    assert.equal(written.model_profile, "balanced");
    assert.equal(written.commit_docs, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("syncGsdGlobalDefaults: no-op (changed:false) when already a superset", () => {
  const home = mkdtempSync(join(tmpdir(), "gsd-defaults-sync-test-"));
  mkdirSync(join(home, ".gsd"), { recursive: true });
  writeFileSync(join(home, ".gsd", "defaults.json"), JSON.stringify({ commit_docs: true }, null, 2) + "\n");
  try {
    const result = syncGsdGlobalDefaults({ homeDir: home, partial: { commit_docs: true } });
    assert.equal(result.changed, false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("syncProjectConfig: skips when .planning directory is absent", () => {
  const root = mkdtempSync(join(tmpdir(), "gsd-defaults-sync-test-"));
  try {
    const result = syncProjectConfig({ projectRoot: root, partial: { commit_docs: true } });
    assert.equal(result.skipped, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("syncProjectConfig: reference wins on overlapping keys, other fields untouched", () => {
  const root = mkdtempSync(join(tmpdir(), "gsd-defaults-sync-test-"));
  mkdirSync(join(root, ".planning"), { recursive: true });
  writeFileSync(
    join(root, ".planning", "config.json"),
    JSON.stringify({ project_code: "CK", workflow: { code_review: false, tdd_mode: false } }, null, 2)
  );
  try {
    const result = syncProjectConfig({
      projectRoot: root,
      partial: { workflow: { code_review: true, tdd_mode: true } },
    });
    assert.equal(result.changed, true);
    const written = JSON.parse(readFileSync(join(root, ".planning", "config.json"), "utf8"));
    assert.equal(written.project_code, "CK");
    assert.deepEqual(written.workflow, { code_review: true, tdd_mode: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("syncProjectConfig: no-op (changed:false) when config already matches reference", () => {
  const root = mkdtempSync(join(tmpdir(), "gsd-defaults-sync-test-"));
  mkdirSync(join(root, ".planning"), { recursive: true });
  writeFileSync(join(root, ".planning", "config.json"), JSON.stringify({ commit_docs: true }, null, 2) + "\n");
  try {
    const result = syncProjectConfig({ projectRoot: root, partial: { commit_docs: true } });
    assert.equal(result.changed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
