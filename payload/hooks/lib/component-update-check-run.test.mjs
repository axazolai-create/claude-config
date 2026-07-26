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
