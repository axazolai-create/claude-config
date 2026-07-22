import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadVariants, globToRe, resolveVariant, filterPartialHooks } from "./variants.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));

test("globToRe: * does not cross /, ** does", () => {
  assert.ok(globToRe("hooks/lib/leanmode-*").test("hooks/lib/leanmode-rules.mjs"));
  assert.ok(!globToRe("hooks/*").test("hooks/lib/leanmode-rules.mjs"));
  assert.ok(globToRe("rules-src/**").test("rules-src/templates/next.AGENTS.md"));
  assert.ok(!globToRe("CLAUDE.md").test("payload-lite/CLAUDE.md"));
});

test("classification: every payload file is covered by include ∪ exclude (lite)", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "lite" });
  assert.deepEqual(v.uncovered, [], `unclassified payload files: ${v.uncovered.join(", ")}`);
});

test("overlay: no orphan files in payload-lite/", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "lite" });
  assert.deepEqual(v.orphanOverlay, [], `orphan overlay files: ${v.orphanOverlay.join(", ")}`);
});

test("lite set has no excluded families", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "lite" });
  for (const rel of v.rels) {
    assert.ok(!/^(agents\/gsd-|hooks\/gsd-|hooks\/lib\/gsd-|references\/|setting-templates\/)/.test(rel), rel);
    assert.notEqual(rel, "rules-src/gsd.md");
  }
});

test("full variant is identity over payload/", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "full" });
  assert.ok(v.rels.includes("hooks/gsd-context-meter.mjs"));
  assert.equal(v.excludedSet.size, 0);
});
