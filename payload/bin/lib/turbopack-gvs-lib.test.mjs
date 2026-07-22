// payload/bin/lib/turbopack-gvs-lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { usesTurbopack, parseGvsFlag, parseVirtualStoreDir, configTargetForPnpm, relUp, detectConfigFormat, nextConfigSnippet, buildRecipe } from "./turbopack-gvs-lib.mjs";

test("usesTurbopack: Next >=15 default, <15 only with --turbopack", () => {
  assert.equal(usesTurbopack({ dependencies: { next: "^16.2.9" } }), true);
  assert.equal(usesTurbopack({ dependencies: { next: "15.0.0" } }), true);
  assert.equal(usesTurbopack({ dependencies: { next: "^14.0.0" } }), false);
  assert.equal(usesTurbopack({ dependencies: { next: "^14.0.0" }, scripts: { dev: "next dev --turbopack" } }), true);
  assert.equal(usesTurbopack({ dependencies: { react: "^18" } }), false);
  assert.equal(usesTurbopack({}), false);
});

test("parseGvsFlag: explicit on/off, else null", () => {
  assert.equal(parseGvsFlag("packages: []\nenableGlobalVirtualStore: true\n", ""), true);
  assert.equal(parseGvsFlag("", "enable-global-virtual-store=true\n"), true);
  assert.equal(parseGvsFlag("", "enable-global-virtual-store=false\n"), false);
  assert.equal(parseGvsFlag("packages: []\n", ""), null);
});

test("detectConfigFormat: extension then package type", () => {
  assert.equal(detectConfigFormat("next.config.mjs", "commonjs"), "esm");
  assert.equal(detectConfigFormat("next.config.ts", undefined), "esm");
  assert.equal(detectConfigFormat("next.config.cjs", "module"), "cjs");
  assert.equal(detectConfigFormat("next.config.js", "module"), "esm");
  assert.equal(detectConfigFormat("next.config.js", "commonjs"), "cjs");
});

test("nextConfigSnippet: correct module system, default one-level hop", () => {
  const cjs = nextConfigSnippet("cjs");
  assert.match(cjs, /module\.exports/);
  assert.match(cjs, /turbopack:\s*\{\s*root: path\.join\(__dirname, '\.\.'\)/);
  assert.match(cjs, /outputFileTracingRoot: path\.join\(__dirname, '\.\.'\)/);
  const esm = nextConfigSnippet("esm");
  assert.match(esm, /export default/);
  assert.match(esm, /import\.meta\.url/);
});

test("nextConfigSnippet: monorepo hop is deepened, both fields, both formats", () => {
  const esm = nextConfigSnippet("esm", "../../..");
  assert.match(esm, /turbopack: \{ root: path\.join\(__dirname, '\.\.\/\.\.\/\.\.'\) \}/);
  assert.match(esm, /outputFileTracingRoot: path\.join\(__dirname, '\.\.\/\.\.\/\.\.'\)/);
  const cjs = nextConfigSnippet("cjs", "../../..");
  assert.match(cjs, /turbopack: \{ root: path\.join\(__dirname, '\.\.\/\.\.\/\.\.'\) \}/);
});

test("relUp: one dotdot per level, '.' when equal, fallback for non-ancestor", () => {
  assert.equal(relUp("/a/b/c", "/a/b"), "..");
  assert.equal(relUp("/repo/apps/web", "/repo/.."), ".."); // toDir not a clean ancestor -> fallback
  assert.equal(relUp("D:/_Next/pik.mes/apps/web", "D:/_Next"), "../../..");
  assert.equal(relUp("C:\\_Next\\repo\\apps\\web", "C:/_Next"), "../../..");
  assert.equal(relUp("/x/y/", "/x/y"), ".");
});

test("parseVirtualStoreDir: reads camelCase (workspace.yaml) and kebab (.npmrc), quotes stripped", () => {
  assert.equal(parseVirtualStoreDir("packages: []\nvirtualStoreDir: D:/x/repo-store\n", ""), "D:/x/repo-store");
  assert.equal(parseVirtualStoreDir('virtualStoreDir: "D:/x/repo-store"\n', ""), "D:/x/repo-store");
  assert.equal(parseVirtualStoreDir("", "virtual-store-dir=../repo-store\n"), "../repo-store");
  assert.equal(parseVirtualStoreDir("packages: []\n", ""), null);
});

test("configTargetForPnpm: >=11 -> workspace.yaml, <11 / unknown -> npmrc", () => {
  assert.equal(configTargetForPnpm(11), "workspace-yaml");
  assert.equal(configTargetForPnpm(12), "workspace-yaml");
  assert.equal(configTargetForPnpm(10), "npmrc");
  assert.equal(configTargetForPnpm(9), "npmrc");
  assert.equal(configTargetForPnpm(null), "npmrc");
  assert.equal(configTargetForPnpm(NaN), "npmrc");
});

test("buildRecipe: store named <repo>-store, sibling of the repo anchor", () => {
  const r = buildRecipe("D:/6__Work/parent/app", "D:/6__Work/parent/app", "esm");
  assert.equal(r.parent, "D:/6__Work/parent");
  assert.equal(r.storeName, "app-store");
  assert.equal(r.store, "D:/6__Work/parent/app-store");
  assert.match(r.snippet, /export default/);
});

test("buildRecipe: two repos under one parent get distinct stores; a trailing slash is ignored", () => {
  // appDir defaults to the anchor, so the single-arg form still computes the store.
  assert.equal(buildRecipe("/repos/a").store, "/repos/a-store");
  assert.equal(buildRecipe("/repos/b").store, "/repos/b-store");
  assert.notEqual(buildRecipe("/repos/a").store, buildRecipe("/repos/b").store);
  assert.equal(buildRecipe("C:/dev/my-site/").store, "C:/dev/my-site-store");
  assert.equal(buildRecipe("C:\\dev\\win-app").store, "C:/dev/win-app-store");
});

test("buildRecipe: monorepo — store anchored on repo, snippet hop reaches the store's parent", () => {
  // anchor = repo root; app nested at apps/web. Store sibling of the repo; hop = ../../.. .
  const r = buildRecipe("D:/_Next/pik.mes", "D:/_Next/pik.mes/apps/web", "esm", { target: "workspace-yaml" });
  assert.equal(r.store, "D:/_Next/pik.mes-store");
  assert.equal(r.parent, "D:/_Next");
  assert.equal(r.up, "../../..");
  assert.match(r.snippet, /path\.join\(__dirname, '\.\.\/\.\.\/\.\.'\)/);
});

test("buildRecipe: worktrees of one repo share a store (anchor = canonical repo, not worktree)", () => {
  // Both worktrees pass the SAME canonical anchor -> identical store path -> shared.
  const a = buildRecipe("D:/_Next/pik.mes", "D:/_Next/wt-featureA/apps/web", "esm", { target: "workspace-yaml" });
  const b = buildRecipe("D:/_Next/pik.mes", "D:/_Next/wt-featureB/apps/web", "esm", { target: "workspace-yaml" });
  assert.equal(a.store, b.store);
  assert.equal(a.store, "D:/_Next/pik.mes-store");
});

test("buildRecipe: target=npmrc (default, pnpm<11) emits kebab keys into .npmrc", () => {
  const r = buildRecipe("/repos/app", "/repos/app", "cjs", { target: "npmrc" });
  assert.equal(r.configFile, ".npmrc");
  assert.deepEqual(r.configLines, ["enable-global-virtual-store=false", "virtual-store-dir=/repos/app-store"]);
});

test("buildRecipe: target=workspace-yaml (pnpm>=11) emits camelCase keys into pnpm-workspace.yaml", () => {
  const r = buildRecipe("/repos/app", "/repos/app", "cjs", { target: "workspace-yaml" });
  assert.equal(r.configFile, "pnpm-workspace.yaml");
  assert.deepEqual(r.configLines, ["enableGlobalVirtualStore: false", "virtualStoreDir: /repos/app-store"]);
});
