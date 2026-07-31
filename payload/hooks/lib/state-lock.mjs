// A PID/mtime lock with a staleness TTL, shared by the autosync worker and the Neo4j push.
// Every call is best-effort: a filesystem that refuses must never stop the work the lock guards.
import { existsSync, statSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";

export const STALE_LOCK_MS = 10 * 60 * 1000;

export function isHeld(lockPath, { now = Date.now(), ttlMs = STALE_LOCK_MS } = {}) {
  if (!existsSync(lockPath)) return false;
  let mtimeMs;
  try { mtimeMs = statSync(lockPath).mtimeMs; } catch { return false; }
  const age = now - mtimeMs;
  return Number.isFinite(age) && age < ttlMs;
}

export function take(lockPath) {
  try {
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, String(process.pid));
  } catch { /* best-effort */ }
}

export function release(lockPath) {
  try { rmSync(lockPath, { force: true }); } catch { /* best-effort */ }
}
