import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isGitCommit } from "./decision-records-nudge.mjs";

test("recognises a commit in any of its usual forms", () => {
  for (const cmd of ["git commit -m x", "git -C /repo commit", "git add . && git commit -F msg.txt", "git.exe commit --amend"])
    assert.equal(isGitCommit(cmd), true, cmd);
});

test("does not fire on other git commands", () => {
  for (const cmd of ["git push", "git status", "git log --oneline"]) assert.equal(isGitCommit(cmd), false, cmd);
});

test("a commit message mentioning commit does not matter - only the command does", () => {
  assert.equal(isGitCommit("echo 'how to commit' > notes.txt"), false);
  assert.equal(isGitCommit("git commit -m 'do not commit secrets'"), true);
});

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "decision-records-nudge.mjs");
const run = (payload) => spawnSync(process.execPath, [HOOK], { input: payload, encoding: "utf8" });

// A nudge that breaks a commit is worse than a missed nudge, so every input class exits 0.
test("the hook never blocks and never throws, whatever it is fed", () => {
  for (const payload of ["", "not json", "null", "[]", "42", '{"tool_input":null}',
    JSON.stringify({ tool_name: "Bash", tool_input: { command: "git status" } })]) {
    const r = run(payload);
    assert.equal(r.status, 0, `payload ${JSON.stringify(payload)} exited ${r.status}`);
  }
});
