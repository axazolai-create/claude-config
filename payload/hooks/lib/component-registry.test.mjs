import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPONENTS, autoUpdateEnabled, decide, pendingCount, pendingNames, formatUpdateNotes } from "./component-registry.mjs";

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

const STATE = {
  "impeccable":    { installed: "4.0.2", latest: "4.1.0", updateAvailable: true,  class: "safe",   autoUpdated: true },
  "graphify":      { installed: "1.0.0", latest: "1.0.0", updateAvailable: false, class: "safe",   autoUpdated: false },
  "claude-config": { installed: "abc123", latest: "def456", updateAvailable: true, class: "reinit", autoUpdated: false },
  "ui-ux-pro-max": { installed: "2.0.0", latest: "2.1.0", updateAvailable: true,  class: "safe",   autoUpdated: false },
};

test("pendingCount: counts only updateAvailable entries", () => {
  assert.equal(pendingCount(STATE), 3);
  assert.equal(pendingCount({}), 0);
});

test("formatUpdateNotes: safe-applied says restart; reinit says the command", () => {
  const notes = formatUpdateNotes(STATE);
  assert.equal(notes.length, 3);
  const safe = notes.find((n) => n.startsWith("impeccable"));
  assert.match(safe, /4\.0\.2.*4\.1\.0/);
  assert.match(safe, /restart/i);
  const reinit = notes.find((n) => n.startsWith("claude-config"));
  assert.match(reinit, /setup\.mjs|installer/i);
  assert.doesNotMatch(reinit, /restart to apply now/i);
  const safeNotAuto = notes.find((n) => n.startsWith("ui-ux-pro-max"));
  assert.match(safeNotAuto, /available/i);
  assert.doesNotMatch(safeNotAuto, /restart to apply now/i);
  assert.doesNotMatch(safeNotAuto, /init-stack|setup\.mjs|installer/i);
});

test("formatUpdateNotes: handles empty and null state", () => {
  assert.deepEqual(formatUpdateNotes({}), []);
  assert.deepEqual(formatUpdateNotes(null), []);
});

test("pendingNames lists exactly the components with an update available", () => {
  const state = {
    graphify: { updateAvailable: false },
    "context-mode": { updateAvailable: true },
    "claude-config": { updateAvailable: true },
  };
  assert.deepEqual(pendingNames(state), ["claude-config", "context-mode"]);
  assert.equal(pendingCount(state), 2);
});

test("pendingNames tolerates junk", () => {
  assert.deepEqual(pendingNames(null), []);
  assert.deepEqual(pendingNames({ a: null, b: "x", c: { updateAvailable: "yes" } }), []);
});
