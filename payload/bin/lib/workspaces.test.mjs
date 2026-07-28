import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listWorkspaces } from "./workspaces.mjs";

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), "workspaces-"));
  for (const [rel, text] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}
const pkg = JSON.stringify({ name: "x" });

test("reads pnpm-workspace.yaml packages", () => {
  const root = repo({
    "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n",
    "apps/web/package.json": pkg,
    "apps/api/package.json": pkg,
  });
  const r = listWorkspaces(root);
  assert.equal(r.detectionSource, "pnpm-workspace.yaml");
  assert.deepEqual(r.workspaces.map((w) => w.relDir), ["apps/api", "apps/web"]);
  assert.equal(r.isMonorepo, true);
});

test("falls back to package.json workspaces", () => {
  const root = repo({
    "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
    "packages/ui/package.json": pkg,
  });
  const r = listWorkspaces(root);
  assert.equal(r.detectionSource, "package.json#workspaces");
  assert.deepEqual(r.workspaces.map((w) => w.relDir), ["packages/ui"]);
  assert.equal(r.isMonorepo, false);
});

test("falls back to conventional globs when only turbo.json is present", () => {
  const root = repo({ "turbo.json": "{}", "apps/web/package.json": pkg });
  assert.equal(listWorkspaces(root).detectionSource, "conventional-fallback");
});

test("a directory without package.json is not a workspace", () => {
  const root = repo({
    "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n",
    "apps/web/package.json": pkg,
    "apps/docs/README.md": "x",
  });
  assert.deepEqual(listWorkspaces(root).workspaces.map((w) => w.relDir), ["apps/web"]);
});

test("a single-package repository has no workspaces", () => {
  const root = repo({ "package.json": pkg });
  const r = listWorkspaces(root);
  assert.deepEqual(r.workspaces, []);
  assert.equal(r.detectionSource, null);
});
