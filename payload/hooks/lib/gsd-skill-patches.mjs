// Idempotent, best-effort effort re-tune patches for gsd-core-owned skills
// (~/.claude/skills/gsd-*/SKILL.md) — the skill-side sibling of gsd-agent-patches.mjs's two
// agent effort patches. Same review-gated model: applied only by an explicit /init-session (via
// apply-gsd-agent-patches.mjs, which also calls this), surfaced read-only every session by
// session-init.mjs. gsd-agent-patches.mjs only scans agents/gsd-*.md; skills live under a
// different directory, hence this separate small module (mirrors gsd-workflow-patches.mjs's
// reasoning for splitting out the workflow target).
//
// Unlike the agent/workflow modules these are NOT marker-wrapped prose blocks but frontmatter
// scalar re-tunes (Phase 5 §6.1: `effort: max` -> `effort: xhigh`), so idempotency and
// non-clobbering come from setFrontmatterField's value comparison, not version markers.
//   - checkGsdSkillPatches(claudeDir)  -> read-only. Returns { "<skill>/SKILL.md": [id, ...] }.
//   - applyGsdSkillPatches(claudeDir)  -> writes. Returns { applied, skippedForeign,
//                                         skippedCurated, skippedNoKey }.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { setFrontmatterField } from "./gsd-patch-frontmatter.mjs";

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
const MARKER_RE = /^<!--\s*CURATED:NOEDIT\s*-->$/;
const isCurated = (content) => content.split(/\r?\n/).some((l) => MARKER_RE.test(l.trim()));

// Opus 5 migration §6.1: these three skills ran at `max` (which overthinks on Opus 5); `xhigh`
// is the recommended start for coding/agentic work. `from` is a list so a future re-tune can add
// the prior target and still catch a machine sitting on the original `max`.
export const SKILL_PATCHES = [
  { id: "plan-phase-effort", skill: "gsd-plan-phase", key: "effort", from: ["max"], to: "xhigh" },
  { id: "execute-phase-effort", skill: "gsd-execute-phase", key: "effort", from: ["max"], to: "xhigh" },
  { id: "autonomous-effort", skill: "gsd-autonomous", key: "effort", from: ["max"], to: "xhigh" },
];

function skillFile(claudeDir, skill) { return join(claudeDir, "skills", skill, "SKILL.md"); }
const label = (patch) => `${patch.skill}/SKILL.md`;

/* ---------- read-only: what's pending, per skill file (never writes) ---------- */
export function checkGsdSkillPatches({ claudeDir }) {
  const pending = {}; // { "<skill>/SKILL.md": [patchId, ...] }
  for (const patch of SKILL_PATCHES) {
    const p = skillFile(claudeDir, patch.skill);
    if (!existsSync(p)) continue;
    const content = safe(() => readFileSync(p, "utf8"));
    if (content === undefined || isCurated(content)) continue;
    if (setFrontmatterField(content, patch).kind === "applied") {
      (pending[label(patch)] ||= []).push(patch.id);
    }
  }
  return pending; // {} means fully up to date (or nothing installed)
}

/* ---------- write: apply every pending patch (only called explicitly, see file header) ---------- */
export function applyGsdSkillPatches({ claudeDir }) {
  const result = { applied: [], skippedForeign: [], skippedCurated: [], skippedNoKey: [] };
  for (const patch of SKILL_PATCHES) {
    const p = skillFile(claudeDir, patch.skill);
    if (!existsSync(p)) continue;
    const content = safe(() => readFileSync(p, "utf8"));
    if (content === undefined) continue;
    if (isCurated(content)) { result.skippedCurated.push(label(patch)); continue; }
    const { content: updated, kind } = setFrontmatterField(content, patch);
    if (kind === "applied") {
      safe(() => writeFileSync(p, updated));
      result.applied.push(`${label(patch)}:${patch.id}`);
    } else if (kind === "skippedForeign") {
      result.skippedForeign.push(`${label(patch)}:${patch.id}`);
    } else if (kind === "noKey") {
      result.skippedNoKey.push(`${label(patch)}:${patch.id}`);
    }
    // kind === null -> already current, nothing to report
  }
  return result;
}
