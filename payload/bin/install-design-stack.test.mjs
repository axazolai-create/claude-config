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

test("provenance prune: removes only install-created extras, protects pre-existing user skills", () => {
  const root = mkdtempSync(join(tmpdir(), "ds-prov-"));
  const skills = join(root, ".claude", "skills");
  mkdirSync(skills, { recursive: true });
  // pre-existing USER skill named "design" (a generic name uipro also uses) — must SURVIVE
  mkdirSync(join(skills, "design"), { recursive: true });
  writeFileSync(join(skills, "design", "USER.md"), "mine");
  mkdirSync(join(skills, "ui-styling"), { recursive: true });     // kept, pre-existing
  mkdirSync(join(skills, "design-system"), { recursive: true });  // kept, pre-existing
  const refDir = join(skills, "impeccable", "reference");         // impeccable present → its install skipped
  mkdirSync(refDir, { recursive: true });
  for (const f of ["new-work.md", "shape.md", "colorize.md", "typeset.md"])
    writeFileSync(join(refDir, f), `# ${f}\n\n## Steps\nbody\n`);
  // fixture install: creates ui-ux-pro-max (kept) + brand + slides (extras to prune). No spaces in the path.
  const gen = join(root, "make-extras.mjs");
  writeFileSync(gen, `import { mkdirSync } from "node:fs"; import { join } from "node:path"; const b = join(process.cwd(), ".claude", "skills"); for (const d of ["ui-ux-pro-max","brand","slides"]) mkdirSync(join(b, d), { recursive: true });`);
  const CONFIG = { impeccable: { install: "node --version" },
    proMax: { install: `node ${gen}`, keepSkills: ["ui-ux-pro-max", "ui-styling", "design-system"] } };

  const r1 = runDesignStack({ root, config: CONFIG, skip: false });
  assert.deepEqual(r1.pruned.sort(), ["brand", "slides"], "only install-created extras pruned");
  assert.equal(readFileSync(join(skills, "design", "USER.md"), "utf8"), "mine", "pre-existing user 'design' skill must survive");
  assert.ok(existsSync(join(skills, "ui-ux-pro-max")), "kept skill survives");
  assert.equal(r1.hook.added, true);
  assert.ok(r1.graft.applied.length === 4);
  // idempotent second run: ui-ux-pro-max now present → install skipped → nothing created → nothing pruned
  const r2 = runDesignStack({ root, config: CONFIG, skip: false });
  assert.deepEqual(r2.pruned, []);
  assert.equal(r2.hook.added, false);
  assert.deepEqual(r2.graft.applied, []);
  rmSync(root, { recursive: true, force: true });
});
