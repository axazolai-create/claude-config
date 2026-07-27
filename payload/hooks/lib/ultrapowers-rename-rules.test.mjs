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

  // A single protective span can swallow more than one raw occurrence of the name (e.g. a
  // plugin-root path that also embeds the CLI script name) - the histogram must count
  // occurrences inside the span, not spans themselves, or this invariant passes vacuously.
  const multi = "run ${CLAUDE_PLUGIN_ROOT}/plugins/superpowers/superpowers-cli.js";
  const { histogram: multiHistogram, unclassified: multiUnclassified } = rewrite(multi);
  const multiTotal = Object.values(multiHistogram).reduce((a, b) => a + b, 0) + multiUnclassified.length;
  assert.equal(multiTotal, (multi.match(/superpowers/gi) || []).length);
  assert.equal(multiHistogram["plugin-path"], 2);
});

test("a longer protective match wins over a narrower overlapping one regardless of rule order", () => {
  const src = "read ${CLAUDE_PLUGIN_ROOT}/plugins/superpowers/skills/using-superpowers/SKILL.md now";
  assert.equal(classify(src).unclassified.length, 0);
  assert.equal(rewrite(src).text, src);
});

test("a bare plugin install path is protected without CLAUDE_PLUGIN_ROOT or using-superpowers", () => {
  const src = "plugins/superpowers/skills/brainstorming/SKILL.md";
  assert.equal(rewrite(src).text, src);
  assert.equal(classify(src).unclassified.length, 0);
});

test("a ${CLAUDE_PLUGIN_ROOT}-prefixed plugin path is protected", () => {
  const src = "load ${CLAUDE_PLUGIN_ROOT}/plugins/superpowers/hooks/session-start.mjs";
  assert.equal(rewrite(src).text, src);
  assert.equal(classify(src).unclassified.length, 0);
});

test("upstream repo and marketplace identifiers are protected from the brand rule", () => {
  assert.equal(
    rewrite("https://github.com/obra/superpowers").text,
    "https://github.com/obra/superpowers",
  );
  assert.equal(
    rewrite("/plugin marketplace add obra/superpowers").text,
    "/plugin marketplace add obra/superpowers",
  );
  assert.equal(
    rewrite("the superpowers-marketplace entry").text,
    "the superpowers-marketplace entry",
  );
});

test("a docs/superpowers path outside plans/specs is left unclassified, not invented", () => {
  const { text, unclassified } = rewrite("see docs/superpowers/README.md");
  assert.equal(text, "see docs/superpowers/README.md");
  assert.equal(unclassified.length, 1);
});
