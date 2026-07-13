// Idempotent, best-effort content patches for specific ~/.claude/agents/gsd-*.md files.
// Same "gsd-* agents are owned by the separate gsd-core tool, not this bundle" caveat as
// context-mode-gsd-agents.mjs (best-effort cross-tool maintenance) - but REVIEW-GATED rather
// than silently self-healing: these patches inject prose across 30+ files, not a one-line
// frontmatter grant, so a human reviews what's about to land before it's applied instead of
// it rewriting silently every session.
//   - checkGsdAgentPatches(claudeDir)  -> read-only. Called every session by session-init.mjs
//                                          to surface a "run /init-session" note when
//                                          something is pending. Never writes.
//   - applyGsdAgentPatches(claudeDir)  -> actually patches. Called only by
//                                          payload/commands/init-session.md (via
//                                          apply-gsd-agent-patches.mjs), never automatically.
// Each patch is scoped to the file(s) it targets via `appliesTo` - most gsd-* agents get only
// the context-mode routing block; gsd-executor.md/gsd-debugger.md get a couple of bespoke
// additions on top of that, justified per-patch in its own comment below. `detect` makes every
// patch idempotent (already-applied is a no-op) and self-healing (re-applies if a gsd-core
// update overwrites the file and drops it). `apply` returns null (skip, never throws) if its
// anchor text isn't found - a prerequisite for that patch not being met, or an upstream
// gsd-core rewrite having changed the surrounding text - so one missing anchor never blocks
// the other patches in the same run.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isContextModeActive, EXCLUDED_AGENTS } from "./context-mode-gsd-agents.mjs";

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
const MARKER_RE = /^<!--\s*CURATED:NOEDIT\s*-->$/;
const isCurated = (content) => content.split(/\r?\n/).some((l) => MARKER_RE.test(l.trim()));

function insertAfter(content, anchor, block) {
  if (!content.includes(anchor)) return null;
  return content.replace(anchor, `${anchor}\n\n${block}`);
}
function insertBefore(content, anchor, block) {
  if (!content.includes(anchor)) return null;
  return content.replace(anchor, `${block}\n\n${anchor}`);
}

/* ---------- block bodies ---------- */

const CONTEXT_MODE_ROUTING_BLOCK = `<context_mode_routing>
Route exploratory / data-derivation Bash and Read calls (JSON parsing, path/config lookups,
file summarization) through \`ctx_batch_execute\` / \`ctx_execute\` / \`ctx_execute_file\` instead
of raw \`Bash\`/\`Read\` when the result would otherwise dump large or intermediate output into
context.

Do NOT reroute \`gsd_run()\` / \`gsd-tools.cjs\` calls (gate checks, commit validation, drift
precheck, worktree checks) through the sandbox — GSD drives its own control flow off their
literal exit codes/stdout, and the sandbox would strip that signal.
</context_mode_routing>`;

const FILESYSTEM_SEARCH_DISCIPLINE_BLOCK = `<filesystem_search_discipline>
**Never run \`find /\`, \`find ~\`, \`find $HOME\`, or any \`find\` with no starting path (defaults
to cwd but chained into a broad tree) or a drive/root path.** These sweep the entire
filesystem, run for tens of minutes, and get auto-backgrounded by the Bash tool — see
\`<background_task_hygiene>\` for why an abandoned one is worse than the wasted time.

For file search, use the \`Glob\` tool (safely scoped, fast) or \`grep -r <pattern>
<known-dir>\` against a specific directory you already have reason to believe holds the
answer. If you don't know where something lives, check the table below before searching
blindly — most gsd-core paths are one of these:

| What | Path |
|---|---|
| CLI / tools shim | \`$GSD_HOME/gsd-core/bin/\` (resolved by \`load_project_state\`'s \`GSD_TOOLS\` discovery) |
| Workflow docs | \`$GSD_HOME/gsd-core/workflows/\` |
| Reference docs (this file's \`@\`-includes) | \`$GSD_HOME/gsd-core/references/\` |
| Templates | \`$GSD_HOME/gsd-core/templates/\` |

If a doc pointer elsewhere in this file (or in \`gsd-tools\` output) names a path outside
this table — e.g. anything under \`sdk/src/...\` — treat it as upstream-source-only. That
tree ships in the \`open-gsd/gsd-core\` git repo, not in your local install; don't search
the local filesystem for it, and don't assume its absence means something is broken.
</filesystem_search_discipline>`;

const BACKGROUND_TASK_HYGIENE_BLOCK = `<background_task_hygiene>
The Bash tool auto-backgrounds a call that runs long (e.g. an unrooted \`find\`, a hanging
server, a slow build) instead of blocking indefinitely. If you decide not to wait for or
use that call's result — you found the answer another way, or you abandoned that
approach — call \`TaskStop\` on it **immediately, before moving to the next step.** Do not
just move on and leave it running: an abandoned background process can wake up and emit a
delayed notification long after you've finished the plan, with no user around to act on
it.

Rule of thumb: every backgrounded Bash call you don't explicitly wait on and use gets
either consumed or stopped before you continue. Never both-neither.
</background_task_hygiene>`;

const EXECUTOR_STABILITY_RERUN_BLOCK = `**STABILITY-CONFIRMATION RERUN LIMIT:**
This is a separate cap from the one above — it bounds *reconfirming a step that already
passed*, not fixing one that failed. Once a verification/e2e/test step has passed
cleanly:
- Standard steps: do not re-run it again "to be sure." One clean pass is the result.
- Steps the plan's \`<threat_model>\` marks safety-critical, or whose success criteria call
  out flakiness/concurrency risk explicitly: at most one extra confirmation rerun (2 total
  runs) is allowed *if the reason is stated inline* (e.g. "rerunning: race-condition fix,
  single pass isn't sufficient evidence"). Never more than 2 total without a checkpoint.
- Re-running a green test with no new signal to act on is not verification — it's
  inertia. Document any extra confirmation run and its reason in SUMMARY.md next to the
  task it covers.`;

const DEBUGGER_STABILITY_RERUN_BLOCK = `**STABILITY-CONFIRMATION RERUN LIMIT:** The repeated runs above are an investigation technique for surfacing intermittent bugs — the repetition itself is the evidence. Once a stability/regression batch has produced a clean result (e.g., N/N passing, recorded in Evidence), stop. Do not launch another full batch of the same run "to be extra sure" with no new hypothesis or code change since the last batch. One additional batch is acceptable only if the original run count was thin (<20) or the bug is timing/concurrency-sensitive enough that the reasoning_checkpoint's \`blind_spots\` field names a specific reason more evidence is needed — document that reason in Evidence. Beyond that, a green stability run repeated again is not verification, it's inertia.`;

const EXECUTOR_QUERY_HANDLERS_OLD =
  "After SUMMARY.md, update STATE.md using `gsd-tools query` state handlers (positional args; see `sdk/src/query/QUERY-HANDLERS.md`):";
const EXECUTOR_QUERY_HANDLERS_NEW =
`After SUMMARY.md, update STATE.md using \`gsd-tools query\` state handlers (positional args).
The full handler catalog with calling conventions lives in \`sdk/src/query/QUERY-HANDLERS.md\`
in the \`open-gsd/gsd-core\` **upstream source repo** — that path is not shipped in your local
install (see \`<filesystem_search_discipline>\`), so don't search for it locally. The commands
below cover every handler this step needs:`;

/* ---------- patch registry ----------
 * appliesTo(name, claudeDir): whether this patch targets a given agent filename.
 * detect(content):            true = already applied (no-op).
 * apply(content):              returns patched content, or null if the anchor wasn't found
 *                               (skip safely - never throws, never corrupts the file). */
export const PATCHES = [
  {
    id: "context-mode-routing-block",
    // Same file set + same exclusion reasoning as context-mode-gsd-agents.mjs's tool grant
    // (EXCLUDED_AGENTS there: narrow single-purpose agents that don't do large-output
    // research/analysis work) - the routing prose is meaningless without the tool grant, and
    // the tool grant is unused surface area without the routing prose, so both patches share
    // one predicate on purpose. EXCLUDED_AGENTS stays defined in that file as the single
    // source of truth; this just imports it.
    appliesTo: (name, claudeDir) => name.startsWith("gsd-") && name.endsWith(".md")
      && !EXCLUDED_AGENTS.has(name) && isContextModeActive(claudeDir),
    detect: (content) => content.includes("<context_mode_routing>"),
    apply: (content) => insertAfter(content, "</role>", CONTEXT_MODE_ROUTING_BLOCK),
  },
  {
    id: "executor-query-handlers-ref-fix",
    // sdk/src/query/QUERY-HANDLERS.md ships in the open-gsd/gsd-core UPSTREAM SOURCE repo,
    // not in the installed package (verified absent from every local gsd-core install and
    // from this repo, 2026-07-13 - see docs/superpowers/specs/... forensics writeup). The
    // bare pointer reads as a local path and has caused an agent to `find /` hunting for it,
    // auto-backgrounding two unbounded whole-disk searches it then forgot to stop.
    appliesTo: (name) => name === "gsd-executor.md",
    detect: (content) => content.includes(EXECUTOR_QUERY_HANDLERS_NEW.split("\n")[0]),
    apply: (content) => content.includes(EXECUTOR_QUERY_HANDLERS_OLD)
      ? content.replace(EXECUTOR_QUERY_HANDLERS_OLD, EXECUTOR_QUERY_HANDLERS_NEW)
      : null,
  },
  {
    id: "executor-filesystem-search-discipline",
    // detect() checks a phrase from the block BODY, not the bare `<filesystem_search_discipline>`
    // tag - the query-handlers-ref-fix patch's text references that tag by name as a forward
    // pointer, which would false-positive a substring match on the tag alone before this
    // patch has actually run.
    appliesTo: (name) => name === "gsd-executor.md",
    detect: (content) => content.includes("Never run `find /`, `find ~`"),
    apply: (content) => insertAfter(content, "</documentation_lookup>", FILESYSTEM_SEARCH_DISCIPLINE_BLOCK),
  },
  {
    id: "executor-background-task-hygiene",
    // Same reasoning as above: filesystem-search-discipline's block body references
    // `<background_task_hygiene>` by name, so detect() here can't match on that bare tag.
    appliesTo: (name) => name === "gsd-executor.md",
    detect: (content) => content.includes("either consumed or stopped before you continue"),
    apply: (content) => insertBefore(content, "<authentication_gates>", BACKGROUND_TASK_HYGIENE_BLOCK),
  },
  {
    id: "executor-stability-rerun-limit",
    appliesTo: (name) => name === "gsd-executor.md",
    detect: (content) => content.includes("STABILITY-CONFIRMATION RERUN LIMIT"),
    apply: (content) => insertBefore(content, "**Extended examples and edge case guide:**", EXECUTOR_STABILITY_RERUN_BLOCK),
  },
  {
    id: "debugger-stability-rerun-limit",
    // Only gsd-debugger.md, not the other candidates surveyed alongside it - gsd-verifier.md
    // (already caps its own test run at "at most once"), gsd-integration-checker.md,
    // gsd-code-reviewer.md, gsd-eval-auditor.md (no rerun-prone loop structure at all), and
    // gsd-ui-checker.md/gsd-nyquist-auditor.md (already explicitly bounded) don't have this
    // gap - see the survey findings this patch is drawn from.
    appliesTo: (name) => name === "gsd-debugger.md",
    detect: (content) => content.includes("STABILITY-CONFIRMATION RERUN LIMIT"),
    apply: (content) => insertAfter(content, "// Run this 1000 times\n```", DEBUGGER_STABILITY_RERUN_BLOCK),
  },
];

/* ---------- shared file listing ---------- */
function listAgentFiles(claudeDir) {
  const agentsDir = join(claudeDir, "agents");
  if (!existsSync(agentsDir)) return [];
  return (safe(() => readdirSync(agentsDir)) || []).filter((n) => n.endsWith(".md"));
}

/* ---------- read-only: what's pending, per file (never writes) ---------- */
export function checkGsdAgentPatches({ claudeDir }) {
  const pending = {}; // { filename: [patchId, ...] }
  for (const name of listAgentFiles(claudeDir)) {
    const applicable = PATCHES.filter((p) => p.appliesTo(name, claudeDir));
    if (!applicable.length) continue;
    const content = safe(() => readFileSync(join(claudeDir, "agents", name), "utf8"));
    if (content === undefined || isCurated(content)) continue;
    const missing = applicable.filter((patch) => !patch.detect(content)).map((patch) => patch.id);
    if (missing.length) pending[name] = missing;
  }
  return pending; // {} means fully up to date
}

/* ---------- write: apply every pending patch (only called explicitly, see file header) ---------- */
export function applyGsdAgentPatches({ claudeDir }) {
  const result = { applied: [], skippedCurated: [], skippedNoAnchor: [] };
  for (const name of listAgentFiles(claudeDir)) {
    const applicable = PATCHES.filter((p) => p.appliesTo(name, claudeDir));
    if (!applicable.length) continue;
    const p = join(claudeDir, "agents", name);
    let content = safe(() => readFileSync(p, "utf8"));
    if (content === undefined) continue;
    if (isCurated(content)) { result.skippedCurated.push(name); continue; }
    let changed = false;
    for (const patch of applicable) {
      if (patch.detect(content)) continue; // already applied
      const updated = patch.apply(content);
      if (updated === null) { result.skippedNoAnchor.push(`${name}:${patch.id}`); continue; }
      content = updated;
      changed = true;
      result.applied.push(`${name}:${patch.id}`);
    }
    if (changed) safe(() => writeFileSync(p, content));
  }
  return result;
}
