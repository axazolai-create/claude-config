// payload/bin/lib/turbopack-gvs-lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { usesTurbopack, parseGvsFlag, detectConfigFormat, nextConfigSnippet, buildRecipe } from "./turbopack-gvs-lib.mjs";

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

test("nextConfigSnippet: correct module system", () => {
  const cjs = nextConfigSnippet("cjs");
  assert.match(cjs, /module\.exports/);
  assert.match(cjs, /turbopack:\s*\{\s*root:/);
  assert.match(cjs, /outputFileTracingRoot/);
  const esm = nextConfigSnippet("esm");
  assert.match(esm, /export default/);
  assert.match(esm, /import\.meta\.url/);
});

test("buildRecipe: sibling store under parent + npmrc lines", () => {
  const r = buildRecipe("D:/6__Work/parent/app", "esm");
  assert.equal(r.parent, "D:/6__Work/parent");
  assert.equal(r.store, "D:/6__Work/parent/.pnpm-store");
  assert.ok(r.npmrc.includes("enable-global-virtual-store=false"));
  assert.ok(r.npmrc.some((l) => l === "virtual-store-dir=D:/6__Work/parent/.pnpm-store"));
  assert.match(r.snippet, /export default/);
});
