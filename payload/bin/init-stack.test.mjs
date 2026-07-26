// Tests for init-stack.mjs: the pure/read-only core (template inheritance resolver + gather)
// AND the side-effecting half (apply/install/CLI dispatch) + the profile-aware plugin tier
// filter. Mirrors payload/bin/test_init_stack.py: SyntheticFixtureTests (resolver mechanics
// against a throwaway template tree) + the parity cases from RealTemplatesTests (against the
// actual setting-templates/ tree shipped in this repo), plus new coverage for the Node-only
// apply/tier-filter/CLI additions (init-stack.py has no equivalent to port from).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
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
  keepPlugin,
  apply,
  grab,
  main,
  readMaxPluginTier,
} from "./init-stack.mjs";

const REPO_TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "setting-templates");

// Every test that touches subprocess-guarded paths (installMissing/syncGsdContextModeAgents)
// relies on this: never let the suite shell out to `claude plugin install`/marketplace add or
// spawn node for real. Mirrors setup.mjs's CLAUDE_SETUP_SKIP_PLUGINS=1 hermetic-mode pattern.
process.env.CLAUDE_INIT_STACK_SKIP_SUBPROCESS = "1";

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
test("react inherits the frontend chain (typescript-lsp, accesslint; frontend-design removed)", () => {
  const { entries } = gather(["react"], { templatesDir: REPO_TEMPLATES_DIR });
  const ids = new Set(entries.map((e) => e.id));
  assert.ok(ids.has("typescript-lsp@claude-plugins-official"));
  assert.ok(ids.has("accesslint@accesslint"));
  assert.ok(!ids.has("frontend-design@claude-plugins-official"), "frontend-design removed in Phase 3");
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

// ---------- tier filter (spec §4) ----------
test("keepPlugin: absent tier defaults to core, kept under any cap", () => {
  assert.equal(keepPlugin({ id: "x@mp" }, "core"), true);
  assert.equal(keepPlugin({ id: "x@mp" }, "full"), true);
  assert.equal(keepPlugin({ id: "x@mp" }, undefined), true);
});

test("keepPlugin: tier:full dropped under maxPluginTier core, kept under full or no cap", () => {
  const entry = { id: "playwright@mp", tier: "full" };
  assert.equal(keepPlugin(entry, "core"), false);
  assert.equal(keepPlugin(entry, "full"), true);
  assert.equal(keepPlugin(entry, undefined), true);
});

test("gather: tier filter drops a tier:full plugin under maxPluginTier core", () => {
  const dir = writeTemplates({
    "frontend/react.json": {
      stack: "react",
      merge: {},
      plugins: [{ id: "typescript-lsp@mp" }, { id: "playwright@mp", tier: "full" }],
    },
  });
  const kept = gather(["react"], { templatesDir: dir, maxPluginTier: "core" }).entries.map((e) => e.id);
  assert.ok(kept.includes("typescript-lsp@mp") && !kept.includes("playwright@mp"), kept.join(","));
});

test("gather: no maxPluginTier keeps tier:full plugins", () => {
  const dir = writeTemplates({
    "frontend/react.json": {
      stack: "react",
      merge: {},
      plugins: [{ id: "typescript-lsp@mp" }, { id: "playwright@mp", tier: "full" }],
    },
  });
  const kept = gather(["react"], { templatesDir: dir }).entries.map((e) => e.id);
  assert.ok(kept.includes("typescript-lsp@mp") && kept.includes("playwright@mp"), kept.join(","));
});

test("gather: real frontend template drops playwright/chrome-devtools-mcp under core, keeps them uncapped", () => {
  const core = gather(["react"], { templatesDir: REPO_TEMPLATES_DIR, maxPluginTier: "core" }).entries.map((e) => e.id);
  assert.ok(!core.includes("playwright@claude-plugins-official"));
  assert.ok(!core.includes("chrome-devtools-mcp@claude-plugins-official"));
  assert.ok(core.includes("typescript-lsp@claude-plugins-official")); // core plugin unaffected

  const full = gather(["react"], { templatesDir: REPO_TEMPLATES_DIR }).entries.map((e) => e.id);
  assert.ok(full.includes("playwright@claude-plugins-official"));
  assert.ok(full.includes("chrome-devtools-mcp@claude-plugins-official"));
});

// ---------- apply ----------
function tmpRoot() {
  return mkdtempSync(join(tmpdir(), "init-stack-apply-"));
}

test("apply writes enabledPlugins into .claude/settings.json", () => {
  const root = tmpRoot();
  apply(["x@mp"], [], [], { root, templatesDir: REPO_TEMPLATES_DIR });
  const settings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
  assert.equal(settings.enabledPlugins["x@mp"], true);
});

test("apply removes ids and preserves sibling settings keys (additive merge)", () => {
  const root = tmpRoot();
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(
    join(root, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "old@mp": true }, model: "sonnet" }),
    "utf8",
  );
  apply(["new@mp"], ["old@mp"], [], { root, templatesDir: REPO_TEMPLATES_DIR });
  const settings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
  assert.equal(settings.enabledPlugins["new@mp"], true);
  assert.ok(!("old@mp" in settings.enabledPlugins));
  assert.equal(settings.model, "sonnet"); // sibling key untouched
});

test("apply never enables a placeholder id", () => {
  const root = tmpRoot();
  apply(["<fill-me>@mp"], [], [], { root, templatesDir: REPO_TEMPLATES_DIR });
  const settings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
  assert.deepEqual(settings.enabledPlugins, {});
});

// ---------- grab (CLI arg parsing) ----------
test("grab: collects tokens after a flag until the next --flag", () => {
  assert.deepEqual(grab(["--enable", "a@mp", "b@mp", "--remove", "c@mp"], "--enable"), ["a@mp", "b@mp"]);
  assert.deepEqual(grab(["--enable", "a@mp", "b@mp", "--remove", "c@mp"], "--remove"), ["c@mp"]);
  assert.deepEqual(grab(["--apply-all"], "--enable"), []);
});

// ---------- main() CLI dispatch ----------
function withCapturedLog(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try {
    return { result: fn(), lines };
  } finally {
    console.log = orig;
  }
}

test("main --status prints {id,state} JSON and returns 0", () => {
  const configDir = mkdtempSync(join(tmpdir(), "init-stack-cfg-"));
  const { result, lines } = withCapturedLog(() => main(["--status", "foo@mp"], { configDir }));
  assert.equal(result, 0);
  assert.deepEqual(JSON.parse(lines[0]), { id: "foo@mp", state: "marketplace_missing" });
});

test("main --status with missing id arg prints an error object and returns 2", () => {
  const configDir = mkdtempSync(join(tmpdir(), "init-stack-cfg-"));
  const { result, lines } = withCapturedLog(() => main(["--status"], { configDir }));
  assert.equal(result, 2);
  assert.deepEqual(JSON.parse(lines[0]), { error: "--status needs a plugin id" });
});

test("main: invalid installed_plugins.json is caught at the CLI boundary and exits 2 (not thrown)", () => {
  const configDir = mkdtempSync(join(tmpdir(), "init-stack-cfg-"));
  mkdirSync(join(configDir, "plugins"), { recursive: true });
  writeFileSync(join(configDir, "plugins", "installed_plugins.json"), "{ not valid json", "utf8");
  let threw = false;
  let result;
  const origErr = console.error;
  console.error = () => {};
  try {
    result = main(["--status", "foo@mp"], { configDir });
  } catch {
    threw = true;
  } finally {
    console.error = origErr;
  }
  assert.equal(threw, false);
  assert.equal(result, 2);
});

test("main: no known stack detected reports and returns 0", () => {
  const configDir = mkdtempSync(join(tmpdir(), "init-stack-cfg-"));
  const root = mkdtempSync(join(tmpdir(), "init-stack-noroot-"));
  const { result, lines } = withCapturedLog(() => main([], { configDir, root }));
  assert.equal(result, 0);
  assert.ok(lines.some((l) => l.includes("No known stack detected")));
});

test("main --apply-all enables every declared non-placeholder plugin for the detected stack", () => {
  const configDir = mkdtempSync(join(tmpdir(), "init-stack-cfg-"));
  const root = mkdtempSync(join(tmpdir(), "init-stack-root-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { react: "^18" } }), "utf8");
  withCapturedLog(() => main(["--apply-all"], { configDir, root, templatesDir: REPO_TEMPLATES_DIR }));
  const settings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
  assert.equal(settings.enabledPlugins["typescript-lsp@claude-plugins-official"], true);
});

test("main default report ends with the STATUS_JSON marker and payload", () => {
  const configDir = mkdtempSync(join(tmpdir(), "init-stack-cfg-"));
  const root = mkdtempSync(join(tmpdir(), "init-stack-root-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { react: "^18" } }), "utf8");
  const { result, lines } = withCapturedLog(() =>
    main([], { configDir, root, templatesDir: REPO_TEMPLATES_DIR }),
  );
  assert.equal(result, 0);
  const markerIdx = lines.findIndex((l) => l.includes("=== STATUS_JSON ==="));
  assert.ok(markerIdx !== -1, "STATUS_JSON marker missing");
  const payload = JSON.parse(lines[markerIdx + 1]);
  assert.deepEqual(payload.stacks, ["react"]);
  assert.ok(Array.isArray(payload.plugins));
});

test("main --apply-all respects maxPluginTier from the bundle manifest (drops tier:full)", () => {
  const configDir = mkdtempSync(join(tmpdir(), "init-stack-cfg-"));
  mkdirSync(join(configDir, "state"), { recursive: true });
  writeFileSync(join(configDir, "state", "bundle-manifest.json"), JSON.stringify({ maxPluginTier: "core" }), "utf8");
  const root = mkdtempSync(join(tmpdir(), "init-stack-root-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { react: "^18" } }), "utf8");
  withCapturedLog(() => main(["--apply-all"], { configDir, root, templatesDir: REPO_TEMPLATES_DIR }));
  const settings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
  assert.equal(settings.enabledPlugins["typescript-lsp@claude-plugins-official"], true);
  assert.ok(!("playwright@claude-plugins-official" in settings.enabledPlugins));
});

test("readMaxPluginTier: corrupt (invalid-JSON) manifest degrades to no cap, does not throw", () => {
  const configDir = mkdtempSync(join(tmpdir(), "init-stack-cfg-"));
  mkdirSync(join(configDir, "state"), { recursive: true });
  writeFileSync(join(configDir, "state", "bundle-manifest.json"), "{ not valid json", "utf8");
  assert.doesNotThrow(() => readMaxPluginTier(configDir));
  assert.equal(readMaxPluginTier(configDir), undefined);
});
