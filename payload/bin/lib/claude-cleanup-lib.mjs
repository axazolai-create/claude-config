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
