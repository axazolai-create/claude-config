#!/usr/bin/env node
// PreToolUse guard (matcher: Edit|Write|MultiEdit). Cross-platform (Node).
// Protection travels with the CURATED:NOEDIT marker ONLY, regardless of location (project
// root, .planning/, anywhere, including ~/.claude/CLAUDE.md) - there is deliberately NO
// hardcoded path check for the global file. Authority lives entirely in the marker so it is
// one mechanism, not two: setup.mjs is responsible for GUARANTEEING ~/.claude/CLAUDE.md always
// carries the marker (see its "always ensure the global CLAUDE.md marker" step) - this hook
// just trusts whatever is actually on disk, exactly like it does for every other CLAUDE.md.
// The marker must appear as its OWN LINE (`<!-- CURATED:NOEDIT -->`, whitespace-trimmed) -
// not necessarily the first line (a title/H1, frontmatter, or other content may come first) -
// but never as a substring INSIDE a longer line. A plain substring-anywhere check would also
// trip on prose that merely names the marker (e.g. this repo's own CLAUDE.md, which documents
// this very invariant by quoting it inline). Unmarked CLAUDE.md files (e.g. GSD-generated) are
// editable wherever they live.
// Block = exit 2 (stderr fed back to Claude). Any parse failure => allow (exit 0).
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const MARKER = "CURATED:NOEDIT";
const MARKER_LINE = `<!-- ${MARKER} -->`;
// Whole-line match only (never a substring inside a longer line, so prose that just NAMES the
// marker can't self-trigger protection) - but lenient on whitespace: any line, any amount of
// spaces/tabs around the line and between the `<!--`/`-->` brackets and the marker text itself.
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

// Protect any CLAUDE.md carrying the marker as a standalone line - root, .planning/, anywhere,
// wherever in the file it sits. Anchored to whole-line equality (not a substring anywhere) so
// prose that merely names the marker inline doesn't accidentally self-trigger protection.
try {
  const content = readFileSync(abs, "utf8").replace(/^﻿/, "");
  const isMarked = content.split(/\r?\n/).some((line) => MARKER_RE.test(line.trim()));
  if (isMarked) {
    deny(`Denied: ${abs} carries a ${MARKER} line. It is curated; do not edit it via Claude.`);
  }
} catch { /* file does not exist yet -> allow creation */ }

process.exit(0);
