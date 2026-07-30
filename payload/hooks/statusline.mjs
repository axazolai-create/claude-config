#!/usr/bin/env node
// statusLine renderer for the base and lite profiles. full keeps gsd-context-meter.mjs, which
// wraps gsd-core's own gsd-statusline.js and rewrites one segment; without gsd-core there is
// nothing to wrap, so this renders the whole line itself. Any error yields empty output - the
// statusline never breaks the prompt.
import { readFileSync, existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { computeContext } from "./lib/statusline-lib.mjs";
import { pendingNames } from "./lib/component-registry.mjs";

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;
const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

export function renderUpdates(names) {
  if (!Array.isArray(names) || !names.length) return "";
  const shown = names.slice(0, 2);
  const rest = names.length - shown.length;
  return YELLOW(`⬆ ${shown.join(" ")}${rest > 0 ? ` +${rest}` : ""}`);
}

export function renderGsd({ milestone, phase, status, percent } = {}) {
  const n = Number(percent);
  const pct = percent == null || percent === "" || Number.isNaN(n) ? null : Math.max(0, Math.min(100, n));
  // Three cells are too coarse for a linear map: a full bar is reserved for an actually
  // complete milestone and an empty bar for one with no progress, so neither can be misread.
  const filled = pct == null || pct <= 0 ? 0 : pct >= 100 ? 3 : Math.min(2, Math.ceil((pct / 100) * 3));
  const bar = pct == null ? "" : `[${"█".repeat(filled)}${"░".repeat(3 - filled)}] ${pct}%`;
  const head = [milestone, bar].filter(Boolean).join(" ");
  const tail = phase ? ["Phase", phase, status].filter(Boolean).join(" ") : "";
  return [head, tail].filter(Boolean).join(" · ");
}

export function renderSdd({ plan, complete, next } = {}) {
  return `${plan} ✔${complete} →${next}`;
}

export function installedProfile(claudeDir) {
  const m = safe(() => JSON.parse(readFileSync(join(claudeDir, "state", "bundle-manifest.json"), "utf8")));
  return (m && (m.profile || m.variant)) || null;
}

export function render({ updates, model, context, project, gsd, up } = {}) {
  return [renderUpdates(updates), model, context, project, gsd, up]
    .filter(Boolean)
    .join(DIM(" │ "));
}

// Frontmatter or bold-markdown scalar, e.g. `milestone: v1.0` / `**Status**: executing`.
// Indent-tolerant so the nested `progress:` block's keys resolve too.
function field(text, key) {
  const m = new RegExp(`^[ \\t]*(?:\\*\\*)?${key}(?:\\*\\*)?[ \\t]*:[ \\t]*(\\S+)`, "im").exec(text);
  return m && m[1] !== "null" ? m[1] : null;
}

function gsdPercent(text) {
  const explicit = field(text, "percent");
  if (explicit && /^\d{1,3}$/.test(explicit)) return Number(explicit);
  const done = Number(field(text, "completed_phases"));
  const total = Number(field(text, "total_phases"));
  if (Number.isFinite(done) && total > 0) return Math.round((done / total) * 100);
  const loose = /(\d{1,3})\s*%/.exec(text);
  return loose ? Number(loose[1]) : null;
}

function gsdState(root) {
  if (!existsSync(join(root, ".planning", "config.json"))) return null;
  const text = safe(() => readFileSync(join(root, ".planning", "STATE.md"), "utf8"), "") ?? "";
  const milestone = field(text, "milestone") || field(text, "version");
  // gsd-core writes active_phase while an orchestrator is in flight and current_phase otherwise;
  // a hand-kept STATE.md may just say phase.
  const phase = field(text, "active_phase") || field(text, "current_phase") || field(text, "phase");
  // A .planning/ this parser cannot read is not an error - the gsd segment just stays absent,
  // and the project segment renders regardless. Guessing a phase would not be.
  if (!milestone || !phase) return null;
  return renderGsd({ milestone, phase, status: field(text, "status") || "", percent: gsdPercent(text) });
}

function sddState(root) {
  const base = join(root, ".ultrapowers", "sdd");
  if (!existsSync(base)) return null;
  const found = (safe(() => readdirSync(base), []) ?? [])
    .map((name) => ({ name, ledger: join(base, name, "progress.md") }))
    .filter((c) => existsSync(c.ledger))
    .map((c) => ({ ...c, at: safe(() => statSync(c.ledger).mtimeMs, 0) ?? 0 }));
  if (!found.length) return null;
  // The ledger written most recently is the plan in flight. The directory name only breaks
  // ties: it is date-prefixed, so every plan started on one day sorts identically. Code-unit
  // comparison, deliberately not locale-sensitive.
  found.sort((a, b) => b.at - a.at || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  const { name, ledger } = found[0];
  const text = safe(() => readFileSync(ledger, "utf8"), "") ?? "";
  const plan = (/^#\s*SDD ledger\s*[—-]\s*plan:\s*(.+)$/m.exec(text) || [])[1];
  const done = new Set([...text.matchAll(/^Task (\d+): complete/gm)].map((m) => Number(m[1])));
  let next = 1;
  while (done.has(next)) next += 1;
  return renderSdd({ plan: plan ? basename(plan.trim(), ".md") : name, complete: done.size, next });
}

function main(raw) {
  const data = safe(() => JSON.parse(raw || "{}"), {}) || {};
  const ws = data.workspace || {};
  const root = resolve(ws.current_dir || ws.project_dir || process.cwd());
  const state = safe(() => JSON.parse(readFileSync(join(CLAUDE_DIR, "state", "component-updates.json"), "utf8")), null);
  process.stdout.write(render({
    updates: pendingNames(state),
    model: (data.model && data.model.display_name) || "",
    context: safe(() => computeContext(data), "") || "",
    project: basename(root),
    gsd: safe(() => gsdState(root)) || "",
    up: installedProfile(CLAUDE_DIR) === "lite" ? "" : (safe(() => sddState(root)) || ""),
  }));
}

function isMainModule() {
  const a = process.argv[1];
  if (!a) return false;
  if (import.meta.url === pathToFileURL(a).href) return true;
  try { return import.meta.url === pathToFileURL(realpathSync(a)).href; } catch { return false; }
}

if (isMainModule()) {
  process.stdout.on("error", () => {});
  let input = "";
  let done = false;
  // No process.exit(): on Windows a pipe write is async, and exiting on the spot can truncate
  // the line we just wrote. Nothing else holds the loop open, so the process ends on its own.
  const finish = () => {
    if (done) return;
    done = true;
    try { main(input); } catch { /* never break the prompt */ }
    process.exitCode = 0;
  };
  if (process.stdin.isTTY) finish();
  else {
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("error", finish);
    process.stdin.on("end", finish);
  }
}
