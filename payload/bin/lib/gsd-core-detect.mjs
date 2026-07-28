import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { dirSize, newestMtime } from "./claude-cleanup-lib.mjs";

const CATEGORIES = [
  { name: "gsd-core", dir: ".", match: (n) => n === "gsd-core", reason: "gsd-core install root" },
  { name: "skills", dir: "skills", match: (n) => n.startsWith("gsd-"), reason: "gsd-core skill" },
  { name: "agents", dir: "agents", match: (n) => n.startsWith("gsd-") && n.endsWith(".md"), reason: "gsd-core agent" },
  { name: "hooks", dir: "hooks", match: (n) => n.startsWith("gsd-"), reason: "gsd-core hook" },
  { name: "hooks/lib", dir: join("hooks", "lib"), match: (n) => n.startsWith("gsd-"), reason: "gsd-core hook library" },
];

export const gsdCorePresent = (dir) => existsSync(join(dir, "gsd-core", "VERSION"));

const safeReaddir = (p) => { try { return readdirSync(p); } catch { return []; } };
const statOr = (p) => { try { return statSync(p); } catch { return null; } };

export function buildGsdInventory({ dir, manifestRels = [] }) {
  const owned = new Set(manifestRels.map((r) => r.replace(/\\/g, "/")));
  const items = [];
  const categories = [];
  for (const cat of CATEGORIES) {
    const base = cat.dir === "." ? dir : join(dir, cat.dir);
    let count = 0;
    let bytes = 0;
    for (const name of safeReaddir(base)) {
      if (!cat.match(name)) continue;
      const rel = (cat.dir === "." ? name : `${cat.dir.replace(/\\/g, "/")}/${name}`);
      if (owned.has(rel)) continue;
      const absPath = join(base, name);
      const st = statOr(absPath);
      if (!st) continue;
      const size = st.isDirectory() ? dirSize(absPath) : st.size;
      const mtimeMs = st.isDirectory() ? newestMtime(absPath) : st.mtimeMs;
      items.push({ absPath, size, category: `gsd-core:${cat.name}`, reason: cat.reason, mtimeMs });
      count += 1;
      bytes += size;
    }
    if (count) categories.push({ name: cat.name, count, bytes });
  }
  return { items, categories, totalBytes: items.reduce((n, i) => n + i.size, 0) };
}

// `hooks/lib/gsd-*` is deliberately NOT matched here: nothing registers a lib file as a hook,
// and a broader match would be a second place this code can reach outside its own files.
const REFERENCES_GSD_HOOK = (entry) =>
  (entry.hooks || []).some((h) => (h.args || []).some((a) => /(^|[\\/])hooks[\\/]gsd-[^\\/]+$/.test(String(a))));

export function filterGsdHooks(settings) {
  if (!settings || !settings.hooks) return { settings: { ...settings }, removed: [] };
  const hooks = {};
  const removed = [];
  for (const [event, entries] of Object.entries(settings.hooks)) {
    hooks[event] = (entries || []).filter((e) => {
      if (!REFERENCES_GSD_HOOK(e)) return true;
      removed.push({ event, entry: e });
      return false;
    });
  }
  return { settings: { ...settings, hooks }, removed };
}
