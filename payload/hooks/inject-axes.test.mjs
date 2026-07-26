import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, "inject-axes.mjs");

function run(payload, env = {}) {
  const out = execFileSync("node", [HOOK], {
    input: JSON.stringify(payload),
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return out.trim() ? JSON.parse(out) : null;
}

function leanmodeRoot() {
  const root = mkdtempSync(join(tmpdir(), "inj-"));
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "leanmode.json"), JSON.stringify({ dial: "full", default: "full" }));
  return root;
}

test("SubagentStart injects the leanmode block for a mapped-to-full agent", () => {
  const root = leanmodeRoot();
  const res = run({ hook_event_name: "SubagentStart", agent_type: "x", cwd: root });
  assert.ok(res, "expected output");
  assert.match(res.systemMessage, /leanmode: full/);
  assert.ok(res.hookSpecificOutput.additionalContext.length > 0);
  assert.equal(res.hookSpecificOutput.hookEventName, "SubagentStart");
  rmSync(root, { recursive: true, force: true });
});

test("CLAUDE_LEANMODE=0 disables the leanmode axis (no output)", () => {
  const root = leanmodeRoot();
  const res = run({ hook_event_name: "SubagentStart", agent_type: "x", cwd: root }, { CLAUDE_LEANMODE: "0" });
  assert.equal(res, null);
  rmSync(root, { recursive: true, force: true });
});

test("SessionStart yields nothing yet (leanmode is SubagentStart-only)", () => {
  const root = leanmodeRoot();
  const res = run({ hook_event_name: "SessionStart", cwd: root });
  assert.equal(res, null);
  rmSync(root, { recursive: true, force: true });
});
