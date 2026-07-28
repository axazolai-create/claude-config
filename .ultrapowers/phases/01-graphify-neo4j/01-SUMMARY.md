# Phase Summary: graphify ↔ Neo4j Integration

Plan: `.ultrapowers/archive/plans/2026-07-21-graphify-neo4j-integration.md`
Branch: `feat/graphify-neo4j`, base (master): `f467811`

## Tasks

1. Config + graph helpers (`payload/bin/lib/neo4j-config.mjs`, with tests) — `47a49cc..f2c38f2`
2. Per-repo prune helper (`payload/bin/graphify-neo4j-prune.py`, `DETACH DELETE` via neo4j driver) — `f2c38f2..c0b55a4`
3. Push orchestrator (`payload/bin/graphify-neo4j-push.mjs`: probe + prune + MERGE) — `c0b55a4..03f59f4`
4. Opt-in `--neo4j-push` flag in `payload/graphify-sync-all.mjs` — `03f59f4..6b39f17`
5. Neo4j MCP section in `payload/commands/init-mcp.md` — `6b39f17..53837f8`
6. Cypher read cookbook (`payload/graphify-neo4j.cypher`) — `53837f8..749b8e7`
7. gsd-agent Cypher/MCP guidance patch in `payload/hooks/lib/gsd-agent-patches.mjs` — `749b8e7..eea7a23` (incl. fix commit `eea7a23`)
8. Neo4j opt-in prompt in `setup.mjs` (writes `~/.graphify/neo4j.env`) — `eea7a23..a7cee1f`
9. graphify freshness nudge (`payload/bin/graphify-freshness.mjs`, semver test) — `a7cee1f..37428b6` (incl. fix)
10. Wire freshness check into `setup.mjs` and `payload/commands/init-stack.md` — `37428b6..6d16eac`
11. Phase 3: one-time push of the current global graph — MANUAL runbook, NOT implemented (needs NAS bolt URI + creds, `pip install neo4j`; operational, no code)

## Rulings

### Deferred Minor findings (parked for final whole-branch review)
- T1: probeReachable success path untested (inherited from brief).
- T2: prune.py git mode 100644 despite shebang (invoked via `python`); count-then-delete TOCTOU (brief-specified).
- T3: missing-graph/unparseable-URI/corrupt-graph fail-soft branches reasoned+static-verified but not live-tested.
- NOTE: repo secrets-gate.mjs false-positives on `KEY: cfg.x.password` unless on same line as `...process.env` (worked around in T3; watch in T8 setup.mjs).
- T7 fix: appliesTo signature widened (name)->(name,claudeDir), unused param, matches sibling convention (cosmetic).
- T8 Minor (recommend fixing at final review): mkdirSync/writeFileSync of ~/.graphify/neo4j.env are unguarded while chmodSync is try/caught; a FS failure would abort setup.mjs for an optional feature. Wrap the write pair in try/catch (log+skip, leave GRAPHIFY_NEO4J unset) to match the feature's fail-soft ethos.
- T10 Minor (recommend fixing): init-stack.md freshness bullet placed in Step 1 (Detect+classify) is a topical non-sequitur; move it to the Steps 9-11 "always, no gate / machine-wide maintenance" cluster (own short step, or append to Step 9/11).

### FINAL whole-branch review (opus): Ready-to-merge WITH FIXES. No Critical. Fix wave:
- IMPORTANT-1: setup.mjs neo4j opt-in: mkdirSync/writeFileSync/flag-record unguarded -> wrap in try/catch (log+skip, leave GRAPHIFY_NEO4J unset).
- IMPORTANT-2: dead pointer 'payload/graphify-neo4j.cypher' in init-mcp.md + gsd-agent-patches.mjs NEO4J_GRAPH_ROUTING_BLOCK -> deployed path is ~/.claude/graphify-neo4j.cypher; fix both refs. Block text change => bump neo4j patch version 1->2.
- MINOR-3: move init-stack.md freshness bullet from Step 1 to Steps 9-11 maintenance cluster.
- MINOR-4: gsd neo4j patch appliesTo add !EXCLUDED_AGENTS.has(name) for parity with context-mode-routing-block.
- NOTE (no-op): NEO4J_USERNAME (MCP) vs NEO4J_USER (write) is intentional - different consumers, do NOT unify.

Ledger's own verdict line: "ALL COMPLETE: 10 code tasks + final review + fix wave all reviewed clean. Fix-wave re-review = Ready to merge: YES. Only T11 (manual NAS push) pending."

### Fix-wave report (`sdd/fix-wave-report.md`, commit `e8bd949`) — additional finding not in the ledger's fix-wave list
- No `priorBlocks` entry was added for the v1→v2 bump on `neo4j-global-graph-routing`: unlike the `executor-dependency-provisioning-order` patch's legacy-migration case, this patch's v1 application already carries the version marker (`<!-- gsd-patch:... v1 -->`), so `findMarkedSpan`/`applyOrUpgradePatch`'s marked-span upgrade path handles the v1→v2 transition correctly without needing a literal-text `legacyMatch` fallback. Confirmed behaviorally by the idempotency test above (fresh v2 install path); a true "upgrade an existing v1 file" run was not separately exercised but follows the same code path already covered by the file's own general versioned-patch machinery.

## Deviations and decisions

- **T3 — instructed fail-soft hardening.** The brief's push orchestrator had a bare `repoTagsFromGlobalGraph(readFileSync(GLOBAL_GRAPH_PATH, "utf8"))`, which throws uncaught on a malformed/corrupt `global-graph.json`. Per instruction, wrapped it in try/catch so a read/parse error degrades to a fail-soft `exit 0` skip instead of an unhandled exception.
- **T3 — hook-forced formatting, not a behavior change.** The repo's `secrets-gate.mjs` pre-commit hook blocked the first commit attempt ("Denied: possible secrets in staged changes... hardcoded secret assignment") because the brief's multi-line `env` object put `NEO4J_PASSWORD: cfg.config.password,` on its own line with no `process.env` text on that line, so the hook's line-level allowlist didn't recognize it as env-passthrough. Collapsed the object to one line (`...process.env` and the `NEO4J_PASSWORD` key on the same line) to satisfy the hook without disabling it — functionally identical. The report separately flags this as a maintainability concern in the hook itself (recommends widening the env-context regex to a window of lines rather than requiring call-site formatting changes), left unfixed as out of scope.
- **T3 — stale-file housekeeping.** The report notes this path previously held a stale report from an unrelated earlier "Task 3" (about `init-stack.py` C# detection, from a different plan run); overwritten, old content still in git history.
- **T4 — instructed deviation from the brief's path-resolution snippet.** The brief resolved the push script's path via a fragile regex (`new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")`). Per instruction, used `fileURLToPath`/`dirname` instead (matching Task 3's own style), requiring an added `node:url` import and `dirname` added to the existing `node:path` import.
- **T4 — minor simplification.** Omitted `encoding: "utf8"` from the push-script `spawnSync` options since `stdio: "inherit"` never populates `stdout`/`stderr` anyway — a no-op simplification, not a behavior change.
- **T5 — stale-file housekeeping.** The pre-existing `task-5-report.md` at this path documented a different plan's Task 5 (`/leanmode` command); unrelated, overwritten by this task's report.
- **T7 — brief's literal instruction conflicted with the file's own documented convention; caught in review, fixed.** The brief said to append the new patch at the end of the `PATCHES` array. The implementer followed that literally but flagged a concern: per the file's own header comment, `</role>`-anchored patches apply in *reverse* of array order, so appending at the end would make the Neo4j block render FIRST after `</role>` — ahead of the deliberately curated `executor-context-mode-read-discipline` etc. entries, which the header comment explicitly warns against. This was raised to Important in review and fixed in commit `eea7a23`: moved the patch object to array index 0 (first), updated the header comment's entry count ("three" → "four") and reading-order description, verified structurally (`</role>`-anchored reading order confirmed as `context-mode-routing-block`, `executor-no-recursive-agent-spawn`, `executor-context-mode-read-discipline`, `neo4j-global-graph-routing` last) and functionally (idempotent apply in an isolated fixture dir).
- **T8 — variable naming and import reuse, both deliberate.** Namespaced brief's `s`/`decided` to `neo4jSettings`/`neo4jDecided` to avoid shadowing the update-check block's own locals (`curEnvSettings`, `updateCheckDecided`) in the same function scope. Used the existing `HOME` const instead of calling `homedir()`, per the task's explicit constraint.
- **T8 — secrets-gate did NOT false-positive here, unlike T3.** Root-caused: the hook's `envRe` allowlist regex is case-insensitive, so `${pw}`, `${uri}`, `${user}` in the template literal all match `\$\{?[A-Z_]+` case-insensitively and the line is filtered out before the hardcoded-secret heuristic runs — no formatting change was needed. The implementer notes mid-task they speculatively pre-emptively rewrote the line to string concatenation to dodge a hypothetical false positive, then reverted to the brief's exact template literal before testing; the committed code is the brief's original, unmodified form.
- **T9 — review found a real hang risk, fixed.** `installedVersion()` originally had no timeout on `spawnSync("graphify", ["--version"], ...)`, so a hung `graphify` binary could block indefinitely before the HTTPS-side timeout was ever reached. Fixed by adding `timeout: 3000` to the spawn options and widening the guard to treat `r.error` (set on a spawn timeout) as a failure, same as any other spawn error.
- **T9 — the brief's own direct-run guard was dead code on Windows.** The primary clause of the "only run when invoked directly" guard (`import.meta.url === \`file://${process.argv[1]}\``) never matches on Windows because `process.argv[1]` is a raw backslash path, never a `file:///D:/...`-style URL — correctness rested entirely on the `endsWith("graphify-freshness.mjs")` fallback, which is also spoofable by any same-named file. Replaced with a `pathToFileURL(process.argv[1]).href` comparison, verified to match Node's actual `import.meta.url` form on this OS.
- **T10 — the brief's anchor didn't exist; judgment call made and flagged.** The brief said to add the freshness bullet to "the graphify-related step [in init-stack.md] that mentions registering the project in the global graph." The implementer searched `init-stack.md` for `graphify`/`global graph`/`registers the project` and found no match anywhere — that description actually matches text printed by `setup.mjs` itself (documenting what `session-init.mjs`'s SessionStart hook does), not anything in `init-stack.md`, which had zero graphify-related content at the time. Placed the bullet in Step 1 (Detect + classify) instead, as the closest fit (unconditional, first, best-effort), and flagged the placement as a concern for reviewer awareness — this became the T10 Minor deferred finding in the ledger, later folded into MINOR-3 of the final-review fix wave (move to the Steps 9-11 maintenance cluster).
- **Plan's own self-review deviation (recorded in the plan, not the ledger/reports):** C6 (freshness check) shipped as a standalone `payload/bin/graphify-freshness.mjs` script instead of the originally-scoped `--check` mode inside `graphify-setup.mjs`, for testability; call sites (`setup.mjs`, `init-stack.md`) and behavior are unchanged.
- **Housekeeping anomaly, not part of this plan.** The archive directory also contains `task-6h-report.md` and `task-fu-report.md` (and a matching set of `review-*.diff` files, e.g. `72b65ee..354b160`, `263327b..9380b6e`) documenting an unrelated bootstrap-hardening effort (`.gitattributes`, `bootstrap.sh`/`bootstrap.ps1` env-var parity, a shellcheck CI workflow — commits `354b160`, `518bd2f`, `8510d23`, `9380b6e`, none of which appear anywhere in this ledger). These are stale leftovers from a different plan run that reused this same archive directory name (the same pattern the T3 and T5 reports themselves note for their own paths being overwritten). They are excluded from this summary's Tasks and Reviews sections as out of scope for the graphify-neo4j plan.
- **Fix-wave (`e8bd949`) — catch-branch design choice beyond "wrap in try/catch."** For Fix 1 (setup.mjs env-write guard), on a write failure the catch block deliberately does **not** set `GRAPHIFY_NEO4J` at all (neither `"1"` nor `"0"`), so the opt-in offer re-asks on the next `node setup.mjs` run rather than silently recording a false "declined". The password variable (`pw`) is never referenced inside the catch — only `e.message` is logged.
- **Fix-wave (`e8bd949`) — reason for the v1→v2 patch version bump.** Fix 2 (dead cookbook-path pointer) bumped the `neo4j-global-graph-routing` patch's `version` from `1` to `2`, specifically so the versioned-marker upgrade path (`findMarkedSpan`/`applyOrUpgradePatch`) replaces an already-applied v1 span in place on any file that already has it, instead of treating the stale v1 block as still current.
- **Fix-wave (`e8bd949`) — mid-fix regression caught by its own verification, fixed before commit.** While fixing the dead `payload/graphify-neo4j.cypher` pointer (Fix 2), an initial pass reintroduced a literal `payload/graphify-neo4j.cypher` string inside a v2 changelog comment. The report's own verification step (`grep -rn "payload/graphify-neo4j.cypher" ...`) caught this before commit and it was reworded; the committed `e8bd949` has no remaining `payload/graphify-neo4j.cypher` references in either touched file.

## Reviews

- `git diff 47a49cc..f2c38f2`
- `git diff f2c38f2..c0b55a4`
- `git diff c0b55a4..03f59f4`
- `git diff 03f59f4..6b39f17`
- `git diff 6b39f17..53837f8`
- `git diff 53837f8..749b8e7`
- `git diff 749b8e7..6fba794`
- `git diff 749b8e7..eea7a23`
- `git diff eea7a23..a7cee1f`
- `git diff a7cee1f..189ef08`
- `git diff a7cee1f..37428b6`
- `git diff 37428b6..6d16eac`
- `git diff f467811..6d16eac`
- `git diff 6d16eac..e8bd949`
