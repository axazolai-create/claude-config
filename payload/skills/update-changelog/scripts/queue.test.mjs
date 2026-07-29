import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readQueue, readEntries, appendHash, resolveDrain } from "./queue.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "queue.mjs");

function repo(queueText) {
  const root = mkdtempSync(join(tmpdir(), "queue-"));
  if (queueText !== undefined) {
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, ".claude", "changelog-queue"), queueText);
  }
  return root;
}

test("readQueue still returns bare hashes, whatever the line carries", () => {
  const root = repo("aaa1111 minor\nbbb2222\n");
  assert.deepEqual(readQueue(root), ["aaa1111", "bbb2222"]);
});

test("readEntries splits the level out, null when absent", () => {
  const root = repo("aaa1111 minor\nbbb2222\n");
  assert.deepEqual(readEntries(root), [
    { hash: "aaa1111", level: "minor" },
    { hash: "bbb2222", level: null },
  ]);
});

test("appendHash writes the level and never duplicates a hash", () => {
  const root = repo("");
  appendHash(root, "aaa1111", "patch");
  appendHash(root, "aaa1111", "minor");
  assert.equal(readFileSync(join(root, ".claude", "changelog-queue"), "utf8"), "aaa1111 patch\n");
});

test("appendHash without a level writes a bare hash", () => {
  const root = repo("");
  appendHash(root, "aaa1111");
  assert.equal(readFileSync(join(root, ".claude", "changelog-queue"), "utf8"), "aaa1111\n");
});

test("drain takes the maximum level across recorded and looked-up entries", () => {
  const entries = [
    { hash: "a", level: "patch" },
    { hash: "b", level: null },
    { hash: "c", level: "none" },
  ];
  const lookup = (h) => (h === "b" ? { subject: "feat: new thing", body: "" } : { subject: "", body: "" });
  const d = resolveDrain(entries, lookup);
  assert.equal(d.level, "minor");
  assert.deepEqual(d.hashes, ["a", "b", "c"]);
});

test("drain surfaces a major proposal instead of applying it", () => {
  const entries = [{ hash: "a", level: null }];
  const d = resolveDrain(entries, () => ({ subject: "feat!: drop the old API", body: "" }));
  assert.equal(d.level, "minor");
  assert.equal(d.proposals.length, 1);
});

test("drain counts commits it could not classify", () => {
  const d = resolveDrain([{ hash: "a", level: null }], () => ({ subject: "wip", body: "" }));
  assert.equal(d.unrecognised, 1);
  assert.equal(d.level, "none");
});

test("a lookup that throws does not lose the rest of the queue", () => {
  const entries = [{ hash: "a", level: null }, { hash: "b", level: "patch" }];
  const d = resolveDrain(entries, (h) => { if (h === "a") throw new Error("gone"); return { subject: "", body: "" }; });
  assert.equal(d.level, "patch");
  assert.equal(d.unrecognised, 1);
});

test("append --classify against an unresolvable hash still queues it, level-less, and exits zero", () => {
  const root = mkdtempSync(join(tmpdir(), "queue-"));
  execFileSync("git", ["init", root], { encoding: "utf8" });
  const hash = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  execFileSync(process.execPath, [SCRIPT, "append", hash, "--root", root, "--classify"], { encoding: "utf8" });
  assert.equal(readFileSync(join(root, ".claude", "changelog-queue"), "utf8"), `${hash}\n`);
});

test("a valueless flag before --root does not swallow it, so the queue lands in --root", () => {
  const root = mkdtempSync(join(tmpdir(), "queue-root-"));
  const elsewhere = mkdtempSync(join(tmpdir(), "queue-cwd-"));
  execFileSync("git", ["init", root], { encoding: "utf8" });
  const hash = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  execFileSync(process.execPath, [SCRIPT, "append", hash, "--classify", "--root", root],
    { encoding: "utf8", cwd: elsewhere });
  assert.equal(readFileSync(join(root, ".claude", "changelog-queue"), "utf8"), `${hash}\n`);
  assert.equal(existsSync(join(elsewhere, ".claude", "changelog-queue")), false);
});

test("drain keeps git's stderr out of its output for a hash git cannot resolve", () => {
  const root = mkdtempSync(join(tmpdir(), "queue-"));
  execFileSync("git", ["init", root], { encoding: "utf8" });
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "changelog-queue"), "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n");
  const r = spawnSync(process.execPath, [SCRIPT, "drain", "--root", root], { encoding: "utf8" });
  assert.equal(r.stderr, "");
  assert.equal(JSON.parse(r.stdout).unrecognised, 1);
});

test("append --classify keeps git's stderr out of its output too", () => {
  const root = mkdtempSync(join(tmpdir(), "queue-"));
  execFileSync("git", ["init", root], { encoding: "utf8" });
  const hash = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  const r = spawnSync(process.execPath, [SCRIPT, "append", hash, "--root", root, "--classify"], { encoding: "utf8" });
  assert.equal(r.stderr, "changelog: could not classify deadbeefdeadbeefdeadbeefdeadbeefdeadbeef, queued unclassified\n");
});
