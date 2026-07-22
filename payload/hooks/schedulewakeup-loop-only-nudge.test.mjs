// payload/hooks/schedulewakeup-loop-only-nudge.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { shouldNudge } from "./schedulewakeup-loop-only-nudge.mjs";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "schedulewakeup-loop-only-nudge.mjs");

function runHook(payload) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: "utf8", timeout: 10000 });
  return { status: r.status, out: (r.stdout || "").trim() };
}

test("stop:true (ending a loop) passes silently", () => {
  assert.equal(shouldNudge({ stop: true }), false);
  const { status, out } = runHook({ tool_name: "ScheduleWakeup", tool_input: { stop: true } });
  assert.equal(status, 0);
  assert.equal(out, "", "no advisory when a loop is being ended");
});

test("a scheduling call gets the loop-only reminder, non-blocking", () => {
  assert.equal(shouldNudge({ delaySeconds: 300, prompt: "x", reason: "waiting for executor" }), true);
  const { status, out } = runHook({
    tool_name: "ScheduleWakeup",
    tool_input: { delaySeconds: 300, prompt: "<<autonomous-loop-dynamic>>", reason: "pacing" },
  });
  assert.equal(status, 0);
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "allow", "advisory must never block");
  assert.match(parsed.hookSpecificOutput.additionalContext, /ONLY for \/loop/);
  assert.match(parsed.hookSpecificOutput.additionalContext, /re-invokes you automatically/);
});

test("malformed stdin fails open (exit 0, no output)", () => {
  const r = spawnSync(process.execPath, [HOOK], { input: "not json", encoding: "utf8", timeout: 10000 });
  assert.equal(r.status, 0);
  assert.equal((r.stdout || "").trim(), "");
});
