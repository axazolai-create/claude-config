# The graph reaches Neo4j without being asked — design

Date: 2026-07-31
Status: approved, not yet planned

Every commit already refreshes this machine's entry in the cross-project global graph. Nothing
carries that graph to Neo4j, and three further faults mean the graph itself has not moved since
3 July. This phase repairs the chain end to end and gives its last link the same automatic
trigger the first three already have.

## Context

The Neo4j mirror was built in phase 01. Its write path — `bin/graphify-neo4j-push.mjs`: probe,
then per-repo prune, then `MERGE` — works and is not in question. What was never wired is who
calls it: the only caller is an opt-in `--neo4j-push` flag on `graphify-sync-all.mjs` that a
human has to type.

Investigation found four faults, three of them older than the missing trigger and each enough on
its own to make an automatic trigger pointless:

1. **`extract` fails for want of an LLM key.** The autosync worker runs `graphify extract <root>
   --global --as <tag>` with no `--code-only`, so graphify demands semantic extraction for the
   tree's 172 markdown files and exits. `graphify-sync.log` records the same failure on every
   run: `error: no LLM API key found (172 doc/paper/image file(s) need semantic extraction)`.
2. **`~/.graphify/global-graph.json` does not exist.** Only `global-manifest.json`, dated 3 July,
   and `neo4j.env` remain in that directory, while `graphify global path` still names the missing
   file. The push script's own fail-soft guard skips on exactly this condition.
3. **The `neo4j` driver was absent.** Neither the `graphifyy` uv tool venv nor the system
   `python` could import it, yet the push script invokes prune through the system interpreter.
   Any push would have failed on import.
4. **Nothing calls the push.** No hook, no scheduled task.

That Neo4j holds 269 nodes is not a coincidence: it is the sum of the `node_count` fields in the
3 July manifest. The mirror is an intact snapshot of the last manual push, correct but frozen.

Fault 3 was cleared by hand before this phase, with `uv tool install graphifyy --with neo4j`,
because nothing else could be verified until a driver existed. That command is not a fix: it is
the symptom's cure. The cause is that `ensureNeo4jDriver` has exactly one caller,
`setup.mjs:1224`, inside `if (!neo4jDecided && INTERACTIVE)`. Once `GRAPHIFY_NEO4J` is recorded
the question is never asked again, so a driver lost to a later `uv tool install graphifyy` — the
ordinary way graphify is upgraded — has no route back. The same install that restored the driver
also moved graphify 0.9.30 → 0.9.31, which is how easily it happens.

## Settled before this phase, and not to be re-decided

- Autosync extracts with **`--code-only`**. It is deterministic, free, and needs no secret in the
  environment of a git hook — the property that makes a fresh machine work after `setup.mjs` and
  nothing else. Full semantic extraction stays available as a **manual** run.
- The push is triggered **in the tail of the same detached process** the worker already spawns,
  not by a scheduled task. A scheduled task would need registration during install plus a second
  branch for Linux and macOS, and the payload is cross-platform.
- Driver recovery belongs **in this phase**, not in a one-off command.

## Preconditions already met

`protected-lib.mjs` refused to create a file that did not exist yet, so this document could not
be written at all. Fixed first, on this branch, as its own commit: a `Write` to a non-existent
path is allowed under a matching rule; overwriting, deleting and moving stay denied. Phase 12
shipped without a spec for the same reason.

## Components

### 1. `payload/hooks/lib/graphify-global-sync-run.mjs`

Two changes: `--code-only` joins the extract arguments, and the push runs after the extract
inside the one detached process, before the lock is released. The lock therefore covers the push
too, so a burst of commits in one repository cannot start a second push while the first runs.

The inner command is today assembled inline, twice, once per platform:

```js
const args = ["extract", root, "--global", "--as", name];
const quoted = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
if (IS_WIN) {
  const inner = `graphify ${args.map(quoted).join(" ")} & del /f /q ${quoted(lock)}`;
  spawn("cmd", ["/c", inner], { cwd: root, detached: true, stdio: "ignore", windowsHide: true }).unref();
} else {
  const inner = `graphify ${args.map(quoted).join(" ")}; rm -f ${quoted(lock)}`;
  spawn("sh", ["-c", inner], { cwd: root, detached: true, stdio: "ignore" }).unref();
}
```

Inline assembly cannot be tested, and RISK-GRAPHFRESH-001 asks for a test before this file is
edited. The assembly therefore moves to a pure function in a new module, leaving the worker a
thin caller:

```js
export function buildSyncCommand({ root, name, lock, pushScript, node, logPath, isWin }) {
  const q = isWin ? winQuote : shQuote;
  const sep = isWin ? " & " : "; ";
  const steps = [`graphify ${["extract", root, "--code-only", "--global", "--as", name].map(q).join(" ")}`];
  if (pushScript) steps.push(`${q(node)} ${q(pushScript)} > ${q(logPath)} 2>&1`);
  steps.push(isWin ? `del /f /q ${q(lock)}` : `rm -f ${q(lock)}`);
  return { shell: isWin ? "cmd" : "sh", flag: isWin ? "/c" : "-c", inner: steps.join(sep) };
}
```

The caller passes `pushScript: null` when `CLAUDE_GRAPHIFY_NEO4J_PUSH=0` or when
`bin/graphify-neo4j-push.mjs` is absent. Absence is the normal case, not an edge one: the `base`
profile **excludes** `bin/graphify-neo4j-*` and offers it only as `optional/neo4j`, so most
installs have no push script and must degrade to a plain sync rather than to an error.

The push writes to `~/.claude/state/graphify-neo4j-push.log`, overwritten each run. The process
is detached with `stdio: "ignore"`, so without a file a failed push is invisible, and "check that
it works" has nothing to read.

### 2. `payload/bin/graphify-neo4j-push.mjs`

Four changes, all so that a push either succeeds or says why.

- **A global lock**, `~/.claude/state/graphify-neo4j-push.lock`. The worker's lock is per
  repository, so commits landing in two repositories at once produce two concurrent pushes, and
  prune's `DETACH DELETE` in one can remove what the other has just merged. The result heals on
  the next push, but a lock is cheaper than the confusion.
- **Prune through `findGraphifyPython()`** instead of a bare `python`. The driver belongs to
  graphify's environment; the system interpreter is not where it will be found.
- **Driver recovery.** When `driverInstalled()` is false, call the existing `ensureNeo4jDriver()`
  once, then re-check. This is the missing second caller — a machine that has opted into Neo4j
  has already consented to the driver, and the phase's whole point is that no human has to
  notice. If recovery fails, skip fail-soft with the reason and the command to run.
- **The reason reaches the log** in every skip branch, since nobody is watching the console.

### 3. `payload/graphify-sync-all.mjs`

`--code-only` becomes the default, for the same reason as in the worker, and the full semantic
run moves behind a new `--semantic` flag. This is the manual full run of the settled decisions,
and it keeps one rule in one place: both callers of graphify now agree on what a routine sync
costs.

### 4. New `payload/hooks/lib/state-lock.mjs`

The PID/mtime lock with a ten-minute staleness TTL exists once, inline, in the worker. Both the
worker and the push need it. It moves into a module with `acquire`/`release` and injectable `fs`,
with no behavioural change for the existing caller.

## Data flow

A commit — from Claude's Bash tool or from git itself — wakes the worker. The worker takes the
per-repo lock and spawns one detached shell: `graphify extract --code-only --global` refreshes
`~/.graphify/global-graph.json`; the push script then takes the global lock, probes bolt, prunes
this machine's repo tags and `MERGE`s the whole global graph; the lock is removed last. A later
session reads the result through the `mcp-neo4j-cypher` MCP server.

## Error handling

Every step is fail-soft and none can block a commit: no `neo4j.env`, an unreachable NAS, a driver
that could not be restored, a corrupt global graph — each is a logged skip with exit 0. A failed
prune still aborts the push, so a stale mixture is never written. The only new failure surface is
the log file, and failing to write it is ignored.

## Testing decisions

Verification happens at four seams, all with the repository's `node --test` + `*.test.mjs`
convention:

- **The command the worker builds.** A pure function is checked for: `--code-only` present, the
  push step present, the push step absent when the script is missing or the toggle is off, and
  the order extract → push → unlock on both platforms. Per RISK-GRAPHFRESH-001 this is written
  pin-then-edit: the invariants that must not change — a lock is taken, the process is detached,
  the worker never throws and always exits 0 — are pinned first and must still hold after.
- **The lock module.** Acquire on a free lock, refuse on a live one, ignore one past its TTL.
- **The push orchestrator's decisions.** Interpreter selection and each skip branch — no config,
  no driver and recovery declined, unreachable bolt — with `run` and `probe` injected, as
  `neo4j-config.test.mjs` already does.
- **Driver recovery.** Recovery is attempted exactly once and its failure is a skip, not a throw.

Whether the chain reaches the NAS is not a unit-test question; it is checked live.

## Live verification

1. `node --test` over the suite is green.
2. A commit produces a fresh `~/.graphify/global-graph.json`, and `graphify global list` names
   `claude-config`.
3. `~/.claude/state/graphify-neo4j-push.log` reads `Pushed to Neo4j: <n> nodes, <m> edges`.
4. Cypher returns a node count well above 269, and `claude-config` appears among the repo tags.

Steps 2–4 need `node setup.mjs` to have deployed the payload: `payload/` is source, `~/.claude`
is what runs.

## Risks

- **RISK-GRAPHFRESH-001** (Deferred) covers edits to this exact worker. Its mitigation,
  pin-then-edit, is adopted above rather than restated.
- A new risk is filed for the automatic push: a repository with a large extract now drags a full
  global `MERGE` behind every commit. The locks bound concurrency, not cost.
- A second new risk is filed for driver recovery: a push now installs a package as a side effect
  of a commit. It is bounded to one attempt on a machine that already opted into Neo4j, and it is
  the alternative to a chain that silently stops working after a routine upgrade.

## Out of scope

A throttle on the push. The two locks already stop pushes from overlapping, and a stamp that
skips a push would let the last commit of a session never reach Neo4j at all — the failure this
phase exists to end. If cost becomes the problem (RISK-GRAPHPUSH-001), a throttle is the answer
then, with eyes open. Scheduled or CI-driven semantic extraction. Cross-machine consistency
beyond the per-repo prune
already accepted under RISK-NEO4J-001. The MCP read side, configured separately. Other graph
backends such as FalkorDB. Recompiling `.claude/stack-rules.md`.
