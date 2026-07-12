// Retention for the GLOBAL token-usage log only (~/.claude/state/token-usage.jsonl);
// per-project `.claude/token-usage.jsonl` is never pruned. Runs at most once per 24h
// (PRUNE_THROTTLE_MS below; disable with CLAUDE_TOKEN_USAGE_PRUNE=0). A record is KEPT if it
// matches ANY of: (1) within 3 calendar months of the log's own newest entry, (2) on the
// penultimate distinct UTC activity day, or (3) among the 10 most recent records. Full
// rationale + worked examples: docs/superpowers/specs/2026-07-08-token-usage-log-design.md §H.
import { existsSync } from "node:fs";
import { safe, writeFile, readJSON, readJSONLRecords } from "./token-usage-shared.mjs";

function calendarMonthsAgo(date, months) {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}
function dayKeyUTC(iso) {
  return iso.slice(0, 10); // ISO 8601 from toISOString() always starts "YYYY-MM-DD"
}

// Pure function, unit-testable in isolation: given all current records (including any brand-new
// one for this run), returns the subset to keep, preserving original file order. Records with an
// unparseable `date` are dropped (defensive - should never happen for records this hook writes).
export function computeKept(records) {
  const parsed = records.map((r) => ({ r, t: Date.parse(r && r.date) }));
  const valid = parsed.filter((x) => Number.isFinite(x.t));
  if (!valid.length) return [];

  const sortedDesc = [...valid].sort((a, b) => b.t - a.t);
  const lastDate = new Date(sortedDesc[0].t);
  const cutoff = calendarMonthsAgo(lastDate, 3).getTime();

  const distinctDaysDesc = [...new Set(sortedDesc.map((x) => dayKeyUTC(x.r.date)))];
  const penultimateDay = distinctDaysDesc[1]; // undefined when only one distinct day exists

  const countFloorSet = new Set(sortedDesc.slice(0, 10).map((x) => x.r));

  const keepSet = new Set(
    valid
      .filter((x) =>
        x.t >= cutoff ||
        (penultimateDay !== undefined && dayKeyUTC(x.r.date) === penultimateDay) ||
        countFloorSet.has(x.r))
      .map((x) => x.r)
  );
  return records.filter((r) => keepSet.has(r)); // preserve original append order
}

const PRUNE_THROTTLE_MS = 24 * 60 * 60 * 1000;

// Throttled driver: reads the global log, prunes if due, rewrites only if something changed.
// Returns true if a prune check actually ran this call (throttle passed), false if skipped.
export function pruneGlobalLogIfDue(globalLogPath, pruneStateFile) {
  if (process.env.CLAUDE_TOKEN_USAGE_PRUNE === "0") return false;
  const state = existsSync(pruneStateFile) ? (safe(() => readJSON(pruneStateFile)) || {}) : {};
  const last = state.lastRun ? Date.parse(state.lastRun) : 0;
  if (Number.isFinite(last) && Date.now() - last < PRUNE_THROTTLE_MS) return false;

  const records = readJSONLRecords(globalLogPath);
  if (records.length) {
    const kept = computeKept(records);
    if (kept.length !== records.length) {
      const body = kept.map((r) => JSON.stringify(r)).join("\n") + (kept.length ? "\n" : "");
      writeFile(globalLogPath, body);
    }
  }
  writeFile(pruneStateFile, JSON.stringify({ lastRun: new Date().toISOString() }, null, 2) + "\n");
  return true;
}
