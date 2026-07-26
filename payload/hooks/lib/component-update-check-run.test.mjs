import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPONENTS } from "./component-registry.mjs";

test("impeccable registry entry carries afterUpdate=promax-graft", () => {
  const imp = COMPONENTS.find((c) => c.name === "impeccable");
  assert.equal(imp.scope, "project");
  assert.equal(imp.afterUpdate, "promax-graft");
});

test("projectProbe present() is false when the skill dir is absent (no throw)", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "probe-"));
  // dynamic import of the worker's projectProbe requires it be exported; export it for testability.
  const mod = await import("./component-update-check-run.mjs");
  const probe = mod.projectProbe("impeccable", root);
  assert.equal(probe.present(), false);
  rmSync(root, { recursive: true, force: true });
});

test("updateAndRegraft re-applies the graft AFTER the update clobbers the reference files", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { SENTINEL, ANCHORS } = await import("./impeccable-promax-graft.mjs");
  const mod = await import("./component-update-check-run.mjs");

  const root = mkdtempSync(join(tmpdir(), "uar-"));
  const refDir = join(root, ".claude", "skills", "impeccable", "reference");
  mkdirSync(refDir, { recursive: true });
  const writeClean = () => { for (const f of Object.keys(ANCHORS)) writeFileSync(join(refDir, f), `# ${f}\n\n## Steps\nbody\n`); };
  writeClean();
  // fake update = what `impeccable update` really does: overwrite reference/*.md (dropping any graft)
  const probe = { update: () => writeClean() };
  const comp = { afterUpdate: "promax-graft" };

  mod.updateAndRegraft({ probe, comp, root });

  // if regraft ran BEFORE the (clobbering) update, the sentinel would be gone; its presence proves ordering
  for (const f of Object.keys(ANCHORS))
    assert.ok(readFileSync(join(refDir, f), "utf8").includes(SENTINEL), `${f} must carry the graft after updateAndRegraft`);
  rmSync(root, { recursive: true, force: true });
});
