// Pure engine for /claude-cleanup. Allowlist-based: only ever proposes paths under enumerated
// category roots, so "never touch" (memory/, config, venvs) holds by construction.
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, renameSync, rmSync,
  writeFileSync, copyFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";

export const DAY_MS = 86_400_000;
export const KEEP_DAYS = 7;
export const AUTO_DAYS = 14;
export const RETENTION_DAYS = 7;

export function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

export function newestMtime(path) {
  let newest = 0;
  const walk = (p) => {
    let st; try { st = statSync(p); } catch { return; }
    if (st.isDirectory()) {
      let ents = []; try { ents = readdirSync(p); } catch { return; }
      if (ents.length === 0) { if (st.mtimeMs > newest) newest = st.mtimeMs; return; } // empty dir: fall back to its own mtime
      for (const e of ents) walk(join(p, e));
    } else if (st.mtimeMs > newest) newest = st.mtimeMs;
  };
  walk(path);
  return newest;
}

export function dirSize(path) {
  let total = 0;
  const walk = (p) => {
    let st; try { st = statSync(p); } catch { return; }
    if (st.isDirectory()) { let ents = []; try { ents = readdirSync(p); } catch { return; } for (const e of ents) walk(join(p, e)); }
    else total += st.size;
  };
  walk(path);
  return total;
}

// < KEEP_DAYS → keep; [KEEP_DAYS, AUTO_DAYS] → list; > AUTO_DAYS → auto
export function ageBucket(mtimeMs, nowMs) {
  const ageDays = (nowMs - mtimeMs) / DAY_MS;
  if (ageDays < KEEP_DAYS) return "keep";
  if (ageDays <= AUTO_DAYS) return "list";
  return "auto";
}

export function activeInstallPaths(dir = claudeDir()) {
  const f = join(dir, "plugins", "installed_plugins.json");
  let parsed; try { parsed = JSON.parse(readFileSync(f, "utf8")); } catch { return null; }
  // Guard manifest shape: missing/renamed `plugins` key must never look like "no plugins" —
  // that would make pluginPruneCandidates treat every cached version as prunable.
  if (!parsed || typeof parsed.plugins !== "object" || parsed.plugins === null) return null;
  const set = new Set();
  for (const entries of Object.values(parsed.plugins)) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries) if (e && e.installPath) set.add(e.installPath);
  }
  return set;
}

// Version dirs under plugins/cache/<mkt>/<plugin>/ whose full path is NOT an active installPath.
export function pluginPruneCandidates(dir = claudeDir()) {
  const active = activeInstallPaths(dir);
  if (active === null) return []; // fail-safe: never prune when we can't tell what's active
  const cacheRoot = join(dir, "plugins", "cache");
  const out = [];
  let mkts = []; try { mkts = readdirSync(cacheRoot); } catch { return out; }
  for (const mkt of mkts) {
    let plugs = []; try { plugs = readdirSync(join(cacheRoot, mkt)); } catch { continue; }
    for (const plug of plugs) {
      const plugDir = join(cacheRoot, mkt, plug);
      let vers = []; try { vers = readdirSync(plugDir); } catch { continue; }
      for (const ver of vers) {
        const verPath = join(plugDir, ver);
        let st; try { st = statSync(verPath); } catch { continue; }
        if (st.isDirectory() && !active.has(verPath)) out.push(verPath);
      }
    }
  }
  return out;
}

const EPHEMERAL = ["paste-cache", "shell-snapshots", "logs", "cache", "session-env", "daemon"];
const AGE_DIRS = ["file-history", "jobs", "tasks", "backups", "gsd-user-files-backup", "gsd-migration-journal"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeReaddir(p) { try { return readdirSync(p, { withFileTypes: true }); } catch { return []; } }
function statOr(p) { try { return statSync(p); } catch { return null; } }

export function buildPlan({ dir = claudeDir(), tempRoot, nowMs, excludeUuids = [] }) {
  const items = [], listCheck = [];
  const excl = new Set(excludeUuids);
  const push = (arr, absPath, category, reason, mtimeMs) =>
    arr.push({ absPath, size: statOr(absPath)?.isDirectory() ? dirSize(absPath) : (statOr(absPath)?.size ?? 0), category, reason, mtimeMs, bucket: ageBucket(mtimeMs, nowMs) });

  // Ephemeral: trash each immediate child of the dir (dir itself stays).
  for (const name of EPHEMERAL) {
    const root = join(dir, name);
    for (const e of safeReaddir(root)) push(items, join(root, e.name), "ephemeral", `ephemeral:${name}`, newestMtime(join(root, e.name)));
  }
  // Age dirs: each immediate child, only if > AUTO_DAYS.
  for (const name of AGE_DIRS) {
    const root = join(dir, name);
    for (const e of safeReaddir(root)) {
      const p = join(root, e.name); const m = e.isDirectory() ? newestMtime(p) : (statOr(p)?.mtimeMs ?? 0);
      if (ageBucket(m, nowMs) === "auto") push(items, p, "age", `age:${name}`, m);
    }
  }
  // Sessions: projects/<slug>/{<uuid>.jsonl,<uuid>/}; skip literal "memory".
  const projects = join(dir, "projects");
  for (const slugEnt of safeReaddir(projects)) {
    if (!slugEnt.isDirectory()) continue;
    const slugDir = join(projects, slugEnt.name);
    // group uuids
    const uuids = new Map(); // uuid -> {jsonl?, dir?}
    for (const e of safeReaddir(slugDir)) {
      if (e.name === "memory") continue; // NEVER
      const m = e.name.match(/^([0-9a-f-]{36})(\.jsonl)?$/i);
      if (!m || !UUID_RE.test(m[1])) continue;
      const rec = uuids.get(m[1]) || {}; rec[m[2] ? "jsonl" : "dir"] = join(slugDir, e.name); uuids.set(m[1], rec);
    }
    for (const [uuid, rec] of uuids) {
      if (excl.has(uuid)) continue;
      const paths = [rec.jsonl, rec.dir].filter(Boolean);
      const m = Math.max(...paths.map((p) => (statOr(p)?.isDirectory() ? newestMtime(p) : (statOr(p)?.mtimeMs ?? 0))));
      const bucket = ageBucket(m, nowMs);
      if (bucket === "keep") continue;
      for (const p of paths) push(bucket === "auto" ? items : listCheck, p, "session", `session:${slugEnt.name}/${uuid}`, m);
    }
  }
  // Temp: <tempRoot>/<slug>/<uuid>/
  for (const slugEnt of safeReaddir(tempRoot)) {
    if (!slugEnt.isDirectory()) continue;
    const slugDir = join(tempRoot, slugEnt.name);
    for (const e of safeReaddir(slugDir)) {
      if (!e.isDirectory() || !UUID_RE.test(e.name) || excl.has(e.name)) continue;
      const p = join(slugDir, e.name); const m = newestMtime(p); const bucket = ageBucket(m, nowMs);
      if (bucket === "keep") continue;
      push(bucket === "auto" ? items : listCheck, p, "temp", `temp:${slugEnt.name}/${e.name}`, m);
    }
  }
  // Plugins: stale cache versions (always trash).
  for (const p of pluginPruneCandidates(dir)) push(items, p, "plugin", "plugin:stale-version", newestMtime(p));

  const totals = { count: items.length, bytes: items.reduce((a, i) => a + i.size, 0) };
  return { items, listCheck, totals };
}
