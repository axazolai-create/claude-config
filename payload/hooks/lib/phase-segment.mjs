// Renders the ultrapowers work segment. Three modes, switched wholesale: in two of them the
// leading token is one phase's id, in the third it is a tally across all phases, and those are
// different kinds of thing in the same position.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const C = { green: "32", cyan: "36", yellow: "33", red: "31" };
const paint = (s, colour) => `\x1b[${colour}m${s}\x1b[0m`;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function renderPhaseSegment(state) {
  const s = state && typeof state === "object" && !Array.isArray(state) ? state : {};
  if (s.mode === "tally") {
    if (!s.name || !Number.isFinite(Number(s.phasesTotal))) return "";
    return `${paint(num(s.phasesDone), C.green)}/${num(s.phasesTotal)} ${s.name}`;
  }
  if (!s.id || !s.name) return "";
  const c = s.counts;
  const queued = c ? num(c.queued) : -1;
  // A negative queue means the fields contradict each other. Printing arithmetic that is
  // provably wrong is worse than printing none, so it degrades to the action mode.
  if (s.mode === "executing" && c && queued >= 0) {
    const fixing = num(c.fixing);
    const inWork = num(c.active) + fixing;
    const blocked = num(c.blocked);
    const cells = [
      paint(num(c.done), C.green),
      paint(inWork, fixing > 0 ? C.yellow : C.cyan),
      String(queued),
    ];
    if (blocked > 0) cells.push(paint(blocked, C.red));
    return `${s.id} ${cells.join("/")} — ${s.name}`;
  }
  if (!s.action) return `${s.id} ${s.name}`;
  return `${s.id} (${paint(s.action, s.status === "blocked" ? C.red : C.cyan)}) ${s.name}`;
}

const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
const read = (p) => safe(() => readFileSync(p, "utf8"), "") ?? "";

export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text ?? ""));
  return m ? m[1] : "";
}

// CR is a JS LineTerminator, so `(.+)$` under /m already stops before CRLF's \r.
export function fmField(fm, key) {
  const m = new RegExp(`^[ \t]*${key}[ \\t]*:[ \\t]*(.+)$`, "m").exec(fm);
  if (!m) return null;
  const v = m[1].trim().replace(/^["']|["']$/g, "");
  return v === "null" || v === "" ? null : v;
}

export function roadmapPhases(text) {
  return [...frontmatter(text).matchAll(/^\s*-\s*\{([^}]*)\}\s*$/gm)].map((m) => {
    const row = {};
    for (const pair of m[1].split(",")) {
      const i = pair.indexOf(":");
      if (i === -1) continue;
      row[pair.slice(0, i).trim()] = pair.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
    return row;
  });
}

// Structural, never prose: briefs give the total, reports give the done count, and a brief
// without its report is a task in flight. The ledger's wording can change freely.
function ledgerCounts(tree, id, slug) {
  const dir = join(tree, "sdd", `phases-${id}-${slug}`);
  if (!existsSync(dir)) return null;
  const names = safe(() => readdirSync(dir), []) ?? [];
  const briefs = new Set(), reports = new Set();
  for (const n of names) {
    const b = /^task-(\d+)-brief\.md$/.exec(n);
    if (b) briefs.add(Number(b[1]));
    const r = /^task-(\d+)-report\.md$/.exec(n);
    if (r) reports.add(Number(r[1]));
  }
  if (!briefs.size) return null;
  const done = [...briefs].filter((n) => reports.has(n)).length;
  return { total: briefs.size, done, unreported: briefs.size - done };
}

function tallyState(rows) {
  const live = rows.filter((r) => r.status !== "abandoned");
  if (!live.length) return null;
  const last = live.reduce((a, b) => (Number(b.phase) >= Number(a.phase) ? b : a));
  return {
    mode: "tally",
    name: last.slug || null,
    phasesDone: live.filter((r) => r.status === "complete").length,
    phasesTotal: live.length,
  };
}

export function readPhaseState(root) {
  const tree = join(root, ".ultrapowers");
  const roadmap = read(join(tree, "ROADMAP.md"));
  if (!roadmap) return null;
  const rows = roadmapPhases(roadmap);
  let id = fmField(frontmatter(roadmap), "current");
  if (!id) {
    const running = rows.filter((r) => r.status === "running");
    id = running.length === 1 ? running[0].phase : null;
  }
  const row = id ? rows.find((r) => r.phase === id) : null;
  const dirs = safe(() => readdirSync(join(tree, "phases")), []) ?? [];
  const dirName = id ? dirs.find((n) => n.startsWith(`${id}-`)) : null;
  if (!dirName) return tallyState(rows);

  const slug = dirName.slice(String(id).length + 1);
  const fm = frontmatter(read(join(tree, "phases", dirName, `${id}-STATE.md`)));
  const base = { id, name: (row && row.slug) || slug, status: fmField(fm, "status"),
    action: fmField(fm, "action") };
  const ledger = ledgerCounts(tree, id, slug);
  if (!ledger || !ledger.unreported) return { ...base, mode: "action" };

  const n = (key) => Number(fmField(fm, key)) || 0;
  const fixing = n("tasks_fixing"), blocked = n("tasks_blocked");
  const active = ledger.unreported - fixing - blocked;
  // `tasks_dropped` is deliberately NOT subtracted here. It belongs to a frontmatter tally,
  // where the denominator counts tasks that were planned; the ledger's total counts briefs that
  // were actually written, so a retired task is either already among the unreported briefs or
  // was never in the total at all. Subtracting it a second time drives the queue negative and
  // costs the segment its counters.
  const queued = ledger.total - ledger.done - active - fixing - blocked;
  return { ...base, mode: "executing", counts: { done: ledger.done, active, fixing, queued, blocked } };
}
