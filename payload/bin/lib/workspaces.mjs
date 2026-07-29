import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function readJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function parsePnpmWorkspaceYaml(path) {
  const globs = [];
  let inPackages = false;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (/^packages\s*:/.test(line)) { inPackages = true; continue; }
    if (!inPackages) continue;
    const m = line.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/);
    if (m) { globs.push(m[1]); continue; }
    if (/^\S/.test(line)) break;
  }
  return globs;
}

function expandGlob(root, glob) {
  if (glob.endsWith("/*")) {
    const base = join(root, glob.slice(0, -2));
    if (!existsSync(base)) return [];
    return readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(base, e.name));
  }
  const exact = join(root, glob);
  return existsSync(exact) && statSync(exact).isDirectory() ? [exact] : [];
}

export function listWorkspaces(rootArg) {
  const root = resolve(rootArg);
  let workspaceGlobs = null;
  let source = null;

  const pnpmWsPath = join(root, "pnpm-workspace.yaml");
  if (existsSync(pnpmWsPath)) {
    const globs = parsePnpmWorkspaceYaml(pnpmWsPath);
    if (globs.length > 0) { workspaceGlobs = globs; source = "pnpm-workspace.yaml"; }
  }

  if (!workspaceGlobs) {
    const rootPkg = readJsonSafe(join(root, "package.json"));
    const w = rootPkg?.workspaces;
    const globs = Array.isArray(w) ? w : Array.isArray(w?.packages) ? w.packages : null;
    if (globs?.length) { workspaceGlobs = globs; source = "package.json#workspaces"; }
  }

  if (!workspaceGlobs && (existsSync(join(root, "turbo.json")) || existsSync(join(root, "nx.json")))) {
    const fallback = ["apps/*", "packages/*"].filter((g) => existsSync(join(root, g.replace("/*", ""))));
    if (fallback.length > 0) { workspaceGlobs = fallback; source = "conventional-fallback"; }
  }

  const dirs = new Set();
  for (const g of workspaceGlobs ?? []) for (const d of expandGlob(root, g)) dirs.add(d);

  const workspaces = [...dirs]
    .map((dir) => ({
      dir,
      relDir: dir.slice(root.length + 1).split("\\").join("/"),
      hasPackageJson: existsSync(join(dir, "package.json")),
    }))
    .filter((w) => w.hasPackageJson)
    .sort((a, b) => a.relDir.localeCompare(b.relDir));

  return {
    root,
    isMonorepo: workspaces.length > 1,
    detectionSource: source,
    workspaceGlobsUsed: workspaceGlobs ?? [],
    workspaces,
  };
}
