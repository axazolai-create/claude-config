// gsd-defaults.partial.json is written against gsd-core's config schema, and gsd-core moves on its
// own release cycle. 1.9.1 moved `branching_strategy` and `quick_branch_template` under `git.`,
// which no test could have caught: the file stayed valid JSON and the settings simply stopped
// applying. This check reads the schema from an INSTALLED gsd-core and skips when there is none,
// so it never fails a machine that does not have the tool - it only fires where it can be right.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const SHARED = join(CLAUDE_DIR, "gsd-core", "bin", "shared");
const DEFAULTS_MANIFEST = join(SHARED, "config-defaults.manifest.json");
const SCHEMA_MANIFEST = join(SHARED, "config-schema.manifest.json");

// Read by gsd-core's own code but listed in neither manifest — verified by hand against 1.9.1,
// each one appearing in `gsd-core/bin/`. Being absent from the defaults manifest only means the
// tool ships no default for it, not that the setting is gone. Re-verify when this list grows:
// an entry that stops being read is exactly the silent breakage this test exists to catch.
const READ_BUT_UNLISTED = new Set([
  "workflow.tdd_mode",   // "Owns workflow.tdd_mode; the --tdd CLI flag is the ephemeral override"
  "workflow.ui_review",  // a `when:` condition in capability-registry.cjs
  "intel.enabled",
  "graphify.enabled",
]);

const leaves = function* (obj, path = "") {
  for (const [k, v] of Object.entries(obj)) {
    const p = `${path}${k}`;
    if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length) yield* leaves(v, `${p}.`);
    else yield p;
  }
};

test("every key we ship is one gsd-core still knows", (t) => {
  if (!existsSync(DEFAULTS_MANIFEST)) {
    t.skip(`no installed gsd-core at ${SHARED}`);
    return;
  }
  const shipped = new Set(leaves(JSON.parse(readFileSync(DEFAULTS_MANIFEST, "utf8"))));
  const schema = existsSync(SCHEMA_MANIFEST) ? JSON.parse(readFileSync(SCHEMA_MANIFEST, "utf8")) : { validKeys: [], dynamicKeyPatterns: [] };
  const valid = new Set(schema.validKeys || []);
  const patterns = (schema.dynamicKeyPatterns || []).map((p) => new RegExp(p.source));

  const ours = [...leaves(JSON.parse(readFileSync("gsd-defaults.partial.json", "utf8")))];
  const unknown = ours.filter((k) =>
    !shipped.has(k) && !valid.has(k) && !patterns.some((r) => r.test(k)) && !READ_BUT_UNLISTED.has(k));

  assert.deepEqual(unknown, [],
    `these keys are in neither gsd-core's defaults manifest nor its schema — it likely moved or dropped them:\n  ${unknown.join("\n  ")}`);
});
