// payload/bin/lib/turbopack-gvs-lib.mjs
// Pure detection + recipe logic for the Turbopack × enableGlobalVirtualStore conflict.
// Turbopack (Next.js) only resolves/serves files under its `root`; an out-of-tree pnpm virtual
// store (enableGlobalVirtualStore / an external virtual-store-dir) puts packages outside root,
// so chunks 404 after a hard reload. Strategy B: move the virtual store to a sibling folder under
// a common parent and widen Turbopack's root to that parent (verified against the Next.js docs:
// turbopack.root "Sets the application root directory. Should be an absolute path." and
// outputFileTracingRoot for build tracing). No I/O here — the CLI supplies file contents/paths.
import { dirname } from "node:path";

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

export function nextConfigSnippet(format) {
  if (format === "esm") {
    return [
      "import path from 'node:path'",
      "import { fileURLToPath } from 'node:url'",
      "const __dirname = path.dirname(fileURLToPath(import.meta.url))",
      "",
      "export default {",
      "  turbopack: { root: path.join(__dirname, '..') },",
      "  outputFileTracingRoot: path.join(__dirname, '..'),",
      "}",
    ].join("\n");
  }
  return [
    "const path = require('path')",
    "",
    "module.exports = {",
    "  turbopack: { root: path.join(__dirname, '..') },",
    "  outputFileTracingRoot: path.join(__dirname, '..'),",
    "}",
  ].join("\n");
}

// Compute the Strategy-B recipe for a project. `store` is a sibling of the project under the
// common parent; Turbopack root becomes that parent (`path.join(__dirname, '..')`).
export function buildRecipe(projectRoot, format = "cjs") {
  const parent = dirname(String(projectRoot)).replace(/\\/g, "/");
  const store = `${parent}/.pnpm-store`;
  return {
    parent,
    store,
    npmrc: ["enable-global-virtual-store=false", `virtual-store-dir=${store}`],
    reinstall: "rm -rf node_modules && pnpm install",
    snippet: nextConfigSnippet(format),
  };
}
