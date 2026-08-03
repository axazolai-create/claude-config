#!/usr/bin/env node
// statusLine renderer for every profile - full, base, lite. Composes pending updates, model,
// context, project, and (when applicable) gsd and ultrapowers work status into one line, with no
// subprocess spawned. Any error yields empty output - the statusline never breaks the prompt.
import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { computeContext, contextMetrics } from "./lib/statusline-lib.mjs";
import { severityOf } from "./lib/context-severity.mjs";
import { resolveAutocompact, promotePending, autoCompactEnabledFrom } from "./lib/autocompact.mjs";
import { pendingNames } from "./lib/component-registry.mjs";
import { readPhaseState, renderPhaseSegment } from "./lib/phase-segment.mjs";

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
  if (!milestone) return "";
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

export function paintContext(text, opts) {
  const { colour, icon } = opts || {};
  if (!text) return "";
  const painted = colour ? `\x1b[${colour}m${text}\x1b[0m` : text;
  return icon ? `${icon} ${painted}` : painted;
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

// Phase resolution, the ledger and the three display modes all live in lib/phase-segment.mjs.
// This file keeps the wiring only.

function upState(root) {
  return renderPhaseSegment(readPhaseState(root));
}

function gsdActive(root) {
  return existsSync(join(CLAUDE_DIR, "gsd-core", "VERSION"))
    && existsSync(join(root, ".planning", "config.json"));
}

function contextSegment(data) {
  const text = safe(() => computeContext(data), "") || "";
  if (!text) return "";
  const m = safe(() => contextMetrics(data), null);
  if (!m) return text;
  const statePath = join(CLAUDE_DIR, "state", "autocompact.json");
  const modelId = (data.model && data.model.id) || "";
  let state = safe(() => JSON.parse(readFileSync(statePath, "utf8")), null) || {};
  const promoted = safe(() => promotePending(state, { modelId, windowSize: m.windowSize }), null);
  if (promoted && promoted.changed) {
    state = promoted.next;
    safe(() => writeFileSync(statePath, JSON.stringify(state, null, 2)));
  }
  const settings = safe(() => JSON.parse(readFileSync(join(CLAUDE_DIR, "settings.json"), "utf8")), null);
  const ac = safe(() => resolveAutocompact({ windowSize: m.windowSize, modelId, state,
    enabled: autoCompactEnabledFrom(settings) }), null);
  const windowPct = m.pct != null ? Number(m.pct) : (m.tokens / m.windowSize) * 100;
  // Only collapse onto windowPct when the source's point is the full window - "assumed" with no
  // CLAUDE_CODE_AUTO_COMPACT_WINDOW narrowing it, or "disabled" (which is always the full window).
  // A narrowed capacity must still diverge from windowPct, that divergence is the whole reason
  // the two ladders exist.
  const collapse = ac && (ac.source === "assumed" || ac.source === "disabled") && ac.tokens === m.windowSize;
  const acProgress = ac && !collapse && ac.tokens > 0 ? (m.tokens / ac.tokens) * 100 : windowPct;
  return safe(() => paintContext(text, severityOf({ windowPct, acProgress })), text) || text;
}

function main(raw) {
  const data = safe(() => JSON.parse(raw || "{}"), {}) || {};
  const ws = data.workspace || {};
  const root = resolve(ws.current_dir || ws.project_dir || process.cwd());
  const state = safe(() => JSON.parse(readFileSync(join(CLAUDE_DIR, "state", "component-updates.json"), "utf8")), null);
  process.stdout.write(render({
    updates: pendingNames(state),
    model: (data.model && data.model.display_name) || "",
    context: safe(() => contextSegment(data), "") || "",
    project: basename(root),
    gsd: gsdActive(root) ? (safe(() => gsdState(root)) || "") : "",
    up: installedProfile(CLAUDE_DIR) === "lite" ? "" : (safe(() => upState(root)) || ""),
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
  // the line we just wrote. Nothing else holds the loop open once stdin is released below, so
  // the process ends on its own.
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(guard);
    try { main(input); } catch { /* never break the prompt */ }
    process.exitCode = 0;
    // Rendering alone does not end the process: the `data` listener below keeps the readable
    // flowing, so stdin that never closes would hold the event loop open forever after the line
    // was already printed. Releasing the handle is what lets the loop drain.
    try { process.stdin.pause(); process.stdin.destroy(); } catch { /* already gone */ }
  };
  // A statusLine command whose stdin never closes would otherwise hang forever and leave the
  // prompt with no line at all; rendering what arrived beats rendering nothing.
  const guard = setTimeout(finish, Number(process.env.CLAUDE_STATUSLINE_STDIN_MS) || 1500);
  guard.unref();
  if (process.stdin.isTTY) finish();
  else {
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("error", finish);
    process.stdin.on("end", finish);
  }
}
