// Tests for init-stack.mjs's pure/read-only core (template inheritance resolver + gather).
// Mirrors payload/bin/test_init_stack.py: SyntheticFixtureTests (resolver mechanics against a
// throwaway template tree) + the parity cases from RealTemplatesTests (against the actual
// setting-templates/ tree shipped in this repo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  STACK_PATHS,
  verticalAncestors,
  resolveChain,
  loadJson,
  classify,
  gather,
  gatherSkills,
  cleanNonplugin,
  deepMerge,
  splitId,
} from "./init-stack.mjs";

const REPO_TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "setting-templates");

// ---------- synthetic fixtures ----------
function writeTemplates(files) {
  const dir = mkdtempSync(join(tmpdir(), "init-stack-test-"));
  for (const [rel, data] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(data), "utf8");
  }
  return dir;
}

test("verticalAncestors: root-most first, excludes self, leaf case", () => {
  assert.deepEqual(verticalAncestors("backend/node/nest.json"), [
    "_base.json",
    "backend/_base.json",
    "backend/node/_base.json",
  ]);
  assert.deepEqual(verticalAncestors("backend/node/_base.json"), ["_base.json", "backend/_base.json"]);
  assert.deepEqual(verticalAncestors("_base.json"), []);
});

test("resolveChain: vertical ancestors apply root-most first, self last", () => {
  const dir = writeTemplates({
    "_base.json": { stack: "_root", merge: { enabledPlugins: { "root-p": true } }, plugins: [] },
    "d/_base.json": { stack: "_dir", merge: { enabledPlugins: { "dir-p": true } }, plugins: [] },
    "d/leaf.json": { stack: "leaf", merge: {}, plugins: [] },
  });
  const labels = resolveChain("d/leaf.json", { templatesDir: dir }).map(([l]) => l);
  assert.deepEqual(labels, ["_base.json", "d/_base.json", "d/leaf.json"]);
});

test("resolveChain: explicit extends splices a cross-branch chain before the leaf", () => {
  const dir = writeTemplates({
    "a/_base.json": { stack: "a", merge: {}, plugins: [{ id: "a-p" }] },
    "b/_base.json": { stack: "b", merge: {}, plugins: [{ id: "b-p" }] },
    "a/leaf.json": { stack: "leaf", extends: ["b/_base.json"], merge: {}, plugins: [] },
  });
  const labels = resolveChain("a/leaf.json", { templatesDir: dir }).map(([l]) => l);
  assert.deepEqual(labels, ["a/_base.json", "b/_base.json", "a/leaf.json"]);
});

test("resolveChain: pick restricts an extended sub-chain to named top-level keys", () => {
  const dir = writeTemplates({
    "a/_base.json": { stack: "a", merge: {}, plugins: [] },
    "b/_base.json": {
      stack: "b",
      merge: { enabledPlugins: { "b-merge": true } },
      plugins: [{ id: "b-plugin" }],
      _notes: ["should be dropped"],
    },
    "a/leaf.json": {
      stack: "leaf",
      extends: ["b/_base.json"],
      pick: { "b/_base.json": ["plugins"] },
      merge: {},
      plugins: [],
    },
  });
  const chain = resolveChain("a/leaf.json", { templatesDir: dir });
  const picked = Object.fromEntries(chain)["b/_base.json"];
  assert.ok(!("merge" in picked));
  assert.ok(!("_notes" in picked));
  assert.deepEqual(picked.plugins, [{ id: "b-plugin" }]);
});

test("resolveChain: pick filters EVERY tuple in a multi-level sub-chain", () => {
  const dir = writeTemplates({
    "b/_base.json": {
      stack: "b-dir",
      merge: { enabledPlugins: { "b-dir-p": true } },
      plugins: [{ id: "b-dir-plugin" }],
    },
    "b/leaf.json": {
      stack: "b",
      merge: { enabledPlugins: { "b-merge": true } },
      plugins: [{ id: "b-plugin" }],
      _notes: ["should be dropped"],
    },
    "a/leaf.json": {
      stack: "leaf",
      extends: ["b/leaf.json"],
      pick: { "b/leaf.json": ["plugins"] },
      merge: {},
      plugins: [],
    },
  });
  const chain = resolveChain("a/leaf.json", { templatesDir: dir });
  const byLabel = Object.fromEntries(chain);
  // b/leaf.json's own vertical ancestor (b/_base.json) is part of its resolved sub-chain too -
  // pick must filter EVERY tuple in that sub-chain, not just b/leaf.json's own tuple.
  assert.ok(!("merge" in byLabel["b/_base.json"]));
  assert.deepEqual(byLabel["b/_base.json"].plugins, [{ id: "b-dir-plugin" }]);
  assert.ok(!("merge" in byLabel["b/leaf.json"]));
  assert.deepEqual(byLabel["b/leaf.json"].plugins, [{ id: "b-plugin" }]);
});

test("resolveChain: self-extends is silently ignored, not infinite", () => {
  const dir = writeTemplates({
    "self.json": { stack: "self", extends: ["self.json"], merge: {}, plugins: [{ id: "self-p" }] },
  });
  const chain = resolveChain("self.json", { templatesDir: dir });
  assert.deepEqual(chain.map(([l]) => l), ["self.json"]);
});

test("resolveChain: a<->b cycle terminates and still includes both", () => {
  const dir = writeTemplates({
    "a.json": { stack: "a", extends: ["b.json"], merge: {}, plugins: [] },
    "b.json": { stack: "b", extends: ["a.json"], merge: {}, plugins: [] },
  });
  const chain = resolveChain("a.json", { templatesDir: dir });
  const labels = chain.map(([l]) => l);
  assert.ok(labels.includes("a.json"));
  assert.ok(labels.includes("b.json"));
});

test("resolveChain: missing template file returns []", () => {
  const dir = writeTemplates({});
  assert.deepEqual(resolveChain("nope.json", { templatesDir: dir }), []);
});

test("loadJson: missing file returns {}", () => {
  const dir = writeTemplates({});
  assert.deepEqual(loadJson(join(dir, "nope.json")), {});
});

test("loadJson: invalid JSON throws", () => {
  const dir = writeTemplates({});
  const p = join(dir, "bad.json");
  writeFileSync(p, "{ not valid json", "utf8");
  assert.throws(() => loadJson(p), /not valid JSON/);
});

test("splitId: last '@' is the separator; no '@' -> name='' mp=whole string (matches Python rpartition)", () => {
  assert.deepEqual(splitId("foo@mp"), ["foo", "mp"]);
  assert.deepEqual(splitId("scoped@name@mp"), ["scoped@name", "mp"]); // splits on the LAST '@'
  assert.deepEqual(splitId("no-at-sign"), ["", "no-at-sign"]);
});

test("classify: placeholder ids beat every other state", () => {
  assert.equal(classify("<fill-me>@mp", {}), "placeholder");
});

test("classify: installed beats marketplace/catalog checks", () => {
  assert.equal(classify("foo@mp", { installed: new Set(["foo@mp"]) }), "installed");
});

test("classify: unknown marketplace -> marketplace_missing", () => {
  assert.equal(classify("foo@mp", { installed: new Set(), known: new Set() }), "marketplace_missing");
});

test("classify: known marketplace but no catalog dir -> unavailable", () => {
  const dir = writeTemplates({});
  assert.equal(
    classify("foo@mp", { installed: new Set(), known: new Set(["mp"]), marketplacesDir: dir }),
    "unavailable",
  );
});

test("classify: catalog lists the plugin -> available", () => {
  const dir = writeTemplates({
    "mp/marketplace.json": { plugins: [{ name: "foo" }] },
  });
  assert.equal(
    classify("foo@mp", { installed: new Set(), known: new Set(["mp"]), marketplacesDir: dir }),
    "available",
  );
});

test("gather: emits no_template for an unknown stack, dedups by pid first-seen", () => {
  const dir = writeTemplates({
    "_base.json": { stack: "_root", merge: {}, plugins: [{ id: "shared@mp" }] },
    "x/leaf.json": { stack: "leaf", merge: {}, plugins: [{ id: "shared@mp" }, { id: "x-only@mp" }] },
  });
  const { entries } = gather(["not-a-real-stack"], { templatesDir: dir });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].state, "no_template");
  assert.equal(entries[0].id, null);
});

test("cleanNonplugin drops _-prefixed keys and enabledPlugins, keeps the rest", () => {
  assert.deepEqual(
    cleanNonplugin({ enabledPlugins: { p: true }, _notes: ["x"], statusLine: { type: "root" } }),
    { statusLine: { type: "root" } },
  );
});

test("deepMerge recursively merges nested objects, later values win on scalars", () => {
  const dst = { a: { x: 1, y: 2 }, b: 1 };
  deepMerge(dst, { a: { y: 3, z: 4 }, b: 2 });
  assert.deepEqual(dst, { a: { x: 1, y: 3, z: 4 }, b: 2 });
});

// ---------- parity against the REAL shipped templates (payload/setting-templates) ----------
test("react inherits the frontend chain (typescript-lsp, accesslint, frontend-design)", () => {
  const { entries } = gather(["react"], { templatesDir: REPO_TEMPLATES_DIR });
  const ids = new Set(entries.map((e) => e.id));
  assert.ok(ids.has("typescript-lsp@claude-plugins-official"));
  assert.ok(ids.has("accesslint@accesslint"));
  assert.ok(ids.has("frontend-design@claude-plugins-official"));
  assert.ok(ids.has("context7@claude-plugins-official")); // root _base, universal
});

test("react-native inherits both frontend (vertical) and mobile (explicit extends)", () => {
  const { entries } = gather(["react-native"], { templatesDir: REPO_TEMPLATES_DIR });
  const ids = new Set(entries.map((e) => e.id));
  assert.ok(ids.has("typescript-lsp@claude-plugins-official")); // frontend, vertical parent
  assert.ok(ids.has("expo@claude-plugins-official")); // its own plugin
  assert.ok(ids.has("auth0@claude-plugins-official")); // mobile, explicit extends
});

test("telegram-node inherits backend/node's explicit extends", () => {
  const { entries } = gather(["telegram-node"], { templatesDir: REPO_TEMPLATES_DIR });
  const ids = new Set(entries.map((e) => e.id));
  assert.ok(ids.has("typescript-lsp@claude-plugins-official"));
});

test("kotlin is standalone (no frontend/mobile cross-branch leaks)", () => {
  const { entries } = gather(["kotlin"], { templatesDir: REPO_TEMPLATES_DIR });
  const ids = new Set(entries.map((e) => e.id));
  assert.ok(ids.has("kotlin-lsp@claude-plugins-official"));
  assert.ok(ids.has("context7@claude-plugins-official"));
  assert.ok(!ids.has("typescript-lsp@claude-plugins-official"));
  assert.ok(!ids.has("expo@claude-plugins-official"));
});

test("csharp-cli is standalone", () => {
  const { entries } = gather(["csharp-cli"], { templatesDir: REPO_TEMPLATES_DIR });
  const ids = new Set(entries.map((e) => e.id));
  assert.ok(ids.has("csharp-lsp@claude-plugins-official"));
  assert.ok(ids.has("context7@claude-plugins-official"));
  assert.ok(!ids.has("typescript-lsp@claude-plugins-official"));
  assert.ok(!ids.has("kotlin-lsp@claude-plugins-official"));
});

test("wpf is standalone", () => {
  const { entries } = gather(["wpf"], { templatesDir: REPO_TEMPLATES_DIR });
  const ids = new Set(entries.map((e) => e.id));
  assert.ok(ids.has("csharp-lsp@claude-plugins-official"));
  assert.ok(!ids.has("typescript-lsp@claude-plugins-official"));
});

test("bare node/python/csharp stacks reuse their direction's _base.json as the leaf", () => {
  const node = gather(["node"], { templatesDir: REPO_TEMPLATES_DIR }).entries.map((e) => e.id);
  assert.ok(node.includes("typescript-lsp@claude-plugins-official"));
  assert.ok(node.includes("context7@claude-plugins-official"));

  const python = gather(["python"], { templatesDir: REPO_TEMPLATES_DIR }).entries.map((e) => e.id);
  assert.ok(python.includes("pyright-lsp@claude-plugins-official"));
  assert.ok(python.includes("context7@claude-plugins-official"));

  const csharp = gather(["csharp"], { templatesDir: REPO_TEMPLATES_DIR }).entries.map((e) => e.id);
  assert.ok(csharp.includes("csharp-lsp@claude-plugins-official"));
  assert.ok(csharp.includes("context7@claude-plugins-official"));
});

test("gather: no_template for an unknown stack against real templates", () => {
  const { entries } = gather(["not-a-real-stack"], { templatesDir: REPO_TEMPLATES_DIR });
  assert.equal(entries[0].state, "no_template");
});

test("gather: every STACK_PATHS entry resolves to a real template file", () => {
  for (const [stack, relPath] of Object.entries(STACK_PATHS)) {
    const { entries } = gather([stack], { templatesDir: REPO_TEMPLATES_DIR });
    assert.ok(
      entries.every((e) => e.state !== "no_template"),
      `${stack} -> ${relPath} should resolve (no_template found)`,
    );
  }
});

test("gatherSkills: matches shipped templates per stack", () => {
  assert.deepEqual(
    new Set(gatherSkills(["android"], { templatesDir: REPO_TEMPLATES_DIR }).map((s) => s.id)),
    new Set(["chrisbanes/skills", "skydoves/compose-performance-skills"]),
  );
  assert.deepEqual(
    new Set(gatherSkills(["react"], { templatesDir: REPO_TEMPLATES_DIR }).map((s) => s.id)),
    new Set(["shadcn"]),
  );
  assert.deepEqual(
    new Set(gatherSkills(["sql"], { templatesDir: REPO_TEMPLATES_DIR }).map((s) => s.id)),
    new Set(["planetscale/database-skills"]),
  );
  assert.deepEqual(
    new Set(gatherSkills(["django"], { templatesDir: REPO_TEMPLATES_DIR }).map((s) => s.name)),
    new Set(["django-expert"]),
  );
  assert.deepEqual(gatherSkills(["nx"], { templatesDir: REPO_TEMPLATES_DIR }), []); // declares no skills
});

test("gatherSkills: state reflects installedSkills by dirname", () => {
  const skills = gatherSkills(["react"], {
    templatesDir: REPO_TEMPLATES_DIR,
    installedSkills: new Set(["shadcn-ui"]),
  });
  const shadcn = skills.find((s) => s.id === "shadcn");
  assert.equal(shadcn.name, "shadcn-ui");
  assert.equal(shadcn.state, "installed");
});
