import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInstaller, pruneProMaxSkills, registerDesignHook } from "./design-stack.mjs";

test("runInstaller with skip=true never spawns and reports skipped", () => {
  const r = runInstaller("npx", ["impeccable", "install"], { root: tmpdir(), skip: true });
  assert.deepEqual(r, { ok: true, skipped: true, stdout: "", stderr: "" });
});

test("pruneProMaxSkills removes only non-kept uipro skills, protecting others", () => {
  const dir = mkdtempSync(join(tmpdir(), "skills-"));
  for (const s of ["ui-ux-pro-max", "ui-styling", "design-system", "design", "brand", "slides", "impeccable", "shadcn"])
    mkdirSync(join(dir, s), { recursive: true });
  const removed = pruneProMaxSkills(dir, ["ui-ux-pro-max", "ui-styling", "design-system"],
    { protect: ["impeccable", "shadcn"] });
  assert.deepEqual(removed.sort(), ["brand", "design", "slides"]);
  for (const keep of ["ui-ux-pro-max", "ui-styling", "design-system", "impeccable", "shadcn"])
    assert.ok(existsSync(join(dir, keep)), `${keep} must survive`);
  rmSync(dir, { recursive: true, force: true });
});

test("registerDesignHook adds Edit|Write|MultiEdit + Stop once (idempotent)", () => {
  const dir = mkdtempSync(join(tmpdir(), "hook-"));
  const settingsFile = join(dir, "settings.json");
  const first = registerDesignHook(settingsFile, { scriptPath: ".claude/skills/impeccable/scripts/hook.mjs" });
  assert.equal(first.added, true);
  const s = JSON.parse(readFileSync(settingsFile, "utf8"));
  const post = s.hooks.PostToolUse.find((e) => e.matcher === "Edit|Write|MultiEdit");
  assert.ok(post, "PostToolUse Edit|Write|MultiEdit entry missing");
  assert.match(post.hooks[0].command, /impeccable\/scripts\/hook\.mjs/);
  assert.ok(Array.isArray(s.hooks.Stop) && s.hooks.Stop.length >= 1, "Stop entry missing");
  const second = registerDesignHook(settingsFile, { scriptPath: ".claude/skills/impeccable/scripts/hook.mjs" });
  assert.equal(second.added, false, "second call must be a no-op");
  const s2 = JSON.parse(readFileSync(settingsFile, "utf8"));
  assert.equal(s2.hooks.PostToolUse.filter((e) => e.matcher === "Edit|Write|MultiEdit").length, 1);
  rmSync(dir, { recursive: true, force: true });
});
