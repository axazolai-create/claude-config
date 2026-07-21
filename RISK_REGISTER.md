# Risk Register

## RISK-BOOTSTRAP-001 — Remote code execution via `curl|bash` / `irm|iex` bootstrap

- **Status:** Open (accepted)
- **Context:** `bootstrap.sh`/`bootstrap.ps1` are executed straight from the network, and they
  download+run `setup.mjs` from a GitHub tarball. A compromised repo, MITM, or wrong ref runs
  arbitrary code on the new machine.
- **Mitigation:** HTTPS-only endpoints; pin to a signed release tag via `--ref v1.0.0` for
  reproducibility; documented safe alternative (download → inspect → run) in README; secrets
  never embedded in bootstrap scripts.
- **Residual:** Standard installer trust model — user must trust the repo owner. Accepted.

## RISK-STACKRULES-001 — Model-driven rules compilation can lose requirements

- **Status:** Open (accepted)
- **Context:** `.claude/stack-rules.md` is compiled from `~/.claude/rules-src/` by a subagent
  (deduplicated rewrite, not a mechanical concatenation — per user decision 2026-07-12). A
  careless build could drop or distort a rule requirement, and the loss would persist until
  the next rebuild.
- **Mitigation:** compiler instructions (`rules-src/README.md` § "Building stack-rules")
  require every "Avoid:" list and every version pin to be carried over verbatim; the snapshot
  frontmatter marks it machine-owned so fixes go into `rules-src/` (source of truth) and a
  rebuild is idempotent; the snapshot is a reviewable file, not hidden state.
- **Residual:** prose-level nuance can still be lossy between rebuilds. Accepted.

## RISK-STACKRULES-002 — Snapshot desync / stale auto-loading copies

- **Status:** Open (accepted)
- **Context:** two desync paths. (1) Simplified 2026-07-13: `session-init.mjs` now only checks
  whether `.claude/stack-rules.md` exists, not whether it's stale (the prior sourceHash/
  stackFingerprint comparison via `stack-rules-check.mjs` was removed as too eager — it fired a
  rebuild instruction every session on any drift). So once a project has a snapshot, it is
  never auto-flagged again, even if `~/.claude/rules-src/` changes or the project's stack
  changes (new framework added, etc.) — drift is silent until someone re-runs `/init-stack` or
  asks for a rebuild. (2) A machine that updates the bundle but never re-runs `setup.mjs` keeps
  the old auto-loaded `~/.claude/rules/` copies alongside the snapshot — every rule then loads
  twice.
- **Mitigation:** (1) `/init-stack` now owns building the snapshot (rules-src/README.md §
  "Building stack-rules") and can be re-run any time to refresh it; `stack-rules-check.mjs` is
  kept as a CLI utility so the compiler subagent can still stamp sourceHash/stackFingerprint
  into the frontmatter, it's just no longer auto-compared. (2) `setup.mjs` `migrateRulesDir()`
  deletes bundle-owned files from `~/.claude/rules/` and removes the directory when empty;
  user-authored files are kept and reported with a move-by-hand note.
- **Residual:** (1) trades auto-freshness for less session-start noise — a project's rules can
  silently drift from `rules-src/` indefinitely if nobody re-runs `/init-stack`. (2) machines
  that skip `setup.mjs` after upgrading stay on the old (working) mechanism until they run it.
  Both accepted.

## RISK-CLAUDEMD-001 — Legacy `@.claude/CLAUDE.md` imports double-load project context

- **Status:** Open (accepted, manual cleanup)
- **Context:** the removed session-init link-import step (deleted 2026-07-12) used to prepend
  `@.claude/CLAUDE.md` to a project's root `CLAUDE.md`. Claude Code auto-loads
  `<project>/.claude/CLAUDE.md` by itself (doc-verified + live-tested 2026-07-12), so any
  project still carrying that line loads the generated file twice per session.
- **Mitigation:** no hook can fix it (root `CLAUDE.md` is usually `CURATED:NOEDIT`, and the
  deny hook rightly blocks writes). Remove the `@.claude/CLAUDE.md` line by hand when
  touching an affected project's root `CLAUDE.md`.
- **Residual:** duplicated context in affected projects until manually cleaned. Accepted.

## RISK-GSDEXEC-001 — `gsd-executor-decomposing.md` is a full fork with no inheritance, will drift

- **Status:** Open (accepted)
- **Context:** `payload/agents/gsd-executor-decomposing.md` duplicates the entirety of
  `gsd-executor.md`'s execution machinery (commit protocol, deviation rules 1-4, TDD flow,
  checkpoint protocol, worktree safety assertions) because Claude Code agent files have no
  inheritance/include mechanism for another agent's full body — only prose `@`-references to
  shared reference docs, which `gsd-executor.md` doesn't itself use for these sections. Every
  future upstream `gsd-core` fix to `gsd-executor.md` (numbered fixes like #2924/#3097/#3542/
  #3678 already baked into the copy as of 2026-07-17) will NOT automatically reach the fork.
- **Mitigation:** `gsd-executor-decomposing.md`'s frontmatter `description` points at
  `docs/superpowers/specs/2026-07-17-executor-task-decomposition-design.md`'s sync procedure —
  when `apply-gsd-agent-patches.mjs`/`gsd-agent-patches.mjs`'s `PATCHES` registry gains a new or
  upgraded entry for `gsd-executor.md`, the same patch must be manually re-applied (or the
  equivalent prose change hand-ported) to `gsd-executor-decomposing.md`, skipping only the two
  delta sections (`tools:`/`description` frontmatter and the `<task_stage_decomposition>` block
  that replaces `<no_recursive_agent_spawn>`). No automated drift check exists yet.
- **Residual:** silent drift between the two files is possible until a human notices (e.g. a
  `verify_isolated="true"` plan hits a bug already fixed in plain `gsd-executor`). Accepted as
  the cost of the only mechanism that gives a genuinely structural (tools-grant-based, not
  prose-based) depth-3 cap — see `rules-src/gsd.md`'s "The one sanctioned depth-3 exception"
  section for why the alternative (a prose-conditional single file) was rejected.

## RISK-FALLOW-001 — `fallow.enabled` is set optimistically, not gated on binary presence

- **Status:** Resolved (2026-07-17) — the check-and-decision point already existed at
  `/init-stack` step 8; the bug was that the nag text pointed at the wrong step number.
- **Context:** `gsd-config-patch.mjs`'s tier2 default sets `code_quality.fallow.enabled` to
  `true` whenever the project root has a `package.json` — deliberately without checking
  whether the `fallow` binary is actually installed (see the comment above
  `DEFAULT_WORKFLOW_CONFIG` in that file). The declared, still-current rationale: fallow's own
  error message is loud/actionable (`npm install -D fallow` / `cargo install fallow`), and
  `/init-stack` step 8 ("`fallow` devDependency proposal") is the actual check-and-decision
  point — it detects whether the binary is already installed, and if not, asks the user via
  `AskUserQuestion` to either install it or explicitly set `enabled: false` (closing the gap
  for good, not a silent decline). `session-init.mjs` and `gsd-config-patch.mjs` tier3 both
  re-check every session/throttle window and surface a note pointing at this step when
  `enabled=true` but the binary is missing.
- **Root cause found:** that nag text (and the code comment above the tier2 default) referenced
  "`/init-stack` step 6" / "step 5" — stale after `init-stack.md` gained a `claude_orchestration`
  step and the fallow proposal shifted to step 8, the test/build proposal to step 6. Hit in
  practice 2026-07-17: manually set `code_quality.fallow.enabled: false` in a project to unblock
  `code-review`, following a nag that pointed at the wrong (non-existent-for-this-purpose) step.
- **Fix:** corrected all stale step-number references to the actual current numbering —
  `gsd-config-patch.mjs` (comment + gap-note text) and `session-init.mjs` (fallow gap note +
  test/build one-time suggestion) now say step 8 and step 6 respectively. Also strengthened
  both fallow gap notes so they no longer only point at `/init-stack`: they now embed the
  concrete install command inline (`pnpm add -D fallow`, or `pnpm add -D fallow -w` when
  `pnpm-workspace.yaml` exists at root) so the binary can be installed directly, without
  needing to run the full interactive `/init-stack` flow first.
- **Follow-up sweep (same session):** the same drift wasn't limited to fallow. Grepped the
  whole repo for `"step N"`/`"steps N-M"` cross-references into `init-stack.md` and found the
  identical bug in 9 more places, all stemming from the same `claude_orchestration` step
  insertion (step 10 "apply pending gsd-* agent patches" and step 11 "sync personal GSD
  defaults" had shifted from what used to be step 9/10): `session-init.mjs` (4 occurrences),
  `gsd-agent-patches.mjs`, `gsd-workflow-patches.mjs`, `apply-gsd-agent-patches.mjs`,
  `gsd-defaults-sync.mjs`, `rules-src/gsd.md`, plus two README lines (`GSD-шагов 5-6` / `GSD
  steps 5-6` reconfigure-table rows) and two more claiming `mark-initstack-done.mjs` runs as
  init-stack's "last step" (it's step 9 of 11 — steps 10-11 run after it) in `README.md`,
  `README.en.md`, `mark-initstack-done.mjs`, and `leanmode-rules.mjs`. All corrected to the
  current numbering (verified against `init-stack.md`'s actual `## N.` headings). Also fixed
  a separate, non-numbering bug found in the same sweep: `setup.mjs`'s comment claimed
  "`/init-stack`'s own step 0" duplicates its update-check offer per-project — no such step
  exists anywhere in `init-stack.md` (grepped for update/release/background-check content,
  zero matches); the offer is machine-wide-only in `setup.mjs`, corrected to say so.
- **Residual:** `init-stack.md`'s own step numbers can drift again if a step is
  inserted/removed in the future without grepping for `"step N"` cross-references across the
  repo. No automated check ties any of this text to the command file's actual heading numbers.
  The inline fallow install command assumes pnpm (consistent with the rest of this repo's Node
  tooling conventions) — a project on npm/yarn only would need to adapt the command by hand.

## RISK-TOKENLOG-001 — Scraped model pricing can silently break

- **Status:** Open (accepted)
- **Context:** `hooks/lib/token-usage-pricing-refresh.mjs` estimates `cost_usd` in the
  token-usage log by scraping `docs.claude.com/en/docs/about-claude/pricing`'s HTML pricing
  table. There is no official Anthropic pricing API — this is regex-based HTML parsing against a
  page Anthropic doesn't version or contract to keep stable. If the page's markup structure
  changes, parsing can silently return zero or partial rows.
- **Mitigation:** a `MIN_EXPECTED_MODELS` guard (currently 8) rejects a suspiciously small parse
  result and leaves the existing `~/.claude/state/model-pricing.json` untouched rather than
  overwriting it with bad data; `token-usage-log.mjs` surfaces a `systemMessage` warning when the
  pricing file is more than 48h stale. Refresh is throttled to once/24h and fully optional
  (`CLAUDE_TOKEN_USAGE_COST=0` disables cost estimation and the refresh job entirely, leaving raw
  token counts only).
- **Residual:** `cost_usd` is always a **best-effort local estimate**, never billing-grade — same
  disclaimer Claude Code's own `/usage` command carries for its dollar figure. Accepted.

## RISK-NEO4J-001 — Multi-source staleness when several PCs push the global graph to one Neo4j

- **Status:** Open (mitigated by design)
- **Context:** each PC has its own `~/.graphify/global-graph.json` (aggregate of that PC's repos).
  Multiple PCs push into one shared Neo4j on the NAS. graphify's `MERGE` never deletes, so nodes
  for files deleted in a repo persist. A naive "rebuild = wipe the whole graph then re-push" would
  destroy the repos contributed by *other* PCs (they are not in the wiping PC's global graph).
- **Mitigation:** per-repo scoped refresh, never a global wipe. Every global-graph node carries a
  `repo` property (= repo_tag; `prefix_graph_for_global` in graphify `build.py`). Before the MERGE
  push, the wrapper deletes only the repos present in *this* PC's global graph:
  `MATCH (n {repo: $tag}) DETACH DELETE n`. Repos known only to other PCs are never matched.
- **Residual:** shared external-library nodes (deduped by label) are owned by whichever repo added
  them first and can be briefly orphaned on that repo's refresh; MERGE re-adds them on next push.
  See RISK-NEO4J-005 for the same-repo-two-PCs case. Accepted.

## RISK-NEO4J-002 — NAS/Neo4j unavailable at push time

- **Status:** Open (mitigated by design)
- **Context:** the push runs after a graph rebuild and may be chained onto `graphify-sync-all` or a
  commit-time flow. If the NAS is down/asleep or the bolt port is unreachable, a hard failure would
  block the sync (or a commit, if ever wired there).
- **Mitigation:** the wrapper does a short TCP reachability probe on the bolt host:port first and is
  **fail-soft** — on unreachable it warns and exits 0, leaving the JSON source of truth intact. The
  push is never a prerequisite for any commit/sync step.
- **Residual:** Neo4j can lag the JSON until the next successful push. Acceptable — JSON is the
  source of truth graphify reads; Neo4j is an eventually-consistent mirror. Accepted.

## RISK-NEO4J-003 — Neo4j credentials leaking into the repo or argv

- **Status:** Open (accepted)
- **Context:** the write path and the MCP both need a Neo4j password. Committing it, or passing it
  as `--password` on argv (visible in `ps`/shell history), would leak it.
- **Mitigation:** password lives only in `~/.graphify/neo4j.env` (user home, chmod 600, outside every
  repo) for the write path and in the user's private `~/.claude` MCP config for the read path. The
  wrapper loads that env file and relies on graphify's `NEO4J_PASSWORD` env support (never `--password`
  on argv). No connection string or password is ever written into this repo; the secrets-gate hook
  remains the backstop.
- **Residual:** a user could still hand-paste creds into a committed file; the gate catches common
  shapes but not all. Accepted.

## RISK-NEO4J-004 — graphify upgrade breaks the write path or the agent patch

- **Status:** Open (accepted / low)
- **Context:** the integration depends on graphify's `export neo4j` CLI and on the `repo`/id-prefix
  node schema, and the Cypher agent guidance is injected as a prose patch into gsd-* agent files.
  An upstream graphify change could move any of these (the 0.9.13 refactor already relocated modules).
- **Mitigation:** the write path uses only the public, stable `graphify export neo4j` CLI and the
  documented `NEO4J_PASSWORD` env, not internals (verified intact through 0.9.22). The agent patch
  uses the existing versioned, anchor-based patch infra (`gsd-agent-patches.mjs`), which skips
  cleanly (`skippedNoAnchor`) if an anchor moves rather than corrupting a file, and re-applies
  idempotently on upgrade.
- **Residual:** a CLI-level breaking change in graphify would need a wrapper update; surfaced by the
  quality-check queries failing. Accepted.

## RISK-NEO4J-005 — Same repo cloned on two PCs flip-flops in Neo4j

- **Status:** Open (accepted)
- **Context:** if the identical repo is present on two PCs at different states and both sync+push
  frequently, the per-repo refresh (RISK-NEO4J-001) makes them alternately overwrite that repo's
  nodes — last push wins, so the graph oscillates.
- **Mitigation:** default is last-writer-wins, which yields the latest-pushed state and is usually
  fine (same repo → same code). Optional hardening if it becomes a problem: designate one PC as
  authoritative for the shared repo, or namespace repo_tag with the hostname so the two clones are
  distinct nodes.
- **Residual:** transient oscillation for a genuinely divergent shared repo under frequent dual
  sync. Accepted; revisit only if observed.

## RISK-PNPM-001 — False positives from dynamic/conditional imports

- **Status:** Open (accepted / low)
- **Context:** the scan statically extracts bare imports (`import`/`require`/`export-from`/dynamic
  `import()`) and flags any undeclared specifier whose package is installed somewhere in the
  workspace. A conditionally- or dynamically-imported package that the consumer never actually
  reaches at runtime could still be flagged.
- **Mitigation:** three layers make a false positive harmless. (1) The **installed-in-workspace
  gate** — a specifier is only flagged when its package is genuinely resolvable, so a genuinely
  absent optional adapter is never touched. (2) The fix is an **optional peer**
  (`peerDependenciesMeta.optional: true`) — declaring one that goes unused has no effect on
  resolution or install. (3) **Additive-only** writes — nothing existing is removed or rewritten,
  so an over-declaration is trivially reversible by hand.
- **Residual:** at worst a harmless, unused optional-peer line in `pnpm-workspace.yaml`. Accepted.

## RISK-PNPM-002 — Native-trigger coverage gap for sub-package installs

- **Status:** Open (accepted)
- **Context:** the always-on trigger is a PostToolUse hook (fires after Claude-invoked
  `pnpm install`/`add`) plus a root `postinstall` (fires on the user's own top-level installs). An
  install run *inside a nested workspace package* in the user's own terminal may not fire the root
  `postinstall`, leaving a newly-introduced phantom undetected until the next top-level install.
- **Mitigation:** the Claude-side hook covers agent-driven installs regardless of directory, and the
  `/pnpm-phantom-fix` command is a manual backstop the user can run at any time. The failure mode is
  detection latency, not a wrong write.
- **Residual:** a phantom introduced by a manual sub-package install stays latent until the next
  top-level install or manual scan. Accepted; documented as a caveat in the command.

## RISK-PNPM-003 — Auto-writing pnpm-workspace.yaml

- **Status:** Open (accepted / low)
- **Context:** the scan writes `packageExtensions` entries into `pnpm-workspace.yaml` automatically.
  Node has no stdlib YAML parser and npm deps are forbidden, so a minimal line-oriented handler
  edits the file — a full parser is not available to guarantee round-tripping arbitrary shapes.
- **Mitigation:** the handler is **additive-only** (only inserts new lines, never rewrites existing
  ones) and **fail-safe**: on any shape it can't safely edit (flow/JSON-style block, tabs, or a `P`
  key already present where a fresh block would risk a duplicate mapping key) it makes **no write**
  and prints the entries for manual addition. Idempotency and the fail-safe paths are locked by
  unit tests.
- **Residual:** an unusual hand-authored `pnpm-workspace.yaml` shape falls back to manual entry
  rather than an automated fix. Accepted — safety over convenience.
