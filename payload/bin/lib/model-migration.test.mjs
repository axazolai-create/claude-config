// payload/bin/lib/model-migration.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateSettingsModel, migrateProjectModelConfig } from "./model-migration.mjs";

// ---- migrateSettingsModel: tier-preserving, non-clobber ----

test("superseded opus ids migrate to claude-opus-5", () => {
  for (const id of ["claude-opus-4-8", "claude-opus-4-1", "claude-3-opus-20240229"]) {
    const r = migrateSettingsModel(id);
    assert.equal(r.changed, true, `${id} should be flagged`);
    assert.equal(r.value, "claude-opus-5");
    assert.equal(r.from, id);
  }
});

test("the opus[1m] alias migrates to claude-opus-5", () => {
  const r = migrateSettingsModel("opus[1m]");
  assert.equal(r.changed, true);
  assert.equal(r.value, "claude-opus-5");
  assert.equal(r.from, "opus[1m]");
});

test("superseded sonnet ids migrate to claude-sonnet-5 (no cross-tier jump)", () => {
  for (const id of ["claude-sonnet-4-5", "claude-3-5-sonnet-20241022", "claude-3-7-sonnet-20250219"]) {
    const r = migrateSettingsModel(id);
    assert.equal(r.changed, true, `${id} should be flagged`);
    assert.equal(r.value, "claude-sonnet-5");
  }
});

test("superseded haiku ids migrate to claude-haiku-4-5", () => {
  for (const id of ["claude-3-5-haiku-20241022", "claude-3-haiku-20240307"]) {
    const r = migrateSettingsModel(id);
    assert.equal(r.changed, true, `${id} should be flagged`);
    assert.equal(r.value, "claude-haiku-4-5");
  }
});

test("aliases are left untouched (opus[1m] is the deliberate exception)", () => {
  for (const id of ["opus", "sonnet", "haiku", "fable", "sonnet[1m]"]) {
    const r = migrateSettingsModel(id);
    assert.equal(r.changed, false, `${id} must not change`);
    assert.equal(r.value, id);
  }
});

test("current full ids are left untouched", () => {
  for (const id of ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5", "claude-fable-5"]) {
    const r = migrateSettingsModel(id);
    assert.equal(r.changed, false, `${id} must not change`);
    assert.equal(r.value, id);
  }
});

test("unknown / future ids are never mis-flagged", () => {
  for (const id of ["claude-opus-6", "claude-opus-6-1", "gpt-4o", "", undefined]) {
    const r = migrateSettingsModel(id);
    assert.equal(r.changed, false, `${id} must not change`);
    assert.equal(r.value, id);
  }
});

// ---- migrateProjectModelConfig: surgical §6.3 re-migration ----

const OLD_OVERRIDES = {
  "gsd-planner": "opus",
  "gsd-pattern-mapper": "haiku",
  "gsd-integration-checker": "haiku",
  "gsd-nyquist-auditor": "haiku",
  "gsd-ui-checker": "haiku",
  "gsd-ui-auditor": "haiku",
  "gsd-verifier": "sonnet",
  "gsd-doc-verifier": "haiku",
};

test("all six §6.3 roles migrate old -> new", () => {
  const { config, changes } = migrateProjectModelConfig({ model_overrides: { ...OLD_OVERRIDES } });
  assert.equal(config.model_overrides["gsd-pattern-mapper"], "sonnet");
  assert.equal(config.model_overrides["gsd-integration-checker"], "sonnet");
  assert.equal(config.model_overrides["gsd-nyquist-auditor"], "sonnet");
  assert.equal(config.model_overrides["gsd-ui-checker"], "sonnet");
  assert.equal(config.model_overrides["gsd-ui-auditor"], "sonnet");
  assert.equal(config.model_overrides["gsd-verifier"], "opus");
  assert.equal(changes.length, 6);
  // Untouched roles stay put.
  assert.equal(config.model_overrides["gsd-planner"], "opus");
  assert.equal(config.model_overrides["gsd-doc-verifier"], "haiku");
});

test("already-migrated config is a no-op", () => {
  const migrated = {
    "gsd-pattern-mapper": "sonnet", "gsd-integration-checker": "sonnet",
    "gsd-nyquist-auditor": "sonnet", "gsd-ui-checker": "sonnet",
    "gsd-ui-auditor": "sonnet", "gsd-verifier": "opus",
  };
  const { changes } = migrateProjectModelConfig({ model_overrides: { ...migrated } });
  assert.deepEqual(changes, []);
});

test("a foreign (user-chosen) value is left untouched", () => {
  const { config, changes } = migrateProjectModelConfig({
    model_overrides: { "gsd-pattern-mapper": "opus", "gsd-verifier": "sonnet" },
  });
  assert.equal(config.model_overrides["gsd-pattern-mapper"], "opus", "user value kept");
  // only gsd-verifier (holds the known-old value) migrates
  assert.deepEqual(changes.map((c) => c.role), ["gsd-verifier"]);
});

test("a role absent from the config is skipped", () => {
  const { changes } = migrateProjectModelConfig({ model_overrides: { "gsd-verifier": "sonnet" } });
  assert.deepEqual(changes.map((c) => c.role), ["gsd-verifier"]);
});

test("missing model_overrides key does not throw", () => {
  const { changes } = migrateProjectModelConfig({ mode: "interactive" });
  assert.deepEqual(changes, []);
});

test("the input config object is not mutated", () => {
  const input = { model_overrides: { "gsd-verifier": "sonnet" } };
  migrateProjectModelConfig(input);
  assert.equal(input.model_overrides["gsd-verifier"], "sonnet", "original must be untouched");
});

test("each change records role, from, to", () => {
  const { changes } = migrateProjectModelConfig({ model_overrides: { "gsd-ui-checker": "haiku" } });
  assert.deepEqual(changes, [{ role: "gsd-ui-checker", from: "haiku", to: "sonnet" }]);
});
