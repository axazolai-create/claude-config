#!/usr/bin/env node
// PreToolUse guard (matcher: Edit|Write|MultiEdit). Cross-platform (Node).
// Protection travels with the CURATED:NOEDIT marker ONLY, regardless of location (project
// root, .planning/, anywhere, including ~/.claude/CLAUDE.md) - there is deliberately NO
// hardcoded path check for the global file. Authority lives entirely in the marker:
// setup.mjs guarantees ~/.claude/CLAUDE.md always carries it; this hook just trusts
// whatever is actually on disk, exactly like it does for every other CLAUDE.md.
// The marker must appear as its OWN LINE (`<!-- CURATED:NOEDIT -->`, whitespace-trimmed) -
// not necessarily the first line (a title/H1 or frontmatter may come first) - but never as a
// substring INSIDE a longer line: a substring-anywhere check would trip on prose that merely
// names the marker (e.g. this repo's own CLAUDE.md, which quotes it inline). Unmarked
// CLAUDE.md files (e.g. GSD-generated) are editable wherever they live.
// Block = exit 2 (stderr fed back to Claude). Any parse failure => allow (exit 0).
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const MARKER = "CURATED:NOEDIT";
const MARKER_LINE = `<!-- ${MARKER} -->`;
// Whole-line match, whitespace-lenient (see header). Keep in sync with session-init.mjs's MARKER_RE.
const MARKER_RE = /^<!--\s*CURATED:NOEDIT\s*-->$/;

function stdin() { try { return readFileSync(0, "utf8"); } catch { return ""; } }
function deny(msg) { process.stderr.write(msg + "\n"); process.exit(2); }

let d = {};
try { d = JSON.parse(stdin() || "{}"); } catch { process.exit(0); }

const fp = (d.tool_input || {}).file_path || "";
if (!fp) process.exit(0);

const cwd = d.cwd || process.cwd();
const abs = resolve(cwd, fp);

if (basename(abs) !== "CLAUDE.md") process.exit(0);

// Protect any marked CLAUDE.md, wherever it lives (whole-line match - see header).
try {
  const content = readFileSync(abs, "utf8").replace(/^﻿/, "");
  const isMarked = content.split(/\r?\n/).some((line) => MARKER_RE.test(line.trim()));
  if (isMarked) {
    deny(`Denied: ${abs} carries a ${MARKER} line. It is curated; do not edit it via Claude.`);
  }
} catch { /* file does not exist yet -> allow creation */ }

process.exit(0);
