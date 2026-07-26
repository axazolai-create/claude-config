import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { globToRe, resolveVariant, filterPartialHooks } from "./variants.mjs";
import { join } from "node:path";

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

// Scope is deliberately NOT all of `skills/` — `skills/update-changelog/**` legitimately
// mentions "GSD" (it's the changelog-writer's own instruction to STRIP any mention of GSD from
// user-facing release notes, e.g. SKILL.md's "of every trace of AI tooling, GSD, ..." and
// "GSD scope/decision identifiers" sections), so a blanket skills/ scan would false-positive on
// it forever. `skills/token-usage/**` has zero "gsd" occurrences (verified) and would pass either
// way, but only `skills/model-selection-policy/**` is the one this test is actually guarding
// (Fix 4: the lite overlay must not regress back to citing /gsd-execute-phase / /gsd-debug).
test("purity: resolved lite rules-src + overlay docs carry no forbidden tokens", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "lite" });
  const scope = v.rels.filter((r) => r.startsWith("rules-src/") || r === "CLAUDE.md"
    || r === "commands/init-stack.md" || r.startsWith("skills/model-selection-policy/"));
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

test("optional neo4j: opted in, ecosystem files are included and no longer excluded", () => {
  const off = resolveVariant({ repoRoot: ROOT, variant: "lite" });
  const on = resolveVariant({ repoRoot: ROOT, variant: "lite", activeOptional: ["neo4j"] });
  const neo = "bin/lib/neo4j-config.mjs";
  assert.ok(!off.rels.includes(neo) && off.excludedSet.has(neo), "default: excluded");
  assert.ok(on.rels.includes(neo) && !on.excludedSet.has(neo), "opted-in: included, not excluded");
  assert.ok(on.rels.includes("bin/graphify-neo4j-push.mjs"), "push wrapper included");
  assert.ok(on.rels.includes("graphify-neo4j.cypher"), "cypher cookbook included");
  assert.ok(on.rels.includes("commands/init-mcp.md"), "read-MCP doc included");
  assert.deepEqual(on.uncovered, [], "still fully classified when opted in");
});

test("optional neo4j: opted-in set is import-closed (no dangling static import)", () => {
  const on = resolveVariant({ repoRoot: ROOT, variant: "lite", activeOptional: ["neo4j"] });
  const relSet = new Set(on.rels);
  const bad = [];
  for (const rel of on.rels) {
    if (!rel.endsWith(".mjs")) continue;
    const text = readFileSync(on.srcFor(rel), "utf8");
    for (const specifier of staticImportRels(text)) {
      const target = new URL(specifier, `file:///${rel}`).pathname.replace(/^\//, "");
      if (!relSet.has(target)) bad.push(`${rel} -> ${specifier}`);
    }
  }
  assert.deepEqual(bad, [], bad.join("\n"));
});

test("optional neo4j: unknown group name is a no-op, not a throw", () => {
  const on = resolveVariant({ repoRoot: ROOT, variant: "lite", activeOptional: ["does-not-exist"] });
  assert.ok(!on.rels.includes("bin/lib/neo4j-config.mjs"));
  assert.deepEqual(on.uncovered, []);
});

test("optional groups are a no-op on full (already identity)", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "full", activeOptional: ["neo4j"] });
  assert.ok(v.rels.includes("bin/lib/neo4j-config.mjs"));
  assert.equal(v.excludedSet.size, 0);
});

test("hook registrations: lite keeps exactly the 6 lite hooks and no statusLine", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "lite" });
  const partial = JSON.parse(readFileSync(join(ROOT, "settings.partial.json"), "utf8"));
  const basenames = new Set(v.rels.map((r) => r.split("/").pop()));
  const filtered = filterPartialHooks(partial.hooks, basenames);
  const scripts = new Set();
  for (const entries of Object.values(filtered))
    for (const e of entries) for (const h of (e.hooks || []))
      for (const a of (h.args || [])) scripts.add(String(a).split(/[\\/]/).pop());
  assert.deepEqual([...scripts].sort(), [
    "deny-curated-claude-md.mjs", "graphify-global-sync.mjs", "inject-axes.mjs",
    "secrets-gate.mjs", "session-init.mjs", "token-usage-log.mjs",
  ]);
  // statusLine script must NOT be in the lite set (Task 5 uses this fact to drop statusLine)
  assert.ok(!basenames.has("gsd-context-meter.mjs"));
});
