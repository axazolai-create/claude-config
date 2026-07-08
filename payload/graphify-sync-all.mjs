#!/usr/bin/env node
/*
 * Cross-platform mass graphify sync (Node - runs on Windows / Linux / macOS alike; replaces the
 * earlier PowerShell version, since PowerShell isn't available on Linux and Node always is here).
 *
 * Finds every project under a root folder (by project-root markers), builds/updates each one's
 * graphify graph and registers it in the shared ~/.graphify/global-graph.json. Optionally also
 * installs graphify's per-repo commit hook in each project so its local graph self-refreshes.
 *
 * Does NOT install anything itself: if `graphify` is not on PATH it prints how to get it and exits.
 *
 * Usage:
 *   node graphify-sync-all.mjs [--root <dir>] [--max-depth N] [--install-hooks]
 *                              [--exclude a,b,c] [--dry-run]
 *   Defaults: --root = current directory, --max-depth 3.
 * Examples:
 *   node graphify-sync-all.mjs --root /home/me/dev --install-hooks
 *   node graphify-sync-all.mjs --root C:\Dev --max-depth 4
 */
import { readdirSync, existsSync, appendFileSync } from "node:fs";
import { join, basename } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const optVal = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(name);
const log = (s = "") => process.stdout.write(s + "\n");

const ROOT = optVal("--root", process.cwd());
const MAX_DEPTH = parseInt(optVal("--max-depth", "3"), 10) || 3;
const INSTALL_HOOKS = flag("--install-hooks");
const DRY = flag("--dry-run");
const EXCLUDE = new Set(
  optVal("--exclude",
    "node_modules,graphify-out,bin,obj,.venv,venv,dist,build,__pycache__,.git,vendor,.gradle,.idea,target,.next")
    .split(",").map((s) => s.trim()).filter(Boolean),
);

// graphify present? (never auto-install - just tell the user how to get it)
const gv = spawnSync("graphify", ["--version"], { encoding: "utf8" });
if (gv.error) {
  log("! graphify not found on PATH. Install it first, then re-run:");
  log("    node ~/.claude/bin/graphify-setup.mjs");
  process.exit(1);
}
if (!existsSync(ROOT)) { log(`! root does not exist: ${ROOT}`); process.exit(1); }

// project-root markers: exact filenames + simple extension globs (Delphi .dpr/.dproj kept for legacy)
const EXACT = new Set([".git", "package.json", "pyproject.toml", "go.mod", "requirements.txt"]);
const EXTS = new Set([".sln", ".csproj", ".dpr", ".dproj", ".groupproj"]);
function isProjectDir(dir) {
  let names;
  try { names = readdirSync(dir); } catch { return false; }
  for (const n of names) {
    if (EXACT.has(n)) return true;
    const dot = n.lastIndexOf(".");
    if (dot > 0 && EXTS.has(n.slice(dot))) return true;
  }
  return false;
}

// walk ROOT (inclusive) down to MAX_DEPTH, collecting project dirs (deduped by the Set)
const found = new Set();
function walk(dir, depth) {
  if (isProjectDir(dir)) found.add(dir);
  if (depth >= MAX_DEPTH) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory() && !EXCLUDE.has(e.name)) walk(join(dir, e.name), depth + 1);
  }
}
log(`Scanning ${ROOT} (depth ${MAX_DEPTH})...`);
walk(ROOT, 0);
const projects = [...found];
log(`Projects found: ${projects.length}`);

const logFile = join(ROOT, "graphify-sync.log");
const fileLog = (s) => { try { appendFileSync(logFile, s + "\n"); } catch { /* best-effort */ } };
fileLog(`=== Run started ${new Date().toISOString()} ===`);

const results = [];
for (const dir of projects) {
  const name = basename(dir);
  log(`==> ${name}  (${dir})`);
  if (DRY) { results.push([name, "DRY"]); continue; }
  const ex = spawnSync("graphify", ["extract", dir, "--global", "--as", name, "--max-workers", "8"],
    { cwd: dir, encoding: "utf8" });
  fileLog(`--- ${name} ---\n${(ex.stdout || "") + (ex.stderr || "")}`);
  const status = (!ex.error && ex.status === 0) ? "OK" : "FAILED";
  if (status === "OK" && INSTALL_HOOKS) {
    const hk = spawnSync("graphify", ["hook", "install"], { cwd: dir, encoding: "utf8" });
    fileLog((hk.stdout || "") + (hk.stderr || ""));
  }
  results.push([name, status]);
}

fileLog(`=== Run finished ${new Date().toISOString()} ===`);
log("\n--- Summary ---");
for (const [name, status] of results) log(`  ${status.padEnd(7)} ${name}`);
if (!DRY && projects.length) {
  log("\nGlobal graph contents:");
  const gl = spawnSync("graphify", ["global", "list"], { encoding: "utf8" });
  if (gl.stdout) process.stdout.write(gl.stdout);
}
log(`\nLog: ${logFile}`);
