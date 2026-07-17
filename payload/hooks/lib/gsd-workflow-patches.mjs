// Idempotent, best-effort content patch for gsd-core/workflows/execute-phase.md — same
// review-gated, versioned-marker pattern as gsd-agent-patches.mjs (that file patches
// ~/.claude/agents/gsd-*.md; this one patches the orchestrator's own dispatch template, which
// lives in a different directory and isn't an agent file, hence a separate small module rather
// than folding into gsd-agent-patches.mjs's agents-only scope).
//   - checkGsdWorkflowPatches(claudeDir)  -> read-only. Surfaced every session by session-init.mjs.
//   - applyGsdWorkflowPatches(claudeDir)  -> actually patches. Called only by an explicit human
//                                            invocation - payload/apply-gsd-agent-patches.mjs
//                                            also calls this, so /init-stack step 10 applies both
//                                            in one command - never automatically/per-session.
// Same "content-aware, not presence-aware" versioned-marker scheme as gsd-agent-patches.mjs:
// `<!-- gsd-patch:ID vN -->...<!-- /gsd-patch:ID -->`. See that file's header comment for the
// full rationale; duplicated here in miniature (single target file, single patch) rather than
// generalizing that module's `agents`-directory-specific file listing to cover an arbitrary path.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
const MARKER_RE = /^<!--\s*CURATED:NOEDIT\s*-->$/;
const isCurated = (content) => content.split(/\r?\n/).some((l) => MARKER_RE.test(l.trim()));

function markerOpen(id, version) { return `<!-- gsd-patch:${id} v${version} -->`; }
function markerClose(id) { return `<!-- /gsd-patch:${id} -->`; }
function wrapBlock(id, version, block) { return `${markerOpen(id, version)}\n${block}\n${markerClose(id)}`; }
function findMarkedSpan(content, id) {
  const re = new RegExp(`<!-- gsd-patch:${id} v(\\d+) -->[\\s\\S]*?<!-- /gsd-patch:${id} -->`);
  const m = content.match(re);
  return m ? { version: Number(m[1]), fullMatch: m[0] } : null;
}

const TARGET_REL = ["gsd-core", "workflows", "execute-phase.md"];
const PATCH_ID = "execute-phase-decompose-dispatch";
const PATCH_VERSION = 1;

// Anchor: the literal opening of the per-plan Agent() dispatch template (step 3). Verified
// against the installed gsd-core@1.7.0-era execute-phase.md at the time this was written -
// if a future gsd-core release reformats this block, this patch degrades to "no anchor found"
// (skipped, never a partial/corrupt write) rather than silently misplacing the insertion.
const ANCHOR = `   \`\`\`text
   Agent(
     subagent_type="gsd-executor",`;

const DISPATCH_SELECTION_BLOCK = `**Decompose-aware dispatch selection (before the Agent() call below):** check whether ANY
task in this plan's file has \`verify_isolated="true"\` in its \`<task>\` attributes:
\`\`\`bash
grep -q 'verify_isolated="true"' "{plan_file_path}" && echo "decomposing" || echo "standard"
\`\`\`
If it does, use \`subagent_type="gsd-executor-decomposing"\` in the Agent() call below instead of
\`"gsd-executor"\` - identical prompt template, worktree handling, and isolation otherwise.
\`gsd-executor\` remains the default for every plan with no such task.`;

/* ---------- read-only: is the patch pending for execute-phase.md? (never writes) ---------- */
export function checkGsdWorkflowPatches({ claudeDir }) {
  const p = join(claudeDir, ...TARGET_REL);
  if (!existsSync(p)) return {};
  const content = safe(() => readFileSync(p, "utf8"));
  if (content === undefined || isCurated(content)) return {};
  const marked = findMarkedSpan(content, PATCH_ID);
  const current = !!marked && marked.version === PATCH_VERSION;
  return current ? {} : { "execute-phase.md": [PATCH_ID] };
}

/* ---------- write: apply the pending patch, if any (only called explicitly) ---------- */
export function applyGsdWorkflowPatches({ claudeDir }) {
  const result = { applied: [], upgraded: [], skippedCurated: [], skippedNoAnchor: [] };
  const p = join(claudeDir, ...TARGET_REL);
  if (!existsSync(p)) return result;
  let content = safe(() => readFileSync(p, "utf8"));
  if (content === undefined) return result;
  if (isCurated(content)) { result.skippedCurated.push("execute-phase.md"); return result; }

  const marked = findMarkedSpan(content, PATCH_ID);
  if (marked && marked.version === PATCH_VERSION) return result; // already current

  if (marked) {
    content = content.replace(marked.fullMatch, wrapBlock(PATCH_ID, PATCH_VERSION, DISPATCH_SELECTION_BLOCK));
    result.upgraded.push(`execute-phase.md:${PATCH_ID}`);
  } else {
    if (!content.includes(ANCHOR)) {
      result.skippedNoAnchor.push(`execute-phase.md:${PATCH_ID}`);
      return result;
    }
    content = content.replace(ANCHOR, `${wrapBlock(PATCH_ID, PATCH_VERSION, DISPATCH_SELECTION_BLOCK)}\n\n${ANCHOR}`);
    result.applied.push(`execute-phase.md:${PATCH_ID}`);
  }
  writeFileSync(p, content);
  return result;
}
