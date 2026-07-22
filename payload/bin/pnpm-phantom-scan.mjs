#!/usr/bin/env node
// pnpm-phantom-scan: walk installed node_modules, find undeclared-but-imported packages that
// ARE installed somewhere (real by-luck phantoms), and additively declare them as optional
// peers in packageExtensions of pnpm-workspace.yaml — so an out-of-tree store
// (enableGlobalVirtualStore) links them by the graph. Additive-only, fail-safe, exit 0.
//
// Usage: node pnpm-phantom-scan.mjs [--packages a,b,c] [--root <dir>]
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, realpathSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { extractBareImports, phantomsForPackage } from "./lib/pnpm-phantom-lib.mjs";
import { addOptionalPeers } from "./lib/pnpm-workspace-yaml.mjs";

const MAX_FILES = 400;              // per-package source file cap (bound cost)
const MAX_BYTES = 512 * 1024;       // per-file size cap

function parseArgs(argv) {
  const out = { root: null, packages: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") out.root = argv[++i];
    else if (argv[i] === "--packages")
      out.packages = String(argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
  }
  return out;
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

function resolveWorkspaceRoot(start) {
  return findUp(start, "pnpm-workspace.yaml") || findUp(start, "pnpm-lock.yaml") || resolve(start);
}

// Record a single package dir into `out` (Map name -> {name, dir, pkg}); first copy wins.
function recordPackage(dir, out) {
  let pkg;
  try { pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")); } catch { return; }
  if (!pkg || !pkg.name) return;
  if (!out.has(pkg.name)) out.set(pkg.name, { name: pkg.name, dir, pkg });
}

// Enumerate packages directly under a node_modules dir, handling @scope dirs and the
// .pnpm/<pkg>@<ver>/node_modules real copies. Does NOT descend into a package's own
// node_modules (bounded), except the one .pnpm hop for real copies.
function collectPackagesUnder(nmDir, out) {
  let entries;
  try { entries = readdirSync(nmDir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const nm = e.name;
    if (nm === ".bin") continue;
    if (nm === ".pnpm") {
      let vers;
      try { vers = readdirSync(join(nmDir, ".pnpm"), { withFileTypes: true }); } catch { continue; }
      for (const v of vers) {
        if (v.name.startsWith(".")) continue;
        collectPackagesUnder(join(nmDir, ".pnpm", v.name, "node_modules"), out);
      }
      continue;
    }
    if (nm.startsWith(".")) continue;
    const full = join(nmDir, nm);
    if (nm.startsWith("@")) {
      let subs;
      try { subs = readdirSync(full, { withFileTypes: true }); } catch { continue; }
      for (const s of subs) recordPackage(join(full, s.name), out);
      continue;
    }
    recordPackage(full, out);
  }
}

// Best-effort: extra workspace-package node_modules from pnpm-workspace.yaml `packages:` globs.
function workspaceNodeModules(root) {
  const out = [];
  try {
    const ws = join(root, "pnpm-workspace.yaml");
    if (!existsSync(ws)) return out;
    const txt = readFileSync(ws, "utf8");
    for (const g of parsePackagesGlobs(txt))
      for (const dir of expandGlob(root, g)) out.push(join(dir, "node_modules"));
  } catch { /* best-effort */ }
  return out;
}

function parsePackagesGlobs(txt) {
  const lines = txt.split(/\r?\n/);
  const i = lines.findIndex((l) => l.trim() === "packages:");
  if (i < 0) return [];
  const globs = [];
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    if (l.trim() === "") continue;
    if (!/^\s+/.test(l)) break;                 // dedented => block ended
    const m = l.match(/^\s*-\s*['"]?([^'"]+?)['"]?\s*$/);
    if (m) globs.push(m[1]);
  }
  return globs;
}

function expandGlob(root, glob) {
  if (glob.startsWith("!")) return [];
  const g = glob.replace(/\/\*\*$/, "/*");
  const star = g.indexOf("*");
  if (star < 0) { const d = join(root, g); return existsSync(d) ? [d] : []; }
  const base = g.slice(0, star).replace(/\/$/, "");
  const dirs = [];
  try {
    for (const e of readdirSync(join(root, base), { withFileTypes: true }))
      if (e.isDirectory() && !e.name.startsWith(".")) dirs.push(join(root, base, e.name));
  } catch { /* ignore */ }
  return dirs;
}

// Union of bare imports across a package's runtime source (excluding nested node_modules).
function gatherImports(dir) {
  const names = new Set();
  let fileCount = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name === "node_modules") continue;  // exclude nested deps
        stack.push(join(cur, e.name));
      } else if (/\.(js|mjs|cjs|jsx)$/.test(e.name)) {
        if (fileCount >= MAX_FILES) continue;
        fileCount++;
        const fp = join(cur, e.name);
        try {
          if (statSync(fp).size > MAX_BYTES) continue;
          for (const n of extractBareImports(readFileSync(fp, "utf8"))) names.add(n);
        } catch { /* ignore unreadable */ }
      }
    }
  }
  return names;
}

// Given seed package names, walk deps/peer/optional over installed manifests -> in-scope set.
function transitiveScope(seeds, byName) {
  const inScope = new Set();
  const stack = [...seeds];
  while (stack.length) {
    const n = stack.pop();
    if (inScope.has(n)) continue;
    inScope.add(n);
    const rec = byName.get(n);
    if (!rec) continue;
    for (const f of ["dependencies", "peerDependencies", "optionalDependencies"]) {
      const o = rec.pkg[f];
      if (o && typeof o === "object") for (const k of Object.keys(o)) if (!inScope.has(k)) stack.push(k);
    }
  }
  return inScope;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const start = args.root ? resolve(args.root) : process.cwd();
  const root = resolveWorkspaceRoot(start);

  const byName = new Map();
  collectPackagesUnder(join(root, "node_modules"), byName);
  for (const nm of workspaceNodeModules(root)) collectPackagesUnder(nm, byName);
  const installedNames = new Set(byName.keys());

  let scanNames = [...byName.keys()];
  if (args.packages && args.packages.length) {
    const scope = transitiveScope(args.packages, byName);
    scanNames = scanNames.filter((n) => scope.has(n));
  }

  const additions = new Map();
  for (const name of scanNames) {
    const rec = byName.get(name);
    if (!rec) continue;
    const ph = phantomsForPackage(rec.pkg, gatherImports(rec.dir), installedNames);
    if (ph.length) additions.set(name, ph);
  }

  if (!additions.size) { console.log("No phantom dependencies found."); return; }

  const wsPath = join(root, "pnpm-workspace.yaml");
  const yamlText = existsSync(wsPath) ? readFileSync(wsPath, "utf8") : "";
  const res = addOptionalPeers(yamlText, additions);

  if (!res.safe) {
    console.log("pnpm-workspace.yaml has a shape this tool cannot safely edit. Add manually:");
    for (const [P, qs] of additions) for (const Q of qs) console.log(`  ${P} -> ${Q} (optional peer)`);
    return;
  }

  if (res.added.length) {
    writeFileSync(wsPath, res.text);
    console.log("Added optional-peer packageExtensions:");
    for (const [P, Q] of res.added) console.log(`  ${P} -> ${Q} (optional peer)`);
    if (res.skipped.length) {
      console.log("Skipped (P already present — add manually if needed):");
      for (const [P, Q] of res.skipped) console.log(`  ${P} -> ${Q} (optional peer)`);
    }
    console.log("→ run `pnpm install` again to apply");
  } else {
    console.log("No new phantom dependencies to declare (already present).");
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
  try { main(); } catch { /* fail-soft */ }
  process.exit(0);
}
