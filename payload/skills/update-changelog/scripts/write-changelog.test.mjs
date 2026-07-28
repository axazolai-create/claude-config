import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "write-changelog.mjs");
const run = (args) => execFileSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

function project(version = "1.2.3") {
  const root = mkdtempSync(join(tmpdir(), "write-changelog-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x", version }, null, 2));
  return root;
}

test("--version-only bumps package.json and writes no changelog", () => {
  const root = project();
  run(["--version-only", "--final-version", "1.3.0", "--root", root]);
  assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version, "1.3.0");
  assert.equal(existsSync(join(root, "changelog.json")), false);
});

test("--version-only updates version.json when it already exists", () => {
  const root = project();
  writeFileSync(join(root, "version.json"), '{\n  "version": "1.2.3"\n}\n');
  run(["--version-only", "--final-version", "1.3.0", "--root", root]);
  assert.match(readFileSync(join(root, "version.json"), "utf8"), /1\.3\.0/);
});

test("--version-only rejects a malformed version", () => {
  const root = project();
  assert.throws(() => run(["--version-only", "--final-version", "v1.3", "--root", root]));
});

test("without --version-only an empty entries file is still refused", () => {
  const root = project();
  const f = join(root, "entries.json");
  writeFileSync(f, JSON.stringify({ entries: [], finalVersion: "1.3.0" }));
  assert.throws(() => run(["--entries-file", f, "--root", root]));
});
