// payload/bin/lib/pnpm-phantom-lib.mjs
// Pure detection helpers for pnpm phantom dependencies. Node stdlib only, no side effects.
import { builtinModules } from "node:module";

const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => "node:" + m)]);

export function pkgNameFromSpecifier(spec) {
  if (!spec || spec.startsWith(".") || spec.startsWith("/")) return null;
  if (spec.startsWith("node:")) return null;
  const parts = spec.split("/");
  const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  if (!name || BUILTINS.has(name)) return null;
  return name;
}

export function extractBareImports(src) {
  const out = new Set();
  const patterns = [
    /\bimport\s+(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/g, // import ... from 'x' | import 'x'
    /\bexport\s+[^'";]*?\sfrom\s*['"]([^'"]+)['"]/g,       // export ... from 'x'
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,             // require('x')
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,              // import('x')
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src))) {
      const n = pkgNameFromSpecifier(m[1]);
      if (n) out.add(n);
    }
  }
  return out;
}

export function declaredDeps(pkg) {
  const s = new Set();
  for (const f of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    if (pkg && pkg[f] && typeof pkg[f] === "object") for (const k of Object.keys(pkg[f])) s.add(k);
  }
  if (pkg && pkg.name) s.add(pkg.name);
  if (pkg && Array.isArray(pkg.bundledDependencies)) for (const k of pkg.bundledDependencies) s.add(k);
  return s;
}

export function phantomsForPackage(pkg, importedNames, installedNames) {
  const declared = declaredDeps(pkg);
  const phantoms = [];
  for (const q of importedNames) {
    if (q === pkg?.name) continue;
    if (declared.has(q)) continue;
    if (!installedNames.has(q)) continue;
    phantoms.push(q);
  }
  return phantoms.sort();
}
