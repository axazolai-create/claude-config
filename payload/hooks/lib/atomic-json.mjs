// Shared lock + atomic-write helpers for the config/state files that several hooks and
// /init-stack mutate concurrently: ~/.claude/state/project-init.json (session-init.mjs,
// gsd-config-patch.mjs, mark-initstack-done.mjs) and a project's .claude/settings.json
// (session-init.mjs, init-stack.py). See RISK-SETTINGS-001. Two guarantees:
//   1. No torn/partial file: content is written to a temp sibling and renamed over the target.
//      rename is atomic on the same filesystem; on Windows Node maps it to MoveFileEx with
//      MOVEFILE_REPLACE_EXISTING, so it replaces an existing target rather than failing.
//   2. No lost update under concurrency: updateJsonFile() re-reads the target INSIDE an
//      exclusive lock and applies the caller's mutation to that fresh copy, so a writer that
//      raced in between is merged onto, not clobbered. The lock is a `<target>.lock` file
//      created with the 'wx' (exclusive-create) flag; a lock older than STALE_MS is presumed
//      abandoned (a crashed holder) and broken. init-stack.py uses the SAME `<target>.lock`
//      filename convention so the Node hooks and the Python command mutually exclude.
// The mutator passed to updateJsonFile MUST apply only this run's own key changes (never
// wholesale-replace another writer's subtree), so concurrent writers' other keys survive.
import {
  openSync, closeSync, writeFileSync, readFileSync, renameSync,
  unlinkSync, statSync, mkdirSync, existsSync,
} from "node:fs";
import { dirname } from "node:path";

const STALE_MS = 15000; // a lock file older than this is treated as abandoned and broken
const RETRY_MS = 50;    // backoff between acquisition attempts
const MAX_WAIT_MS = 5000; // give up waiting after this and proceed unlocked (never drop the write)

// Sync sleep without a busy-loop (hooks run as plain sync CLIs). Atomics.wait blocks the
// thread for `ms`; the SharedArrayBuffer value never changes so it always times out.
const sleepSync = (ms) => {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* not critical */ }
};

// Run fn() while holding an exclusive lock on `target`. Best-effort: if the lock can't be
// acquired (permissions, or contention beyond MAX_WAIT_MS) fn still runs, because dropping the
// write entirely is worse than a rare unlocked write. Always releases a lock it took.
export function withFileLock(target, fn) {
  const lock = `${target}.lock`;
  try { mkdirSync(dirname(target), { recursive: true }); } catch { /* ignore */ }
  const deadline = Date.now() + MAX_WAIT_MS;
  let held = false;
  for (;;) {
    try {
      const fd = openSync(lock, "wx");
      try { writeFileSync(fd, String(process.pid)); } catch { /* pid is advisory only */ }
      closeSync(fd);
      held = true;
      break;
    } catch (e) {
      if (e.code !== "EEXIST") break; // can't create the lock at all - proceed unlocked
      let stale = false;
      try { stale = (Date.now() - statSync(lock).mtimeMs) > STALE_MS; } catch { stale = true; }
      if (stale) { try { unlinkSync(lock); } catch { /* someone else broke it */ } continue; }
      if (Date.now() > deadline) break; // waited long enough - proceed unlocked
      sleepSync(RETRY_MS);
    }
  }
  try { return fn(); }
  finally { if (held) { try { unlinkSync(lock); } catch { /* already gone */ } } }
}

// Write `content` to `target` atomically (temp sibling + rename). Not locked on its own - use
// for create-once/single-writer files; for read-modify-write use updateJsonFile.
export function writeFileAtomic(target, content) {
  try { mkdirSync(dirname(target), { recursive: true }); } catch { /* ignore */ }
  writeFileAtomic._n = (writeFileAtomic._n || 0) + 1;
  const tmp = `${target}.tmp-${process.pid}-${writeFileAtomic._n}`;
  writeFileSync(tmp, content);
  try { renameSync(tmp, target); }
  catch (e) { try { unlinkSync(tmp); } catch { /* ignore */ } throw e; }
}

// Strip a leading UTF-8 BOM before parsing (project-init.json can pick one up from an external
// tool, e.g. PowerShell's Set-Content -Encoding utf8) - matches the readJSON in the hooks.
const readJsonBOM = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));

// Lock `target`, re-read it fresh, hand the parsed object (or {} if missing/corrupt) to
// `mutate`, then write the result back atomically - all inside the lock. `mutate` may mutate
// the object in place or return a replacement. Returns true iff a write happened (a semantic
// no-op against an existing file writes nothing). On failure returns false rather than throwing.
export function updateJsonFile(target, mutate) {
  try {
    return withFileLock(target, () => {
      let obj = {};
      if (existsSync(target)) { try { obj = readJsonBOM(target); } catch { obj = {}; } }
      if (obj === null || typeof obj !== "object" || Array.isArray(obj)) obj = {};
      const before = JSON.stringify(obj);
      const next = mutate(obj) ?? obj;
      if (JSON.stringify(next) === before && existsSync(target)) return false;
      writeFileAtomic(target, JSON.stringify(next, null, 2) + "\n");
      return true;
    });
  } catch { return false; }
}
