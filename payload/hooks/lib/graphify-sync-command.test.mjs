import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSyncCommand } from "./graphify-sync-command.mjs";

const args = { root: "C:/repo", name: "repo", lock: "C:/state/repo.lock" };

test("the windows command extracts then deletes the lock", () => {
  const c = buildSyncCommand({ ...args, isWin: true });
  assert.equal(c.shell, "cmd");
  assert.equal(c.flag, "/c");
  assert.equal(c.inner,
    'graphify "extract" "C:/repo" "--global" "--as" "repo" & del /f /q "C:/state/repo.lock"');
});

test("the posix command extracts then removes the lock", () => {
  const c = buildSyncCommand({ ...args, isWin: false });
  assert.equal(c.shell, "sh");
  assert.equal(c.flag, "-c");
  assert.equal(c.inner,
    'graphify "extract" "C:/repo" "--global" "--as" "repo"; rm -f "C:/state/repo.lock"');
});

test("a quote inside an argument is escaped, not dropped", () => {
  const c = buildSyncCommand({ ...args, name: 'we"ird', isWin: false });
  assert.match(c.inner, /"we\\"ird"/);
});
