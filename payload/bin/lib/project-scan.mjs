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
