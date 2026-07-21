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
  twice. (3) Even where the compiler subagent still stamps the frontmatter, the staleness check it
  supports is weak: `computeSourceHash` (`stack-rules-check.mjs:20-38`) hashes only relative path +
  size + mtime (`:32-33`), so a size-and-mtime-preserving edit (archive extraction, `rsync -t`,
  `cp -p`) is invisible; and the read slices only the first 800 bytes (`:92`), so a snapshot
  truncated mid-write past its frontmatter still reads `status:"ok"` (`:95`).
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

## RISK-SETTINGS-001 — Unlocked read-modify-write on shared config/state → lost updates under concurrency

- **Status:** Open (unmitigated)
- **Context:** Several independent writers mutate the same shared files with plain
  `readFileSync` → `JSON.parse` → `writeFile`, no lock and no temp+rename atomicity, so a
  concurrent writer (a second session, or a hook firing during `/init-stack`) can silently drop
  the other's update. Three surfaces:
  - Project `.claude/settings.json` — `init-stack.py apply()` reads `:598` / writes `:615`;
    `session-init.mjs:201-207` independently RMWs it. `deep_merge` (`init-stack.py:309-315`)
    recurses only into dicts, so a template array-valued `merge` key **replaces** a user-set array
    rather than merging.
  - Machine-wide `~/.claude/agents/gsd-*.md` — three unsynchronized writers: `session-init.mjs:452`
    (`syncGsdAgentsContextMode`, every session), `init-stack.py:945-960` (every invocation), and
    `gsd-agent-patches.mjs:592` (prose patches). Two concurrent sessions interleave, last writer
    wins; a context-mode tool-grant or a freshly-applied patch can be clobbered.
  - `~/.claude/state/project-init.json` — RMW at `session-init.mjs:543`, `gsd-config-patch.mjs:266`
    (fires on EVERY `Bash|Write|Edit|MultiEdit`), and `mark-initstack-done.mjs:34`. A one-time gate
    flag (`initStackRun`, `graphifySynced`, …) can be lost, so a step re-fires or a just-set flag is
    overwritten and its step effectively skipped.
- **Mitigation:** none yet. Options: a shared atomic-write helper (temp file + rename); a per-file
  `.lock` sentinel with stale-timeout; or a single owner for the machine-wide agent sync. The
  `deep_merge` array behaviour needs an explicit union-vs-replace policy.
- **Residual:** until fixed, plugin entries, patch blocks, and one-time flags can be silently
  dropped when two sessions overlap or a hook fires during `/init-stack`.

## RISK-SETTINGS-002 — `session-init.mjs` writes `settings.json` without an `enabledPlugins` key

- **Status:** Open (fix identified, ~1 line)
- **Context:** `session-init.mjs:199-210` — when a GSD project has `.planning/CLAUDE.md` but no
  `.claude/settings.json` yet, the hook creates the file with only `claudeMdExcludes` (`s = {}` at
  `:200`, write at `:207`), no `enabledPlugins` key. This is exactly the failure `payload/CLAUDE.md`
  § PLUGINS warns about ("Keep an `enabledPlugins` key … even if `{}` — otherwise entries in
  settings.local.json are silently dropped on merge"): on the next Claude Code startup merge,
  plugins declared in `settings.local.json` are dropped. `init-stack.py apply()` always writes the
  key (`:602`, `:613`), but this hook path bypasses init-stack entirely.
- **Mitigation:** ensure `enabledPlugins` (default `{}`) is present before the write in the
  fresh-file branch of `session-init.mjs`.
- **Residual:** none once the key is always emitted.

## RISK-AGENTPATCH-001 — gsd-* agent patches silently skipped or mis-applied

- **Status:** Open (unmitigated)
- **Context:** `gsd-agent-patches.mjs` — (a) when gsd-core rewrites the surrounding text so
  `insertAnchor` isn't found, `applyOrUpgradePatch` returns `noAnchor` (`:101-103`) and the write is
  skipped; it's recorded in `skippedNoAnchor` but only surfaces if the user reads `/init-stack`
  step 10 output. (b) If a gsd-*.md carries `CURATED:NOEDIT`, both `checkGsdAgentPatches:545` and
  `applyGsdAgentPatches:576` `continue` — pending patches are neither applied NOR reported as
  pending (fully silent). (c) "Applied" is keyed off the `<!-- gsd-patch:ID vN -->…<!-- /gsd-patch:ID
  -->` marker pair (`:74-78`); a hand-broken closing marker makes `findMarkedSpan` return null and
  `legacyMatch` (`:79-84`) fail, so a fresh block is inserted (double-apply), while a version bump
  does `replaceOnce(marked.fullMatch, …)` (`:98`), discarding any manual edit inside the span.
- **Mitigation:** none yet. Options: surface `skippedNoAnchor` and curated-pending as a
  session-start note (not only step-10 output); a second-anchor/fuzzy fallback; treat a broken
  marker as needs-attention rather than fresh-insert.
- **Residual:** a hardening patch (e.g. the executor no-recursive-spawn guardrail) can fail to land
  with no visible signal.

## RISK-DETECT-001 — Stack-detection ambiguity: two detectors disagree; pooled `.csproj` classification

- **Status:** Open (accepted / low impact for the current stack set)
- **Context:** (a) `init-stack.py detect()` classifies by `package.json`/`.csproj` CONTENT (`:154`
  nest via `@nestjs/core`, `:162-167` react via deps, `:211-219` C# by csproj text), whereas
  `stack-rules-check.mjs detectMarkers` (`:45`, `:72-81`) keys off FILENAMES only — the two use
  different signal sets, so a content-only stack change (adding a framework dependency with no new
  config file) never moves the fingerprint (compounds RISK-STACKRULES-002). (b) `_csproj_text()`
  (`:121-128`) concatenates EVERY `.csproj` in the tree into one string before classifying, so in a
  mixed solution one ASP.NET/WPF project suppresses a genuine console app's `csharp-cli` tag (gated
  `not any(aspnet, wpf)` at `:216`), and separate web + desktop projects are indistinguishable.
- **Mitigation:** the fingerprint desync overlaps the already-accepted RISK-STACKRULES-002; C#
  pooling could classify per-`.csproj` instead of on concatenated text.
- **Residual:** rare mis-selection in mixed .NET solutions; content-only framework switches need a
  manual `/init-stack` rebuild. Low impact while the active project set is Node-centric.
