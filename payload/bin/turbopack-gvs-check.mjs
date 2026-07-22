#!/usr/bin/env node
// turbopack-gvs-check: detect the structural conflict between Turbopack (Next.js) and an
// out-of-tree pnpm virtual store (enableGlobalVirtualStore / an external virtual-store-dir).
// Turbopack only resolves/serves files under its `root`; an out-of-tree store puts packages
// outside root, so `_next/static/chunks/...` 404 after a hard reload. This tool WARNS and prints
// a tailored Strategy-B recipe (sibling store + widened turbopack.root) — it does not edit code.
// Advisory only: exit 0 always.
//
// Usage: node turbopack-gvs-check.mjs [--root <dir>]
import { readFileSync, existsSync, lstatSync, readlinkSync, realpathSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { usesTurbopack, parseGvsFlag, parseVirtualStoreDir, configTargetForPnpm, parseWidenedRoot, isPathUnder, detectConfigFormat, buildRecipe } from "./lib/turbopack-gvs-lib.mjs";

function readIf(p) { try { return existsSync(p) ? readFileSync(p, "utf8") : ""; } catch { return ""; } }

function findUpFile(start, name) {
  let dir = resolve(start);
  for (;;) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const CONFIG_NAMES = ["next.config.js", "next.config.mjs", "next.config.ts", "next.config.cjs", "next.config.mts", "next.config.cts"];

// Structural: is the virtual store physically outside the project tree? Recognises a junctioned
// `.pnpm` AND an explicit `virtualStoreDir`/`virtual-store-dir` (either config file) pointing out
// of tree — the latter is how Strategy B relocates the store WITHOUT the enableGlobalVirtualStore
// flag, which the bare-flag check alone would miss (a re-run would falsely report "no conflict").
function pnpmSymlinkTarget(root) {
  const pnpmDir = join(root, "node_modules", ".pnpm");
  try {
    const st = lstatSync(pnpmDir);
    if (st.isSymbolicLink()) return resolve(dirname(pnpmDir), readlinkSync(pnpmDir));
  } catch { /* .pnpm absent */ }
  return null;
}

function storeOutOfTree(root, wsYaml, npmrc) {
  const target = pnpmSymlinkTarget(root);
  if (target && !target.startsWith(resolve(root))) return true;
  const vsd = parseVirtualStoreDir(wsYaml, npmrc);
  if (vsd) { const abs = resolve(root, vsd); if (!abs.startsWith(resolve(root))) return true; }
  return false;
}

// Installed pnpm major version, or null if pnpm can't be run. shell:true so Windows resolves
// `pnpm.cmd` (Node refuses to spawn a .cmd without a shell); fixed args, no user input, bounded.
function detectPnpmMajor() {
  try {
    const r = spawnSync("pnpm", ["--version"], { encoding: "utf8", timeout: 10000, shell: true });
    if (r.status !== 0) return null;
    const m = String(r.stdout || "").trim().match(/^(\d+)\./);
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

// Canonical MAIN-worktree root, so every git worktree of one repo anchors the store on the same
// path and shares it. `git rev-parse --git-common-dir` resolves to `<main>/.git` from any worktree;
// its parent is the main worktree. Best-effort — null when not a git repo / git unavailable.
function gitMainWorktreeRoot(dir) {
  try {
    const r = spawnSync("git", ["-C", dir, "rev-parse", "--git-common-dir"], { encoding: "utf8", timeout: 10000 });
    if (r.status !== 0) return null;
    const common = String(r.stdout || "").trim();
    if (!common) return null;
    const abs = resolve(dir, common);
    return /[\\/]\.git$/.test(abs) ? dirname(abs) : null;
  } catch { return null; }
}

function main() {
  const args = process.argv.slice(2);
  let root = process.cwd();
  const ri = args.indexOf("--root");
  if (ri >= 0 && args[ri + 1]) root = resolve(args[ri + 1]);

  let pkg = {};
  try { pkg = JSON.parse(readIf(join(root, "package.json")) || "{}"); } catch { pkg = {}; }
  if (!usesTurbopack(pkg)) { console.log("No Turbopack/Next detected — nothing to check."); return; }

  const wsPath = findUpFile(root, "pnpm-workspace.yaml");
  const wsYaml = wsPath ? readIf(wsPath) : "";
  const npmrc = readIf(join(root, ".npmrc"));
  const flag = parseGvsFlag(wsYaml, npmrc);
  const outOfTree = flag === true || (flag !== false && storeOutOfTree(root, wsYaml, npmrc));

  if (!outOfTree) { console.log("Turbopack + in-tree pnpm store — no conflict."); return; }

  // Anchor the store on the workspace/repo root (so it covers packages/*, not just the app dir);
  // for a git worktree, on the canonical main worktree so every worktree shares one store.
  const workspaceRoot = wsPath ? dirname(wsPath) : root;
  const anchorRoot = gitMainWorktreeRoot(workspaceRoot) || workspaceRoot;

  const nextCfgName = CONFIG_NAMES.find((n) => existsSync(join(root, n))) || "next.config.js";
  const format = detectConfigFormat(nextCfgName, pkg.type);

  // Already mitigated by hand? If next.config ALREADY widens turbopack.root and the widened root
  // covers the actual store location (explicit virtualStoreDir — resolved against the workspace
  // root, pnpm's reference point — or the live `.pnpm` symlink target), Strategy B is in place and
  // re-reporting a CONFLICT forever would be a false positive. A gVS=true TRUE-global store with
  // no explicit virtualStoreDir stays a CONFLICT: its machine-wide path can't be known covered.
  const widenHop = parseWidenedRoot(readIf(join(root, nextCfgName)));
  const explicitVsd = parseVirtualStoreDir(wsYaml, npmrc);
  const storeActual = explicitVsd ? resolve(workspaceRoot, explicitVsd) : pnpmSymlinkTarget(root);
  if (widenHop && storeActual) {
    const widened = resolve(root, widenHop);
    if (isPathUnder(widened, storeActual) && isPathUnder(widened, root)) {
      console.log("Turbopack + out-of-tree pnpm store — Strategy B already in place:");
      console.log(`  store          → ${storeActual}`);
      console.log(`  turbopack.root → ${widened} (path.join(__dirname, '${widenHop}') in ${nextCfgName}) — covers both.`);
      console.log("No action needed. Confirm once with a live `next dev` + hard reload (chunks respond 200).");
      return;
    }
  }

  const pnpmMajor = detectPnpmMajor();
  // Undetectable pnpm → assume >=11 (pnpm-workspace.yaml): a silently-ignored .npmrc (the pnpm>=11
  // failure mode) is worse than an explicit note for the rarer pnpm<11 user.
  const target = pnpmMajor === null ? "workspace-yaml" : configTargetForPnpm(pnpmMajor);
  const r = buildRecipe(anchorRoot, root, format, { target });
  const configPath = join(workspaceRoot, r.configFile);

  console.log("CONFLICT: Turbopack + out-of-tree pnpm virtual store.");
  console.log("Turbopack resolves only under its root; the store is outside it → chunk 404s after a hard reload.");
  console.log("phantom-fix cannot help — this is a file-location conflict, not an undeclared dep.\n");
  console.log("Strategy B — sibling store + widened Turbopack root:\n");
  if (pnpmMajor === null)
    console.log("NOTE: could not run `pnpm --version` — assuming pnpm >= 11 (settings in pnpm-workspace.yaml).\n" +
                "      On pnpm < 11, put the same keys in .npmrc kebab-case (enable-global-virtual-store /\n" +
                "      virtual-store-dir) instead — .npmrc drives them there.\n");
  console.log(`1) Relocate the virtual store beside the repo. In ${configPath}` +
              `${pnpmMajor === null ? "" : ` (pnpm ${pnpmMajor})`}:`);
  for (const line of r.configLines) console.log(`     ${line}`);
  console.log(`   (store → ${r.store}, a sibling of the repo under ${r.parent}; shared across worktrees)`);
  console.log(`2) Clean relayout (from the repo root):  ${r.reinstall}`);
  console.log(`3) Widen Turbopack's boundary to that parent. In ${nextCfgName} (${format}):\n`);
  console.log(r.snippet.split("\n").map((l) => "     " + l).join("\n"));
  console.log("\nCaveats: the widened root enlarges Turbopack's watch scope — keep the parent clean");
  console.log("(only the repo + store). turbopack.root must be the parent of BOTH the repo and the store");
  console.log("(Next.js docs). storeOutOfTree() is a first signal only — confirm with a live next dev +");
  console.log("hard reload. Alternative if this misbehaves: disable gVS entirely (store back in-tree).");
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
  try { main(); } catch { /* advisory, never throws */ }
  process.exit(0);
}
