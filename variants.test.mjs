import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { globToRe, resolveVariant } from "./variants.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));

// Static import specifiers (relative only). Dynamic import() is intentionally NOT matched:
// full-only code loads excluded libs via gated dynamic imports, which is legal in lite.
// Matches: import "specifier" or import ... from "specifier", including multiline forms.
function staticImportRels(text) {
  const out = [];
  // Pattern: import keyword + anything (including newlines) + quoted specifier + semicolon.
  // The semicolon ensures we don't match quoted strings in other statements (e.g., const x = "...").
  for (const m of text.matchAll(/^[ \t]*import\s[\s\S]*?["'](\.[^"']+)["'];/gm)) {
    out.push(m[1]);
  }
  return out;
}

test("globToRe: * does not cross /, ** does", () => {
  assert.ok(globToRe("hooks/lib/leanmode-*").test("hooks/lib/leanmode-rules.mjs"));
  assert.ok(!globToRe("hooks/*").test("hooks/lib/leanmode-rules.mjs"));
  assert.ok(globToRe("rules-src/**").test("rules-src/templates/next.AGENTS.md"));
  assert.ok(!globToRe("CLAUDE.md").test("payload-lite/CLAUDE.md"));
  // literal space stays literal, does not become wildcard
  assert.ok(!globToRe("a b*").test("aXb.mjs"));
  assert.ok(globToRe("a b*").test("a bc.mjs"));
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

const FORBIDDEN = [
  "gsd", "init-stack.py", "setting-templates", "neo4j", "pnpm-phantom",
  "db-live-access", "ci-watch", "schedulewakeup", "stack-markers",
  "worktree-executor-discipline", "bg-supervision", "supervise-bg",
  "task-lifecycle-probe", "init-mcp",
];

test("purity: resolved lite rules-src + overlay docs carry no forbidden tokens", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "lite" });
  const scope = v.rels.filter((r) => r.startsWith("rules-src/") || r === "CLAUDE.md" || r === "commands/init-stack.md");
  const bad = [];
  for (const rel of scope) {
    const text = readFileSync(v.srcFor(rel), "utf8").toLowerCase();
    for (const tok of FORBIDDEN) if (text.includes(tok)) bad.push(`${rel}: ${tok}`);
  }
  assert.deepEqual(bad, [], bad.join("\n"));
});

test("import graph: no static import in the lite set resolves to an excluded file", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "lite" });
  const relSet = new Set(v.rels);

  // Regression: multiline imports must be detected (e.g., payload/hooks/token-usage-log.mjs)
  const tuLog = readFileSync(v.srcFor("hooks/token-usage-log.mjs"), "utf8");
  assert.ok(
    staticImportRels(tuLog).includes("./lib/token-usage-shared.mjs"),
    "multiline import form must be detected"
  );

  // Sanity check: dynamic import() must NOT be matched
  assert.deepEqual(
    staticImportRels('import {\n a,\n} from "./x.mjs";\nconst y = await import("./z.mjs");'),
    ["./x.mjs"],
    "dynamic import() must not be matched"
  );

  const bad = [];
  for (const rel of v.rels) {
    if (!rel.endsWith(".mjs")) continue;
    const text = readFileSync(v.srcFor(rel), "utf8");
    // static imports only: handles multiline forms via staticImportRels
    for (const specifier of staticImportRels(text)) {
      const target = new URL(specifier, `file:///${rel}`).pathname.replace(/^\//, "");
      if (!relSet.has(target)) bad.push(`${rel} -> ${specifier}`);
    }
  }
  assert.deepEqual(bad, [], bad.join("\n"));
});
