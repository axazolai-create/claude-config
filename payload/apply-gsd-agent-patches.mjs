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
import { applyGsdAgentPatches } from "./hooks/lib/gsd-agent-patches.mjs";

const claudeDir = process.argv[2] || join(homedir(), ".claude");
const result = applyGsdAgentPatches({ claudeDir });

if (result.applied.length) {
  console.log(`Applied ${result.applied.length} patch(es):`);
  for (const entry of result.applied) console.log(`  - ${entry}`);
} else {
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
