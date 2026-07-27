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

  // Ephemeral: each immediate child of the dir (dir itself stays), guarded by age — a <7d
  // ("keep") child is skipped, which protects the currently-running session's own transient
  // files (logs/session-env/daemon/shell-snapshots/cache/paste-cache). No list-checker here:
  // both "list" and "auto" age buckets are swept straight into items.
  for (const name of EPHEMERAL) {
    const root = join(dir, name);
    for (const e of safeReaddir(root)) {
      const p = join(root, e.name);
      const m = e.isDirectory() ? newestMtime(p) : (statOr(p)?.mtimeMs ?? 0);
      if (ageBucket(m, nowMs) === "keep") continue;
      push(items, p, "ephemeral", `ephemeral:${name}`, m);
    }
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

export function trashRoot(dir = claudeDir()) { return join(dir, ".cleanup-trash"); }

function moveInto(src, destDir) {
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, basename(src));
  try { renameSync(src, dest); }
  catch (err) {
    if (err?.code !== "EXDEV") throw err; // only fall back for cross-device; anything else propagates
    const st = statSync(src);
    if (st.isDirectory()) {
      mkdirSync(dest, { recursive: true });
      for (const e of readdirSync(src)) moveInto(join(src, e), dest);
      rmSync(src, { recursive: true, force: true });
    } else { copyFileSync(src, dest); rmSync(src, { force: true }); }
  }
  return dest;
}

export function applyPlan({ dir = claudeDir(), items, nowMs, ts }) {
  const batchDir = join(trashRoot(dir), ts);
  mkdirSync(batchDir, { recursive: true });
  const entries = []; let moved = 0, bytes = 0, skipped = 0;
  let idx = 0;
  try {
    for (const it of items) {
      try {
        const st = statOr(it.absPath);
        if (!st) { skipped++; continue; }
        // TOCTOU: became active since scan → leave alone (allow tiny fs rounding)
        const liveM = st.isDirectory() ? newestMtime(it.absPath) : st.mtimeMs;
        if (Math.abs(liveM - it.mtimeMs) > 1) { skipped++; continue; }
        const slot = join(batchDir, String(idx++)); // unique slot avoids basename collisions
        const dest = moveInto(it.absPath, slot);
        entries.push({ originalAbsPath: it.absPath, size: it.size, category: it.category, reason: it.reason, movedAt: nowMs, slot: basename(slot) });
        moved++; bytes += it.size;
      } catch { skipped++; } // never let one bad item orphan already-moved siblings; original stays in place
    }
  } finally {
    // Unconditional: whatever actually moved must always be recorded/restorable, even on an
    // unexpected throw from something above the per-item try (e.g. batchDir became unwritable).
    writeFileSync(join(batchDir, "manifest.json"), JSON.stringify({ ts, entries }, null, 2), "utf8");
  }
  return { batchDir, moved, bytes, skipped };
}

export function listTrashBatches(dir = claudeDir()) {
  const root = trashRoot(dir); const out = [];
  for (const e of safeReaddir(root)) {
    if (!e.isDirectory()) continue;
    const p = join(root, e.name); out.push({ ts: e.name, dir: p, mtimeMs: statOr(p)?.mtimeMs ?? 0 });
  }
  return out;
}

export function purgeRetention({ dir = claudeDir(), nowMs, retentionDays = RETENTION_DAYS }) {
  const removed = [];
  for (const b of listTrashBatches(dir)) {
    if ((nowMs - b.mtimeMs) / DAY_MS > retentionDays) { rmSync(b.dir, { recursive: true, force: true }); removed.push(b.ts); }
  }
  return removed;
}

export function restoreBatch({ dir = claudeDir(), ts }) {
  const batchDir = join(trashRoot(dir), ts);
  let manifest; try { manifest = JSON.parse(readFileSync(join(batchDir, "manifest.json"), "utf8")); } catch { return { restored: 0, skipped: 0 }; }
  let restored = 0, skipped = 0;
  for (const e of manifest.entries || []) {
    const stored = join(batchDir, e.slot, basename(e.originalAbsPath));
    if (existsSync(e.originalAbsPath) || !existsSync(stored)) { skipped++; continue; } // never clobber
    mkdirSync(dirname(e.originalAbsPath), { recursive: true });
    moveInto(join(batchDir, e.slot, basename(e.originalAbsPath)), dirname(e.originalAbsPath));
    restored++;
  }
  if (skipped === 0) rmSync(batchDir, { recursive: true, force: true });
  return { restored, skipped };
}
