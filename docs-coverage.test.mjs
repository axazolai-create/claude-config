// The mirror of docs-claims.test.mjs, and the half that was missing.
//
// docs-claims asks "does everything the prose names exist?". Nobody asked the reverse: "is
// everything that exists named?". decision-records-nudge.mjs reached master registered, shipped
// and tested, with no mention in either README — and the lite hook count sat at 9 while the
// bundle registered 10. Both are the same failure: a document that is silently behind the code
// reads exactly like a document that is current.
//
// This check is deliberately narrow. It covers the two claims that have already gone stale
// twice: which hooks exist, and how many of them a profile carries. It does not try to police
// prose in general, because a check nobody can satisfy gets deleted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveVariant, filterPartialHooks } from "./variants.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const READMES = ["README.md", "README.en.md"].map((f) => ({ file: f, text: readFileSync(join(ROOT, f), "utf8") }));

const registeredHooks = () => {
  const partial = JSON.parse(readFileSync(join(ROOT, "settings.partial.json"), "utf8"));
  const names = new Set();
  for (const entries of Object.values(partial.hooks || {}))
    for (const e of entries) for (const h of (e.hooks || []))
      for (const a of (h.args || [])) names.add(String(a).split(/[\\/]/).pop());
  return names;
};

const hooksInProfile = (variant) => {
  const v = resolveVariant({ repoRoot: ROOT, variant });
  const basenames = new Set(v.rels.map((r) => r.split("/").pop()));
  const partial = JSON.parse(readFileSync(join(ROOT, "settings.partial.json"), "utf8"));
  const filtered = filterPartialHooks(partial.hooks, basenames);
  const names = new Set();
  for (const entries of Object.values(filtered))
    for (const e of entries) for (const h of (e.hooks || []))
      for (const a of (h.args || [])) names.add(String(a).split(/[\\/]/).pop());
  return names;
};

// Matched without the extension: the READMEs name some hooks as `inject-axes` and others as
// `inject-axes.mjs`, and requiring one spelling reports six documented hooks as missing.
test("every registered hook is described in both READMEs", () => {
  const missing = [];
  for (const hook of registeredHooks()) {
    const stem = hook.replace(/\.mjs$/, "");
    for (const { file, text } of READMES)
      if (!text.includes(stem)) missing.push(`${file}: ${stem}`);
  }
  assert.deepEqual(missing, [],
    "a hook that ships without a word in the README is invisible to everyone who did not write it");
});

// The counts drifted twice: "exactly 6 hooks" when lite carried nine, then 9 when it carried
// ten. A number in prose that nothing checks is a number that will be wrong.
test("the lite hook count claimed in the READMEs matches what lite actually registers", () => {
  const actual = hooksInProfile("lite").size;
  for (const { file, text } of READMES) {
    const m = /(?:exactly|ровно)\s+(\d+)\s+(?:hooks|хуков)/.exec(text);
    assert.ok(m, `${file} no longer states a lite hook count — if that is deliberate, drop this assertion with it`);
    assert.equal(Number(m[1]), actual, `${file} claims ${m[1]} lite hooks, the bundle registers ${actual}`);
  }
});

// A phase directory without a row in the roadmap is a phase nobody can find.
test("every phase directory has a row in the roadmap", () => {
  const roadmap = readFileSync(join(ROOT, ".ultrapowers/ROADMAP.md"), "utf8");
  const dirs = readdirSync(join(ROOT, ".ultrapowers/phases"), { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name);
  const missing = dirs.filter((d) => !new RegExp(`phase: "${d.slice(0, 2)}"`).test(roadmap));
  assert.deepEqual(missing, [], "each of these has a directory but no frontmatter row in ROADMAP.md");
});
