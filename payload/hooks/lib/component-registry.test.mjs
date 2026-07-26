import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPONENTS, autoUpdateEnabled, decide } from "./component-registry.mjs";

test("COMPONENTS: known entries with required fields", () => {
  const byName = Object.fromEntries(COMPONENTS.map((c) => [c.name, c]));
  assert.equal(byName["context-mode"].kind, "upgrade-only");
  assert.equal(byName["context-mode"].legacyEnv, "CONTEXT_MODE");
  assert.equal(byName["graphify"].kind, "upgrade-only");
  assert.equal(byName["claude-config"].kind, "version");
  assert.equal(byName["claude-config"].updateClass, "reinit");
  for (const c of COMPONENTS) {
    assert.ok(["global", "project"].includes(c.scope), `${c.name} scope`);
    assert.ok(["safe", "reinit"].includes(c.updateClass), `${c.name} class`);
  }
});

test("decide: routes on class + availability + toggle", () => {
  assert.equal(decide({ updateClass: "safe", updateAvailable: true, autoUpdateEnabled: true }), "auto");
  assert.equal(decide({ updateClass: "safe", updateAvailable: true, autoUpdateEnabled: false }), "notify");
  assert.equal(decide({ updateClass: "reinit", updateAvailable: true, autoUpdateEnabled: true }), "notify");
  assert.equal(decide({ updateClass: "safe", updateAvailable: false, autoUpdateEnabled: true }), "skip");
});

test("autoUpdateEnabled: default on, global/per-name/legacy off", () => {
  assert.equal(autoUpdateEnabled("impeccable", {}), true);
  assert.equal(autoUpdateEnabled("impeccable", { CLAUDE_COMPONENT_AUTOUPDATE: "0" }), false);
  assert.equal(autoUpdateEnabled("ui-ux-pro-max", { CLAUDE_COMPONENT_AUTOUPDATE_UI_UX_PRO_MAX: "0" }), false);
  // legacy env still honored for a migrated tool (context-mode -> CONTEXT_MODE)
  assert.equal(autoUpdateEnabled("context-mode", { CLAUDE_TOOL_AUTOUPGRADE: "0" }), false);
  assert.equal(autoUpdateEnabled("context-mode", { CLAUDE_TOOL_AUTOUPGRADE_CONTEXT_MODE: "0" }), false);
  assert.equal(autoUpdateEnabled("graphify", { CLAUDE_TOOL_AUTOUPGRADE_GRAPHIFY: "0" }), false);
});
