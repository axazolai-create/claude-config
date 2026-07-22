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

test("patch is scoped to debug-session-manager only", () => {
  const patch = PATCHES.find((p) => p.id === PATCH_ID);
  assert.equal(patch.appliesTo("gsd-planner.md"), false);
  assert.equal(patch.appliesTo("gsd-debugger.md"), false);
  assert.equal(patch.appliesTo("gsd-executor.md"), false);
});
