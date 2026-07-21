#!/usr/bin/env node
// turbopack-gvs-check: detect the structural conflict between Turbopack (Next.js) and an
// out-of-tree pnpm virtual store (enableGlobalVirtualStore / an external virtual-store-dir).
// Turbopack only resolves/serves files under its `root`; an out-of-tree store puts packages
// outside root, so `_next/static/chunks/...` 404 after a hard reload. This tool WARNS and prints
// a tailored Strategy-B recipe (sibling store + widened turbopack.root) — it does not edit code.
// Advisory only: exit 0 always.
//
// Usage: node turbopack-gvs-check.mjs [--root <dir>]
import { readFileSync, existsSync, lstatSync, readlinkSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { usesTurbopack, parseGvsFlag, detectConfigFormat, buildRecipe } from "./lib/turbopack-gvs-lib.mjs";

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

// Structural: is the virtual store physically outside the project tree?
function storeOutOfTree(root, npmrc) {
  const pnpmDir = join(root, "node_modules", ".pnpm");
  try {
    const st = lstatSync(pnpmDir);
    if (st.isSymbolicLink()) {
      const target = resolve(dirname(pnpmDir), readlinkSync(pnpmDir));
      if (!target.startsWith(resolve(root))) return true;
    }
  } catch { /* .pnpm absent */ }
  const m = String(npmrc).match(/^\s*virtual-store-dir\s*=\s*(.+)$/m);
  if (m) { const vsd = resolve(root, m[1].trim()); if (!vsd.startsWith(resolve(root))) return true; }
  return false;
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
  const outOfTree = flag === true || (flag !== false && storeOutOfTree(root, npmrc));

  if (!outOfTree) { console.log("Turbopack + in-tree pnpm store — no conflict."); return; }

  const configFile = CONFIG_NAMES.find((n) => existsSync(join(root, n))) || "next.config.js";
  const format = detectConfigFormat(configFile, pkg.type);
  const r = buildRecipe(root, format);

  console.log("CONFLICT: Turbopack + out-of-tree pnpm virtual store (enableGlobalVirtualStore).");
  console.log("Turbopack resolves only under its root; the store is outside it → chunk 404s after a hard reload.");
  console.log("phantom-fix cannot help — this is a file-location conflict, not an undeclared dep.\n");
  console.log("Strategy B — sibling store + widened Turbopack root:\n");
  console.log(`1) Move the virtual store beside the project. In ${join(root, ".npmrc")}:`);
  for (const line of r.npmrc) console.log(`     ${line}`);
  console.log(`   (store → ${r.store}, a sibling of the project under ${r.parent})`);
  console.log(`2) Clean relayout:  ${r.reinstall}`);
  console.log(`3) Widen Turbopack's boundary to that parent. In ${configFile} (${format}):\n`);
  console.log(r.snippet.split("\n").map((l) => "     " + l).join("\n"));
  console.log("\nCaveats: the widened root enlarges Turbopack's watch scope — keep the parent clean");
  console.log("(only the project + store). turbopack.root must be the parent of BOTH the project and");
  console.log("the store (Next.js docs). Alternative if this misbehaves: disable gVS entirely (store in-tree).");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch { /* advisory, never throws */ }
  process.exit(0);
}
