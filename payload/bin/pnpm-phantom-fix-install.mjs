#!/usr/bin/env node
// Per-project wiring installer for the pnpm phantom-dependency guard. pnpm-gated, additive,
// idempotent. Adds (1) a root `postinstall` that runs the scan (covers the user's own
// terminal) and (2) a PostToolUse Bash hook in .claude/settings.json (covers Claude-invoked
// installs). No removal path — uninstall-safety is structural.
//
// Usage: node pnpm-phantom-fix-install.mjs <projectRoot>
import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");

// Cross-shell bootstrap. The old `node ~/.claude/bin/pnpm-phantom-scan.mjs` form failed on
// Windows because pnpm runs lifecycle scripts through cmd.exe, and cmd does NOT expand `~` —
// node then couldn't find the module and the postinstall errored out. Here node
// resolves $HOME itself via os.homedir(), so the same string works verbatim in cmd.exe and POSIX
// sh alike. existsSync-guarded so it's a silent no-op on a machine without claude-config
// installed (this postinstall is committed and runs for every clone/CI, not just this machine).
// Written with only single-quoted JS strings and no $/backtick/% so the one-liner survives both
// shells' quoting; spawnSync(node) directly — no nested shell, no stdin read — so it can't hang.
const SCAN_CMD = `node -e "const p=require('path').join(require('os').homedir(),'.claude/bin/pnpm-phantom-scan.mjs');require('fs').existsSync(p)&&require('child_process').spawnSync(process.execPath,[p],{stdio:'inherit'})"`;
// Recognizes a previously-wired tilde form so an already-broken project gets migrated in place.
const OLD_TILDE_SCAN_RE = /node\s+~\/\.claude\/bin\/pnpm-phantom-scan\.mjs/;
const HOOK_PATH = join(CLAUDE_DIR, "hooks", "pnpm-phantom-fix-hook.mjs");

function findUp(start, filename) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, filename))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function isPnpmProject(root) {
  return !!(findUp(root, "pnpm-lock.yaml") || findUp(root, "pnpm-workspace.yaml"));
}

export function addPostinstall(pkg) {
  const obj = { ...(pkg || {}) };
  obj.scripts = { ...((pkg && pkg.scripts) || {}) };
  const cur = obj.scripts.postinstall || "";
  // Migrate a previously-wired tilde form (broken under cmd.exe) to the cross-shell bootstrap.
  if (OLD_TILDE_SCAN_RE.test(cur)) {
    obj.scripts.postinstall = cur.replace(OLD_TILDE_SCAN_RE, SCAN_CMD);
    return { changed: true, obj };
  }
  // Already on the current form, or some other scan reference is present — leave it alone.
  if (cur.includes("pnpm-phantom-scan.mjs")) return { changed: false, obj };
  obj.scripts.postinstall = cur ? `${cur} && ${SCAN_CMD}` : SCAN_CMD;
  return { changed: true, obj };
}

function hookEntryExists(settings) {
  const post = settings && settings.hooks && settings.hooks.PostToolUse;
  if (!Array.isArray(post)) return false;
  for (const entry of post)
    for (const h of entry.hooks || [])
      if ((h.args || []).some((a) => String(a).includes("pnpm-phantom-fix-hook.mjs"))) return true;
  return false;
}

export function addHookToSettings(settings, hookPath = HOOK_PATH) {
  const obj = settings ? JSON.parse(JSON.stringify(settings)) : {};
  if (hookEntryExists(obj)) return { changed: false, obj };
  obj.hooks = obj.hooks || {};
  obj.hooks.PostToolUse = Array.isArray(obj.hooks.PostToolUse) ? obj.hooks.PostToolUse : [];
  obj.hooks.PostToolUse.push({
    matcher: "Bash",
    hooks: [{ type: "command", command: "node", args: [hookPath] }],
  });
  return { changed: true, obj };
}

function main() {
  const root = resolve(process.argv[2] || process.cwd());
  if (!isPnpmProject(root)) {
    console.log("not a pnpm project, skipping");
    return;
  }

  // (1) root postinstall
  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const { changed, obj } = addPostinstall(pkg);
      if (changed) {
        writeFileSync(pkgPath, JSON.stringify(obj, null, 2) + "\n");
        console.log(`postinstall: added scan to ${pkgPath}`);
      } else {
        console.log("postinstall: already wired");
      }
    } catch (e) {
      console.log(`postinstall: skipped (could not parse package.json: ${e.message})`);
    }
  } else {
    console.log("postinstall: skipped (no package.json at root)");
  }

  // (2) PostToolUse hook in .claude/settings.json
  const settingsDir = join(root, ".claude");
  const settingsPath = join(settingsDir, "settings.json");
  let settings = {};
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, "utf8")); }
    catch (e) { console.log(`hook: skipped (could not parse settings.json: ${e.message})`); return; }
  }
  const { changed, obj } = addHookToSettings(settings);
  if (changed) {
    if (!existsSync(settingsDir)) mkdirSync(settingsDir, { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(obj, null, 2) + "\n");
    console.log(`hook: added PostToolUse Bash hook to ${settingsPath}`);
  } else {
    console.log("hook: already wired");
  }
}

// Symlink-robust entry-point check: Node realpaths import.meta.url, but process.argv[1]
// keeps the (possibly symlinked) invocation path — so a symlinked ~/.claude makes the naive
// equality FALSE and main() never runs. Match the raw OR the realpath'd argv[1] (covers the
// default resolver and --preserve-symlinks).
function isMainModule() {
  const a = process.argv[1];
  if (!a) return false;
  if (import.meta.url === pathToFileURL(a).href) return true;
  try { return import.meta.url === pathToFileURL(realpathSync(a)).href; } catch { return false; }
}

if (isMainModule()) {
  try { main(); } catch (e) { console.log(`error: ${e.message}`); }
  process.exit(0);
}
