import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lintVersions } from "./lint-versions.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "lint-versions.mjs");
const feat = { subject: "feat: a", body: "" };
const junk = { subject: "wip", body: "" };

test("a clean queue lints clean", () => {
  assert.deepEqual(lintVersions({ entries: [{ hash: "a", level: "patch" }], lookup: () => feat }), []);
});

test("a queue of nothing but well-formed commits lints clean", () => {
  const byHash = { a: feat, b: { subject: "fix(x): b", body: "" }, c: { subject: "chore: c", body: "" } };
  const entries = [{ hash: "a", level: "minor" }, { hash: "b", level: "patch" }, { hash: "c", level: "none" }];
  assert.deepEqual(lintVersions({ entries, lookup: (h) => byHash[h] }), []);
});

test("commits with no recognised type are reported with their hashes", () => {
  const found = lintVersions({ entries: [{ hash: "abc1234", level: null }], lookup: () => junk });
  assert.equal(found.length, 1);
  assert.match(found[0].problem, /abc1234/);
  assert.match(found[0].problem, /no recognised/i);
});

test("a pending major proposal is reported", () => {
  const found = lintVersions({ entries: [{ hash: "a", level: null }], lookup: () => ({ subject: "feat!: x", body: "" }) });
  assert.ok(found.some((f) => /major/i.test(f.problem)));
});

test("a major proposal is still reported when the entry already carries a level", () => {
  const found = lintVersions({ entries: [{ hash: "a", level: "minor" }], lookup: () => ({ subject: "fix: x", body: "BREAKING CHANGE: drops ids" }) });
  assert.ok(found.some((f) => /major/i.test(f.problem)));
});

test("an empty queue reports nothing", () => {
  assert.deepEqual(lintVersions({ entries: [], lookup: () => feat }), []);
});

test("a hash git cannot resolve is reported as drift, not a crash", () => {
  const found = lintVersions({
    entries: [{ hash: "dead123", level: null }, { hash: "b", level: "patch" }],
    lookup: (h) => { if (h === "dead123") throw new Error("unknown revision"); return feat; },
  });
  assert.equal(found.length, 1);
  assert.match(found[0].problem, /dead123/);
  assert.match(found[0].problem, /history/i);
});

test("a lookup that returns no commit is reported like one that throws", () => {
  const found = lintVersions({
    entries: [{ hash: "dead123", level: null }, { hash: "b", level: "patch" }],
    lookup: (h) => (h === "dead123" ? undefined : feat),
  });
  assert.equal(found.length, 1);
  assert.match(found[0].problem, /dead123/);
});

test("a version-bump commit sitting in the queue is reported as drift, once", () => {
  const byHash = { a: { subject: "v0.4.0", body: "" }, b: { subject: "патч: сайт v0.4.7", body: "" } };
  const found = lintVersions({ entries: [{ hash: "aaa1111", level: null }, { hash: "bbb2222", level: null }], lookup: (h) => byHash[h === "aaa1111" ? "a" : "b"] });
  assert.equal(found.length, 1);
  assert.match(found[0].problem, /outside a drain/i);
  assert.match(found[0].problem, /aaa1111/);
  assert.match(found[0].problem, /bbb2222/);
});

function repo() {
  const root = mkdtempSync(join(tmpdir(), "lint-"));
  execFileSync("git", ["init", "-q", root], { encoding: "utf8" });
  return root;
}
function commit(root, subject) {
  writeFileSync(join(root, `${subject.replace(/\W/g, "_")}.txt`), subject);
  execFileSync("git", ["-C", root, "add", "-A"], { encoding: "utf8" });
  execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", subject], { encoding: "utf8" });
  return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}
function queue(root, text) {
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "changelog-queue"), text);
}
function run(root) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: e.status, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

test("the CLI stays silent and exits zero when there is nothing to say", () => {
  const root = repo();
  commit(root, "feat: a");
  const clean = run(root);
  assert.equal(clean.code, 0);
  assert.equal(clean.stdout + clean.stderr, "");
});

test("the CLI exits non-zero and names the commit when the queue holds an unclassifiable one", () => {
  const root = repo();
  const hash = commit(root, "wip");
  queue(root, `${hash}\n`);
  const found = run(root);
  assert.equal(found.code, 1);
  assert.match(found.stderr, /no recognised/i);
  assert.match(found.stderr, new RegExp(hash.slice(0, 7)));
});

test("the CLI reports a queued hash that is not in this repository's history", () => {
  const root = repo();
  commit(root, "feat: a");
  queue(root, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n");
  const found = run(root);
  assert.equal(found.code, 1);
  assert.match(found.stderr, /history/i);
  assert.doesNotMatch(found.stderr, /unknown revision/i);
});
