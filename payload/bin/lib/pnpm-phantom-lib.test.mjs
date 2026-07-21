// payload/bin/lib/pnpm-phantom-lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { pkgNameFromSpecifier, extractBareImports, declaredDeps, phantomsForPackage } from "./pnpm-phantom-lib.mjs";

test("pkgNameFromSpecifier reduces to package name, drops builtins/relative", () => {
  assert.equal(pkgNameFromSpecifier("zod"), "zod");
  assert.equal(pkgNameFromSpecifier("zod/lib/index"), "zod");
  assert.equal(pkgNameFromSpecifier("@hookform/resolvers/zod"), "@hookform/resolvers");
  assert.equal(pkgNameFromSpecifier("./local"), null);
  assert.equal(pkgNameFromSpecifier("/abs"), null);
  assert.equal(pkgNameFromSpecifier("node:fs"), null);
  assert.equal(pkgNameFromSpecifier("fs"), null);
  assert.equal(pkgNameFromSpecifier("path"), null);
});

test("extractBareImports finds import/require/export-from/dynamic-import", () => {
  const src = `import z from 'zod';\nconst y = require("yup");\nexport * from '@scope/pkg/sub';\nawait import('joi');\nimport './rel';\nimport n from 'node:path';`;
  assert.deepEqual([...extractBareImports(src)].sort(), ["@scope/pkg", "joi", "yup", "zod"]);
});

test("declaredDeps excludes devDependencies (zod-only-in-dev is NOT declared)", () => {
  const pkg = { name: "@hookform/resolvers", peerDependencies: { "react-hook-form": "^7" }, devDependencies: { zod: "^3.25.0" } };
  const d = declaredDeps(pkg);
  assert.ok(d.has("react-hook-form"));
  assert.ok(d.has("@hookform/resolvers")); // self
  assert.ok(!d.has("zod")); // dev-only => NOT declared
});

test("phantomsForPackage flags undeclared+installed, skips declared/self/absent", () => {
  const pkg = { name: "@hookform/resolvers", peerDependencies: { "react-hook-form": "^7" }, devDependencies: { zod: "^3.25.0" } };
  const imported = new Set(["zod", "yup", "react-hook-form", "@hookform/resolvers"]);
  const installed = new Set(["zod", "react-hook-form"]); // yup not installed
  assert.deepEqual(phantomsForPackage(pkg, imported, installed), ["zod"]);
});
