#!/usr/bin/env node
// CLI wrapper around hooks/lib/context-mode-gsd-agents.mjs, for callers that can't (or
// shouldn't) import the ESM lib directly - namely init-stack.py (Python has no import path into
// a .mjs module, so it spawns this via `node`). setup.mjs and session-init.mjs are already
// Node/ESM and import the lib function directly instead of spawning this.
// Usage: node sync-gsd-context-mode-tool.mjs [claudeDir]   (default: ~/.claude)
import { homedir } from "node:os";
import { join } from "node:path";
import { syncGsdAgentsContextMode } from "./hooks/lib/context-mode-gsd-agents.mjs";

const claudeDir = process.argv[2] || join(homedir(), ".claude");
const result = syncGsdAgentsContextMode({ claudeDir });

if (!result.active) {
  console.log("context-mode plugin not installed/enabled - gsd-* agents left untouched.");
} else if (result.updated.length) {
  console.log(`Added context-mode MCP tool to ${result.updated.length} gsd-* agent(s): ${result.updated.join(", ")}`);
} else {
  console.log("gsd-* agents: context-mode tool already present everywhere.");
}
if (result.skipped.length) console.log(`Skipped (curated): ${result.skipped.join(", ")}`);
