// Which directories the mass sync treats as project roots, and which it never descends into.
// A git worktree and a submodule both carry a `.git` FILE rather than a directory; indexing
// them registers the parent repository a second time under a second name.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_EXCLUDE = [
  "node_modules", "graphify-out", "bin", "obj", ".venv", "venv", "dist", "build",
  "__pycache__", ".git", "vendor", ".gradle", ".idea", "target", ".next",
  ".vscode", ".vs", ".vite-inspect", "out", "coverage", ".turbo", ".cache", ".nuxt",
  "site-packages", "_vendored",
];

const EXACT = new Set(["package.json", "pyproject.toml", "go.mod", "requirements.txt"]);
const EXTS = new Set([".sln", ".csproj", ".dpr", ".dproj", ".groupproj"]);

const realFs = (dir) => ({
  readdir: () => readdirSync(dir),
  gitIsDirectory: () => { try { return statSync(join(dir, ".git")).isDirectory(); } catch { return false; } },
});

const ARCHIVE_NAME = /^(_old\d*|_prod|_bak|_backup|_archive|archive|backup|.*-\s*Copy|.*\.bak)$/i;

export function looksArchival(name) {
  return ARCHIVE_NAME.test(String(name));
}

// Nesting alone is not evidence - a monorepo package is nested and legitimate. An archival name
// alone is not either - a project may simply be called `backup`. Only the pair identifies a copy.
export function dropNestedArchives(dirs) {
  const norm = (d) => String(d).replace(/\\/g, "/").replace(/\/+$/, "");
  const roots = dirs.map(norm);
  return dirs.filter((d, i) => {
    const p = roots[i];
    const nested = roots.some((r, j) => j !== i && p.startsWith(r + "/"));
    return !(nested && looksArchival(p.slice(p.lastIndexOf("/") + 1)));
  });
}

export function isProjectRoot(dir, io = realFs(dir)) {
  let names;
  try { names = io.readdir(); } catch { return false; }
  for (const n of names) {
    if (EXACT.has(n)) return true;
    const dot = n.lastIndexOf(".");
    if (dot > 0 && EXTS.has(n.slice(dot))) return true;
  }
  return names.includes(".git") && io.gitIsDirectory();
}
