#!/usr/bin/env node
// PostToolUse guard (matcher: Bash). Cross-platform (Node).
// Fires after Claude runs `git commit` through the Bash tool. Thin wrapper around
// lib/graphify-global-sync-run.mjs, the shared worker that refreshes this project's
// entry in the graphify global graph.
//
// Why this exists ALONGSIDE the native <repo>/.git/hooks/post-commit hook that
// session-init.mjs installs per-project: this one needs no per-repo install step,
// so it covers Claude-driven commits from session one, even before the native hook
// has been installed. It structurally CANNOT see `--amend` done by hand, IDE
// commits, or anything not run through Claude's own Bash tool - Claude Code hooks
// only fire on tool calls Claude itself makes. The native git hook is what covers
// those; this hook is the zero-setup fallback for the Claude-driven case.
// Trigger surface (2026-07-08): `git commit`, `git push`, or `git tag` - not just commit.
// `push` covers the "just pushed, nothing new committed this session" case commit-only
// missed. `tag` covers GSD phase/milestone close specifically: when a GSD project has
// `git.create_tag: true` (the tier-2 gsd-config-patch.mjs default), gsd-core tags on phase/
// milestone completion (`gsd/phase-{phase}-{slug}`, `gsd/{milestone}-{slug}`), so a tag is a
// reliable, git-visible "a phase just closed" signal without parsing gsd-core's own state.
// Deliberately NOT narrowed to only these three: this hook is a cheap, detached, lock-deduped
// background extraction (see the worker below) - unlike the LOCAL per-project graphify-out/
// cadence (rules/templates/graphify.PROJECT.md), where narrowing to review/verify gates matters
// because gsd-core's rebuild is heavier and synchronous-ish. There's no such cost here, so
// commit stays as a trigger too rather than being replaced by the narrower set.
// No Superpowers-close-specific trigger: Superpowers' review skills leave no git-visible
// signal of their own (no tag, no distinct command) - that case is covered incidentally by
// the commit/push triggers already present, since finishing a Superpowers branch always
// ends in one of those.
// No-op (exit 0, never blocks) if disabled or the command isn't a matching git operation.
// Toggle: CLAUDE_GRAPHIFY_AUTOSYNC=0.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function stdin() { try { return readFileSync(0, "utf8"); } catch { return ""; } }

let d = {};
try { d = JSON.parse(stdin() || "{}"); } catch { process.exit(0); }
if (process.env.CLAUDE_GRAPHIFY_AUTOSYNC === "0") process.exit(0);

const cmd = (((d.tool_input || {}).command) || "").replace(/\s+/g, " ");
if (!cmd) process.exit(0);
if (!/(^|[;&|\s])git(\s+-[^\s]+)*\s+(commit|push|tag)(\s|$)/.test(cmd)) process.exit(0);

const cwd = d.cwd || process.cwd();
const lib = join(dirname(fileURLToPath(import.meta.url)), "lib", "graphify-global-sync-run.mjs");
try { spawnSync(process.execPath, [lib, cwd], { cwd }); } catch { /* best-effort, never blocks */ }

process.exit(0);
