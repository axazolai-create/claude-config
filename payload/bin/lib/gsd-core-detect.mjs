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
  const owned = [...new Set(manifestRels.map((r) => r.replace(/\\/g, "/")))];
  // owned entries are always files (manifest ships one per shipped file); a directory-shaped
  // category's rel (e.g. "skills/gsd-x") never appears verbatim, only nested under it — so
  // subtraction must also match by prefix, not just exact equality.
  const isOwned = (rel) => owned.some((o) => o === rel || o.startsWith(rel + "/"));
  const items = [];
  const categories = [];
  for (const cat of CATEGORIES) {
    const base = cat.dir === "." ? dir : join(dir, cat.dir);
    let count = 0;
    let bytes = 0;
    for (const name of safeReaddir(base)) {
      if (!cat.match(name)) continue;
      const rel = (cat.dir === "." ? name : `${cat.dir.replace(/\\/g, "/")}/${name}`);
      if (isOwned(rel)) continue;
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

// Both registration shapes, because gsd-core uses the one this bundle does not: every real
// gsd-core hook is a single quoted command line with no args array at all
// (`"…/node.exe" "…/hooks/gsd-check-update.js"`), while this bundle registers command+args.
// Matching args alone left every real registration behind after its file had been moved, so the
// hook fired and failed at every session. Unanchored and stopping at a quote or space, so it holds
// through quoting, either slash, and trailing arguments.
// `hooks/lib/gsd-*` stays unmatched: nothing registers a lib file as a hook, and a broader pattern
// would be a second place this code can reach outside its own files.
// A leading space counts as a boundary for the same reason `^` does: `node hooks/gsd-x.js` and a
// bare `hooks/gsd-x.js` are the same reference, and treating only one of them as one was an
// inconsistency, not a policy. `my-hooks/`, `xhooks/` and `.hooks/` still miss - `-`, `x` and `.`
// are not boundaries.
const GSD_HOOK_REF = /(^|[\s\\/"'])hooks[\\/]gsd-[^\\/"'\s]+/;
const REFERENCES_GSD_HOOK = (entry) =>
  (entry.hooks || []).some((h) =>
    GSD_HOOK_REF.test(String(h.command ?? "")) || (h.args || []).some((a) => GSD_HOOK_REF.test(String(a))));

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
