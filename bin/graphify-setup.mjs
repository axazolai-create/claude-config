#!/usr/bin/env node
/*
 * graphify-setup.mjs - install/check graphify (PyPI "graphifyy", CLI "graphify") + extra
 * components, register the /graphify skill, and wire up ONE cross-project GLOBAL graph so the
 * knowledge graph of your whole codebase is available in every project.
 *
 * Bootstraps the toolchain too: if `uv` is missing it installs it (Windows: winget > scoop >
 * choco > official PowerShell installer; macOS: brew > curl; Linux: curl > wget > pipx > pip).
 * ASCII-only output (safe under cp1251/cp866). Cross-platform.
 *
 * Usage:
 *   node graphify-setup.mjs                    ensure uv, then install graphifyy[<extras>] + skill
 *   node graphify-setup.mjs --all              use extras "all" (uv tool install "graphifyy[all]")
 *   node graphify-setup.mjs --extras=pdf,sql   pick extras (default: pdf,office,sql,mcp)
 *   node graphify-setup.mjs --doctor           check python, uv, winget/scoop/choco/brew/curl, graphify, global graph
 *   node graphify-setup.mjs --bootstrap-uv     just install uv (via the best method for this OS)
 *   node graphify-setup.mjs --no-bootstrap     do not auto-install uv; use pipx/pip if present
 *   node graphify-setup.mjs --no-skill         skip `graphify install`
 *   node graphify-setup.mjs --build-global R.. build/refresh the global graph from repo paths
 *   node graphify-setup.mjs --mcp              register the global graph as a user MCP server (Claude Code)
 *   node graphify-setup.mjs --uninstall [--purge]
 *   node graphify-setup.mjs --dry-run          print the commands, run nothing
 */
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const DRY = flag("--dry-run");
const NO_SKILL = flag("--no-skill");
const DOCTOR = flag("--doctor") || flag("--check");
const DO_MCP = flag("--mcp");
const UNINSTALL = flag("--uninstall");
const PURGE = flag("--purge");
const NO_BOOTSTRAP = flag("--no-bootstrap");
const BOOTSTRAP_ONLY = flag("--bootstrap-uv");
const extrasArg = (argv.find((a) => a.startsWith("--extras=")) || "").split("=")[1];
const EXTRAS = flag("--all") ? "all" : (extrasArg || "pdf,office,sql,mcp").replace(/\s+/g, "");
const buildIdx = argv.indexOf("--build-global");
const BUILD_REPOS = buildIdx !== -1 ? argv.slice(buildIdx + 1).filter((a) => !a.startsWith("--")) : [];

const IS_WIN = platform() === "win32";
const IS_MAC = platform() === "darwin";
const HOME = homedir();
const GLOBAL_DIR = join(HOME, ".graphify");
const GLOBAL_GRAPH = join(GLOBAL_DIR, "global-graph.json");
const SPEC = `graphifyy[${EXTRAS}]`;

const log = (s = "") => process.stdout.write(s + "\n");
function capture(bin, args) {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  return { ok: !r.error && r.status === 0, out: ((r.stdout || "") + (r.stderr || "")).trim() };
}
const avail = (bin, args = ["--version"]) => capture(bin, args).ok;
function runLive(bin, args, label) {
  log(`\n$ ${bin} ${args.join(" ")}`);
  if (DRY) { log("  (dry-run: not executed)"); return true; }
  const r = spawnSync(bin, args, { stdio: "inherit" });
  if (r.error || r.status !== 0) { log(`  ! ${label || "command"} failed (exit ${r.status ?? "?"})`); return false; }
  return true;
}
function runShell(cmd, label) {
  const sh = IS_WIN ? ["cmd", ["/c", cmd]] : ["sh", ["-c", cmd]];
  log(`\n$ ${cmd}`);
  if (DRY) { log("  (dry-run: not executed)"); return true; }
  const r = spawnSync(sh[0], sh[1], { stdio: "inherit" });
  if (r.error || r.status !== 0) { log(`  ! ${label || "command"} failed`); return false; }
  return true;
}

function pyVersionOK() {
  for (const py of ["python3", "python"]) {
    const r = capture(py, ["--version"]);
    const m = r.ok && r.out.match(/Python\s+(\d+)\.(\d+)/);
    if (m && (+m[1] > 3 || (+m[1] === 3 && +m[2] >= 10))) return { py, ver: `${m[1]}.${m[2]}` };
  }
  return null;
}

// ---- uv detection + bootstrap ----
function findUv() {
  if (avail("uv")) return "uv";
  const exe = IS_WIN ? "uv.exe" : "uv";
  const cands = [join(HOME, ".local", "bin", exe), join(HOME, ".cargo", "bin", exe)];
  if (IS_WIN && process.env.LOCALAPPDATA)
    cands.push(join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", exe));
  for (const c of cands) if (existsSync(c) && avail(c)) return c;
  return null;
}
function bootstrapUv() {
  log("\nuv not found - installing it for this OS ...");
  if (IS_WIN) {
    if (avail("winget", ["--version"]))
      runLive("winget", ["install", "--id=astral-sh.uv", "-e", "--silent",
        "--accept-package-agreements", "--accept-source-agreements"], "winget install uv");
    else if (avail("scoop", ["--version"])) runLive("scoop", ["install", "main/uv"], "scoop install uv");
    else if (avail("choco", ["--version"])) runLive("choco", ["install", "uv", "-y"], "choco install uv");
    else runLive("powershell", ["-NoProfile", "-ExecutionPolicy", "ByPass", "-Command",
      "irm https://astral.sh/uv/install.ps1 | iex"], "uv standalone installer");
  } else if (IS_MAC && avail("brew")) {
    runLive("brew", ["install", "uv"], "brew install uv");
  } else if (avail("curl")) {
    runShell("curl -LsSf https://astral.sh/uv/install.sh | sh", "uv standalone installer");
  } else if (avail("wget")) {
    runShell("wget -qO- https://astral.sh/uv/install.sh | sh", "uv standalone installer");
  } else if (avail("pipx")) {
    runLive("pipx", ["install", "uv"], "pipx install uv");
  } else {
    const py = pyVersionOK();
    if (py) runLive(py.py, ["-m", "pip", "install", "--user", "uv"], "pip install uv");
  }
  if (DRY) return "uv";
  const uv = findUv();
  if (!uv) log("\n! uv was installed but is not on PATH in THIS shell. Open a NEW terminal and re-run,\n"
    + "  or add its bin dir to PATH (POSIX: ~/.local/bin ; Windows: %USERPROFILE%\\.local\\bin).");
  return uv;
}
function ensureInstaller() {
  let uv = findUv();
  if (!uv && !NO_BOOTSTRAP) uv = bootstrapUv();
  if (uv) return { kind: "uv", bin: uv };
  if (avail("pipx", ["--version"])) return { kind: "pipx", bin: "pipx" };
  for (const py of ["python3", "python"]) if (capture(py, ["-m", "pip", "--version"]).ok) return { kind: "pip", bin: py };
  return null;
}
const graphifyVersion = () => { const r = capture("graphify", ["--version"]); return r.ok ? r.out.split(/\r?\n/)[0] : null; };

function doctor() {
  log("graphify doctor");
  const py = pyVersionOK();
  log("  python 3.10+ : " + (py ? `OK (${py.ver} via ${py.py})` : "MISSING"));
  const uv = findUv();
  log("  uv           : " + (uv ? (uv === "uv" ? "on PATH" : uv) : "not installed"));
  if (IS_WIN) {
    log("  winget       : " + (avail("winget", ["--version"]) ? "available" : "not found"));
    log("  scoop/choco  : " + [avail("scoop", ["--version"]) ? "scoop" : "", avail("choco", ["--version"]) ? "choco" : ""].filter(Boolean).join(", ") || "none");
  } else {
    log("  brew         : " + (avail("brew") ? "available" : "not found"));
    log("  curl / wget  : " + [avail("curl") ? "curl" : "", avail("wget") ? "wget" : ""].filter(Boolean).join(", ") || "none");
  }
  log("  pipx / pip   : " + [avail("pipx", ["--version"]) ? "pipx" : "", pyVersionOK() ? "pip" : ""].filter(Boolean).join(", ") || "none");
  const gv = graphifyVersion();
  log("  graphify CLI : " + (gv || "NOT on PATH"));
  log("  extras spec  : " + SPEC);
  const skill = join(HOME, ".claude", "skills", "graphify", "SKILL.md");
  log("  /graphify skill: " + (existsSync(skill) ? "installed (user)" : "not installed (run: graphify install)"));
  log("  global graph : " + (existsSync(GLOBAL_GRAPH) ? GLOBAL_GRAPH : "not built yet"));
  if (gv) { const gl = capture("graphify", ["global", "list"]); if (gl.ok && gl.out) log("  global repos :\n" + gl.out.split(/\r?\n/).map((l) => "    " + l).join("\n")); }
  log("  claude CLI   : " + (avail("claude", ["--version"]) ? "present (MCP auto-register OK)" : "not found"));
}

function installGraphify() {
  const py = pyVersionOK();
  if (!py) { log("! Python 3.10+ is required. Install it first (winget install Python.Python.3.12 | apt/brew install python3)."); process.exit(1); }
  const pm = ensureInstaller();
  if (!pm) { log("! No installer available and uv bootstrap failed. Install uv manually: https://docs.astral.sh/uv/getting-started/installation/"); process.exit(1); }
  log(`\nInstalling ${SPEC} via ${pm.kind} ...`);
  if (pm.kind === "uv") {
    runLive(pm.bin, ["tool", "install", "--upgrade", SPEC], "uv tool install");
    runLive(pm.bin, ["tool", "update-shell"], "uv tool update-shell");
  } else if (pm.kind === "pipx") {
    runLive("pipx", ["install", SPEC], "pipx install");
    runLive("pipx", ["ensurepath"], "pipx ensurepath");
  } else {
    const a = ["-m", "pip", "install", "--user", "--upgrade", SPEC];
    if (!IS_WIN) a.push("--break-system-packages");
    runLive(pm.bin, a, "pip install");
  }
  if (!DRY) {
    const gv = graphifyVersion();
    log(gv ? `\nInstalled: ${gv}` : "\n! `graphify` not on PATH yet. Open a NEW terminal (uv/pipx just updated PATH).");
  }
  if (!NO_SKILL) runLive("graphify", ["install"], "graphify install (register /graphify skill)");
  if (!existsSync(GLOBAL_DIR) && !DRY) mkdirSync(GLOBAL_DIR, { recursive: true });
  log(`\nGlobal graph path: ${GLOBAL_GRAPH}`);
}

function buildGlobal(repos) {
  if (!graphifyVersion() && !DRY) { log("! graphify not installed. Run `node graphify-setup.mjs` first."); process.exit(1); }
  if (!repos.length) { log("! --build-global needs one or more repo paths."); process.exit(1); }
  for (const repo of repos) {
    if (!existsSync(repo) && !DRY) { log(`  skip (missing): ${repo}`); continue; }
    const name = repo.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "repo";
    runLive("graphify", ["extract", repo, "--global", "--as", name], `extract ${name}`);
  }
  runLive("graphify", ["global", "list"], "global list");
  log(`\nQuery the whole codebase from ANY project:`);
  log(`  graphify query "where is auth validated?" --graph ${GLOBAL_GRAPH}`);
}

function registerMcp() {
  if (!avail("claude", ["--version"])) {
    log("! `claude` CLI not found - cannot auto-register the MCP server.");
    log(`  Manual: python -m graphify.serve ${GLOBAL_GRAPH}`);
    return;
  }
  const uv = findUv();
  const serve = uv
    ? [uv, "tool", "run", "--from", "graphifyy[mcp]", "python", "-m", "graphify.serve", GLOBAL_GRAPH]
    : ["python", "-m", "graphify.serve", GLOBAL_GRAPH];
  runLive("claude", ["mcp", "add", "--scope", "user", "graphify-global", "--", ...serve], "claude mcp add");
  log("\nMCP server 'graphify-global' registered at user scope (available in every project).");
}

// ---- dispatch ----
if (DOCTOR) { doctor(); process.exit(0); }
if (BOOTSTRAP_ONLY) { const uv = bootstrapUv(); log(uv ? `\nuv ready: ${uv}` : "\nuv not on PATH yet - open a new terminal."); process.exit(0); }
if (UNINSTALL) { runLive("graphify", PURGE ? ["uninstall", "--purge"] : ["uninstall"], "graphify uninstall"); process.exit(0); }
if (buildIdx !== -1) { buildGlobal(BUILD_REPOS); process.exit(0); }
if (DO_MCP && argv.length === (DRY ? 2 : 1)) { registerMcp(); process.exit(0); }

installGraphify();
if (DO_MCP) registerMcp();
log("\nNext:");
log("  1) if `graphify` is not found, open a NEW terminal (PATH was just updated)");
log("  2) build the cross-project graph:  node graphify-setup.mjs --build-global <repoA> <repoB> ...");
log("  3) (optional) MCP for every project:  node graphify-setup.mjs --mcp");
log("  4) everything at once uses:  uv tool install \"graphifyy[all]\"  (this script: --all)");
log("  5) check anytime:  node graphify-setup.mjs --doctor");
