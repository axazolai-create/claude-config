import { test } from "node:test";
import assert from "node:assert/strict";
import { liftDoc, buildDocCorpus } from "./doc-corpus.mjs";

const js = [
  "// Parse a .env style file into a map, ignoring comments and blanks.",
  "// Quotes are stripped.",
  "export function parseEnvFile(text) {",
].join("\n").split("\n");

test("a comment block directly above the symbol is lifted, markers stripped", () => {
  assert.equal(liftDoc(js, 3),
    "Parse a .env style file into a map, ignoring comments and blanks. Quotes are stripped.");
});

test("a blank line between comment and symbol ends the block", () => {
  const lines = ["// unrelated note", "", "export function f() {"];
  assert.equal(liftDoc(lines, 3), "");
});

test("hash and docstring markers work too", () => {
  assert.equal(liftDoc(["# reads the queue", "def drain():"], 2), "reads the queue");
  assert.equal(liftDoc(['""" hydrate the environment """', "def go():"], 2), "hydrate the environment");
});

// A box-drawing separator carries no meaning and would dominate the index by sheer length.
test("separator rules are dropped, not indexed", () => {
  assert.equal(liftDoc(["// ── Section ──────────────────────", "function f() {"], 2), "Section");
  assert.equal(liftDoc(["// ==========================", "function f() {"], 2), "");
});

test("a symbol with no comment yields nothing", () => {
  assert.equal(liftDoc(["export function bare() {"], 1), "");
});

// A file that opens with a licence header or a long design note would otherwise turn one
// symbol into a multi-thousand-line entry and swamp the corpus.
test("the lift stops after a bounded number of comment lines", () => {
  const huge = Array.from({ length: 500 }, (_, i) => `// line ${i}`).concat(["function f() {"]);
  const doc = liftDoc(huge, 501);
  assert.ok(doc.length <= 400, `doc was ${doc.length} chars`);
  assert.ok(doc.includes("line 499"), "keeps the lines nearest the symbol");
});

test("a repo name containing a space still resolves to the right file", () => {
  const nodes = [{ label: "go()", repo: "HH Trader", source_file: "src/a.mjs", source_location: "L2", file_type: "code" }];
  const seen = [];
  buildDocCorpus(nodes, (repo, file) => { seen.push([repo, file]); return ["// starts the trader loop", "function go() {"]; });
  assert.deepEqual(seen, [["HH Trader", "src/a.mjs"]]);
});

const nodes = [
  { label: "parseEnvFile()", repo: "r1", source_file: "a.mjs", source_location: "L3", file_type: "code" },
  { label: "bare()", repo: "r1", source_file: "a.mjs", source_location: "L9", file_type: "code" },
  { label: "Themes", repo: "r1", source_file: "p.json", source_location: "L1", file_type: "concept" },
];
const read = (repo, file) => (repo === "r1" && file === "a.mjs" ? js.concat(["", "", "", "", "", "function bare() {"]) : null);

test("only code symbols with a comment reach the corpus", () => {
  const out = buildDocCorpus(nodes, read);
  assert.equal((out.match(/^## /gm) || []).length, 1);
  assert.match(out, /parseEnvFile\(\)/);
  assert.doesNotMatch(out, /bare\(\)/);
  assert.doesNotMatch(out, /Themes/);
});

test("each entry names the file and the repo so a hit is actionable", () => {
  const out = buildDocCorpus(nodes, read);
  assert.match(out, /## parseEnvFile\(\) — a\.mjs:L3/);
  assert.match(out, /repo: r1/);
});

test("an unreadable file is skipped, not thrown on", () => {
  assert.equal(buildDocCorpus(nodes, () => null), "");
});

// graphify extracts a project's own build output too. Bundled vendor code carries generic
// doc comments in bulk and outranks the hand-written source it was built from.
test("build output and vendored paths never reach the corpus", () => {
  const doc = ["// Return an iterable of key, value pairs.", "function entries() {"];
  for (const file of [
    ".vite-inspect/assets/pages-C5.js", "dist/bundle.js", "build/main.js",
    "node_modules/lodash/index.js", "out/app.js", "coverage/lcov.js", "static/js/app.min.js",
  ]) {
    const out = buildDocCorpus(
      [{ label: "entries()", repo: "r", source_file: file, source_location: "L2", file_type: "code" }],
      () => doc);
    assert.equal(out, "", `${file} should be excluded`);
  }
});

test("a normal source path is kept", () => {
  const out = buildDocCorpus(
    [{ label: "entries()", repo: "r", source_file: "src/lib/stream.ts", source_location: "L2", file_type: "code" }],
    () => ["// Return an iterable of key, value pairs.", "function entries() {"]);
  assert.match(out, /entries\(\)/);
});
