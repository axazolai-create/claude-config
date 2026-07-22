#!/usr/bin/env node
// PostToolUse guard (matcher: Bash). Fires after Claude runs a pnpm command through the Bash
// tool. If it was an install-family command (install/i/add) in a pnpm project, run
// pnpm-phantom-scan.mjs and surface its report as additionalContext. Fail-open: any error =>
// exit 0, no output, never blocks the tool.
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const INSTALL = new Set(["install", "i", "add"]);
// Flags that consume the following token as their value (skip both when splitting positionals).
const VALUE_FLAGS = new Set(["--filter", "-F", "--config", "-c", "--reporter", "--use-node-version"]);

function parseSegment(tokens) {
  // tokens = everything after the leading `pnpm`. Returns {sub, positionals}.
  let i = 0, sub = null;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.startsWith("-")) { if (VALUE_FLAGS.has(t) && !t.includes("=")) i++; i++; continue; }
    sub = t; i++; break;
  }
  const positionals = [];
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.startsWith("-")) { if (VALUE_FLAGS.has(t) && !t.includes("=")) i++; i++; continue; }
    positionals.push(t); i++;
  }
  return { sub, positionals };
}

export function classifyPnpmCommand(cmd) {
  const segments = String(cmd || "").split(/&&|\|\||;|\|/);
  for (const seg of segments) {
    const tokens = seg.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const head = tokens[0];
    if (head !== "pnpm" && head !== "pnpm.cmd") continue;
    const { sub, positionals } = parseSegment(tokens.slice(1));
    if (!sub || !INSTALL.has(sub)) continue; // remove/uninstall/rm/run/dlx/exec/... => skip
    return { run: true, packages: positionals.length ? positionals : null };
  }
  return { run: false, packages: null };
}

function findUp(start, filename) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, filename))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function main() {
  let d = {};
  try { d = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { return; }
  const cmd = ((d.tool_input || {}).command) || "";
  if (!cmd) return;
  const cls = classifyPnpmCommand(cmd);
  if (!cls.run) return;

  const cwd = d.cwd || process.cwd();
  // Self-gate: only a real pnpm project.
  if (!findUp(cwd, "pnpm-lock.yaml") && !findUp(cwd, "pnpm-workspace.yaml")) return;

  const scan = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "pnpm-phantom-scan.mjs");
  if (!existsSync(scan)) return;
  const scanArgs = [scan, "--root", cwd];
  if (cls.packages && cls.packages.length) scanArgs.push("--packages", cls.packages.join(","));

  const r = spawnSync(process.execPath, scanArgs, { cwd, encoding: "utf8", timeout: 30000 });
  const out = (r.stdout || "").trim();
  if (!out || /^No phantom dependencies found\.$/.test(out)) return;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: `[pnpm-phantom-fix]\n${out}` },
  }));
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
  try { main(); } catch { /* fail-open */ }
  process.exit(0);
}
