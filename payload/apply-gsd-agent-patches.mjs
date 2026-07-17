#!/usr/bin/env node
// CLI entry point for payload/commands/init-stack.md (step 9) and payload/commands/init-session.md
// (standalone fallback) - applies every pending patch from hooks/lib/gsd-agent-patches.mjs to
// ~/.claude/agents/gsd-*.md. Deliberately NOT wired into setup.mjs or session-init.mjs's
// auto-apply path (unlike sync-gsd-context-mode-tool.mjs's underlying lib) - these patches
// inject prose across 30+ files, so they only run when a human explicitly triggers one of
// those two commands, after session-init.mjs's read-only check has surfaced that something is
// pending.
// Usage: node apply-gsd-agent-patches.mjs [claudeDir]   (default: ~/.claude)
import { homedir } from "node:os";
import { join } from "node:path";
import { applyGsdAgentPatches, checkRecursiveAgentSpawnGuardrail } from "./hooks/lib/gsd-agent-patches.mjs";
import { applyGsdWorkflowPatches } from "./hooks/lib/gsd-workflow-patches.mjs";

const claudeDir = process.argv[2] || join(homedir(), ".claude");
const result = applyGsdAgentPatches({ claudeDir });
const wfResult = applyGsdWorkflowPatches({ claudeDir });

if (result.applied.length) {
  console.log(`Applied ${result.applied.length} patch(es):`);
  for (const entry of result.applied) console.log(`  - ${entry}`);
}
if (result.upgraded.length) {
  console.log(`Upgraded ${result.upgraded.length} stale patch(es) to their current content:`);
  for (const entry of result.upgraded) console.log(`  - ${entry}`);
}
if (!result.applied.length && !result.upgraded.length) {
  console.log("gsd-* agents: no pending patches (already up to date, or context-mode inactive).");
}
if (result.skippedCurated.length)
  console.log(`Skipped (curated, left untouched): ${result.skippedCurated.join(", ")}`);
if (result.skippedNoAnchor.length)
  console.log(`Skipped (anchor text not found - file may have changed upstream): ${result.skippedNoAnchor.join(", ")}`);
if (result.removedRetired.length) {
  console.log(`Cleaned up ${result.removedRetired.length} retired-patch leftover(s):`);
  for (const entry of result.removedRetired) console.log(`  - ${entry}`);
}

if (wfResult.applied.length) {
  console.log(`Applied ${wfResult.applied.length} workflow patch(es):`);
  for (const entry of wfResult.applied) console.log(`  - ${entry}`);
}
if (wfResult.upgraded.length) {
  console.log(`Upgraded ${wfResult.upgraded.length} stale workflow patch(es):`);
  for (const entry of wfResult.upgraded) console.log(`  - ${entry}`);
}
if (wfResult.skippedCurated.length)
  console.log(`Skipped (curated): ${wfResult.skippedCurated.join(", ")}`);
if (wfResult.skippedNoAnchor.length)
  console.log(`Skipped (anchor not found - gsd-core execute-phase.md may have changed upstream): ${wfResult.skippedNoAnchor.join(", ")}`);

const unguarded = checkRecursiveAgentSpawnGuardrail({ claudeDir });
if (unguarded.length) {
  console.log(`\nWARNING: ${unguarded.length} agent(s) grant the Agent tool with no anti-recursion guardrail found:`);
  for (const name of unguarded) console.log(`  - ${name}`);
  console.log(`  This combination (Agent + no guardrail) caused refusals or silent stuck states in`);
  console.log(`  the 2026-07 recursive-delegation test series - see gsd.md's "Depth boundary" section.`);
  console.log(`  Review each file by hand before shipping it; there is no auto-fix for this.`);
}
