import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { runDesignStack } from "./install-design-stack.mjs";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tpl = JSON.parse(readFileSync(join(ROOT, "payload/setting-templates/frontend/_base.json"), "utf8"));

test("frontend/_base.json no longer references frontend-design", () => {
  const raw = JSON.stringify(tpl);
  assert.ok(!raw.includes("frontend-design"), "frontend-design must be fully removed");
});

test("frontend/_base.json declares designStack with the locked Pro Max subset", () => {
  assert.ok(tpl.designStack, "designStack block missing");
  assert.match(tpl.designStack.impeccable.install, /impeccable install .*--scope=project.*--no-hooks/);
  assert.match(tpl.designStack.proMax.install, /uipro init .*--offline/);
  assert.deepEqual(tpl.designStack.proMax.keepSkills, ["ui-ux-pro-max", "ui-styling", "design-system"]);
});

// With installers skipped, simulate their effect by pre-planting the skill dirs, then assert the
// orchestrator prunes, registers the hook, and grafts — idempotently.
function plantSkills(root) {
  const skills = join(root, ".claude", "skills");
  for (const s of ["ui-ux-pro-max", "ui-styling", "design-system", "design", "brand"])
    mkdirSync(join(skills, s), { recursive: true });
  const refDir = join(skills, "impeccable", "reference");
  mkdirSync(refDir, { recursive: true });
  for (const f of ["new-work.md", "shape.md", "colorize.md", "typeset.md"])
    writeFileSync(join(refDir, f), `# ${f}\n\n## Steps\nbody\n`);
}
const CONFIG = { impeccable: { install: "npx impeccable install --scope=project --no-hooks" },
  proMax: { install: "uipro init --offline", keepSkills: ["ui-ux-pro-max", "ui-styling", "design-system"] } };

test("runDesignStack prunes to subset, registers hook, grafts — idempotent", () => {
  const root = mkdtempSync(join(tmpdir(), "ds-root-"));
  plantSkills(root);
  const r1 = runDesignStack({ root, config: CONFIG, skip: true });
  assert.deepEqual(r1.pruned.sort(), ["brand", "design"]);
  assert.equal(r1.hook.added, true);
  assert.ok(r1.graft.applied.length === 4);
  assert.ok(existsSync(join(root, ".claude", "settings.json")));
  assert.ok(readFileSync(join(root, ".claude", "skills", "impeccable", "reference", "shape.md"), "utf8").includes("promax-graft"));
  // second run: nothing to prune, hook already there, graft already applied
  const r2 = runDesignStack({ root, config: CONFIG, skip: true });
  assert.deepEqual(r2.pruned, []);
  assert.equal(r2.hook.added, false);
  assert.deepEqual(r2.graft.applied, []);
  rmSync(root, { recursive: true, force: true });
});
