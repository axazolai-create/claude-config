import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFragment, assembleClaudeMd } from "./assemble-claude-md.mjs";

function fixture() {
  const d = mkdtempSync(join(tmpdir(), "cmd-"));
  const w = (n, s) => writeFileSync(join(d, n), s);
  w("05-language.md", "## LANGUAGE\nshared-lang\n");
  w("06-collab.md", "---\nprofiles: [full, base]\n---\n## COLLAB\nkeeps-bg-elapsed\n");
  w("06-collab.lite.md", "## COLLAB\nno-bg-elapsed\n");
  w("10-gsd.md", "---\nprofiles: [full]\n---\n## GSD\nmethodology\n");
  return d;
}
test("parseFragment strips frontmatter, returns profiles + body", () => {
  const r = parseFragment("---\nprofiles: [full, lite]\n---\n## X\nbody\n");
  assert.deepEqual(r.profiles, ["full", "lite"]);
  assert.equal(r.body.trimEnd(), "## X\nbody");
  assert.equal(parseFragment("## Y\nz").profiles, null);
});
test("full: GSD + shared + full/base side of split", () => {
  const o = assembleClaudeMd(fixture(), "full");
  assert.match(o, /## GSD/); assert.match(o, /keeps-bg-elapsed/); assert.doesNotMatch(o, /no-bg-elapsed/);
});
test("base: no GSD, keeps bg-elapsed", () => {
  const o = assembleClaudeMd(fixture(), "base");
  assert.doesNotMatch(o, /## GSD/); assert.match(o, /keeps-bg-elapsed/);
});
test("lite: override wins, no GSD, no shared collab", () => {
  const o = assembleClaudeMd(fixture(), "lite");
  assert.doesNotMatch(o, /## GSD/); assert.match(o, /no-bg-elapsed/); assert.doesNotMatch(o, /keeps-bg-elapsed/);
});
test("header present, no frontmatter leaks", () => {
  const o = assembleClaudeMd(fixture(), "full");
  assert.match(o, /CURATED:NOEDIT/); assert.match(o, /GENERATED/);
  assert.doesNotMatch(o, /^profiles:/m); assert.doesNotMatch(o, /^---$/m);
});

const REAL = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "claude-md");
test("real fragments: GSD full-only; base keeps bg-elapsed; lite drops it + says 'lite variant'", () => {
  const full = assembleClaudeMd(REAL, "full"), base = assembleClaudeMd(REAL, "base"), lite = assembleClaudeMd(REAL, "lite");
  assert.match(full, /GSD \/ SUPERPOWERS METHODOLOGY/);
  assert.doesNotMatch(base, /GSD \/ SUPERPOWERS METHODOLOGY/);
  assert.doesNotMatch(lite, /GSD \/ SUPERPOWERS METHODOLOGY/);
  assert.match(base, /Elapsed time of a background/);
  assert.doesNotMatch(lite, /Elapsed time of a background/);
  assert.match(lite, /lite variant/);
  for (const o of [full, base, lite]) { assert.match(o, /CURATED:NOEDIT/); assert.doesNotMatch(o, /^---$/m); }
});

// Narrow, non-brittle scope: base/lite must ship neither the GSD-methodology section (10, full-
// only — already covered above) nor the "gsd" entry in the base-plugins list (09-plugins.full.md
// vs the shared base/lite version, which lists superpowers/context-mode/context7 only). A
// blanket case-insensitive "gsd" scan is deliberately NOT used here: 04-reading-order and 06-
// collaboration legitimately mention "GSD project" (a `.planning/` directory convention, not
// gsd-plugin machinery) in fragments shared by every profile per the delta table.
test("real fragments: lite and base plugin list has no gsd entry", () => {
  const base = assembleClaudeMd(REAL, "base"), lite = assembleClaudeMd(REAL, "lite");
  for (const o of [base, lite]) assert.doesNotMatch(o, /Base plugins[^\n]*gsd/i);
});

test("real fragments: 11-rules-resolution drops the retired stack-markers skill pointer", () => {
  const full = assembleClaudeMd(REAL, "full");
  assert.doesNotMatch(full, /stack-markers/);
  assert.match(full, /rules-src\/README\.md/);
});
