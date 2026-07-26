import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveVerbosityLevel, loadVerbosityRule } from "./verbosity-rules.mjs";

function root(json) {
  const r = mkdtempSync(join(tmpdir(), "vb-"));
  if (json !== undefined) {
    mkdirSync(join(r, ".claude"), { recursive: true });
    writeFileSync(join(r, ".claude", "verbosity.json"), JSON.stringify(json));
  }
  return r;
}

test("no config resolves to off", () => {
  const r = root(undefined);
  assert.equal(resolveVerbosityLevel("main", r), "off");
  rmSync(r, { recursive: true, force: true });
});

test("level applies to main and any agent", () => {
  const r = root({ level: "full" });
  assert.equal(resolveVerbosityLevel("main", r), "full");
  assert.equal(resolveVerbosityLevel("gsd-executor", r), "full");
  rmSync(r, { recursive: true, force: true });
});

test("per-agent override wins over level", () => {
  const r = root({ level: "full", overrides: { "gsd-planner": "off" } });
  assert.equal(resolveVerbosityLevel("gsd-planner", r), "off");
  rmSync(r, { recursive: true, force: true });
});

test("each tier file loads and carries the anti-minify carve-out; off is empty", () => {
  assert.equal(loadVerbosityRule("off"), "");
  for (const lvl of ["lite", "full", "ultra"]) {
    const t = loadVerbosityRule(lvl);
    assert.ok(t.length > 0, `${lvl} has text`);
    assert.match(t, /NOT minification/);
  }
});
