import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const settings = JSON.parse(readFileSync(join(ROOT, "settings.partial.json"), "utf8"));

function argsFor(event) {
  return (settings.hooks[event] || []).flatMap(e => e.hooks).map(h => (h.args || []).join(" "));
}

test("injector registered on SessionStart and SubagentStart", () => {
  assert.ok(argsFor("SessionStart").some(a => a.includes("inject-axes.mjs")));
  assert.ok(argsFor("SubagentStart").some(a => a.includes("inject-axes.mjs")));
});

test("obsolete leanmode-subagent hook is gone", () => {
  const all = Object.keys(settings.hooks).flatMap(argsFor).join("\n");
  assert.ok(!all.includes("leanmode-subagent.mjs"));
});
