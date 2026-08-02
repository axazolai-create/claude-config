import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_EXCLUDE, isProjectRoot } from "./project-scan.mjs";

const fs = (entries, gitIsFile = false) => ({
  readdir: () => entries,
  gitIsDirectory: () => !gitIsFile,
});

test("a directory with a package manifest is a project root", () => {
  assert.equal(isProjectRoot("/x", fs(["package.json", "src"])), true);
  assert.equal(isProjectRoot("/x", fs(["pyproject.toml"])), true);
  assert.equal(isProjectRoot("/x", fs(["go.mod"])), true);
});

test("a solution or project file counts by extension", () => {
  assert.equal(isProjectRoot("/x", fs(["App.sln"])), true);
  assert.equal(isProjectRoot("/x", fs(["App.csproj"])), true);
});

test("a directory with a .git directory is a project root", () => {
  assert.equal(isProjectRoot("/x", fs([".git", "src"])), true);
});

// A git worktree and a submodule both carry a .git FILE pointing elsewhere. Indexing them
// duplicates the parent repository under a second name - five copies of one repo drowned the
// real projects in the global graph.
test("a directory whose .git is a file is a worktree or submodule, not its own project", () => {
  assert.equal(isProjectRoot("/x", fs([".git"], true)), false);
});

test("a worktree that also has a manifest still counts, on the manifest", () => {
  assert.equal(isProjectRoot("/x", fs([".git", "package.json"], true)), true);
});

test("a directory with nothing recognisable is not a project root", () => {
  assert.equal(isProjectRoot("/x", fs(["notes.txt", "img.png"])), false);
});

test("an unreadable directory is not a project root, and does not throw", () => {
  assert.equal(isProjectRoot("/x", { readdir: () => { throw new Error("EACCES"); }, gitIsDirectory: () => true }), false);
});

test("the editor's own extension tree is excluded by default", () => {
  for (const name of [".vscode", "node_modules", ".vite-inspect", "dist", "build", "coverage", "out"])
    assert.ok(DEFAULT_EXCLUDE.includes(name), `${name} must be excluded by default`);
});

import { looksArchival, dropNestedArchives } from "./project-scan.mjs";

test("archive-looking directory names are recognised", () => {
  for (const n of ["_old", "_old1", "_old2", "_prod", "_bak", "_backup", "archive", "backup", "app - Copy", "src.bak"])
    assert.equal(looksArchival(n), true, `${n} should look archival`);
});

test("ordinary names are not archival", () => {
  for (const n of ["src", "_parser", "CHD", "packages", "old-router", "production"])
    assert.equal(looksArchival(n), false, `${n} must not be treated as an archive`);
});

// Nesting alone is wrong: a monorepo package is nested and legitimate. An archival name alone is
// wrong too: a top-level project may simply be called `backup`. Only the pair is evidence.
test("only a nested AND archival directory is dropped", () => {
  const dirs = [
    "D:/w/ArkBot",
    "D:/w/ArkBot/_old1",          // nested + archival -> drop
    "D:/w/LobbyBot",
    "D:/w/LobbyBot/_parser",      // nested, not archival -> keep
    "D:/w/backup",                // archival name, not nested -> keep
  ];
  assert.deepEqual(dropNestedArchives(dirs).sort(),
    ["D:/w/ArkBot", "D:/w/LobbyBot", "D:/w/LobbyBot/_parser", "D:/w/backup"].sort());
});

test("nothing is dropped when no project is nested", () => {
  const dirs = ["D:/w/a", "D:/w/b"];
  assert.deepEqual(dropNestedArchives(dirs), dirs);
});

test("backslash paths are handled the same as forward slashes", () => {
  const dirs = [String.raw`D:\w\ArkBot`, String.raw`D:\w\ArkBot\_old1`];
  assert.deepEqual(dropNestedArchives(dirs), [String.raw`D:\w\ArkBot`]);
});
