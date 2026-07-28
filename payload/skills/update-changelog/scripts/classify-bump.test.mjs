import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyBump, levelForCommit, accumulate } from "./classify-bump.mjs";

const only = (subject, body = "") => levelForCommit({ subject, body });

test("feat is minor, fix family is patch, chore family is none", () => {
  assert.equal(only("feat: add a thing").level, "minor");
  assert.equal(only("feat(scope): add a thing").level, "minor");
  for (const t of ["fix", "perf", "refactor", "build"]) assert.equal(only(`${t}: x`).level, "patch", t);
  for (const t of ["docs", "chore", "test", "style", "ci"]) assert.equal(only(`${t}: x`).level, "none", t);
});

test("a breaking marker proposes a major and applies minor", () => {
  const bang = only("feat!: drop the old API");
  assert.equal(bang.major, true);
  assert.equal(bang.level, "minor");
  assert.match(bang.reason, /!/);

  const footer = only("fix: tighten validation", "body text\n\nBREAKING CHANGE: rejects empty ids");
  assert.equal(footer.major, true);
  assert.equal(footer.level, "minor");
  assert.match(footer.reason, /BREAKING CHANGE/);
});

test("an unrecognised subject contributes nothing and is flagged", () => {
  const r = only("updated some stuff");
  assert.equal(r.level, "none");
  assert.equal(r.unrecognised, true);
});

test("accumulate takes the maximum, not the sum", () => {
  const results = [only("feat: a"), only("fix: b"), only("fix: c"), only("chore: d")];
  const acc = accumulate(results);
  assert.equal(acc.level, "minor");
  assert.equal(acc.proposals.length, 0);
  assert.equal(acc.unrecognised, 0);
});

test("accumulate carries every major proposal and counts unrecognised commits", () => {
  const acc = accumulate([only("feat!: a"), only("nonsense"), only("fix: b")]);
  assert.equal(acc.level, "minor");
  assert.equal(acc.proposals.length, 1);
  assert.equal(acc.unrecognised, 1);
});

test("an empty queue accumulates to no bump", () => {
  assert.equal(accumulate([]).level, "none");
});

test("classifyBump still decides the commit prefix, unchanged", () => {
  assert.equal(classifyBump("1.2.3", "1.3.0"), "релиз");
  assert.equal(classifyBump("1.2.3", "1.2.4"), "патч");
});
