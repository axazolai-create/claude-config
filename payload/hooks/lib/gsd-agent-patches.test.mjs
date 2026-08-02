// payload/hooks/lib/gsd-agent-patches.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PATCHES,
  applyGsdAgentPatches,
  checkGsdAgentPatches,
  checkRecursiveAgentSpawnGuardrail,
  checkCuratedGsdAgentPatches,
} from "./gsd-agent-patches.mjs";

const PATCH_ID = "debug-session-manager-no-recursive-agent-spawn";
const AGENT = "gsd-debug-session-manager.md";

// A minimal stand-in for the real agent file: grants the Agent tool (so the guardrail
// checker cares about it) and carries a `</role>` anchor (where the block is inserted),
// but has NO anti-recursion guardrail of its own.
const FIXTURE = `---
name: gsd-debug-session-manager
tools: Read, Write, Edit, Bash, Grep, Glob, Agent, AskUserQuestion
---

<role>
Manages the multi-cycle debug loop, spawning gsd-debugger.
</role>

Body text below the role.
`;

function makeClaudeDir(files) {
  const dir = mkdtempSync(join(tmpdir(), "gsd-agent-patches-"));
  mkdirSync(join(dir, "agents"), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, "agents", name), content);
  }
  return dir;
}

function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

test("a debug-session-manager guardrail patch is registered", () => {
  const patch = PATCHES.find((p) => p.id === PATCH_ID);
  assert.ok(patch, `PATCHES must contain an entry with id "${PATCH_ID}"`);
  assert.ok(patch.appliesTo(AGENT), "patch must apply to gsd-debug-session-manager.md");
  assert.ok(patch.block.includes("<no_recursive_agent_spawn>"), "block must carry the guardrail tag");
});

test("fresh apply injects the guardrail and clears the unguarded warning", () => {
  const dir = makeClaudeDir({ [AGENT]: FIXTURE });
  try {
    // RED precondition: with no guardrail, the checker flags this Agent-granting file.
    assert.deepEqual(checkRecursiveAgentSpawnGuardrail({ claudeDir: dir }), [AGENT]);
    // May be listed alongside other broad `</role>` patches (e.g. neo4j, if configured on this
    // machine) — assert our patch is among the pending ones, not that it's the only one.
    assert.ok(checkGsdAgentPatches({ claudeDir: dir })[AGENT].includes(PATCH_ID));

    const res = applyGsdAgentPatches({ claudeDir: dir });
    assert.ok(res.applied.includes(`${AGENT}:${PATCH_ID}`), "patch should report as freshly applied");

    const out = readFileSync(join(dir, "agents", AGENT), "utf8");
    assert.ok(out.includes("<no_recursive_agent_spawn>"), "guardrail tag present after apply");
    assert.ok(out.includes(`<!-- gsd-patch:${PATCH_ID} v`), "version marker present after apply");
    // Inserted right after the role, not at end of file.
    assert.ok(out.indexOf("<no_recursive_agent_spawn>") > out.indexOf("</role>"));

    // The warning is gone once the guardrail exists.
    assert.deepEqual(checkRecursiveAgentSpawnGuardrail({ claudeDir: dir }), []);
    assert.equal(checkGsdAgentPatches({ claudeDir: dir })[AGENT], undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("re-applying is idempotent — no duplicate block", () => {
  const dir = makeClaudeDir({ [AGENT]: FIXTURE });
  try {
    applyGsdAgentPatches({ claudeDir: dir });
    const second = applyGsdAgentPatches({ claudeDir: dir });
    assert.ok(!second.applied.includes(`${AGENT}:${PATCH_ID}`), "second run must not re-apply");
    assert.ok(!second.upgraded.includes(`${AGENT}:${PATCH_ID}`), "second run must not upgrade");
    const out = readFileSync(join(dir, "agents", AGENT), "utf8");
    assert.equal(occurrences(out, "<no_recursive_agent_spawn>"), 1, "exactly one guardrail block");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("adopts a pre-existing unmarked hand-written block in place (no duplicate)", () => {
  const patch = PATCHES.find((p) => p.id === PATCH_ID);
  // Simulate the block that was hand-authored into the live file before this patch existed:
  // same text, but with no version marker around it.
  const legacy = FIXTURE.replace("</role>\n", `</role>\n\n${patch.block}\n`);
  const dir = makeClaudeDir({ [AGENT]: legacy });
  try {
    const res = applyGsdAgentPatches({ claudeDir: dir });
    assert.ok(res.upgraded.includes(`${AGENT}:${PATCH_ID}`), "unmarked legacy block should upgrade, not re-add");
    const out = readFileSync(join(dir, "agents", AGENT), "utf8");
    assert.equal(occurrences(out, "<no_recursive_agent_spawn>"), 1, "no duplicate after adoption");
    assert.ok(out.includes(`<!-- gsd-patch:${PATCH_ID} v`), "now carries the version marker");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("context-mode routing block v2 carries the deferred-schema recovery and can upgrade v1", () => {
  const p = PATCHES.find((x) => x.id === "context-mode-routing-block");
  assert.equal(p.version, 2, "text change must be accompanied by a version bump");
  assert.ok(p.block.includes("ToolSearch"), "v2 must name the deferred-schema recovery path");
  assert.ok(p.block.includes("select:mcp__plugin_context-mode_context-mode__ctx_execute_file"));
  // priorBlocks must carry the exact v1 body (no recovery paragraph) so an unmarked
  // pre-versioning application still gets found and upgraded in place.
  assert.ok(Array.isArray(p.priorBlocks) && p.priorBlocks.length === 1);
  assert.ok(!p.priorBlocks[0].includes("ToolSearch"));
  assert.ok(p.priorBlocks[0].includes("<context_mode_routing>"));
});

test("patch is scoped to debug-session-manager only", () => {
  const patch = PATCHES.find((p) => p.id === PATCH_ID);
  assert.equal(patch.appliesTo("gsd-planner.md"), false);
  assert.equal(patch.appliesTo("gsd-debugger.md"), false);
  assert.equal(patch.appliesTo("gsd-executor.md"), false);
});

// ---- §6.1 effort re-tune: frontmatter patches (kind: "frontmatter") ----

const FM_AGENT = "gsd-plan-checker.md";
const FM_ID = "plan-checker-effort";
const fmFixture = (effort) =>
  `---\nname: gsd-plan-checker\neffort: ${effort}\ntools: Read, Bash\n---\n\n<role>\nChecks plans.\n</role>\n`;

test("two frontmatter effort patches are registered (low -> medium)", () => {
  const pc = PATCHES.find((p) => p.id === FM_ID);
  const cm = PATCHES.find((p) => p.id === "codebase-mapper-effort");
  for (const [patch, agent] of [[pc, "gsd-plan-checker.md"], [cm, "gsd-codebase-mapper.md"]]) {
    assert.ok(patch, "patch must be registered");
    assert.equal(patch.kind, "frontmatter");
    assert.equal(patch.key, "effort");
    assert.equal(patch.to, "medium");
    assert.ok(patch.from.includes("low"));
    assert.ok(patch.appliesTo(agent), `must apply to ${agent}`);
  }
  // Scoped: each does not apply to the other's file.
  assert.equal(pc.appliesTo("gsd-codebase-mapper.md"), false);
  assert.equal(cm.appliesTo("gsd-plan-checker.md"), false);
});

test("fresh apply rewrites agent effort low -> medium", () => {
  const dir = makeClaudeDir({ [FM_AGENT]: fmFixture("low") });
  try {
    assert.ok(checkGsdAgentPatches({ claudeDir: dir })[FM_AGENT].includes(FM_ID), "pending before apply");
    const res = applyGsdAgentPatches({ claudeDir: dir });
    assert.ok(res.applied.includes(`${FM_AGENT}:${FM_ID}`), "reports as applied");
    const out = readFileSync(join(dir, "agents", FM_AGENT), "utf8");
    assert.match(out, /^effort: medium$/m);
    const after = checkGsdAgentPatches({ claudeDir: dir })[FM_AGENT] || [];
    assert.ok(!after.includes(FM_ID), "not pending after apply");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a user-chosen foreign effort value is left untouched", () => {
  const dir = makeClaudeDir({ [FM_AGENT]: fmFixture("high") });
  try {
    const res = applyGsdAgentPatches({ claudeDir: dir });
    assert.ok(!res.applied.includes(`${FM_AGENT}:${FM_ID}`), "must not apply over a foreign value");
    assert.ok(res.skippedForeign.includes(`${FM_AGENT}:${FM_ID}`), "reports skippedForeign");
    const out = readFileSync(join(dir, "agents", FM_AGENT), "utf8");
    assert.match(out, /^effort: high$/m);
    const after = checkGsdAgentPatches({ claudeDir: dir })[FM_AGENT] || [];
    assert.ok(!after.includes(FM_ID), "foreign value is not treated as pending");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("frontmatter effort re-apply is idempotent", () => {
  const dir = makeClaudeDir({ [FM_AGENT]: fmFixture("low") });
  try {
    applyGsdAgentPatches({ claudeDir: dir });
    const second = applyGsdAgentPatches({ claudeDir: dir });
    assert.ok(!second.applied.includes(`${FM_AGENT}:${FM_ID}`), "second run must not re-apply");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The close marker gone AND the block hand-edited, so neither findMarkedSpan nor the legacy
// exact-block match can recognise it. With only the close marker missing, legacyMatch still
// finds the untouched block and re-wraps it in place - that path self-heals and is not this one.
test("a hand-broken marker span is flagged, never re-inserted as a second copy", () => {
  const broken = FIXTURE.replace("</role>",
    `</role>\n<!-- gsd-patch:${PATCH_ID} v1 -->\n<no_recursive_agent_spawn>hand-edited</no_recursive_agent_spawn>\n`);
  const dir = makeClaudeDir({ [AGENT]: broken });
  try {
    const r = applyGsdAgentPatches({ claudeDir: dir });
    assert.ok(r.skippedBrokenMarker.includes(`${AGENT}:${PATCH_ID}`), "must report the broken span");
    assert.equal(occurrences(readFileSync(join(dir, "agents", AGENT), "utf8"), "<no_recursive_agent_spawn>"), 1,
      "an unrecognisable span must not cause a second copy to be inserted");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a curated file with a pending patch is reported, not silently skipped", () => {
  const dir = makeClaudeDir({ [AGENT]: `<!-- CURATED:NOEDIT -->\n${FIXTURE}` });
  try {
    assert.deepEqual(checkGsdAgentPatches({ claudeDir: dir })[AGENT], undefined,
      "the editable-file checker must not claim a curated file");
    assert.ok(checkCuratedGsdAgentPatches({ claudeDir: dir })[AGENT].includes(PATCH_ID));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a curated file with no pending patch is not reported", () => {
  const dir = makeClaudeDir({ [AGENT]: FIXTURE });
  try {
    applyGsdAgentPatches({ claudeDir: dir });
    const p = join(dir, "agents", AGENT);
    writeFileSync(p, `<!-- CURATED:NOEDIT -->\n${readFileSync(p, "utf8")}`);
    assert.deepEqual(checkCuratedGsdAgentPatches({ claudeDir: dir })[AGENT], undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
