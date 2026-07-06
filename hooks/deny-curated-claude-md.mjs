#!/usr/bin/env node
// PreToolUse guard (matcher: Edit|Write|MultiEdit). Cross-platform (Node).
// Protection travels with the CURATED:NOEDIT marker, regardless of location
// (project root, .planning/, anywhere). The global ~/.claude/CLAUDE.md is always protected.
// Unmarked CLAUDE.md files (e.g. GSD-generated) are editable wherever they live.
// Block = exit 2 (stderr fed back to Claude). Any parse failure => allow (exit 0).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";

const MARKER = "CURATED:NOEDIT";
const winFs = process.platform === "win32";
const samePath = (a, b) => (winFs ? a.toLowerCase() === b.toLowerCase() : a === b);

function stdin() { try { return readFileSync(0, "utf8"); } catch { return ""; } }
function deny(msg) { process.stderr.write(msg + "\n"); process.exit(2); }

let d = {};
try { d = JSON.parse(stdin() || "{}"); } catch { process.exit(0); }

const fp = (d.tool_input || {}).file_path || "";
if (!fp) process.exit(0);

const cwd = d.cwd || process.cwd();
const abs = resolve(cwd, fp);

if (basename(abs) !== "CLAUDE.md") process.exit(0);

// Always protect the global user file (even if its marker was removed)
const globalFile = resolve(homedir(), ".claude", "CLAUDE.md");
if (samePath(abs, globalFile)) {
  deny("Denied: ~/.claude/CLAUDE.md is curated (user scope). Edit it by hand, not via Claude.");
}

// Protect any CLAUDE.md carrying the curated marker - root, .planning/, anywhere
try {
  if (readFileSync(abs, "utf8").includes(MARKER)) {
    deny(`Denied: ${abs} carries ${MARKER}. It is curated; do not edit it via Claude.`);
  }
} catch { /* file does not exist yet -> allow creation */ }

process.exit(0);
