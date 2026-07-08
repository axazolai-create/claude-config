// Shared helpers for the token-usage-log hook family (token-usage-log.mjs,
// token-usage-prune.mjs). Not used by token-usage-pricing-refresh.mjs, which is spawned
// detached via `node <path>` and stays fully self-contained on purpose - same split as
// hooks/graphify-global-sync.mjs vs hooks/lib/graphify-global-sync-run.mjs.
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

export const safe = (fn) => { try { return fn(); } catch { return undefined; } };
export const writeFile = (p, content) => { try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content); return true; } catch { return false; } };
// Strips a leading UTF-8 BOM before parsing - same defensive read used by session-init.mjs /
// gsd-config-patch.mjs for project-init.json, which this file's cursor state shares.
export const readJSON = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));

// Same root-finding walk as session-init.mjs / gsd-config-patch.mjs, duplicated on purpose -
// small helper, keeps this hook family independently readable/runnable without importing from
// a sibling outside hooks/lib/.
export function findRoot(start) {
  let cur = resolve(start);
  for (let i = 0; i < 40; i++) {
    for (const m of [".git", ".planning", "package.json", "pyproject.toml", "go.mod", "build.gradle.kts"])
      if (existsSync(join(cur, m))) return cur;
    const up = dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return resolve(start);
}

// Same basename extraction session-init.mjs already uses for the graphify project name.
export function projectNameOf(root) {
  return root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "repo";
}

export function appendJSONL(path, record) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(record) + "\n");
    return true;
  } catch { return false; }
}

export function readJSONLRecords(path) {
  if (!existsSync(path)) return [];
  const text = safe(() => readFileSync(path, "utf8")) || "";
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const rec = safe(() => JSON.parse(line));
    if (rec) out.push(rec);
  }
  return out;
}

// Byte-accurate incremental JSONL reader: returns only new, FULLY-WRITTEN entries after
// `fromOffset`, plus the offset to persist for next time. The transcript file can be written
// asynchronously and may lag (documented Claude Code behavior) - a trailing line with no
// newline yet is left unconsumed (never parsed, never counted into the new offset), so it's
// picked up whole on the next call instead of being read as a truncated/corrupt line.
export function readNewJSONLEntries(path, fromOffset) {
  if (!existsSync(path)) return { entries: [], newOffset: fromOffset };
  const buf = safe(() => readFileSync(path));
  if (!buf || buf.length <= fromOffset) return { entries: [], newOffset: fromOffset };
  const text = buf.subarray(fromOffset).toString("utf8");
  const rawLines = text.split("\n");
  // Last element is either "" (text ended with \n - a real trailing newline) or a genuinely
  // partial line (no \n yet) - either way, not safe to consume this pass.
  const completeLines = rawLines.slice(0, -1);
  const consumedBytes = completeLines.reduce((n, l) => n + Buffer.byteLength(l, "utf8") + 1, 0);
  const entries = [];
  for (const line of completeLines) {
    const trimmed = line.replace(/\r$/, "");
    if (!trimmed) continue;
    const rec = safe(() => JSON.parse(trimmed));
    if (rec) entries.push(rec);
  }
  return { entries, newOffset: fromOffset + consumedBytes };
}

// Idempotently ensures `.claude/.gitignore` (inside the given project root) lists
// `relFileName`. No-op if the line is already present. In THIS repo specifically `.claude/` is
// already blanket-ignored at the root .gitignore, so this is a no-op here - it matters for
// other projects that commit `.claude/`.
export function ensureGitignored(root, relFileName) {
  const gi = join(root, ".claude", ".gitignore");
  const cur = existsSync(gi) ? (safe(() => readFileSync(gi, "utf8")) || "") : "";
  const lines = cur.split(/\r?\n/).map((l) => l.trim());
  if (lines.includes(relFileName)) return false;
  const next = cur.length && !cur.endsWith("\n") ? cur + "\n" + relFileName + "\n" : cur + relFileName + "\n";
  return writeFile(gi, next);
}
