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

test("addPostinstall emits a cmd-safe command — no bare ~ that cmd.exe can't expand", () => {
  const { obj } = addPostinstall({ name: "x" });
  const cmd = obj.scripts.postinstall;
  // The whole failure mode: `~` is literal in cmd.exe. node must resolve home itself.
  assert.ok(!/(^|\s)~\//.test(cmd), `postinstall must not contain a bare ~/ path: ${cmd}`);
  assert.match(cmd, /os'\)\.homedir\(\)/);
  assert.match(cmd, /existsSync/);
});

test("addPostinstall migrates a previously-wired broken tilde form in place", () => {
  const legacy = { name: "x", scripts: { postinstall: "husky install && node ~/.claude/bin/pnpm-phantom-scan.mjs" } };
  const m = addPostinstall(legacy);
  assert.equal(m.changed, true);
  assert.ok(!/~\/\.claude/.test(m.obj.scripts.postinstall), "tilde form must be gone after migration");
  assert.match(m.obj.scripts.postinstall, /^husky install && /, "sibling scripts preserved");
  assert.match(m.obj.scripts.postinstall, /homedir\(\)/, "replaced with the cross-shell bootstrap");
  // And migration is a one-time change — re-running is a no-op.
  const again = addPostinstall(m.obj);
  assert.equal(again.changed, false);
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
