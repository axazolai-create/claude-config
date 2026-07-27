// payload/hooks/lib/gsd-skill-patches.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SKILL_PATCHES,
  applyGsdSkillPatches,
  checkGsdSkillPatches,
} from "./gsd-skill-patches.mjs";

const skillFixture = (effort) =>
  `---\nname: gsd-plan-phase\ndescription: Plan a phase.\neffort: ${effort}\n---\n\nBody of the skill.\n`;

// Write a skills/<name>/SKILL.md tree, return the claudeDir root.
function makeClaudeDir(skills) {
  const dir = mkdtempSync(join(tmpdir(), "gsd-skill-patches-"));
  for (const [name, content] of Object.entries(skills)) {
    mkdirSync(join(dir, "skills", name), { recursive: true });
    writeFileSync(join(dir, "skills", name, "SKILL.md"), content);
  }
  return dir;
}

test("the three effort patches are registered (max -> xhigh)", () => {
  const ids = SKILL_PATCHES.map((p) => p.skill).sort();
  assert.deepEqual(ids, ["gsd-autonomous", "gsd-execute-phase", "gsd-plan-phase"]);
  for (const p of SKILL_PATCHES) {
    assert.equal(p.key, "effort");
    assert.equal(p.to, "xhigh");
    assert.ok(p.from.includes("max"));
  }
});

test("fresh apply rewrites effort max -> xhigh and clears pending", () => {
  const dir = makeClaudeDir({ "gsd-plan-phase": skillFixture("max") });
  // RED precondition: pending before apply.
  assert.ok(checkGsdSkillPatches({ claudeDir: dir })["gsd-plan-phase/SKILL.md"]);

  const res = applyGsdSkillPatches({ claudeDir: dir });
  assert.ok(res.applied.some((e) => e.startsWith("gsd-plan-phase/SKILL.md")));

  const out = readFileSync(join(dir, "skills", "gsd-plan-phase", "SKILL.md"), "utf8");
  assert.match(out, /^effort: xhigh$/m);
  // Nothing pending after apply.
  assert.deepEqual(checkGsdSkillPatches({ claudeDir: dir }), {});
});

test("re-apply is idempotent (no second write)", () => {
  const dir = makeClaudeDir({ "gsd-plan-phase": skillFixture("max") });
  applyGsdSkillPatches({ claudeDir: dir });
  const res2 = applyGsdSkillPatches({ claudeDir: dir });
  assert.deepEqual(res2.applied, []);
});

test("a user-chosen foreign value is left untouched", () => {
  const dir = makeClaudeDir({ "gsd-plan-phase": skillFixture("high") });
  const res = applyGsdSkillPatches({ claudeDir: dir });
  assert.equal(res.applied.length, 0);
  assert.ok(res.skippedForeign.some((e) => e.startsWith("gsd-plan-phase/SKILL.md")));
  const out = readFileSync(join(dir, "skills", "gsd-plan-phase", "SKILL.md"), "utf8");
  assert.match(out, /^effort: high$/m);
  assert.deepEqual(checkGsdSkillPatches({ claudeDir: dir }), {});
});

test("a curated skill file is skipped, not rewritten", () => {
  const curated = "<!-- CURATED:NOEDIT -->\n" + skillFixture("max");
  const dir = makeClaudeDir({ "gsd-plan-phase": curated });
  const res = applyGsdSkillPatches({ claudeDir: dir });
  assert.equal(res.applied.length, 0);
  assert.ok(res.skippedCurated.includes("gsd-plan-phase/SKILL.md"));
  const out = readFileSync(join(dir, "skills", "gsd-plan-phase", "SKILL.md"), "utf8");
  assert.match(out, /^effort: max$/m);
});

test("an absent skill directory is a silent no-op", () => {
  const dir = makeClaudeDir({}); // no skills at all
  const res = applyGsdSkillPatches({ claudeDir: dir });
  assert.deepEqual(res.applied, []);
  assert.deepEqual(checkGsdSkillPatches({ claudeDir: dir }), {});
});
