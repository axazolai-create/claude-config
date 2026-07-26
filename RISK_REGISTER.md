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
  **Superseded context (2026-07-27):** `init-stack.md`'s steps 6-11 (including this fallow
  step 8) were later deleted wholesale in the GSD-free rewrite `eaf1a50` — the interactive
  fallow proposal no longer exists anywhere. See RISK-INITSTACK-001 for the current state.
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

## RISK-NEO4J-006 — Connection test at setup time depends on the neo4j driver being present

- **Status:** Open (mitigated by design)
- **Context:** the 2026-07-24 C4 rewrite (`docs/superpowers/specs/2026-07-24-graphify-neo4j-setup-test-before-save-plan.md`)
  makes `setup.mjs` **test** the Neo4j connection before writing `~/.graphify/neo4j.env`. The
  authoritative test (`RETURN 1` via the python driver) needs `neo4j` installed in graphify's
  interpreter. On a fresh PC where graphify/driver is absent, the test cannot run.
- **Mitigation:** the C4 flow calls `ensureNeo4jDriver` (uv `--with neo4j` / pipx inject / pip)
  right before the test, so the driver is installed exactly when Neo4j is configured — full
  always, lite only when the ecosystem is opted in (kept out of graphify's blanket extras so lite
  stays clean by default). If it still can't be made present, C4 does not save a false "enabled" —
  it leaves `GRAPHIFY_NEO4J` unset so the offer re-asks next run (same idiom as a filesystem-write
  failure). Governed by decision D1 in the plan.
- **Residual:** on a PC with no way to install the driver, Neo4j config is deferred, not saved
  broken. Accepted — deferral is the correct outcome there.

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

## RISK-PNPM-004 — enableGlobalVirtualStore structurally incompatible with Turbopack

- **Status:** Mitigated (detector built; auto-apply intentionally not done)
- **Context:** `enableGlobalVirtualStore: true` relocates pnpm's virtual store (`node_modules/.pnpm`,
  the real package directories) OUT of the project tree. Turbopack (Next.js) by design only
  resolves/serves files under its `root`. So `next` and other packages living out-of-tree cannot
  have their chunks served: the dev server starts, then after a hard reload (ctrl+F5) the client
  requests freshly-resolved chunk URLs that map outside root → `404 / ChunkLoadError`. This is a
  DIFFERENT failure class than phantom deps — `packageExtensions` (RISK-PNPM-001..003) cannot fix
  it because it does not move files inside root.
- **Mitigation:** for Turbopack/Next projects, either (A) disable gVS project-scoped
  (`.npmrc: enable-global-virtual-store=false`, then `rm -rf node_modules && pnpm install`) — the
  virtual store returns in-tree; guaranteed to work, loses cross-worktree dedup; or (B) place the
  virtual store in a sibling folder under a common parent (`virtual-store-dir=<abs adjacent path>`)
  and widen Turbopack's boundary (`turbopack.root` + `outputFileTracingRoot`) to that parent —
  preserves dedup, less-trodden, may hit Turbopack edge cases.
- **Detection:** `payload/bin/turbopack-gvs-check.mjs` (wired into init-stack, Next+pnpm only)
  flags Turbopack/Next + effective out-of-tree store (gVS flag OR a junctioned `.pnpm` OR an
  external `virtual-store-dir`) and prints the tailored Strategy-B recipe with a format-aware
  (CJS/ESM) next.config snippet. Strategy B chosen (sibling store + widened root) over disabling
  gVS, to preserve cross-worktree dedup.
- **Residual:** the detector WARNS with a recipe but does not auto-edit `.npmrc`/`next.config`
  (project-specific paths + arbitrary config formats make auto-writing unsafe) — applying it is a
  consent-gated manual step. Strategy B is the less-trodden path and may hit Turbopack edge cases;
  the fallback (disable gVS, store in-tree) is noted in the recipe. Accepted.

## RISK-SUP-001 — Hang supervision depends on the model wrapping the job

- **Status:** Open (accepted)
- **Context:** the hard hang guarantee comes only from jobs launched through `supervise-bg.mjs`
  (or a self-bounded watcher like `gh run watch --exit-status`). A raw `run_in_background` job that
  hangs still emits no event. Hooks cannot force the wrapper or arm a timer, so the launch-time
  nudge is advisory, not enforced.
- **Mitigation:** the PreToolUse `bg-supervision-nudge` fires deterministically at every
  unsupervised bounded background launch, making the reminder reliable even if memory/prose is
  ignored. The wrapper itself is the guarantee once used.
- **Residual:** a model that ignores the nudge and launches a raw job can still hang invisibly.
  Accepted — this is the ceiling of what hooks can enforce.

## RISK-SUP-002 — Task* hook events unverified in this harness build

- **Status:** Open (verification pending)
- **Context:** `TaskCreated`/`TaskCompleted` are documented hook events but not confirmed wired in
  the running build. They are registered pointing at a probe, not at behaviour-changing logic.
- **Mitigation:** `task-lifecycle-probe.mjs` only logs firings + payload schema; if the events do
  not exist, the entries are inert (unknown events are ignored). Real handling is wired only after
  the probe log confirms they fire and reveals their schema (post-restart).
- **Residual:** the cleaner TaskCreated launch surface stays unused until verified. Accepted.

## RISK-SUP-003 — supervise-bg could kill a legitimately long or quiet job

- **Status:** Open (accepted / low)
- **Context:** the wrapper's wall-clock timeout and output-staleness watchdog could terminate a
  job that is genuinely long-running or intentionally quiet (a slow build, a silent long task).
- **Mitigation:** defaults are generous (30 min wall / 5 min staleness) and both are tunable per
  launch (`--timeout`, `--stale`); `--timeout 0` / `--stale 0` disable a check. The launch nudge
  skips obvious long-lived servers entirely, so those are not wrapped in the first place.
- **Residual:** a mis-tuned bound on an atypical job could kill it early; the `HANG` marker and
  exit code 124 make that diagnosable. Accepted.

## RISK-VARIANT-001 — Variant switch could delete a file the user hand-edited under `~/.claude`

- **Status:** Open (accepted)
- **Context:** switching bundle variant (`node setup.mjs --variant=...`) prunes files that the
  new variant's `include`/`exclude` set in `variants.json` no longer covers. If prune ran
  blindly, a file the user edited in place after install (a hand-patched hook, a customized
  skill) could be silently deleted along with the genuinely stale ones.
- **Mitigation:** the same `pruneStale()` hash gate used for ordinary version-to-version prune
  applies to variant-surplus files too — a file is only deleted if its on-disk SHA still matches
  what the last `setup.mjs` run recorded in the manifest; anything modified since is kept and
  reported (`kept: modified since install`), never auto-removed. Curated (`CURATED:NOEDIT`)
  files are excluded from prune candidates outright. `--dry-run` previews the full surplus list
  with no writes, and the interactive path always asks `remove these stale files? (y/N)` before
  deleting anything. This path is exercised end-to-end by `setup-variants.e2e.test.mjs`
  (full→lite→full switch, asserting a hand-modified file survives prune).
- **Residual:** the real residual is a user who runs a bulk auto-confirm flag
  (`--replace-all`/`--merge-all`, which imply prune-confirm) without reading the printed surplus
  list first — the hash gate still protects modified files even then, but curated/unmodified
  surplus is removed without a per-file prompt. Accepted — same trust model as every other
  bulk-flag use in this installer.

## RISK-VARIANT-002 — `managedPlugins` marketplace ids can drift from the live marketplace

- **Status:** Open (accepted)
- **Context:** `variants.json`'s `managedPlugins` hardcodes marketplace ids
  (`superpowers@claude-plugins-official`, `gsd@claude-plugins-official`,
  `context-mode@context-mode`, `context7@claude-plugins-official`) that `plugin-reconcile.mjs`
  uses to build install/uninstall/enable/disable plans. These ids are not queried live at plan
  time — if a marketplace renames or re-publishes a plugin under a different id, the
  reconciliation plan would target a stale id. The `gsd` id specifically is **UNVERIFIED on the
  implementation machine**: `gsd` was not installed there as a marketplace plugin when
  `variants.json` was written, so its id was filled in by convention (matching the two confirmed
  `...@claude-plugins-official` ids) rather than read from a live `claude plugin list`; the
  documented fallback if it turns out wrong is the same shape, `gsd@claude-plugins-official`.
- **Mitigation:** reconciliation never applies silently — `buildPluginPlan()`'s full plan
  (install/uninstall/enable/disable per plugin) is always printed before anything runs. The two
  execution paths differ deliberately (spec § 4): **interactive** run asks one aggregate y/N
  (`apply N plugin action(s)? (y/N)`) and, on yes, executes everything, including `claude plugin
  install/uninstall`. **Non-interactive / bulk-flag** (`--replace-all`/`--merge-all`) auto-applies
  only the `enabledPlugins` JSON edits (local, additive, reversible — same trust model as the
  rest of the settings-merge); `install`/`uninstall` are never auto-executed there — each is
  printed as a ready-to-run manual command (`run manually: claude plugin <type> <id>`) and
  recorded in the summary as `plugin-<type>-manual <id>`. **Dry-run / hermetic**
  (`--dry-run`, or `CLAUDE_SETUP_SKIP_PLUGINS=1`) executes nothing at all. A wrong id surfaces
  immediately as a failed `claude plugin install` (`plugin-install-FAILED`) on the interactive
  path rather than a silent no-op.
- **Residual:** until someone re-verifies `gsd`'s id against a live marketplace listing (`claude
  plugin list`/`claude plugin search` on a machine with `gsd` actually installed), a full-variant
  install/switch that needs to newly *install* `gsd` could fail at that one step on the
  interactive path; everything else in `setup.mjs` (file copy, hooks, settings merge) still
  completes. On the bulk path the same wrong id would instead surface as a printed manual command
  the user runs by hand, catching the failure before it executes. Accepted; revisit by
  confirming the id on a machine that has `gsd` installed via the marketplace.

## RISK-INJECT-001 — Generalizing the leanmode hook into an axis injector could change leanmode behavior

- **Status:** Open (until tests green)
- **Context:** `payload/hooks/leanmode-subagent.mjs` (single-axis SubagentStart) becomes
  `inject-axes.mjs`, iterating an axis registry over both SessionStart and SubagentStart. Any
  drift in how leanmode's level is resolved or injected per agent_type would silently weaken a
  working mechanic. See docs/superpowers/specs/2026-07-26-ai-development-mode-design.md § 2.
- **Mitigation:** the leanmode axis re-exports `lib/leanmode-rules.mjs` unchanged, so its
  resolution logic is untouched; the full existing `leanmode-*` test suite is the gate; add an
  axis-independence test (leanmode=off still injects verbosity, and vice versa) and a
  per-event coverage test (SessionStart → verbosity only; SubagentStart → both when on).
- **Residual:** the injector composition layer is new code; regression risk retired once the
  leanmode suite + new tests are green.

## RISK-VERBOSITY-001 — "Terse" verbosity axis slides into minification or drops load-bearing intent

- **Status:** Open (accepted, behavioral)
- **Context:** the verbosity axis tells the model to drop comments and filler whitespace. Over-
  interpreted, the model could shorten identifiers, collapse required structure, remove a comment
  that carried a non-obvious *why*, or delete a docstring that is a real public API contract.
  See design § 3.
- **Mitigation:** every tier text ends with a verbatim hard carve-out — preserve names, casing,
  mandatory syntax/indentation, error handling, validation, security; explicitly "NOT
  minification"; ultra is opt-in only. Correctness/security are out of the axis's scope by
  construction (same carve-out leanmode makes).
- **Residual:** prose-guided behavior can still misfire on an edge case; caught in review, not
  hook-enforced. Accepted.

## RISK-DESIGNSTACK-001 — Impeccable installer footgun writes into all harnesses + settings.local.json

- **Status:** Open (mitigated by design) — Phase 3, spec
  `docs/superpowers/specs/2026-07-26-phase3-design-skills-integration-design.md`.
- **Context:** `npx impeccable install` is interactive and its **default** answer installs the
  skill into every detected harness (`~/.claude`, `~/.agents`, `~/.gemini`) AND appends a
  PostToolUse/Stop hook block to `settings.local.json`. `install --help` does not print flags — it
  re-runs the installer. A naive call from `/init-stack` could pollute the user's global config.
- **Mitigation:** the orchestrator (`bin/install-design-stack.mjs`) always invokes via
  `runInstaller` with a **scratch `HOME`/`USERPROFILE`** (fresh temp dir), `cwd=<project root>`, and
  explicit `--providers=claude --scope=project --no-hooks`, so nothing touches the real global
  harnesses and Impeccable's own settings writer is disabled; our settings-injector registers the
  design hook into the project's `.claude/settings.json` instead. An end-state test asserts the
  scratch HOME ≠ real HOME and that only `<root>/.claude` is written.
- **Residual:** relies on the installer honouring `--scope=project`/`--no-hooks`; a future
  Impeccable that ignores them would need the orchestrator pinned/updated. Accepted.

## RISK-DESIGNSTACK-002 — `impeccable update` clobbers the Pro Max content-graft

- **Status:** Open (mitigated by design)
- **Context:** Pro Max is integrated by grafting "query search.py first" prose into Impeccable's
  `reference/*.md` (no first-class external-DB plug exists). `npx impeccable update` overwrites those
  files, silently removing the graft and the Pro Max enrichment with it.
- **Mitigation:** the updater's `afterUpdate` (`component-registry.mjs` `impeccable` entry) re-runs
  `applyPromaxGraft()` after every auto-update; the graft is anchored + sentinel-guarded
  (`<!-- promax-graft:v1 -->`) so re-apply is idempotent — same infra shape as
  `gsd-agent-patches.mjs`.
- **Residual:** if an Impeccable release renames/removes the target reference files the anchor is
  not found and the graft is **skipped** (reported as `skippedNoAnchor`), not mis-inserted — the
  detector still works, just without Pro Max enrichment until the anchors are refreshed. Accepted.

## RISK-DESIGNSTACK-003 — Pro Max search requires Python 3

- **Status:** Open (accepted)
- **Context:** `ui-ux-pro-max`'s `scripts/search.py` (local BM25 over the style/palette/font CSVs)
  needs a Python 3 interpreter (stdlib only, no network). On a machine without python3 the search
  step cannot run.
- **Mitigation:** soft-degrade — the orchestrator warns at install time if python3 is absent, and
  the grafted prose explicitly instructs "query search.py **if available**, else fall back to the
  reference tables below" (the same CSV data is also readable as prose tables the agent can consult).
- **Residual:** on a python-less machine the agent uses the static reference tables rather than
  ranked search — reduced quality, not a failure. Accepted.

## RISK-DESIGNSTACK-004 — Registered hook path couples to the installed skill's script location

- **Status:** Open (mitigated by design)
- **Context:** the design hook we register into the project's `.claude/settings.json` points at
  `.claude/skills/impeccable/scripts/hook.mjs`. If an Impeccable upgrade relocates or renames that
  script, the hook silently stops firing.
- **Mitigation:** idempotent re-registration — re-running `/init-stack` (and the updater's
  post-update path) re-verifies the hook entry and the script path, re-registering if it moved;
  the registration step short-circuits only when a valid entry pointing at an existing script is
  present.
- **Residual:** between an upstream rename and the next `/init-stack`/update cycle the hook could be
  stale. Low (Impeccable's script layout has been stable at v3.3.1); accepted.

## RISK-DESIGNSTACK-005 — Pro Max `design` sub-skill hardcodes global paths / prune could delete a user skill

- **Status:** Resolved (subset choice + provenance-based prune)
- **Context:** the `uipro init` suite includes a `design` skill that hardcodes global
  `~/.claude/skills/design/` paths, which breaks when the skill is copied project-local; `brand`,
  `banner-design`, `slides` reference absent premium skills. A first design pruned these by a
  **hardcoded name list**, which would have silently deleted a user's own pre-existing skill that
  happened to be named `design`/`brand`/`slides` (generic names) — real user-data loss.
- **Mitigation:** the D3 subset keeps only `ui-ux-pro-max` + `ui-styling` + `design-system`; the
  orchestrator prunes via **provenance**, not names — it snapshots `<root>/.claude/skills` right
  before running `uipro init` and prunes only dirs the install **created** that aren't in
  `keepSkills` (`pruneProMaxSkills(..., { protect: <before-snapshot> })`). A pre-existing skill of
  ANY name is in the before-snapshot and is never deleted; the footgun `design`/etc. that uipro
  creates fresh is pruned. Verified live 2026-07-27: `uipro init` does create a `design` dir, and
  the provenance test proves a pre-existing user `design` survives while install-created extras are
  removed.
- **Residual:** if `uipro` is run OUTSIDE the orchestrator first (extras pre-exist the orchestrator's
  snapshot) they are treated as user content and left in place — acceptable (the orchestrator only
  prunes what it installs). Accepted.

## RISK-DESIGNSTACK-006 — Pinned npm package ids can drift or rename

- **Status:** Open (accepted / low)
- **Context:** the updater's project probe reads latest versions via `npm view impeccable version`
  and `npm view ui-ux-pro-max-cli version`; the orchestrator installs by those ids. A rename or
  unpublish upstream would break the probe/install.
- **Mitigation:** `check()` is best-effort and fully fail-soft (wrapped in `safe()`, `main().catch`
  backstop) — a bad id yields no version signal and no crash; the install step warns and continues
  without aborting `/init-stack`.
- **Residual:** a silent rename leaves the components un-updated until the ids are corrected;
  detection is manual. Accepted / low.

## RISK-INITSTACK-001 — `/init-stack` GSD-free rewrite deleted steps 6-11; ~24 stale references + 2 dropped capabilities

- **Status:** Partially resolved (2026-07-27) — the stale references are fixed; reinstating the two
  genuinely-dropped capabilities is a tracked design task.
- **Context:** commit `eaf1a50` rewrote `payload/commands/init-stack.md` into a single "GSD-free" doc
  shared by all three profiles and, in doing so, **deleted old steps 6-11 wholesale** (not renumbered):
  the stack-aware test/build-command proposal, the `claude_orchestration` pilot ask, the `fallow`
  devDependency proposal, apply-gsd-agent-patches, and sync-gsd-defaults. Only "mark leanmode dial +
  graphify freshness" survived (now current step 7). ~24 references across ~12 files
  (`session-init.mjs`, `gsd-config-patch.mjs`, `apply-gsd-agent-patches.mjs`, `gsd-agent-patches.mjs`,
  `gsd-workflow-patches.mjs`, `gsd-defaults-sync.mjs`, `leanmode-rules.mjs`, `mark-initstack-done.mjs`,
  `rules-src/gsd.md`, `setup.mjs`, `references/gsd-claude-orchestration-pilot.md`, `README.en.md`) kept
  pointing at those dead step numbers. An investigation (2026-07-27) classified each as GSD-only vs
  generally-useful and confirmed which functionality still exists and where.
- **Resolution (done — commits `25f339a`, `420a1cd`):** every stale reference corrected to the truth,
  comment/string/doc text only, no logic touched, full sweep green (215/215). REMAP: gsd-agent /
  workflow-patch pointers → `/init-session` (its only current caller); gsd-defaults-sync → manual-only;
  mark-initstack-done step 9 → current step 7. REWORD/REMOVE: the false test/build, `fallow`, and
  `claude_orchestration` "run /init-stack step N" promises now state the step was removed and cite this
  risk id; the orphaned `gsd-claude-orchestration-pilot.md` gets a dormant-doc note (preserved, not
  deleted). **No functionality was reinstated.**
- **Open (design task — Category II):** two capabilities were genuinely dropped, not just mislabeled —
  (1) the stack-aware test/build-command proposal and (2) the `claude_orchestration` pilot ask — and
  `fallow`'s install-proposal never reached base/lite. Reinstating them must mount in the orchestrator
  that owns code-review **per profile — GSD's gates in full, Superpowers' gates in base/lite** (NOT
  universally Superpowers, which would strip GSD in full); profile-membership + install gating should
  reuse the `pnpm-phantom-fix` stack-marker pattern, not GSD-coupling. See memory
  `gsd-superpowers-orchestration-boundary`.
- **Residual:** until that task ships, base/lite get no `fallow` awareness and `full` lost the
  interactive test/build + orchestration asks (gsd-core's generic auto-detect still covers test/build;
  the orchestration-pilot doc is dormant-but-preserved). Accepted for now.

## RISK-GRAPHFRESH-001 — Stage 2 freshness edits regress the working graphify autosync

- **Status:** Open (until Stage 2)
- **Context:** G Stage 2 edits the existing, working autosync (`hooks/graphify-global-sync.mjs`,
  `hooks/lib/graphify-global-sync-run.mjs`, `bin/graphify-freshness*`) to guarantee `graphify
  query` never answers from a stale graph. A careless edit could cause missed syncs, double
  syncs, or a perf regression. See design § 4.
- **Mitigation:** pin-then-edit — a regression test locking current autosync behavior runs before
  the change and must still pass after; Stage 2 lands only after Stage 1 (grep nudge, zero-risk)
  is merged and green; Stage 2 is splittable into a follow-up spec if the risk grows during
  planning.
- **Residual:** none accepted yet — this risk is not closed until Stage 2 ships with the guard
  test green, or is deferred to its own spec.
