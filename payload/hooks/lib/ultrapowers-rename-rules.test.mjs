import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, rewrite } from "./ultrapowers-rename-rules.mjs";

test("a skill invocation is classified as invocation and never rewritten", () => {
  const src = "Use superpowers:writing-plans to create the plan.";
  const { spans } = classify(src);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].bucket, "invocation");
  assert.equal(rewrite(src).text, src);
});

test("brand prose is rewritten", () => {
  assert.equal(rewrite("You have superpowers.").text, "You have ultrapowers.");
  assert.equal(rewrite("Superpowers' process skills").text, "Ultrapowers' process skills");
});

test("an invocation on the same line as brand prose survives the brand rule", () => {
  const src = "Superpowers ships superpowers:brainstorming for this.";
  const out = rewrite(src).text;
  assert.match(out, /^Ultrapowers ships /);
  assert.match(out, /superpowers:brainstorming/);
  assert.doesNotMatch(out, /ultrapowers:brainstorming/);
});

test("artifact paths are repointed at .ultrapowers", () => {
  assert.equal(
    rewrite("saved to docs/superpowers/plans/x.md").text,
    "saved to .ultrapowers/phases/x.md",
  );
  assert.equal(rewrite("ledger in .superpowers/sdd/").text, "ledger in .ultrapowers/sdd/");
});

test("a plugin-internal path is protected", () => {
  const src = "read skills/using-superpowers/references/pi-tools.md";
  assert.equal(rewrite(src).text, src);
});

test("an occurrence no rule covers is reported as unclassified", () => {
  const { unclassified } = rewrite("The SuperPowersRuntime class is new.");
  assert.equal(unclassified.length, 1);
  assert.match(unclassified[0].match, /SuperPowers/i);
});

test("the histogram counts every occurrence exactly once", () => {
  const src = "Superpowers uses superpowers:writing-plans and docs/superpowers/plans/a.md";
  const { histogram, unclassified } = rewrite(src);
  const total = Object.values(histogram).reduce((a, b) => a + b, 0) + unclassified.length;
  assert.equal(total, (src.match(/superpowers/gi) || []).length);
});
