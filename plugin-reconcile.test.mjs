import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPluginPlan } from "./plugin-reconcile.mjs";

const MANAGED = { superpowers: "superpowers@m", gsd: "gsd@m", "context-mode": "cm@m", context7: "c7@m" };
const LITE = ["superpowers", "context-mode", "context7"];

test("surplus gsd: uninstall + disable when installed and enabled", () => {
  const { actions } = buildPluginPlan({ required: LITE, managed: MANAGED,
    enabledPlugins: { "superpowers@m": true, "gsd@m": true, "cm@m": true, "c7@m": true },
    installedIds: ["superpowers@m", "gsd@m", "cm@m", "c7@m"] });
  assert.deepEqual(actions, [
    { type: "uninstall", name: "gsd", id: "gsd@m" },
    { type: "disable",  name: "gsd", id: "gsd@m" },
  ]);
});

test("missing required: install + enable", () => {
  const { actions } = buildPluginPlan({ required: LITE, managed: MANAGED,
    enabledPlugins: { "superpowers@m": true }, installedIds: ["superpowers@m"] });
  assert.deepEqual(actions, [
    { type: "install", name: "context-mode", id: "cm@m" },
    { type: "enable",  name: "context-mode", id: "cm@m" },
    { type: "install", name: "context7", id: "c7@m" },
    { type: "enable",  name: "context7", id: "c7@m" },
  ]);
});

test("CLI unavailable: enabledPlugins edits still planned, install/uninstall become notes", () => {
  const { actions, notes } = buildPluginPlan({ required: LITE, managed: MANAGED,
    enabledPlugins: { "gsd@m": true }, installedIds: null });
  assert.ok(actions.every((a) => a.type === "enable" || a.type === "disable"));
  assert.ok(notes.some((n) => n.includes("claude plugin uninstall gsd@m")));
  assert.ok(notes.some((n) => n.includes("claude plugin install cm@m")));
});

test("unknown user plugins untouched; empty enabledPlugins object preserved semantics", () => {
  const { actions } = buildPluginPlan({ required: LITE, managed: MANAGED,
    enabledPlugins: { "my-own@x": true, "superpowers@m": true, "cm@m": true, "c7@m": true },
    installedIds: ["my-own@x", "superpowers@m", "cm@m", "c7@m"] });
  assert.deepEqual(actions, []);   // my-own@x invisible; nothing to do
});
