// Ensures ~/.claude/agents/gsd-*.md agents carry the context-mode MCP tool in their `tools:`
// frontmatter - but ONLY when the context-mode plugin is actually installed AND enabled, so a
// machine without it never gets the tool prescribed into agent files that would then reference a
// nonexistent MCP server. gsd-* agents are owned by the separate gsd-core tool (npx gsd-core), not
// by this bundle: this is best-effort cross-tool maintenance, the same pattern session-init.mjs
// already applies to graphify's CLAUDE.md section. Idempotent and self-healing: safe to re-run
// every session, including after gsd-core's own updater rewrites an agent file and drops the tool
// again.
// Consumed by: sync-gsd-context-mode-tool.mjs (CLI wrapper, spawned by setup.mjs and by
// init-stack.py via `node`), and imported directly by session-init.mjs (both already Node/ESM).
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export const MCP_TOOL = "mcp__plugin_context-mode_context-mode__*";
// Whole-line match, whitespace-lenient - keep in sync with deny-curated-claude-md.mjs / session-init.mjs.
const MARKER_RE = /^<!--\s*CURATED:NOEDIT\s*-->$/;
// Deliberately excluded: narrow, single-purpose agents (JSON classifier / read-only profiler)
// that don't do the kind of large-output research/analysis work context-mode targets - adding
// the tool would just be unused surface area, not a fix for a gap.
const EXCLUDED_AGENTS = new Set(["gsd-doc-classifier.md", "gsd-user-profiler.md"]);

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));

/* ---------- is context-mode installed AND enabled on this machine? ---------- */
export function isContextModeActive(claudeDir) {
  const installed = safe(() => readJSON(join(claudeDir, "plugins", "installed_plugins.json")));
  const settings = safe(() => readJSON(join(claudeDir, "settings.json")));
  if (!installed || !settings) return false;
  const plugins = installed.plugins && typeof installed.plugins === "object" ? installed.plugins : installed;
  const ep = settings.enabledPlugins && typeof settings.enabledPlugins === "object" ? settings.enabledPlugins : {};
  return Object.keys(plugins || {}).some((id) => id.split("@")[0] === "context-mode" && ep[id] === true);
}

const isCurated = (content) => content.split(/\r?\n/).some((l) => MARKER_RE.test(l.trim()));

/* ---------- add MCP_TOOL to a YAML frontmatter `tools:` field if missing ----------
 * Supports both formats seen in the wild: inline comma-separated (`tools: A, B, C`) and a
 * YAML list (`tools:\n  - A\n  - B`). Returns the updated content, or null when the tool is
 * already present, the frontmatter/tools field can't be found, or a list-form `tools:` has no
 * items to anchor an insertion after (nothing to safely append to). */
export function addContextModeToolIfMissing(content) {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  let start = -1, end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) { if (start === -1) start = i; else { end = i; break; } }
  }
  if (start === -1 || end === -1) return null;

  for (let i = start + 1; i < end; i++) {
    const m = lines[i].match(/^tools:\s*(.*)$/);
    if (!m) continue;
    const inline = m[1].trim();
    if (inline) {
      const items = inline.split(",").map((s) => s.trim()).filter(Boolean);
      if (items.includes(MCP_TOOL)) return null;
      lines[i] = `tools: ${[...items, MCP_TOOL].join(", ")}`;
      return lines.join(eol);
    }
    let j = i + 1;
    const itemLines = [];
    while (j < end && /^\s*-\s+\S/.test(lines[j])) { itemLines.push(j); j++; }
    if (!itemLines.length) return null;
    const already = itemLines.some((idx) => lines[idx].replace(/^\s*-\s+/, "").trim() === MCP_TOOL);
    if (already) return null;
    const indent = (lines[itemLines[0]].match(/^(\s*)-\s+/) || [, "  "])[1];
    lines.splice(itemLines[itemLines.length - 1] + 1, 0, `${indent}- ${MCP_TOOL}`);
    return lines.join(eol);
  }
  return null;
}

/* ---------- main entry: scan + patch every gsd-*.md agent under claudeDir/agents ---------- */
export function syncGsdAgentsContextMode({ claudeDir }) {
  const result = { active: false, updated: [], skipped: [] };
  if (!isContextModeActive(claudeDir)) return result;
  result.active = true;

  const agentsDir = join(claudeDir, "agents");
  if (!existsSync(agentsDir)) return result;
  const files = safe(() => readdirSync(agentsDir)) || [];
  for (const name of files) {
    if (!name.startsWith("gsd-") || !name.endsWith(".md")) continue;
    if (EXCLUDED_AGENTS.has(name)) continue;
    const p = join(agentsDir, name);
    const content = safe(() => readFileSync(p, "utf8"));
    if (content === undefined) continue;
    if (isCurated(content)) { result.skipped.push(name); continue; }
    const updated = addContextModeToolIfMissing(content);
    if (updated === null) continue; // already present, or frontmatter not recognized - no-op
    if (safe(() => { writeFileSync(p, updated); return true; })) result.updated.push(name);
  }
  return result;
}
