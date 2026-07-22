#!/usr/bin/env node
/*
 * graphify-setup.mjs - install/check graphify (PyPI "graphifyy", CLI "graphify") + extra
 * components, register the /graphify skill, and wire up ONE cross-project GLOBAL graph so the
 * knowledge graph of your whole codebase is available in every project.
 *
 * Bootstraps the toolchain too: if `uv` is missing it OFFERS to install it (asks first; the OS's
 * best available method - Windows: winget > scoop > choco > astral.sh script; macOS: brew > curl;
 * Linux: curl > wget > pipx > pip). Prefers an already-present pipx/pip if you decline. `--yes`
 * auto-accepts; after any install it verifies the tool is actually callable (PATH). ASCII-only
 * output (safe under cp1251/cp866). Cross-platform.
 *
 * Usage:
 *   node graphify-setup.mjs                    ensure uv, then install graphifyy[<extras>] + skill
 *   node graphify-setup.mjs --all              use extras "all" (uv tool install "graphifyy[all]")
 *   node graphify-setup.mjs --extras=pdf,sql   pick extras (default: pdf,office,sql,mcp)
 *   node graphify-setup.mjs --doctor           check python, uv, winget/scoop/choco/brew/curl, graphify, global graph
 *   node graphify-setup.mjs --bootstrap-uv     just install uv (via the best method for this OS)
 *   node graphify-setup.mjs --no-bootstrap     do not auto-install uv; use pipx/pip if present
 *   node graphify-setup.mjs --yes              assume "yes" to any install-consent prompt (CI)
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
import { createInterface } from "node:readline";

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
const ASSUME_YES = flag("--yes") || flag("-y");
const extrasArg = (argv.find((a) => a.startsWith("--extras=")) || "").split("=")[1];
const EXTRAS = flag("--all") ? "all" : (extrasArg || "pdf,office,sql,mcp").replace(/\s+/g, "");
const buildIdx = argv.indexOf("--build-global");
const BUILD_REPOS = buildIdx !== -1 ? argv.slice(buildIdx + 1).filter((a) => !a.startsWith("--")) : [];

const IS_WIN = platform() === "win32";
const IS_MAC = platform() === "darwin";
const HOME = homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(HOME, ".claude");
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

// ---- consent: installing a prerequisite service (uv, package-manager op) needs the user's OK ----
function ask(q) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => { rl.close(); res((a || "").trim().toLowerCase()); });
  });
}
// True only on an explicit yes. `--yes` auto-consents. Non-interactive without `--yes` -> false:
// we cannot obtain consent, so we must NOT install (caller falls back / skips + informs).
async function askConsent(prompt) {
  if (ASSUME_YES) { log(`${prompt} -> yes (--yes)`); return true; }
  if (!process.stdin.isTTY) { log(`${prompt}\n  non-interactive and no --yes -> not installing.`); return false; }
  const a = await ask(`${prompt} [y/N] `);
  return a === "y" || a === "yes";
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
// The single OS-appropriate uv-install method available RIGHT NOW (or the standalone script when
// no package manager is present). Returned as {label, run} so the label can be shown in the
// consent prompt before anything runs. null = no method available at all on this system.
function uvInstallPlan() {
  if (IS_WIN) {
    if (avail("winget", ["--version"]))
      return { label: "winget", run: () => runLive("winget", ["install", "--id=astral-sh.uv", "-e", "--silent",
        "--accept-package-agreements", "--accept-source-agreements"], "winget install uv") };
    if (avail("scoop", ["--version"])) return { label: "scoop", run: () => runLive("scoop", ["install", "main/uv"], "scoop install uv") };
    if (avail("choco", ["--version"])) return { label: "choco", run: () => runLive("choco", ["install", "uv", "-y"], "choco install uv") };
    return { label: "astral.sh PowerShell installer", run: () => runLive("powershell",
      ["-NoProfile", "-ExecutionPolicy", "ByPass", "-Command", "irm https://astral.sh/uv/install.ps1 | iex"], "uv standalone installer") };
  }
  if (IS_MAC && avail("brew")) return { label: "brew", run: () => runLive("brew", ["install", "uv"], "brew install uv") };
  if (avail("curl")) return { label: "astral.sh install script (curl)", run: () => runShell("curl -LsSf https://astral.sh/uv/install.sh | sh", "uv standalone installer") };
  if (avail("wget")) return { label: "astral.sh install script (wget)", run: () => runShell("wget -qO- https://astral.sh/uv/install.sh | sh", "uv standalone installer") };
  if (avail("pipx")) return { label: "pipx", run: () => runLive("pipx", ["install", "uv"], "pipx install uv") };
  const py = pyVersionOK();
  if (py) return { label: "pip --user", run: () => runLive(py.py, ["-m", "pip", "install", "--user", "uv"], "pip install uv") };
  return null;
}

// Install uv, but ONLY after the user consents (unless preConsented - explicit --bootstrap-uv /
// --yes). After installing, VERIFY it is actually callable (a not-on-PATH install is the common
// failure mode). Returns the uv path/name, or null if declined / no method / not yet on PATH.
async function bootstrapUv({ preConsented = false } = {}) {
  const plan = uvInstallPlan();
  if (!plan) {
    log("\n! No way to install uv here (no winget/scoop/choco/brew/curl/wget/pipx/pip).");
    log("  Install uv manually: https://docs.astral.sh/uv/getting-started/installation/");
    return null;
  }
  if (!preConsented && !(await askConsent(`\nuv is required but not installed. Install it now via ${plan.label}?`)))
    return null;
  log(`\nInstalling uv via ${plan.label} ...`);
  plan.run();
  if (DRY) return "uv";
  const uv = findUv();               // verify invocation - PATH is the usual culprit
  if (uv) log(`  verified: uv is callable (${uv === "uv" ? "on PATH" : uv}).`);
  else log("\n! uv was installed but is NOT on PATH in THIS shell. Open a NEW terminal and re-run,\n"
    + "  or add its bin dir to PATH (POSIX: ~/.local/bin ; Windows: %USERPROFILE%\\.local\\bin).");
  return uv;
}

// Pick a Python package installer, preferring ones already present (no install, no prompt) before
// asking to install anything. Consent + one second offer implement the rule:
// ask -> try existing alternatives -> if none, offer again -> skip on a repeated refusal.
async function ensureInstaller() {
  let uv = findUv();
  if (uv) return { kind: "uv", bin: uv };
  if (avail("pipx", ["--version"])) return { kind: "pipx", bin: "pipx" };            // alternative: no install
  for (const py of ["python3", "python"])
    if (capture(py, ["-m", "pip", "--version"]).ok) return { kind: "pip", bin: py }; // alternative: no install
  if (NO_BOOTSTRAP) { log("\n! No uv/pipx/pip present and --no-bootstrap set. Install uv manually, then re-run."); return null; }
  uv = await bootstrapUv();                          // consent-gated install of uv
  if (uv) return { kind: "uv", bin: uv };
  if (uvInstallPlan()) {                             // a method exists -> the null was a decline, not "no method"
    log("\nNo existing pipx/pip alternative here, so graphify can't be installed without uv.");
    uv = await bootstrapUv();                        // offer once more
    if (uv) return { kind: "uv", bin: uv };
    log("Skipping install (declined twice). Re-run with consent, `--yes`, or install uv/pipx yourself.");
  }
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
  const skill = join(CLAUDE_DIR, "skills", "graphify", "SKILL.md");
  log("  /graphify skill: " + (existsSync(skill) ? "installed (user)" : "not installed (run: graphify install)"));
  log("  global graph : " + (existsSync(GLOBAL_GRAPH) ? GLOBAL_GRAPH : "not built yet"));
  if (gv) { const gl = capture("graphify", ["global", "list"]); if (gl.ok && gl.out) log("  global repos :\n" + gl.out.split(/\r?\n/).map((l) => "    " + l).join("\n")); }
  log("  claude CLI   : " + (avail("claude", ["--version"]) ? "present (MCP auto-register OK)" : "not found"));
}

async function installGraphify() {
  const py = pyVersionOK();
  if (!py) { log("! Python 3.10+ is required. Install it first (winget install Python.Python.3.12 | apt/brew install python3)."); process.exit(1); }
  const pm = await ensureInstaller();
  if (!pm) { log("\n! No package installer available (declined, or none found). Nothing installed - re-run when ready."); process.exit(1); }
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
async function main() {
  if (DOCTOR) { doctor(); return; }
  if (BOOTSTRAP_ONLY) {   // explicit --bootstrap-uv is itself the consent
    const uv = await bootstrapUv({ preConsented: true });
    log(uv ? `\nuv ready: ${uv}` : "\nuv not installed (declined or not on PATH yet).");
    return;
  }
  if (UNINSTALL) { runLive("graphify", PURGE ? ["uninstall", "--purge"] : ["uninstall"], "graphify uninstall"); return; }
  if (buildIdx !== -1) { buildGlobal(BUILD_REPOS); return; }
  if (DO_MCP && argv.length === (DRY ? 2 : 1)) { registerMcp(); return; }

  await installGraphify();
  if (DO_MCP) registerMcp();
  log("\nNext:");
  log("  1) if `graphify` is not found, open a NEW terminal (PATH was just updated)");
  log("  2) build the cross-project graph:  node graphify-setup.mjs --build-global <repoA> <repoB> ...");
  log("  3) (optional) MCP for every project:  node graphify-setup.mjs --mcp");
  log("  4) everything at once uses:  uv tool install \"graphifyy[all]\"  (this script: --all)");
  log("  5) check anytime:  node graphify-setup.mjs --doctor");
}
main();
