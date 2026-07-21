// payload/hooks/ci-watch-nudge.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { isGitPush } from "./ci-watch-nudge.mjs";

test("detects a git push as the leading command", () => {
  assert.equal(isGitPush("git push"), true);
  assert.equal(isGitPush("git push origin master"), true);
  assert.equal(isGitPush("git -C /repo push"), true);
  assert.equal(isGitPush("git commit -m x && git push"), true); // second segment
});

test("does not fire on non-push git or unrelated commands", () => {
  assert.equal(isGitPush("git commit -m x"), false);
  assert.equal(isGitPush("git fetch"), false);
  assert.equal(isGitPush("git pull"), false);
  assert.equal(isGitPush("gh pr create"), false);
  assert.equal(isGitPush("echo git push"), false); // not a leading git command
});
