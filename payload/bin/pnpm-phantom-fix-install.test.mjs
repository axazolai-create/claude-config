// payload/bin/pnpm-phantom-fix-install.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isPnpmProject, addPostinstall, addHookToSettings } from "./pnpm-phantom-fix-install.mjs";

test("isPnpmProject true when pnpm-workspace.yaml present, false otherwise", () => {
  const dir = mkdtempSync(join(tmpdir(), "pnpm-inst-"));
  assert.equal(isPnpmProject(dir), false);
  writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages: []\n");
  assert.equal(isPnpmProject(dir), true);
});

test("isPnpmProject true with pnpm-lock.yaml", () => {
  const dir = mkdtempSync(join(tmpdir(), "pnpm-inst-"));
  writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  assert.equal(isPnpmProject(dir), true);
});

test("addPostinstall adds when absent, appends when present, no-op when already there", () => {
  const a = addPostinstall({ name: "x" });
  assert.equal(a.changed, true);
  assert.match(a.obj.scripts.postinstall, /pnpm-phantom-scan\.mjs/);

  const b = addPostinstall({ name: "x", scripts: { postinstall: "husky install" } });
  assert.equal(b.changed, true);
  assert.match(b.obj.scripts.postinstall, /^husky install && /);
  assert.match(b.obj.scripts.postinstall, /pnpm-phantom-scan\.mjs/);

  const c = addPostinstall(b.obj);
  assert.equal(c.changed, false);
  assert.equal(c.obj.scripts.postinstall, b.obj.scripts.postinstall);
});

test("addHookToSettings adds once and is idempotent", () => {
  const first = addHookToSettings({});
  assert.equal(first.changed, true);
  const post = first.obj.hooks.PostToolUse;
  assert.equal(Array.isArray(post), true);
  assert.ok(post.some((e) => (e.hooks || []).some((h) =>
    (h.args || []).some((x) => String(x).includes("pnpm-phantom-fix-hook.mjs")))));

  const second = addHookToSettings(first.obj);
  assert.equal(second.changed, false);
});
