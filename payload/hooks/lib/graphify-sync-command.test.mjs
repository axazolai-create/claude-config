import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSyncCommand } from "./graphify-sync-command.mjs";

const args = { root: "C:/repo", name: "repo", lock: "C:/state/repo.lock" };

test("the windows command extracts then deletes the lock", () => {
  const c = buildSyncCommand({ ...args, isWin: true });
  assert.equal(c.shell, "cmd");
  assert.equal(c.flag, "/c");
  assert.equal(c.inner,
    'graphify "extract" "C:/repo" "--code-only" "--global" "--as" "repo" & del /f /q "C:/state/repo.lock"');
});

test("the posix command extracts then removes the lock", () => {
  const c = buildSyncCommand({ ...args, isWin: false });
  assert.equal(c.shell, "sh");
  assert.equal(c.flag, "-c");
  assert.equal(c.inner,
    'graphify "extract" "C:/repo" "--code-only" "--global" "--as" "repo"; rm -f "C:/state/repo.lock"');
});

test("a quote inside an argument is escaped, not dropped", () => {
  const c = buildSyncCommand({ ...args, name: 'we"ird', isWin: false });
  assert.match(c.inner, /"we\\"ird"/);
});

// Without it graphify demands semantic extraction for every markdown file and exits with
// "no LLM API key found", which is why the global graph stopped moving on 3 July.
test("extraction is code-only, so no API key is ever needed", () => {
  for (const isWin of [true, false]) {
    assert.match(buildSyncCommand({ ...args, isWin }).inner, /"--code-only"/);
  }
});

const withPush = {
  ...args, pushScript: "C:/claude/bin/push.mjs", node: "C:/node.exe",
  logPath: "C:/state/push.log",
};

test("the push runs after the extract and before the lock is released", () => {
  for (const isWin of [true, false]) {
    const inner = buildSyncCommand({ ...withPush, isWin }).inner;
    const iExtract = inner.indexOf("extract");
    const iPush = inner.indexOf("push.mjs");
    const iUnlock = inner.search(isWin ? /del \/f \/q/ : /rm -f/);
    assert.ok(iExtract < iPush && iPush < iUnlock, `order wrong on ${isWin ? "win" : "posix"}: ${inner}`);
  }
});

// Nothing watches the console of a detached process, so a failed push is invisible
// without a file to read afterwards.
test("the push writes stdout and stderr to the log", () => {
  const inner = buildSyncCommand({ ...withPush, isWin: false }).inner;
  assert.match(inner, /> "C:\/state\/push\.log" 2>&1/);
});

// Profile `base` excludes bin/graphify-neo4j-*, so most installs have no push script at all.
test("no push script means the command is the plain sync", () => {
  const plain = buildSyncCommand({ ...args, isWin: true });
  const withNull = buildSyncCommand({ ...withPush, pushScript: null, isWin: true });
  assert.equal(withNull.inner, plain.inner);
});
