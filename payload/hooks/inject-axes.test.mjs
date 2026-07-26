import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRuleText } from "./lib/leanmode-rules.mjs";

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
  assert.equal(res.hookSpecificOutput.additionalContext, loadRuleText("full"));
  assert.equal(res.hookSpecificOutput.hookEventName, "SubagentStart");
  rmSync(root, { recursive: true, force: true });
});

test("SubagentStart with no agent_type yields no output (retired leanmode-subagent.mjs parity)", () => {
  const root = leanmodeRoot();
  const res = run({ hook_event_name: "SubagentStart", cwd: root });
  assert.equal(res, null);
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

function bothRoot() {
  const root = mkdtempSync(join(tmpdir(), "inj2-"));
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "leanmode.json"), JSON.stringify({ dial: "full", default: "full" }));
  writeFileSync(join(root, ".claude", "verbosity.json"), JSON.stringify({ level: "full" }));
  return root;
}

test("SessionStart injects verbosity only (leanmode not subscribed)", () => {
  const root = bothRoot();
  const res = run({ hook_event_name: "SessionStart", cwd: root });
  assert.ok(res);
  assert.match(res.systemMessage, /verbosity: full/);
  assert.doesNotMatch(res.systemMessage, /leanmode/);
  rmSync(root, { recursive: true, force: true });
});

test("SubagentStart injects both axes when both on", () => {
  const root = bothRoot();
  const res = run({ hook_event_name: "SubagentStart", agent_type: "x", cwd: root });
  assert.match(res.systemMessage, /leanmode: full/);
  assert.match(res.systemMessage, /verbosity: full/);
  rmSync(root, { recursive: true, force: true });
});

test("leanmode disabled still injects verbosity (axis independence)", () => {
  const root = bothRoot();
  const res = run({ hook_event_name: "SubagentStart", agent_type: "x", cwd: root }, { CLAUDE_LEANMODE: "0" });
  assert.ok(res);
  assert.match(res.systemMessage, /verbosity: full/);
  assert.doesNotMatch(res.systemMessage, /leanmode/);
  rmSync(root, { recursive: true, force: true });
});
