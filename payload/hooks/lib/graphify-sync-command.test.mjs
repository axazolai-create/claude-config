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

test("the command is extract then unlock, and nothing else", () => {
  for (const isWin of [true, false]) {
    const inner = buildSyncCommand({ ...args, isWin }).inner;
    const iExtract = inner.indexOf("extract");
    const iUnlock = inner.search(isWin ? /del \/f \/q/ : /rm -f/);
    assert.ok(iExtract < iUnlock, `order wrong on ${isWin ? "win" : "posix"}: ${inner}`);
    assert.equal(inner.split(isWin ? " & " : "; ").length, 2);
  }
});

// node escapes the quotes inside `inner` as \" , cmd.exe has no such escape, and the mangled
// line makes cmd exit without running a single step - silently, since stdio is ignored.
test("the windows spawn passes its arguments verbatim, or cmd runs nothing at all", () => {
  assert.equal(buildSyncCommand({ ...args, isWin: true }).opts.windowsVerbatimArguments, true);
});

// Harmless on POSIX, where execve takes an argv array and nothing re-parses it.
test("verbatim is a windows-only concern", () => {
  assert.equal(buildSyncCommand({ ...args, isWin: false }).opts.windowsVerbatimArguments, false);
});

test("the sync runs detached and silent from the repository root, so no caller ever waits", () => {
  for (const isWin of [true, false]) {
    const o = buildSyncCommand({ ...args, isWin }).opts;
    assert.equal(o.cwd, args.root);
    assert.equal(o.detached, true);
    assert.equal(o.stdio, "ignore");
  }
});
