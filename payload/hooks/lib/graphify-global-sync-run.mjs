#!/usr/bin/env node
// Shared worker: refresh THIS project's entry in the graphify cross-project global
// graph (~/.graphify/global-graph.json). Invoked from two places:
//   - hooks/graphify-global-sync.mjs (Claude Code PostToolUse) - fires after a
//     `git commit`, `git push`, or `git tag` Claude itself runs through the Bash tool.
//     Zero-setup, works from session one, but structurally can only see commands
//     Claude's Bash tool makes.
//   - <repo>/.git/hooks/post-commit (native git hook) - installed once per project
//     by session-init.mjs. Fires for EVERY commit git itself creates: manual/IDE
//     commits, `--amend`, rebases that call it, regardless of Claude Code being
//     involved at all. This is what actually covers "amends and user commits".
// Both callers may fire for the same commit - harmless, the PID/mtime lock below
// dedups so only one extraction actually runs.
// Hook trigger surface (2026-07-08): commit|push|tag, not just commit. `push` covers the
// "just pushed, nothing new committed this session" case commit-only missed. `tag` covers
// GSD phase/milestone close: when a GSD project has `git.create_tag: true` (the tier-2
// gsd-config-patch.mjs default), gsd-core tags on phase/milestone completion
// (`gsd/phase-{phase}-{slug}`, `gsd/{milestone}-{slug}`), so a tag is a reliable,
// git-visible "a phase just closed" signal without parsing gsd-core's own state.
// Deliberately NOT narrowed to only these three: this worker is a cheap, detached,
// lock-deduped background extraction - unlike GSD's own `/gsd-graphify build` (gsd.md §
// "graphify is two tools"), which is heavier and synchronous-ish, so narrowing to
// review/verify gates would matter there. There's no such cost here, so commit stays as a
// trigger too rather than being replaced by a narrower set.
// No Ultrapowers-close-specific trigger: Ultrapowers' review skills leave no git-visible
// signal of their own (no tag, no distinct command) - that case is covered incidentally by
// the commit/push triggers, since finishing an Ultrapowers branch always ends in one of those.
// Usage: node graphify-global-sync-run.mjs [repoPath]  (defaults to cwd)
// Never throws, never blocks: no-ops (exit 0) if this isn't a git repo, HEAD has no
// commits yet, or `graphify` isn't installed - this must never surface as an error
// to whichever caller ran it (a Claude Code hook or git itself).
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { buildSyncCommand } from "./graphify-sync-command.mjs";
import { isHeld, take } from "./state-lock.mjs";
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");

const IS_WIN = platform() === "win32";
const safe = (fn) => { try { return fn(); } catch { return undefined; } };

const cwd = process.argv[2] || process.cwd();
const git = (args) => safe(() => spawnSync("git", args, { cwd, encoding: "utf8" }));

const inside = git(["rev-parse", "--is-inside-work-tree"]);
if (!inside || inside.error || inside.status !== 0) process.exit(0);
const head = git(["rev-parse", "HEAD"]);
if (!head || head.error || head.status !== 0) process.exit(0); // no commits yet

const topLevel = git(["rev-parse", "--show-toplevel"]);
const root = ((topLevel && topLevel.stdout) || "").trim() || cwd;
const name = root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "repo";

// graphify not installed -> this is an enhancement, not a hard requirement.
const gv = safe(() => spawnSync("graphify", ["--version"], { encoding: "utf8" }));
if (!gv || gv.error || gv.status !== 0) process.exit(0);

// PID/mtime lock so overlapping triggers (Claude's PostToolUse hook AND the native
// git hook firing for the same commit, or rapid consecutive commits) don't pile up
// concurrent extractions of the same project. A stale lock is ignored after TTL.
const stateDir = join(CLAUDE_DIR, "state");
const lock = join(stateDir, `graphify-sync-${name}.lock`);
if (isHeld(lock)) process.exit(0);
take(lock);

// Run graphify, then remove the lock, all inside one detached background process -
// the caller (Claude Code hook or git itself) is never delayed by this.
const cmd = buildSyncCommand({ root, name, lock, isWin: IS_WIN });
spawn(cmd.shell, [cmd.flag, cmd.inner],
  { cwd: root, detached: true, stdio: "ignore", windowsHide: true }).unref();

process.exit(0);
