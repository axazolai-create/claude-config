// Idempotent, best-effort content patches for specific ~/.claude/agents/gsd-*.md files.
// Same "gsd-* agents are owned by the separate gsd-core tool, not this bundle" caveat as
// context-mode-gsd-agents.mjs (best-effort cross-tool maintenance) - but REVIEW-GATED rather
// than silently self-healing: these patches inject prose across 30+ files, not a one-line
// frontmatter grant, so a human reviews what's about to land before it's applied instead of
// it rewriting silently every session.
//   - checkGsdAgentPatches(claudeDir)  -> read-only. Called every session by session-init.mjs
//                                          to surface a "run /init-stack or /init-session" note
//                                          when something is pending. Never writes.
//   - applyGsdAgentPatches(claudeDir)  -> actually patches. Called only by an explicit human
//                                          invocation - payload/commands/init-stack.md (step 9)
//                                          or the standalone payload/commands/init-session.md
//                                          (via apply-gsd-agent-patches.mjs), never
//                                          automatically/per-session.
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

const EXECUTOR_DEPENDENCY_PROVISIONING_BLOCK = `<dependency_provisioning_order>
If running inside a worktree (\`.git\` is a file — see \`<worktree_metadata_capture>\`), do NOT
run \`pnpm install\`/\`npm install\`/\`yarn install\` (or anything triggering a fresh dependency
resolution) as your first move when a build or test step needs \`node_modules\`. First check
whether the orchestrator already provisioned it from the base checkout — a worktree created
for this task should already have \`node_modules\` and any built cross-package output (e.g.
\`packages/*/dist\`) copied in via \`robocopy <src> <dst> /MIR\` before you were spawned. Only
install for packages genuinely new or changed relative to that copied base, and only after
confirming the copy didn't already cover them (\`ls node_modules/<pkg>\` / check
\`package.json\`'s lockfile hash against the base). Every worktree in a wave independently
reinstalling/rebuilding an unchanged shared dependency — instead of relying on what the
orchestrator already provisioned — is a common root cause of a wave taking hours instead of
minutes, and on Windows can outright fail with \`EPERM ... rename ..._tmp_N\` when two
worktrees resolve the same package against the shared pnpm store concurrently.
</dependency_provisioning_order>`;

const EXECUTOR_TEST_EXECUTION_DISCIPLINE_BLOCK = `<test_execution_discipline>
Scope every test invocation to this plan's own \`files_modified\` — the test runner's own
filter flag (\`--testPathPattern\`, \`--related\`, \`-k\`/\`-m\` marker selection) or, in a
Turborepo/pnpm-workspace monorepo, \`turbo test --filter=...[<base-ref>]\` /
\`pnpm --filter <affected-pkg> test\` — never the full suite as a matter of course. A worker
that finishes a small, scoped change but then runs the entire test suite has been observed
costing tens of minutes per worker, multiplied across every parallel worktree in a wave;
defer a full-suite run to end-of-phase verification or the CI gate, not to your own plan's
verification step.

When a full suite genuinely must run here (no narrower scope applies), chunk it into batches
of ~10 files/specs and run batches sequentially rather than the whole suite at once — this
narrows a hang to the specific batch instead of the whole run.
</test_execution_discipline>`;

const EXECUTOR_INCREMENTAL_PROGRESS_BLOCK = `**5b. Incremental progress signal:** The commit you just made in step 5 IS the incremental
progress artifact the orchestrator's liveness monitoring relies on — never batch multiple
tasks' commits together or defer committing until the end of the plan to "save time." Each
task's commit, made as soon as that task's verification passes, is what lets the orchestrator
distinguish "still working" from "stalled" without guessing.`;

const EXECUTOR_NO_RECURSIVE_AGENT_SPAWN_BLOCK = `<no_recursive_agent_spawn>
You do not have the \`Agent\` tool (see your \`tools:\` frontmatter) — this is intentional, not
an oversight, and must not be worked around (e.g. by shelling out to a CLI that itself
dispatches Claude Code agents). Recursive/nested sub-agent spawning from a worker like you is
an active, unresolved source of uncontrolled exponential fan-out and token burn in current
Claude Code releases — the orchestrator, not you, owns deciding how work gets parallelized.
If a task seems to genuinely need further decomposition into parallel sub-work, that is an
architectural question — return a Rule 4 checkpoint instead of attempting it yourself.
</no_recursive_agent_spawn>`;

const EXECUTOR_CONTEXT_MODE_READ_DISCIPLINE_BLOCK = `<context_mode_read_discipline>
context-mode's own large-file nudge on \`Read\` fires **at most once per session** and never
blocks — after the first large file you read, every subsequent large \`Read\` gets zero
further reminder, silently. Don't rely on that one-time nudge as your ongoing signal: before
every \`Read\` on a file you expect to be large, ask whether you need the file's exact bytes
because you're about to \`Edit\` it, or whether you're reading it purely to understand/analyze
it. For the latter, use \`ctx_execute_file\` instead — every time, not just when reminded.
</context_mode_read_discipline>`;

/* ---------- patch registry ----------
 * appliesTo(name, claudeDir): whether this patch targets a given agent filename.
 * detect(content):            true = already applied (no-op).
 * apply(content):              returns patched content, or null if the anchor wasn't found
 *                               (skip safely - never throws, never corrupts the file). */
// The three `</role>`-anchored entries below (context-mode-routing-block,
// executor-no-recursive-agent-spawn, executor-context-mode-read-discipline) are grouped and
// ordered deliberately. `insertAfter` does `content.replace(anchor, anchor + block)`, and a
// plain-string `.replace` always matches the FIRST (only) occurrence of `</role>` - which never
// moves - so each later patch's block lands immediately after the tag, ahead of blocks already
// inserted by earlier ones. Net effect: for patches sharing one insertAfter anchor, the final
// top-to-bottom reading order is the REVERSE of application order. These three are listed here
// in reverse of their intended reading order (routing block first, no-recursive-spawn second,
// context-mode-read-discipline third) specifically so applying them in THIS array order produces
// that reading order. If you add a fourth patch anchored at `</role>`, place it in this run at
// the position matching where you want it to read, remembering the reversal - don't just append
// it at the end, that puts it first.
// Caveat: this only governs FRESH application. A file that already has all three applied is
// left untouched (each patch's own `detect()` short-circuits it) - reordering here does not
// retroactively reorder blocks already written to an existing gsd-executor.md.
export const PATCHES = [
  {
    id: "executor-context-mode-read-discipline",
    // context-mode's own Read nudge (hooks/core/routing.mjs upstream) fires at most once per
    // session and never blocks - observed: a worker read a large file directly instead of
    // ctx_execute_file after that one-shot budget was already spent earlier in the session.
    // Same gate as context-mode-routing-block (meaningless without the tool grant).
    appliesTo: (name, claudeDir) => name === "gsd-executor.md" && isContextModeActive(claudeDir),
    detect: (content) => content.includes("<context_mode_read_discipline>"),
    apply: (content) => insertAfter(content, "</role>", EXECUTOR_CONTEXT_MODE_READ_DISCIPLINE_BLOCK),
  },
  {
    id: "executor-no-recursive-agent-spawn",
    // gsd-executor.md's own `tools:` frontmatter already excludes Agent - this patch
    // documents that the exclusion is intentional (anthropics/claude-code has an open,
    // unresolved issue about unbounded recursive sub-agent fan-out from workers that DO have
    // Agent access) so a future gsd-core update, or a runtime that ignores the tools:
    // restriction, doesn't silently reintroduce the risk.
    appliesTo: (name) => name === "gsd-executor.md",
    detect: (content) => content.includes("<no_recursive_agent_spawn>"),
    apply: (content) => insertAfter(content, "</role>", EXECUTOR_NO_RECURSIVE_AGENT_SPAWN_BLOCK),
  },
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
    id: "executor-filesystem-search-discipline",
    // detect() checks a phrase from the block BODY, not the bare `<filesystem_search_discipline>`
    // tag, because gsd-executor.md's own "documentation lookup" prose names that tag by name as
    // a forward pointer - which would false-positive a substring match on the tag alone before
    // this patch has actually run.
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
  {
    id: "executor-dependency-provisioning-order",
    // Windows worktree-parallelism findings (see rules-src/gsd.md "Parallel worktree waves"):
    // a wave's N worktrees independently reinstalling/rebuilding an unchanged shared
    // dependency is a common root cause of hours-instead-of-minutes waves, and can outright
    // fail on Windows with EPERM when two worktrees resolve the same package concurrently.
    appliesTo: (name) => name === "gsd-executor.md",
    detect: (content) => content.includes("<dependency_provisioning_order>"),
    apply: (content) => insertAfter(content, "</worktree_metadata_capture>", EXECUTOR_DEPENDENCY_PROVISIONING_BLOCK),
  },
  {
    id: "executor-test-chunking",
    // Observed: a worker finishing a small, scoped change but then running the ENTIRE test
    // suite is a bigger driver of hour-plus runs and ballooned context than model reasoning
    // itself - reinforces the same scoping rule now in rules-src/gsd.md at the orchestrator
    // level, directly in the executor's own system prompt.
    appliesTo: (name) => name === "gsd-executor.md",
    detect: (content) => content.includes("<test_execution_discipline>"),
    apply: (content) => insertAfter(content, "</execution_flow>", EXECUTOR_TEST_EXECUTION_DISCIPLINE_BLOCK),
  },
  {
    id: "executor-incremental-progress",
    // Per-task commits are already the incremental progress signal an orchestrator's
    // liveness monitoring depends on (git diff --stat HEAD / recent commit) - this patch
    // makes that explicit so it's never deferred/batched "to save time."
    appliesTo: (name) => name === "gsd-executor.md",
    detect: (content) => content.includes("Incremental progress signal"),
    apply: (content) => insertBefore(content, "**6. Post-commit deletion check:**", EXECUTOR_INCREMENTAL_PROGRESS_BLOCK + "\n\n"),
  },
];

/* ---------- retired patches: best-effort cleanup of content a NOW-REMOVED entry above once
 * injected ----------
 * A patch dropped from PATCHES (its problem got solved a different way, usually upstream)
 * stops being applied to fresh files, but says nothing about a file that already has its text
 * from a past run - gsd-* agents aren't rewritten by this bundle, only by gsd-core's own
 * updates, so old injected text can sit there indefinitely otherwise. Each entry here is the
 * INVERSE of a patch that used to exist in PATCHES: same `appliesTo` gate, `detect` matches the
 * exact text that patch injected (not a substring that could appear elsewhere), `revert` returns
 * content with it replaced back to a plain, safe form - never re-introducing whatever problem
 * the original patch fixed. Reverting is deliberately conservative (exact-string only, never a
 * heuristic strip) - same "never corrupt the file" bar as PATCHES' own `apply`. Retire an entry
 * here too (delete it) once nobody could plausibly still have the old text - i.e. after enough
 * time that every install has picked up a gsd-core update superseding it. */
const EXECUTOR_QUERY_HANDLERS_NEW =
`After SUMMARY.md, update STATE.md using \`gsd-tools query\` state handlers (positional args).
The full handler catalog with calling conventions lives in \`sdk/src/query/QUERY-HANDLERS.md\`
in the \`open-gsd/gsd-core\` **upstream source repo** — that path is not shipped in your local
install (see \`<filesystem_search_discipline>\`), so don't search for it locally. The commands
below cover every handler this step needs:`;
const EXECUTOR_QUERY_HANDLERS_CLEANED =
  "After SUMMARY.md, update STATE.md using `gsd-tools query` state handlers (positional args):";

export const RETIRED_PATCHES = [
  {
    id: "executor-query-handlers-ref-fix",
    // Retired 2026-07-16 (5ce7e57): upstream gsd-executor.md stopped shipping the dead
    // `sdk/src/query/QUERY-HANDLERS.md` reference this patch used to work around, so the fix is
    // moot for any file gsd-core has since rewritten. A file that predates that rewrite can still
    // carry our old replacement text (including the now-pointless "don't search for it locally"
    // caveat) - revert it to the plain one-liner, with no dangling reference either way.
    appliesTo: (name) => name === "gsd-executor.md",
    detect: (content) => content.includes(EXECUTOR_QUERY_HANDLERS_NEW),
    revert: (content) => content.split(EXECUTOR_QUERY_HANDLERS_NEW).join(EXECUTOR_QUERY_HANDLERS_CLEANED),
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

/* ---------- read-only: which files still carry text from a RETIRED patch (never writes) ---------- */
export function checkRetiredGsdAgentPatches({ claudeDir }) {
  const pending = {}; // { filename: [retiredPatchId, ...] }
  for (const name of listAgentFiles(claudeDir)) {
    const applicable = RETIRED_PATCHES.filter((p) => p.appliesTo(name, claudeDir));
    if (!applicable.length) continue;
    const content = safe(() => readFileSync(join(claudeDir, "agents", name), "utf8"));
    if (content === undefined || isCurated(content)) continue;
    const found = applicable.filter((patch) => patch.detect(content)).map((patch) => patch.id);
    if (found.length) pending[name] = found;
  }
  return pending; // {} means nothing left to clean up
}

/* ---------- write: apply every pending patch (only called explicitly, see file header) ---------- */
export function applyGsdAgentPatches({ claudeDir }) {
  const result = { applied: [], skippedCurated: [], skippedNoAnchor: [], removedRetired: [] };
  for (const name of listAgentFiles(claudeDir)) {
    const applicable = PATCHES.filter((p) => p.appliesTo(name, claudeDir));
    const applicableRetired = RETIRED_PATCHES.filter((p) => p.appliesTo(name, claudeDir));
    if (!applicable.length && !applicableRetired.length) continue;
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
    for (const patch of applicableRetired) {
      if (!patch.detect(content)) continue; // nothing left to clean up
      content = patch.revert(content);
      changed = true;
      result.removedRetired.push(`${name}:${patch.id}`);
    }
    if (changed) safe(() => writeFileSync(p, content));
  }
  return result;
}
