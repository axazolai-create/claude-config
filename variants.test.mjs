import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { globToRe, resolveVariant, filterPartialHooks, resolvedExclude, profilesOf } from "./variants.mjs";
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

// Retired: "classification: every payload file is covered by include ∪ exclude (lite)".
// Under the denylist model (Task 1-2) `uncovered` is hardcoded to [] on every non-legacy
// resolution path (see resolveVariant in variants.mjs) so that assertion was vacuously true
// regardless of what the resolver actually did. The orphan-overlay guard below and the
// family-purity guards further down are the denylist-appropriate replacements: they exercise
// resolver output that can actually vary (overlay files that never landed a base target;
// GSD/full-only basenames leaking into a profile that must not ship them).

test("overlay: no orphan files in payload-lite/", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "lite" });
  assert.deepEqual(v.orphanOverlay, [], `orphan overlay files: ${v.orphanOverlay.join(", ")}`);
});

test("lite set has no excluded families", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "lite" });
  for (const rel of v.rels) {
    // setting-templates/** is deliberately NOT in this list: templates ship in every profile
    // (spec §1) - lite filters plugins by maxPluginTier: "core" at install time, not by
    // excluding template files.
    assert.ok(!/^(agents\/gsd-|hooks\/gsd-|hooks\/lib\/gsd-|references\/)/.test(rel), rel);
    assert.notEqual(rel, "rules-src/gsd.md");
  }
});

test("profile chain is a strict subset: lite ⊂ base ⊂ full", () => {
  const full = new Set(resolveVariant({ repoRoot: ROOT, variant: "full" }).rels);
  const base = new Set(resolveVariant({ repoRoot: ROOT, variant: "base" }).rels);
  const lite = new Set(resolveVariant({ repoRoot: ROOT, variant: "lite" }).rels);
  for (const r of base) assert.ok(full.has(r), `base file not in full: ${r}`);
  for (const r of lite) assert.ok(base.has(r), `lite file not in base: ${r}`);
  assert.ok(base.size < full.size && lite.size < base.size, "each step must be a proper subset");
});

test("Category-II files ship to all profiles (stack-commands)", () => {
  const expected = [
    "bin/detect-stack-commands.mjs",
    "bin/lib/stack-commands.mjs",
  ];
  for (const variant of ["full", "base", "lite"]) {
    const rels = new Set(resolveVariant({ repoRoot: ROOT, variant }).rels);
    for (const f of expected) assert.ok(rels.has(f), `${variant} missing ${f}`);
    assert.ok(![...rels].some((r) => r.endsWith(".test.mjs")), `${variant} leaks a .test.mjs`);
  }
});

test("base drops all GSD, keeps neo4j opt-in and design/infra keep-set", () => {
  const base = resolveVariant({ repoRoot: ROOT, variant: "base" });
  for (const r of base.rels) {
    assert.ok(!/^(agents\/gsd-|hooks\/gsd-|hooks\/lib\/gsd-)/.test(r), `GSD leaked into base: ${r}`);
    assert.notEqual(r, "rules-src/gsd.md");
  }
  const baseWithNeo = resolveVariant({ repoRoot: ROOT, variant: "base", activeOptional: ["neo4j"] });
  assert.ok(baseWithNeo.rels.includes("bin/lib/neo4j-config.mjs"), "base neo4j promotable");
  assert.ok(!base.rels.includes("bin/lib/neo4j-config.mjs"), "base neo4j excluded by default");
  // OI-4 keep-set present in base:
  for (const f of ["hooks/bg-supervision-nudge.mjs", "commands/init-mcp.md",
                   "hooks/schedulewakeup-loop-only-nudge.mjs", "hooks/pnpm-phantom-fix-hook.mjs"])
    assert.ok(base.rels.includes(f), `base must keep ${f}`);
  // full-only infra absent from base:
  for (const f of ["hooks/db-live-access-gate.mjs", "hooks/ci-watch-nudge.mjs"])
    assert.ok(!base.rels.includes(f), `full-only infra leaked into base: ${f}`);
});

test("lite drops base's universal infra + neo4j", () => {
  const lite = resolveVariant({ repoRoot: ROOT, variant: "lite" });
  for (const f of ["hooks/bg-supervision-nudge.mjs", "commands/init-mcp.md",
                   "hooks/schedulewakeup-loop-only-nudge.mjs", "hooks/pnpm-phantom-fix-hook.mjs",
                   "bin/lib/neo4j-config.mjs"])
    assert.ok(!lite.rels.includes(f), `lite must drop ${f}`);
  // lite offers no neo4j opt-in at all (moved to base): opting in on lite yields nothing.
  const liteWithNeo = resolveVariant({ repoRoot: ROOT, variant: "lite", activeOptional: ["neo4j"] });
  assert.ok(!liteWithNeo.rels.includes("bin/lib/neo4j-config.mjs"), "lite has no neo4j opt-in");
});

test("full variant is identity over payload/ (minus alwaysExclude)", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "full" });
  // full ships everything except the alwaysExclude families: task-lifecycle-probe (.mjs +
  // .test.mjs), every **.test.mjs (tests are never shipped to any profile), and every
  // claude-md/ fragment (build input for assemble-claude-md.mjs — CLAUDE.md itself is
  // assembled by setup.mjs, never copied as a payload rel). Nothing else leaks in.
  assert.ok([...v.excludedSet].every((r) => /task-lifecycle-probe/.test(r) || r.startsWith("claude-md/") || r.endsWith(".test.mjs")),
    `unexpected exclusions on full: ${[...v.excludedSet].join(", ")}`);
  assert.ok([...v.excludedSet].some((r) => r.endsWith(".test.mjs")), "**.test.mjs must be excluded from full");
  assert.ok([...v.excludedSet].some((r) => /task-lifecycle-probe/.test(r)), "task-lifecycle-probe must still be excluded");
  assert.ok([...v.excludedSet].some((r) => r.startsWith("claude-md/")), "claude-md/ fragments must be excluded from full too");
});

// "setting-templates" was dropped from this list under three-profile unification (Task 6):
// setting-templates/ now ships in EVERY profile (variant-agnostic stack templates; which
// plugins a profile is willing to enable is the tier filter, not file exclusion - see
// .ultrapowers/archive/specs/2026-07-26-three-profile-unification-design.md §2.1/§4), and the now-
// unified payload/commands/init-stack.md legitimately references
// `~/.claude/setting-templates/` for every profile, including lite. "init-stack.py" stays
// forbidden: the Python implementation is deleted, so the unified doc invokes
// `node ~/.claude/bin/init-stack.mjs` only.
const FORBIDDEN = [
  "gsd", "init-stack.py", "neo4j", "pnpm-phantom",
  "db-live-access", "ci-watch", "schedulewakeup", "stack-markers",
  "worktree-executor-discipline", "bg-supervision", "supervise-bg",
  "task-lifecycle-probe", "init-mcp",
];

// Budgeted exceptions: token -> how many occurrences of it this file is allowed to carry.
// A budget, not an exemption - exceeding it still fails, so a NEW leak of the same token is
// caught while the reviewed one is permitted.
//
// `commands/init-stack.md` is unified across profiles and legitimately names GSD once: the
// `.planning/config.json` `model_overrides` re-migration it documents (Phase 5 Part B, 0db8c6b)
// genuinely ships in lite - `bin/init-stack.mjs` and `bin/lib/model-migration.mjs` are both in
// the resolved lite set, verified 2026-07-27. Deleting the sentence would document lite as not
// doing something it does; rewording it to drop the word would only hide the token, since
// `.planning/` IS the GSD marker. The other twelve tokens stay fully enforced on this file.
const TOKEN_BUDGET = {
  "commands/init-stack.md": { gsd: 1 },
};

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
    const budget = TOKEN_BUDGET[rel] ?? {};
    for (const tok of FORBIDDEN) {
      const found = text.split(tok).length - 1;
      const allowed = budget[tok] ?? 0;
      if (found > allowed) {
        bad.push(allowed === 0
          ? `${rel}: ${tok}`
          : `${rel}: ${tok} x${found} (budget ${allowed})`);
      }
    }
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
  const off = resolveVariant({ repoRoot: ROOT, variant: "base" });
  const on = resolveVariant({ repoRoot: ROOT, variant: "base", activeOptional: ["neo4j"] });
  const neo = "bin/lib/neo4j-config.mjs";
  assert.ok(!off.rels.includes(neo) && off.excludedSet.has(neo), "default: excluded");
  assert.ok(on.rels.includes(neo) && !on.excludedSet.has(neo), "opted-in: included, not excluded");
  assert.ok(on.rels.includes("bin/graphify-neo4j-push.mjs"), "push wrapper included");
  assert.ok(on.rels.includes("graphify-neo4j.cypher"), "cypher cookbook included");
});

test("optional neo4j: opted-in set is import-closed (no dangling static import)", () => {
  const on = resolveVariant({ repoRoot: ROOT, variant: "base", activeOptional: ["neo4j"] });
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
  const on = resolveVariant({ repoRoot: ROOT, variant: "base", activeOptional: ["does-not-exist"] });
  assert.ok(!on.rels.includes("bin/lib/neo4j-config.mjs"));
});

test("optional groups are a no-op on full (already identity)", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "full", activeOptional: ["neo4j"] });
  assert.ok(v.rels.includes("bin/lib/neo4j-config.mjs"));
  // full ships everything except the alwaysExclude families: task-lifecycle-probe (.mjs +
  // .test.mjs), every **.test.mjs, and the claude-md/ fragments (build input, see the test
  // above), nothing else leaks in. Non-vacuous: also assert the excluded set is non-empty and
  // both families are actually present (not just "everything present passes an all-() over an empty set").
  assert.ok(v.excludedSet.size > 0, "excludedSet must not be empty");
  assert.ok([...v.excludedSet].some((r) => /task-lifecycle-probe/.test(r)), "task-lifecycle-probe must still be excluded");
  assert.ok([...v.excludedSet].some((r) => r.startsWith("claude-md/")), "claude-md/ fragments must be excluded from full too");
  assert.ok([...v.excludedSet].every((r) => /task-lifecycle-probe/.test(r) || r.startsWith("claude-md/") || r.endsWith(".test.mjs")),
    `unexpected exclusions on full: ${[...v.excludedSet].join(", ")}`);
  assert.ok([...v.excludedSet].some((r) => r.endsWith(".test.mjs")), "**.test.mjs must be excluded from full");
});

test("hook registrations: lite keeps exactly the 7 lite hooks, and its own statusLine renderer", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "lite" });
  const partial = JSON.parse(readFileSync(join(ROOT, "settings.partial.json"), "utf8"));
  const basenames = new Set(v.rels.map((r) => r.split("/").pop()));
  const filtered = filterPartialHooks(partial.hooks, basenames);
  const scripts = new Set();
  for (const entries of Object.values(filtered))
    for (const e of entries) for (const h of (e.hooks || []))
      for (const a of (h.args || [])) scripts.add(String(a).split(/[\\/]/).pop());
  assert.deepEqual([...scripts].sort(), [
    "deny-curated-claude-md.mjs", "graphify-global-sync.mjs", "graphify-grep-nudge.mjs", "inject-axes.mjs",
    "secrets-gate.mjs", "session-init.mjs", "token-usage-log.mjs",
  ]);
  assert.ok(basenames.has("statusline.mjs"));
});

test("base hook registrations resolve to base's file set", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "base" });
  const partial = JSON.parse(readFileSync(join(ROOT, "settings.partial.json"), "utf8"));
  const basenames = new Set(v.rels.map((r) => r.split("/").pop()));
  const filtered = filterPartialHooks(partial.hooks, basenames);
  const scripts = new Set();
  for (const entries of Object.values(filtered))
    for (const e of entries) for (const h of (e.hooks || []))
      for (const a of (h.args || [])) scripts.add(String(a).split(/[\\/]/).pop());
  // base MUST include its globally-registered OI-4 keep-set hooks:
  for (const s of ["bg-supervision-nudge.mjs", "schedulewakeup-loop-only-nudge.mjs"])
    assert.ok(scripts.has(s), `base settings must register ${s}`);
  // full-only / GSD infra MUST NOT be registered for base:
  for (const s of ["db-live-access-gate.mjs", "ci-watch-nudge.mjs", "task-lifecycle-probe.mjs"])
    assert.ok(!scripts.has(s), `base settings must NOT register ${s}`);
  // pnpm-phantom-fix-hook.mjs is deliberately NEVER globally registered in settings.partial.json
  // (.ultrapowers/archive/specs/2026-07-21-pnpm-phantom-fix-design.md, decision C2: "settings.partial.json
  // is NOT changed — the hook is never globally registered"; it's wired per-project, pnpm-gated, by
  // pnpm-phantom-fix-install.mjs at /init-stack time). It ships in base's FILE SET — asserted
  // separately by "base drops all GSD, keeps neo4j opt-in and design/infra keep-set" — but this
  // filtered-registration view must stay empty for it, or the guard above (which forbids full-only
  // hooks from appearing here) would be trivially satisfiable by never registering anything at all.
  assert.ok(!scripts.has("pnpm-phantom-fix-hook.mjs"),
    "pnpm-phantom-fix-hook.mjs must stay out of the GLOBAL settings.partial.json registration");
});

const FIXTURE = { profiles: {
  full: { plugins: [] },
  base: { exclude: ["a/*", "b/*"] },
  lite: { extends: "base", exclude: ["c/*"] },
}};

test("profilesOf: prefers profiles, falls back to variants", () => {
  assert.equal(profilesOf({ profiles: { x: 1 } }).x, 1);
  assert.equal(profilesOf({ variants: { y: 2 } }).y, 2);
  assert.deepEqual(profilesOf({}), {});
});

test("resolvedExclude: unions the extends chain, child last", () => {
  assert.deepEqual(resolvedExclude(FIXTURE, "full"), []);
  assert.deepEqual(resolvedExclude(FIXTURE, "base"), ["a/*", "b/*"]);
  assert.deepEqual(resolvedExclude(FIXTURE, "lite"), ["a/*", "b/*", "c/*"]);
});

test("full identity honors alwaysExclude (task-lifecycle-probe not shipped in any profile)", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "full" });
  assert.ok(!v.rels.some((r) => /task-lifecycle-probe/.test(r)),
    "task-lifecycle-probe must be excluded even from full");
});

// Task 7: an install against an unknown marketplace fails outright, and setup.mjs will not guess a
// repo. So every marketplace a managed plugin lives in must have its source recorded here.
test("every managed plugin's marketplace has a recorded source", () => {
  const v = JSON.parse(readFileSync(join(ROOT, "variants.json"), "utf8"));
  const needed = [...new Set(Object.values(v.managedPlugins).map((id) => id.split("@")[1]))];
  const missing = needed.filter((mp) => !(v.marketplaces || {})[mp]);
  assert.deepEqual(missing, [], `marketplaces without a source in variants.json: ${missing.join(", ")}`);
});

test("keepInstalled only names plugins that are still managed", () => {
  const v = JSON.parse(readFileSync(join(ROOT, "variants.json"), "utf8"));
  for (const name of v.keepInstalled || []) {
    assert.ok(v.managedPlugins[name], `${name} is kept installed but no longer managed - it could never be disabled`);
  }
});
