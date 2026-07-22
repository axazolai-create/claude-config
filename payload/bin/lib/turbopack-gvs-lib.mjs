// payload/bin/lib/turbopack-gvs-lib.mjs
// Pure detection + recipe logic for the Turbopack × enableGlobalVirtualStore conflict.
// Turbopack (Next.js) only resolves/serves files under its `root`; an out-of-tree pnpm virtual
// store (enableGlobalVirtualStore / an external virtual-store-dir) puts packages outside root,
// so chunks 404 after a hard reload. Strategy B: move the virtual store to a sibling folder under
// a common parent and widen Turbopack's root to that parent (verified against the Next.js docs:
// turbopack.root "Sets the application root directory. Should be an absolute path." and
// outputFileTracingRoot for build tracing). No I/O here — the CLI supplies file contents/paths
// (incl. the detected pnpm version and resolved repo root; version detection / git resolution live
// in the CLI so this stays pure and testable).

// Turbopack is Next's default bundler from v15; before that only with an explicit --turbo flag.
export function usesTurbopack(pkg) {
  const spec = (pkg?.dependencies?.next) || (pkg?.devDependencies?.next) || "";
  if (!spec) return false;
  const major = parseInt(String(spec).replace(/[^\d.]/g, "").split(".")[0] || "", 10);
  if (Number.isFinite(major) && major >= 15) return true;
  return /--turbo(pack)?\b/.test(String(pkg?.scripts?.dev || ""));
}

// true = gVS explicitly ON, false = explicitly OFF, null = unset (caller may still detect
// an out-of-tree store structurally, e.g. an external virtual-store-dir or a junctioned .pnpm).
export function parseGvsFlag(wsYaml, npmrc) {
  const ws = String(wsYaml || "");
  const rc = String(npmrc || "");
  if (/^\s*enableGlobalVirtualStore\s*:\s*true\b/m.test(ws)) return true;
  if (/^\s*enable-global-virtual-store\s*=\s*true\b/m.test(rc)) return true;
  if (/^\s*enableGlobalVirtualStore\s*:\s*false\b/m.test(ws)) return false;
  if (/^\s*enable-global-virtual-store\s*=\s*false\b/m.test(rc)) return false;
  return null;
}

// The explicit `virtualStoreDir` (pnpm-workspace.yaml, camelCase) or `virtual-store-dir` (.npmrc,
// kebab) path, whichever is set — or null. Lets the CLI recognise an already-relocated store, which
// the bare gVS-flag/`.pnpm`-symlink check alone misses (a custom virtualStoreDir moves the store
// out of tree without setting enableGlobalVirtualStore at all).
export function parseVirtualStoreDir(wsYaml, npmrc) {
  const ws = String(wsYaml || "").match(/^\s*virtualStoreDir\s*:\s*(.+?)\s*$/m);
  if (ws) return ws[1].replace(/^['"]|['"]$/g, "").trim();
  const rc = String(npmrc || "").match(/^\s*virtual-store-dir\s*=\s*(.+?)\s*$/m);
  if (rc) return rc[1].trim();
  return null;
}

// pnpm 11.0 made .npmrc auth/registry-only: virtualStoreDir / enableGlobalVirtualStore then take
// effect ONLY from pnpm-workspace.yaml (camelCase). pnpm 10.x exposes pnpm-workspace.yaml too, but
// .npmrc still works there and 10.x's coverage of these two keys is not guaranteed — so target the
// known-good .npmrc (kebab) for <11 and pnpm-workspace.yaml for >=11. An unknown/undetected version
// is the CLI's call (it warns and prefers pnpm-workspace.yaml, the safe choice for current pnpm).
export function configTargetForPnpm(pnpmMajor) {
  return Number.isFinite(pnpmMajor) && pnpmMajor >= 11 ? "workspace-yaml" : "npmrc";
}

// Which module system a next.config file uses — decides the snippet variant.
export function detectConfigFormat(configFilename, pkgType) {
  const f = String(configFilename || "").toLowerCase();
  if (f.endsWith(".mjs")) return "esm";
  if (f.endsWith(".cjs")) return "cjs";
  if (f.endsWith(".ts") || f.endsWith(".mts")) return "esm"; // Next TS config uses export default
  if (f.endsWith(".cts")) return "cjs";
  // plain .js follows package.json "type"
  return pkgType === "module" ? "esm" : "cjs";
}

// `up` is the relative hop from the next.config's own dir to the widened Turbopack root (the store's
// common parent). It is a single `..` for a single-package repo, but DEEPER for a monorepo whose app
// is nested (e.g. `apps/web` → `../../..`), so the widened root actually reaches the parent that
// covers both the repo and the sibling store. Hardcoding `..` silently under-widens in a monorepo.
export function nextConfigSnippet(format, up = "..") {
  if (format === "esm") {
    return [
      "import path from 'node:path'",
      "import { fileURLToPath } from 'node:url'",
      "const __dirname = path.dirname(fileURLToPath(import.meta.url))",
      "",
      "export default {",
      `  turbopack: { root: path.join(__dirname, '${up}') },`,
      `  outputFileTracingRoot: path.join(__dirname, '${up}'),`,
      "}",
    ].join("\n");
  }
  return [
    "const path = require('path')",
    "",
    "module.exports = {",
    `  turbopack: { root: path.join(__dirname, '${up}') },`,
    `  outputFileTracingRoot: path.join(__dirname, '${up}'),`,
    "}",
  ].join("\n");
}

// Relative up-hop from `fromDir` down-to-up to `toDir` (an ancestor), as `..`/`../..`/… — one `..`
// per intervening level. `.` if equal; a plain `..` fallback when `toDir` isn't a clean ancestor.
// Pure string math (normalised to forward slashes) so it's deterministic across OSes.
export function relUp(fromDir, toDir) {
  const a = String(fromDir).replace(/\\/g, "/").replace(/\/+$/, "");
  const b = String(toDir).replace(/\\/g, "/").replace(/\/+$/, "");
  if (a === b) return ".";
  if (a.startsWith(b + "/")) return Array(a.slice(b.length + 1).split("/").length).fill("..").join("/");
  return "..";
}

// The relative hop a next.config ALREADY widens Turbopack's root by — from
// `turbopack: { root: path.join(__dirname, '..', '..') }` / `path.resolve(__dirname, '../..')`
// (outputFileTracingRoot accepted as a fallback signal). Joined into one relative string
// ("../../..") or null when no such widening is present. Lets the CLI recognise a repo where
// Strategy B was already applied by hand instead of re-reporting a CONFLICT forever.
export function parseWidenedRoot(configSource) {
  const src = String(configSource || "");
  const re = /([A-Za-z]*[Rr]oot)\s*:\s*path\.(?:join|resolve)\(\s*__dirname\s*,\s*([^)]+)\)/g;
  let fallback = null;
  for (let m; (m = re.exec(src)); ) {
    const segs = [...m[2].matchAll(/['"]([^'"]+)['"]/g)].map((q) => q[1]);
    if (!segs.length) continue;
    const hop = segs.join("/");
    if (m[1] === "root") return hop;          // turbopack.root — the one that gates serving
    if (!fallback) fallback = hop;             // outputFileTracingRoot etc.
  }
  return fallback;
}

// Is `child` inside (or equal to) `parentDir`? Normalised, case-insensitive on the drive-letter
// style Windows paths this repo deals in — a pure prefix check, no filesystem access.
export function isPathUnder(parentDir, child) {
  const norm = (p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const a = norm(parentDir);
  const b = norm(child);
  return b === a || b.startsWith(a + "/");
}

// Compute the Strategy-B recipe. `repoRoot` must be the store ANCHOR — the workspace/repo root
// (where pnpm-workspace.yaml lives), or, for a git worktree, the canonical MAIN-worktree root so
// every worktree of one repo resolves to the same store. The CLI resolves that before calling here.
// The store is a sibling of the repo named `<repo folder>-store` (not a fixed `.pnpm-store`): two
// repos under one parent get distinct stores, while worktrees of one repo — anchored on the same
// canonical root — share it. `target` picks the config file (see configTargetForPnpm). Turbopack
// root becomes the common parent (`path.join(__dirname, '..')` from the app dir).
export function buildRecipe(anchorRoot, appDir = anchorRoot, format = "cjs", { target = "npmrc" } = {}) {
  const norm = String(anchorRoot).replace(/\\/g, "/").replace(/\/+$/, "");
  const cut = norm.lastIndexOf("/");
  const parent = cut > 0 ? norm.slice(0, cut) : norm;
  const name = norm.slice(cut + 1) || "project";
  const storeName = `${name}-store`;
  const store = `${parent}/${storeName}`;
  const workspaceYaml = target === "workspace-yaml";
  const configFile = workspaceYaml ? "pnpm-workspace.yaml" : ".npmrc";
  const configLines = workspaceYaml
    ? ["enableGlobalVirtualStore: false", `virtualStoreDir: ${store}`]
    : ["enable-global-virtual-store=false", `virtual-store-dir=${store}`];
  return {
    parent,
    store,
    storeName,
    configFile,
    configLines,
    up: relUp(appDir, parent),
    reinstall: "rm -rf node_modules && pnpm install",
    snippet: nextConfigSnippet(format, relUp(appDir, parent)),
  };
}
