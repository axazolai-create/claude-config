// payload/hooks/lib/superpowers-fallow-graft.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SENTINEL, ANCHOR, GRAFT,
  applyFallowGraft, resolveSuperpowersReviewerFile, regraftFallow,
} from "./superpowers-fallow-graft.mjs";

const REVIEWER = `# Code Reviewer Prompt Template\n\n## What to Check\n\n**Plan alignment:**\n- match?\n`;
function tmp() { return mkdtempSync(join(tmpdir(), "fallow-graft-")); }

test("GRAFT constant carries guard, run, and install-nudge prose", () => {
  assert.ok(GRAFT.includes(SENTINEL));
  assert.ok(GRAFT.includes(".planning/"));               // GSD guard
  assert.ok(/fallow/.test(GRAFT));                        // runs fallow
  assert.ok(GRAFT.includes("pnpm add -D fallow"));        // install nudge
});

test("applyFallowGraft inserts under the anchor on a clean file", () => {
  const d = tmp(); const f = join(d, "code-reviewer.md");
  writeFileSync(f, REVIEWER);
  const r = applyFallowGraft({ skillFile: f });
  assert.deepEqual(r, { applied: true, already: false, skippedNoAnchor: false });
  const out = readFileSync(f, "utf8");
  assert.ok(out.includes(SENTINEL));
  assert.ok(out.indexOf(ANCHOR) < out.indexOf(SENTINEL));         // graft is AFTER the heading
  assert.ok(out.indexOf(SENTINEL) < out.indexOf("**Plan alignment:**")); // and before first check
  rmSync(d, { recursive: true, force: true });
});

test("applyFallowGraft is idempotent (already on second call)", () => {
  const d = tmp(); const f = join(d, "code-reviewer.md");
  writeFileSync(f, REVIEWER);
  applyFallowGraft({ skillFile: f });
  const before = readFileSync(f, "utf8");
  const r = applyFallowGraft({ skillFile: f });
  assert.deepEqual(r, { applied: false, already: true, skippedNoAnchor: false });
  assert.equal(readFileSync(f, "utf8"), before);                 // no double-insert
  rmSync(d, { recursive: true, force: true });
});

test("applyFallowGraft skips (no corruption) when anchor absent", () => {
  const d = tmp(); const f = join(d, "code-reviewer.md");
  writeFileSync(f, "# No checklist heading here\n");
  const r = applyFallowGraft({ skillFile: f });
  assert.deepEqual(r, { applied: false, already: false, skippedNoAnchor: true });
  assert.ok(!readFileSync(f, "utf8").includes(SENTINEL));
  rmSync(d, { recursive: true, force: true });
});

test("applyFallowGraft skips when file missing", () => {
  const r = applyFallowGraft({ skillFile: join(tmp(), "nope.md") });
  assert.deepEqual(r, { applied: false, already: false, skippedNoAnchor: true });
});

test("self-heals: a clobbered (sentinel-stripped) file re-grafts", () => {
  const d = tmp(); const f = join(d, "code-reviewer.md");
  writeFileSync(f, REVIEWER);
  applyFallowGraft({ skillFile: f });
  writeFileSync(f, REVIEWER);                                     // simulate plugin update clobber
  const r = applyFallowGraft({ skillFile: f });
  assert.equal(r.applied, true);
  assert.ok(readFileSync(f, "utf8").includes(SENTINEL));
  rmSync(d, { recursive: true, force: true });
});

test("resolveSuperpowersReviewerFile reads installPath from the manifest", () => {
  const d = tmp();
  const install = join(d, "cacheX", "superpowers", "6.2.0");
  const rev = join(install, "skills", "requesting-code-review");
  mkdirSync(rev, { recursive: true });
  writeFileSync(join(rev, "code-reviewer.md"), REVIEWER);
  mkdirSync(join(d, "plugins"), { recursive: true });
  writeFileSync(join(d, "plugins", "installed_plugins.json"), JSON.stringify({
    plugins: { "superpowers@claude-plugins-official": [{ scope: "user", installPath: install, version: "6.2.0" }] },
  }));
  const got = resolveSuperpowersReviewerFile(d);
  assert.equal(got, join(rev, "code-reviewer.md"));
  rmSync(d, { recursive: true, force: true });
});

test("resolveSuperpowersReviewerFile falls back to highest semver cache dir", () => {
  const d = tmp();
  const base = join(d, "plugins", "cache", "claude-plugins-official", "superpowers");
  for (const v of ["6.1.1", "6.2.0"]) {
    const rev = join(base, v, "skills", "requesting-code-review");
    mkdirSync(rev, { recursive: true });
    writeFileSync(join(rev, "code-reviewer.md"), REVIEWER);
  }
  // no installed_plugins.json → fallback path
  const got = resolveSuperpowersReviewerFile(d);
  assert.ok(got.includes(join("superpowers", "6.2.0")));         // highest, not 6.1.1
  rmSync(d, { recursive: true, force: true });
});

test("regraftFallow never throws and no-ops when nothing resolves", () => {
  const r = regraftFallow({ claudeDir: join(tmp(), "empty") });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-skill-file");
});

test("regraftFallow success path grafts a resolved skill file", () => {
  const d = tmp();
  const install = join(d, "cache", "superpowers", "6.2.0");
  const rev = join(install, "skills", "requesting-code-review");
  mkdirSync(rev, { recursive: true });
  writeFileSync(join(rev, "code-reviewer.md"), REVIEWER);
  mkdirSync(join(d, "plugins"), { recursive: true });
  writeFileSync(join(d, "plugins", "installed_plugins.json"), JSON.stringify({
    plugins: { "superpowers@claude-plugins-official": [{ installPath: install }] },
  }));
  const r = regraftFallow({ claudeDir: d });
  assert.equal(r.ok, true);
  assert.equal(r.applied, true);
  assert.ok(readFileSync(join(rev, "code-reviewer.md"), "utf8").includes(SENTINEL));
  rmSync(d, { recursive: true, force: true });
});
