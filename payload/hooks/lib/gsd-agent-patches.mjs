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
//                                          invocation - payload/commands/init-stack.md (step 10)
//                                          or the standalone payload/commands/init-session.md
//                                          (via apply-gsd-agent-patches.mjs), never
//                                          automatically/per-session.
// Each patch is scoped to the file(s) it targets via `appliesTo` - most gsd-* agents get only
// the context-mode routing block; gsd-executor.md/gsd-debugger.md get a couple of bespoke
// additions on top of that, justified per-patch in its own comment below.
//
// "Applied" is CONTENT-aware, not presence-aware: each patch's inserted text carries a version
// marker (see "version markers" below), so a content edit to a patch's `block` (bump `version`)
// actually reaches a file that already has an OLDER version applied instead of being silently
// skipped because a bare tag/phrase was already there. `apply` returns null (skip, never
// throws) if its anchor text isn't found on a truly fresh insertion - a prerequisite for that
// patch not being met, or an upstream gsd-core rewrite having changed the surrounding text - so
// one missing anchor never blocks the other patches in the same run.
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
// Plain-string, single-occurrence splice - deliberately NOT `String.replace(search, repl)`,
// which interprets `$&`/`$1`-style sequences in `repl` even when `search` is a plain string.
// Our blocks are prose that could plausibly contain a literal `$` some day; this never does.
function replaceOnce(content, search, replacement) {
  const idx = content.indexOf(search);
  if (idx === -1) return content;
  return content.slice(0, idx) + replacement + content.slice(idx + search.length);
}
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/* ---------- version markers ----------
 * Every patch's inserted text is wrapped in an invisible HTML-comment pair carrying its version:
 * `<!-- gsd-patch:ID vN -->...block...<!-- /gsd-patch:ID -->`. This is what makes a content
 * change to a patch (bump `version` on its registry entry) actually reach a file that already
 * has an OLDER version applied - `findMarkedSpan` locates the existing span (whatever version)
 * so `applyOrUpgradePatch` can replace it wholesale instead of a bare-tag/phrase presence check
 * treating "already there" as "already CURRENT" and skipping forever.
 *
 * A file with NO marker at all - applied before this versioning system existed - is handled by
 * `legacyMatch`: a plain literal-substring search for the patch's current `block` text, plus
 * any texts listed in `priorBlocks` (the exact body of an earlier version, kept around only for
 * this migration). Deliberately literal substring, not a `<tagName>...</tagName>` regex span:
 * two of these blocks' bodies reference ANOTHER patch's tag by name as a forward pointer
 * (`filesystem-search-discipline` mentions `<background_task_hygiene>`, and vice versa) - a
 * generic open-tag-to-close-tag regex would latch onto that forward mention as the "open" tag
 * and consume everything up to the real closing tag much later in the file. A full literal
 * block match can't be fooled by a short name-drop like that. */
function markerOpen(id, version) { return `<!-- gsd-patch:${id} v${version} -->`; }
function markerClose(id) { return `<!-- /gsd-patch:${id} -->`; }
function wrapBlock(id, version, block) {
  return `${markerOpen(id, version)}\n${block}\n${markerClose(id)}`;
}
function findMarkedSpan(content, id) {
  const re = new RegExp(`<!-- gsd-patch:${escapeRegExp(id)} v(\\d+) -->[\\s\\S]*?<!-- /gsd-patch:${escapeRegExp(id)} -->`);
  const m = content.match(re);
  return m ? { version: Number(m[1]), fullMatch: m[0] } : null;
}
function legacyMatch(content, patch) {
  for (const candidate of [patch.block, ...(patch.priorBlocks || [])]) {
    if (content.includes(candidate)) return candidate;
  }
  return null;
}
function isPatchCurrent(content, patch) {
  const marked = findMarkedSpan(content, patch.id);
  return !!marked && marked.version === patch.version;
}
// Returns { content, kind } where kind is one of:
//   null        - already current, nothing written
//   "upgraded"  - a stale marked span OR an unmarked legacy application was replaced in place
//   "applied"   - freshly inserted at insertAnchor (nothing found at all beforehand)
//   "noAnchor"  - fresh insertion attempted but insertAnchor wasn't found in the file
function applyOrUpgradePatch(content, patch) {
  const marked = findMarkedSpan(content, patch.id);
  if (marked && marked.version === patch.version) return { content, kind: null };
  const wrapped = wrapBlock(patch.id, patch.version, patch.block);
  if (marked) return { content: replaceOnce(content, marked.fullMatch, wrapped), kind: "upgraded" };
  const legacy = legacyMatch(content, patch);
  if (legacy) return { content: replaceOnce(content, legacy, wrapped), kind: "upgraded" };
  const inserter = patch.insertMode === "before" ? insertBefore : insertAfter;
  const updated = inserter(content, patch.insertAnchor, wrapped);
  return updated === null ? { content, kind: "noAnchor" } : { content: updated, kind: "applied" };
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

// v1 (retained only so `legacyMatch` can locate and upgrade an install that already has this
// exact text, unmarked, from before the junction rewrite) - see "version markers" above.
const EXECUTOR_DEPENDENCY_PROVISIONING_BLOCK_V1 = `<dependency_provisioning_order>
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

const EXECUTOR_DEPENDENCY_PROVISIONING_BLOCK = `<dependency_provisioning_order>
If running inside a worktree (\`.git\` is a file — see \`<worktree_metadata_capture>\`), do NOT
run \`pnpm install\`/\`npm install\`/\`yarn install\` (or anything triggering a fresh dependency
resolution) as your first move when a build or test step needs \`node_modules\`. First check
whether the orchestrator already provisioned it from the base checkout — a worktree created
for this task should already have \`node_modules\` present, either as a JUNCTION (the default —
check with \`(Get-Item node_modules).LinkType -eq 'Junction'\`) pointing at the base checkout's
real copy, or — only for a plan explicitly flagged to write into \`node_modules\` — a real,
isolated copy made via \`robocopy <src> <dst> /MIR /MT:32\`. If it's a junction, treat it as
READ-ONLY for your entire task, same as the base checkout itself: installing into it, or
deleting/recreating it, corrupts every other worktree in the wave still linked to it. Never
remove a junction with \`Remove-Item -Recurse\`/\`-Force\` — on Windows PowerShell that can FOLLOW
the reparse point and delete the base checkout's real \`node_modules\` instead of just the link;
if a junction genuinely needs replacing, remove it with \`cmd /c rmdir node_modules\` (no \`/s\`)
first, then recreate. Only install for packages genuinely new or changed relative to the
copied/linked base, and only after confirming they aren't already covered (\`ls
node_modules/<pkg>\` / check \`package.json\`'s lockfile hash against the base) — and only inside
a worktree holding its OWN real copy, never through a junction. Every worktree in a wave
independently reinstalling/rebuilding an unchanged shared dependency — instead of relying on
what the orchestrator already provisioned — is a common root cause of a wave taking hours
instead of minutes, and on Windows can outright fail with \`EPERM ... rename ..._tmp_N\` when two
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

const PLANNER_VERIFY_ISOLATED_BLOCK = `**Task-level isolated verification** (alternative to \`tdd="true"\`, never combined with it on
the same task): a behavior-adding task that would otherwise get \`tdd="true"\` instead gets
\`verify_isolated="true"\` when EITHER applies:
- The plan's \`<threat_model>\` STRIDE register assigns \`critical\` or \`high\` severity with a
  \`mitigate\` disposition to a component this task's \`<files>\` touches.
- CONTEXT.md explicitly requests isolated verification for this task or its area (a
  \`/gsd-discuss-phase\` decision). This is ADDITIVE to the threat-model criterion above, never a
  replacement for it — CONTEXT.md can only ADD tasks to \`verify_isolated="true"\`, never remove
  ones the threat-model criterion already selected.

\`verify_isolated="true"\` tasks are executed by \`gsd-executor-decomposing\` instead of plain
\`gsd-executor\` (dispatched automatically per-plan by execute-phase.md) — see \`rules-src/gsd.md\`'s
"The one sanctioned depth-3 exception" section for why this exists and how it's bounded. Same
\`<behavior>\`/\`<verification>\` shape as a \`tdd="true"\` task:

\`\`\`xml
<task type="auto" verify_isolated="true">
  <name>Task: [name]</name>
  <files>src/feature.ts, src/feature.test.ts</files>
  <behavior>
    - Test 1: [expected behavior]
  </behavior>
  <action>[Specific implementation]</action>
  <verification>[Command or check]</verification>
  <done>[Acceptance criteria]</done>
</task>
\`\`\``;

/* ---------- patch registry ----------
 * appliesTo(name, claudeDir): whether this patch targets a given agent filename.
 * version:                    bump whenever `block`'s text changes - this is what makes an
 *                              already-applied file pick up the new content instead of being
 *                              silently treated as done forever (see "version markers" above).
 * block:                      the CURRENT text to insert/upgrade to.
 * priorBlocks:                (optional) exact text of an earlier version, so `legacyMatch` can
 *                              find and replace an unmarked pre-versioning application. Add one
 *                              here whenever you bump `version` on an already-shipped patch.
 * insertAnchor/insertMode:    where a FRESH application (nothing found at all) gets inserted. */
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
// Caveat: this only governs a FRESH insertion. A content upgrade (`legacyMatch`/marked-span
// replace) rewrites the block IN PLACE at its existing position and never touches ordering.
export const PATCHES = [
  {
    id: "executor-context-mode-read-discipline",
    version: 1,
    // context-mode's own Read nudge (hooks/core/routing.mjs upstream) fires at most once per
    // session and never blocks - observed: a worker read a large file directly instead of
    // ctx_execute_file after that one-shot budget was already spent earlier in the session.
    // Same gate as context-mode-routing-block (meaningless without the tool grant).
    appliesTo: (name, claudeDir) => name === "gsd-executor.md" && isContextModeActive(claudeDir),
    block: EXECUTOR_CONTEXT_MODE_READ_DISCIPLINE_BLOCK,
    insertAnchor: "</role>", insertMode: "after",
  },
  {
    id: "executor-no-recursive-agent-spawn",
    version: 1,
    // gsd-executor.md's own `tools:` frontmatter already excludes Agent - this patch
    // documents that the exclusion is intentional (anthropics/claude-code has an open,
    // unresolved issue about unbounded recursive sub-agent fan-out from workers that DO have
    // Agent access) so a future gsd-core update, or a runtime that ignores the tools:
    // restriction, doesn't silently reintroduce the risk.
    appliesTo: (name) => name === "gsd-executor.md",
    block: EXECUTOR_NO_RECURSIVE_AGENT_SPAWN_BLOCK,
    insertAnchor: "</role>", insertMode: "after",
  },
  {
    id: "context-mode-routing-block",
    version: 1,
    // Same file set + same exclusion reasoning as context-mode-gsd-agents.mjs's tool grant
    // (EXCLUDED_AGENTS there: narrow single-purpose agents that don't do large-output
    // research/analysis work) - the routing prose is meaningless without the tool grant, and
    // the tool grant is unused surface area without the routing prose, so both patches share
    // one predicate on purpose. EXCLUDED_AGENTS stays defined in that file as the single
    // source of truth; this just imports it.
    appliesTo: (name, claudeDir) => name.startsWith("gsd-") && name.endsWith(".md")
      && !EXCLUDED_AGENTS.has(name) && isContextModeActive(claudeDir),
    block: CONTEXT_MODE_ROUTING_BLOCK,
    insertAnchor: "</role>", insertMode: "after",
  },
  {
    id: "executor-filesystem-search-discipline",
    version: 1,
    // Legacy migration matches the full block body literally (see "version markers" above for
    // why) - a bare `<filesystem_search_discipline>` tag substring would false-positive on this
    // same file's OWN forward-reference to the tag name inside `<background_task_hygiene>`'s
    // block, well before this patch's real content.
    appliesTo: (name) => name === "gsd-executor.md",
    block: FILESYSTEM_SEARCH_DISCIPLINE_BLOCK,
    insertAnchor: "</documentation_lookup>", insertMode: "after",
  },
  {
    id: "executor-background-task-hygiene",
    version: 1,
    // Same reasoning as above, mirrored: filesystem-search-discipline's block body references
    // `<background_task_hygiene>` by name, so a bare-tag legacy match here would latch onto
    // THAT mention instead of this patch's own (usually later) real block.
    appliesTo: (name) => name === "gsd-executor.md",
    block: BACKGROUND_TASK_HYGIENE_BLOCK,
    insertAnchor: "<authentication_gates>", insertMode: "before",
  },
  {
    id: "executor-stability-rerun-limit",
    version: 1,
    appliesTo: (name) => name === "gsd-executor.md",
    block: EXECUTOR_STABILITY_RERUN_BLOCK,
    insertAnchor: "**Extended examples and edge case guide:**", insertMode: "before",
  },
  {
    id: "debugger-stability-rerun-limit",
    version: 1,
    // Only gsd-debugger.md, not the other candidates surveyed alongside it - gsd-verifier.md
    // (already caps its own test run at "at most once"), gsd-integration-checker.md,
    // gsd-code-reviewer.md, gsd-eval-auditor.md (no rerun-prone loop structure at all), and
    // gsd-ui-checker.md/gsd-nyquist-auditor.md (already explicitly bounded) don't have this
    // gap - see the survey findings this patch is drawn from.
    appliesTo: (name) => name === "gsd-debugger.md",
    block: DEBUGGER_STABILITY_RERUN_BLOCK,
    insertAnchor: "// Run this 1000 times\n```", insertMode: "after",
  },
  {
    id: "executor-dependency-provisioning-order",
    version: 2,
    // v2 (2026-07-17): junction-by-default rewrite - a plain `robocopy /MIR` of a 100K+-file
    // node_modules runs minutes-to-tens-of-minutes PER WORKTREE (see rules-src/gsd.md "Parallel
    // worktree waves"); junction is near-instant. `priorBlocks` is what lets an install that
    // already has v1 applied (unmarked, from before this versioning system existed) pick up v2
    // instead of the bare `<dependency_provisioning_order>` tag being mistaken for "current".
    appliesTo: (name) => name === "gsd-executor.md",
    block: EXECUTOR_DEPENDENCY_PROVISIONING_BLOCK,
    priorBlocks: [EXECUTOR_DEPENDENCY_PROVISIONING_BLOCK_V1],
    insertAnchor: "</worktree_metadata_capture>", insertMode: "after",
  },
  {
    id: "executor-test-chunking",
    version: 1,
    // Observed: a worker finishing a small, scoped change but then running the ENTIRE test
    // suite is a bigger driver of hour-plus runs and ballooned context than model reasoning
    // itself - reinforces the same scoping rule now in rules-src/gsd.md at the orchestrator
    // level, directly in the executor's own system prompt.
    appliesTo: (name) => name === "gsd-executor.md",
    block: EXECUTOR_TEST_EXECUTION_DISCIPLINE_BLOCK,
    insertAnchor: "</execution_flow>", insertMode: "after",
  },
  {
    id: "executor-incremental-progress",
    version: 1,
    // Per-task commits are already the incremental progress signal an orchestrator's
    // liveness monitoring depends on (git diff --stat HEAD / recent commit) - this patch
    // makes that explicit so it's never deferred/batched "to save time."
    appliesTo: (name) => name === "gsd-executor.md",
    block: EXECUTOR_INCREMENTAL_PROGRESS_BLOCK + "\n",
    insertAnchor: "**6. Post-commit deletion check:**", insertMode: "before",
  },
  {
    id: "planner-verify-isolated-detection",
    version: 1,
    // Companion to gsd-executor-decomposing.md's <task_stage_decomposition>: without this,
    // verify_isolated="true" could only ever be set by a human hand-editing PLAN.md after
    // generation - the mechanism had a consumer (execute-phase.md's dispatch check,
    // gsd-executor-decomposing) but no producer. Reuses the plan's OWN already-computed
    // threat_model severity as the risk signal instead of inventing a new complexity heuristic.
    appliesTo: (name) => name === "gsd-planner.md",
    block: PLANNER_VERIFY_ISOLATED_BLOCK,
    insertAnchor: "Exceptions where `tdd=\"true\"` is not needed: `type=\"checkpoint:*\"` tasks, configuration-only files, documentation, migration scripts, glue code wiring existing tested components, styling-only changes.",
    insertMode: "after",
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

/* ---------- read-only: agents granted `Agent` without an anti-recursion guardrail (never writes) ----------
 * Codifies an empirical finding (2026-07 recursive-delegation test series, see gsd.md's "Depth
 * boundary" section and .test/CONCLUSION-rlm-architecture.md at the time this was written):
 * granting the `Agent` tool to a gsd-* worker whose system prompt has NO anti-recursion
 * guardrail is not neutral - across repeated tests it caused either a principled refusal
 * (contradictory role: an inherited `<no_recursive_agent_spawn>`-style block "overridden" by a
 * later instruction) or a silent stuck state (async/background dispatch a headless run can
 * never wake back up from). A worker meant to recurse safely needs an explicit, non-
 * contradictory depth cap and merge-in-code discipline written into its role from scratch -
 * never `Agent` bolted onto a role that assumed it would never have that tool. This check only
 * flags the ABSENCE of any guardrail marker; it can't judge whether a present one is adequate,
 * and it deliberately does not auto-fix anything (unlike the PATCHES above, there is no single
 * correct guardrail text to inject for an arbitrary future agent - this needs a human).
 */
const RECURSIVE_SPAWN_GUARDRAIL_MARKERS = [
  "<no_recursive_agent_spawn>",
  "gsd-patch:executor-no-recursive-agent-spawn",
  // gsd-executor-decomposing.md's deliberate, reviewed exception (payload/agents/): grants
  // `Agent` for exactly one documented, depth-capped use (dispatching gsd-task-verifier, which
  // itself has no `Agent`). This marker signals "reviewed and bounded," not "forbidden" - the
  // opposite intent of the marker above, but equally not an accidental/undocumented grant.
  "<task_stage_decomposition>",
];
function toolsListFromFrontmatter(content) {
  const m = content.match(/^tools:\s*(.+)$/m);
  return m ? m[1] : "";
}
function grantsAgentTool(toolsLine) {
  return toolsLine.split(",").map((t) => t.trim()).includes("Agent");
}
export function checkRecursiveAgentSpawnGuardrail({ claudeDir }) {
  const missing = []; // [filename, ...] - Agent granted, no guardrail marker found
  for (const name of listAgentFiles(claudeDir)) {
    const content = safe(() => readFileSync(join(claudeDir, "agents", name), "utf8"));
    if (content === undefined || isCurated(content)) continue;
    if (!grantsAgentTool(toolsListFromFrontmatter(content))) continue;
    const guarded = RECURSIVE_SPAWN_GUARDRAIL_MARKERS.some((marker) => content.includes(marker));
    if (!guarded) missing.push(name);
  }
  return missing; // [] means every Agent-granted worker carries a guardrail marker
}

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
    const missing = applicable.filter((patch) => !isPatchCurrent(content, patch)).map((patch) => patch.id);
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
  const result = { applied: [], upgraded: [], skippedCurated: [], skippedNoAnchor: [], removedRetired: [] };
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
      const { content: updated, kind } = applyOrUpgradePatch(content, patch);
      if (kind === null) continue; // already current
      if (kind === "noAnchor") { result.skippedNoAnchor.push(`${name}:${patch.id}`); continue; }
      content = updated;
      changed = true;
      (kind === "upgraded" ? result.upgraded : result.applied).push(`${name}:${patch.id}`);
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
