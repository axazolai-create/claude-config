import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGlossary, lintGlossary, suggestTerms } from "./glossary-lib.mjs";

const GOOD = `# Glossary

## bundle
Everything this repository installs into ~/.claude, as one unit.

## profile
A named subset of the bundle: full, base or lite.
`;

test("parses terms and their definitions", () => {
  assert.deepEqual(parseGlossary(GOOD).map((e) => e.term), ["bundle", "profile"]);
  assert.match(parseGlossary(GOOD)[0].definition, /installs into/);
});

test("a well-formed glossary lints clean", () => {
  assert.deepEqual(lintGlossary(GOOD), []);
});

test("an empty definition is reported", () => {
  assert.match(lintGlossary(GOOD + "\n## delta\n")[0].problem, /delta/);
});

test("a duplicate term is reported", () => {
  assert.match(lintGlossary(GOOD + "\n## bundle\nAgain.\n")[0].problem, /duplicate/i);
});

test("terms out of alphabetical order are reported", () => {
  const out = `# Glossary\n\n## profile\nA subset.\n\n## bundle\nA unit.\n`;
  assert.match(lintGlossary(out)[0].problem, /order/i);
});

test("suggest reports frequent undefined terms and never proposes a definition", () => {
  const documents = [
    { path: "a.md", text: "The `graft` is applied. A `graft` again. And `graft` once more. Also `bundle`." },
    { path: "b.md", text: "Another `graft` here." },
  ];
  const found = suggestTerms({ documents, defined: ["bundle"], minCount: 3, minFiles: 2 });
  assert.deepEqual(found.map((f) => f.term), ["graft"]);
  assert.equal(found[0].count, 4);
  assert.deepEqual(found[0].files, ["a.md", "b.md"]);
  assert.equal("definition" in found[0], false);
});

// A term appearing many times in one file is one author's habit, not shared jargon.
test("a term confined to a single file is not suggested", () => {
  const documents = [{ path: "a.md", text: "`widget` `widget` `widget` `widget` `widget`" }];
  assert.deepEqual(suggestTerms({ documents, defined: [], minCount: 3, minFiles: 2 }), []);
});
