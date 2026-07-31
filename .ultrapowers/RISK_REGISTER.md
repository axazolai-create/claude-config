# Risk Register

## Contents

### Active
- [RISK-BOOTSTRAP-001 — Remote code execution via `curl|bash` / `irm|iex` bootstrap](#risk-bootstrap-001-remote-code-execution-via-curlbash-irmiex-bootstrap)
- [RISK-CHANGELOG-001 — The post-commit trigger enqueues the skill's own manual bump commits](#risk-changelog-001-the-post-commit-trigger-enqueues-the-skills-own-manual-bump-commits)
- [RISK-CHANGELOG-002 — `lint` costs two `git log` subprocesses per queued entry, on every commit once the nudge lands](#risk-changelog-002-lint-costs-two-git-log-subprocesses-per-queued-entry-on-every-commit-once-the-nudge-lands)
- [RISK-CLAUDEMD-001 — Legacy `@.claude/CLAUDE.md` imports double-load project context](#risk-claudemd-001-legacy-claudeclaudemd-imports-double-load-project-context)
- [RISK-CLAUDEMD-002 — the shipped rules name commands, skills and paths that nothing verifies](#risk-claudemd-002-the-shipped-rules-name-commands-skills-and-paths-that-nothing-verifies)
- [RISK-DESIGNSTACK-003 — Pro Max search requires Python 3](#risk-designstack-003-pro-max-search-requires-python-3)
- [RISK-DESIGNSTACK-006 — Pinned npm package ids can drift or rename](#risk-designstack-006-pinned-npm-package-ids-can-drift-or-rename)
- [RISK-GSDEXEC-001 — `gsd-executor-decomposing.md` is a full fork with no inheritance, will drift](#risk-gsdexec-001-gsd-executor-decomposingmd-is-a-full-fork-with-no-inheritance-will-drift)
- [RISK-HARNESS-001 — `Connection closed mid-response` truncates a turn, and the bundle cannot retry it](#risk-harness-001-connection-closed-mid-response-truncates-a-turn-and-the-bundle-cannot-retry-it)
- [RISK-HOOKSTDIN-001 — `token-usage-log.mjs` throws on a literal `null` on stdin](#risk-hookstdin-001-token-usage-logmjs-throws-on-a-literal-null-on-stdin)
- [RISK-NEO4J-003 — Neo4j credentials leaking into the repo or argv](#risk-neo4j-003-neo4j-credentials-leaking-into-the-repo-or-argv)
- [RISK-NEO4J-004 — graphify upgrade breaks the write path or the agent patch](#risk-neo4j-004-graphify-upgrade-breaks-the-write-path-or-the-agent-patch)
- [RISK-NEO4J-005 — Same repo cloned on two PCs flip-flops in Neo4j](#risk-neo4j-005-same-repo-cloned-on-two-pcs-flip-flops-in-neo4j)
- [RISK-PHASEDIR-001 — `phase-dir` caps a kind at 99, and a leaked lock is never collected](#risk-phasedir-001-phase-dir-caps-a-kind-at-99-and-a-leaked-lock-is-never-collected)
- [RISK-PLANTREE-001 — The risk register no longer lives where the rules say to look for it](#risk-plantree-001-the-risk-register-no-longer-lives-where-the-rules-say-to-look-for-it)
- [RISK-PNPM-001 — False positives from dynamic/conditional imports](#risk-pnpm-001-false-positives-from-dynamicconditional-imports)
- [RISK-PNPM-002 — Native-trigger coverage gap for sub-package installs](#risk-pnpm-002-native-trigger-coverage-gap-for-sub-package-installs)
- [RISK-PNPM-003 — Auto-writing pnpm-workspace.yaml](#risk-pnpm-003-auto-writing-pnpm-workspaceyaml)
- [RISK-RULESREACH-001 — Process rules bind only after a deploy, so a repository can run for weeks under rules it does not have](#risk-rulesreach-001-process-rules-bind-only-after-a-deploy-so-a-repository-can-run-for-weeks-under-rules-it-does-not-have)
- [RISK-SETUP-001 — A corrupt `settings.partial.json` crashes the installer instead of being reported](#risk-setup-001-a-corrupt-settingspartialjson-crashes-the-installer-instead-of-being-reported)
- [RISK-STACKRULES-001 — Model-driven rules compilation can lose requirements](#risk-stackrules-001-model-driven-rules-compilation-can-lose-requirements)
- [RISK-STACKRULES-002 — Snapshot desync / stale auto-loading copies](#risk-stackrules-002-snapshot-desync-stale-auto-loading-copies)
- [RISK-STATUSLINE-002 — the autocompact point is assumed until a compaction is observed](#risk-statusline-002-the-autocompact-point-is-assumed-until-a-compaction-is-observed)
- [RISK-SUP-001 — Hang supervision depends on the model wrapping the job](#risk-sup-001-hang-supervision-depends-on-the-model-wrapping-the-job)
- [RISK-SUP-003 — supervise-bg could kill a legitimately long or quiet job](#risk-sup-003-supervise-bg-could-kill-a-legitimately-long-or-quiet-job)
- [RISK-TESTUNIT-001 — `.test/unit/` is gitignored, so tests there rot unnoticed](#risk-testunit-001-testunit-is-gitignored-so-tests-there-rot-unnoticed)
- [RISK-TOKENLOG-001 — Scraped model pricing can silently break](#risk-tokenlog-001-scraped-model-pricing-can-silently-break)
- [RISK-ULTRAPOWERS-001 — Owning a fork carries merge burden on every upstream release](#risk-ultrapowers-001-owning-a-fork-carries-merge-burden-on-every-upstream-release)
- [RISK-ULTRAPOWERS-004 — Keep-list rot devalues the completeness check](#risk-ultrapowers-004-keep-list-rot-devalues-the-completeness-check)
- [RISK-ULTRAPOWERS-006 — Agent registry adds resident context cost every session](#risk-ultrapowers-006-agent-registry-adds-resident-context-cost-every-session)
- [RISK-ULTRAPOWERS-008 — Upstream may change its licence or its direction](#risk-ultrapowers-008-upstream-may-change-its-licence-or-its-direction)
- [RISK-ULTRAPOWERS-010 — `/gsd-update` reinstalls gsd-core at any time](#risk-ultrapowers-010-gsd-update-reinstalls-gsd-core-at-any-time)
- [RISK-VARIANT-001 — Variant switch could delete a file the user hand-edited under `~/.claude`](#risk-variant-001-variant-switch-could-delete-a-file-the-user-hand-edited-under-claude)
- [RISK-VARIANT-002 — `managedPlugins` marketplace ids can drift from the live marketplace](#risk-variant-002-managedplugins-marketplace-ids-can-drift-from-the-live-marketplace)
- [RISK-VARIANT-003 — The gsd-core detector edits hook entries this bundle does not own](#risk-variant-003-the-gsd-core-detector-edits-hook-entries-this-bundle-does-not-own)
- [RISK-VARIANT-004 — `/gsd-update` reinstalls gsd-core behind the detector's back](#risk-variant-004-gsd-update-reinstalls-gsd-core-behind-the-detectors-back)
- [RISK-VARIANT-005 — A declined prune of `gsd-defaults.partial.json` is re-offered on every non-`full` run](#risk-variant-005-a-declined-prune-of-gsd-defaultspartialjson-is-re-offered-on-every-non-full-run)
- [RISK-VERBOSITY-001 — "Terse" verbosity axis slides into minification or drops load-bearing intent](#risk-verbosity-001-terse-verbosity-axis-slides-into-minification-or-drops-load-bearing-intent)

### Deferred
- [RISK-GRAPHFRESH-001 — Stage 2 freshness edits regress the working graphify autosync](#risk-graphfresh-001-stage-2-freshness-edits-regress-the-working-graphify-autosync)
- [RISK-INJECT-001 — Generalizing the leanmode hook into an axis injector could change leanmode behavior](#risk-inject-001-generalizing-the-leanmode-hook-into-an-axis-injector-could-change-leanmode-behavior)
- [RISK-SUP-002 — Task* hook events unverified in this harness build](#risk-sup-002-task-hook-events-unverified-in-this-harness-build)

### Mitigated
- [RISK-CLEANUP-001 — `/claude-cleanup` could cause irreversible loss of user data](#risk-cleanup-001-claude-cleanup-could-cause-irreversible-loss-of-user-data)
- [RISK-DESIGNSTACK-001 — Impeccable installer footgun writes into all harnesses + settings.local.json](#risk-designstack-001-impeccable-installer-footgun-writes-into-all-harnesses-settingslocaljson)
- [RISK-DESIGNSTACK-002 — `impeccable update` clobbers the Pro Max content-graft](#risk-designstack-002-impeccable-update-clobbers-the-pro-max-content-graft)
- [RISK-DESIGNSTACK-004 — Registered hook path couples to the installed skill's script location](#risk-designstack-004-registered-hook-path-couples-to-the-installed-skills-script-location)
- [RISK-NEO4J-001 — Multi-source staleness when several PCs push the global graph to one Neo4j](#risk-neo4j-001-multi-source-staleness-when-several-pcs-push-the-global-graph-to-one-neo4j)
- [RISK-NEO4J-002 — NAS/Neo4j unavailable at push time](#risk-neo4j-002-nasneo4j-unavailable-at-push-time)
- [RISK-NEO4J-006 — Connection test at setup time depends on the neo4j driver being present](#risk-neo4j-006-connection-test-at-setup-time-depends-on-the-neo4j-driver-being-present)
- [RISK-PNPM-004 — enableGlobalVirtualStore structurally incompatible with Turbopack](#risk-pnpm-004-enableglobalvirtualstore-structurally-incompatible-with-turbopack)
- [RISK-ULTRAPOWERS-005 — Migration can mis-pair spec and plan documents](#risk-ultrapowers-005-migration-can-mis-pair-spec-and-plan-documents)
- [RISK-ULTRAPOWERS-007 — A fork left un-updated drifts until merging stops being mechanical](#risk-ultrapowers-007-a-fork-left-un-updated-drifts-until-merging-stops-being-mechanical)
- [RISK-ULTRAPOWERS-009 — Removing foreign hook registrations weakens "only ever touch our own entries"](#risk-ultrapowers-009-removing-foreign-hook-registrations-weakens-only-ever-touch-our-own-entries)

### Closed
- [RISK-DESIGNSTACK-005 — Pro Max `design` sub-skill hardcodes global paths / prune could delete a user skill](#risk-designstack-005-pro-max-design-sub-skill-hardcodes-global-paths-prune-could-delete-a-user-skill)
- [RISK-FALLOW-001 — `fallow.enabled` is set optimistically, not gated on binary presence](#risk-fallow-001-fallowenabled-is-set-optimistically-not-gated-on-binary-presence)
- [RISK-INITSTACK-001 — `/init-stack` GSD-free rewrite deleted steps 6-11; ~24 stale references + 2 dropped capabilities](#risk-initstack-001-init-stack-gsd-free-rewrite-deleted-steps-6-11-24-stale-references-2-dropped-capabilities)
- [RISK-STATUSLINE-001 — the context-window size field name is documented, not observed](#risk-statusline-001-the-context-window-size-field-name-is-documented-not-observed)
- [RISK-ULTRAPOWERS-002 — Rebrand is machine-wide and cannot be gated per project](#risk-ultrapowers-002-rebrand-is-machine-wide-and-cannot-be-gated-per-project)
- [RISK-ULTRAPOWERS-003 — Blind replacement would break `superpowers:` skill resolution](#risk-ultrapowers-003-blind-replacement-would-break-superpowers-skill-resolution)

## Active
### RISK-BOOTSTRAP-001 — Remote code execution via `curl|bash` / `irm|iex` bootstrap

- **Status:** Active
- **Context:** `bootstrap.sh`/`bootstrap.ps1` are executed straight from the network, and they
  download+run `setup.mjs` from a GitHub tarball. A compromised repo, MITM, or wrong ref runs
  arbitrary code on the new machine.
- **Mitigation:** HTTPS-only endpoints; pin to a signed release tag via `--ref v1.0.0` for
  reproducibility; documented safe alternative (download → inspect → run) in README; secrets
  never embedded in bootstrap scripts. Status nuance (migrated 2026-07-31): accepted
- **Residual:** Standard installer trust model — user must trust the repo owner. Accepted.



### RISK-CHANGELOG-001 — The post-commit trigger enqueues the skill's own manual bump commits

- **Status:** Active
  monorepo shape is still misreported, and the enqueue itself is unfixed)
- **Context:** `install-trigger.mjs`'s `post-commit` block skips a commit whose subject matches
  `релиз:*|патч:*` (line 39) — the two prefixes **automated** mode composes (SKILL.md drain step 5) —
  so a drain can never re-enqueue its own bump. The **manual** flow composes different messages and
  is not covered: single-project step 6 commits `v<finalVersion>` (SKILL.md:274, e.g. `v0.4.0`) and
  monorepo M8 commits `web: v0.4.7, backend: v1.9.2, mobile: v2.3.1` (SKILL.md:425). Both are
  enqueued on any repo with the trigger installed. The consequence is worse than noise, because
  `classify-bump.mjs`'s `SUBJECT` regex is `^([a-z]+)(\([^)]*\))?(!)?:\s*(.+)$` — ASCII-only, so it
  cannot match Cyrillic `патч:`/`релиз:` either, and `v0.4.0` carries no `type:` at all. Every one of
  these shapes therefore classifies as `unrecognised`, so the drain's `unrecognised` counter reports
  the skill's own version-bump commits under the heading "commits with no recognised Conventional
  Commits type" — pointing the user at a commit that is not theirs to fix.
- **Mitigation:** `lint-versions.mjs` (2026-07-29) tests a dedicated `BUMP` pattern
  (`/^(релиз:|патч:|v\d+\.\d+\.\d+$)/`) **ahead of** the unrecognised check and reports those
  entries separately as "a version moved outside a drain" — the accurate statement, and an
  actionable one. Verified against all four shapes: `v0.4.0`, `патч: …` and `релиз: …` are named
  correctly. Drain mode is unaffected either way — it has two independent guards (the subject skip
  and the drain lock the hook also tests), so this only ever reaches manual runs. Status nuance (migrated 2026-07-31): Open (partially mitigated 2026-07-29 — `lint` names the single-project shape; the
- **Residual:** two, neither a data-loss risk. (1) `BUMP` does **not** match the monorepo manual
  shape — `^v\d+\.\d+\.\d+$` requires the whole subject to be exactly `vX.Y.Z`, and a per-part list
  is not — so `web: v0.4.7, backend: v1.9.2` still surfaces as "no recognised type" (verified, not
  assumed). Widening the pattern was declined: `<word>: vX.Y.Z, …` is close enough to a real
  conventional-commit subject that a loose match would misfile genuine commits, which is the more
  expensive error. (2) Nothing prevents the enqueue itself; bump commits still accumulate in the
  queue, drain as `none`, and stay queued until a later drain moves a version (drain step 4). The
  version arithmetic is unaffected throughout — `unrecognised` contributes `none`. Fixing the cause
  means either widening the hook's skip pattern or making the manual flow's message match it; both
  edit SKILL.md text reviewed on 2026-07-28 and belong in a deliberate follow-up, not a drive-by.



### RISK-CHANGELOG-002 — `lint` costs two `git log` subprocesses per queued entry, on every commit once the nudge lands

- **Status:** Active
- **Context:** `lint-versions.mjs` resolves each queued entry with two `execFileSync('git', ['log',
  '-1', …])` calls, one for `%s` and one for `%b`, so a run costs `2N` process spawns for an
  `N`-entry queue. As a hand-run CLI that is irrelevant. Step 4 of the versioning plan — a fourth
  note in `payload/hooks/decision-records-nudge.mjs`, skipped 2026-07-29 because that hook belongs
  to the decision-records plan and has not landed — would call `lintVersions` from a hook that fires
  on **every** `git commit`. On a 40-entry queue that is 80 spawns per commit, on Windows, in the
  interactive path.
- **Not an oversight, and not cheaper than the plan's sketch:** the plan's own snippet short-circuits
  on `!e.level`, so in the steady state after the classify-at-commit-time trigger (every entry
  carries a level) it spends **nothing**, while spending up to four spawns on each level-less entry
  in a legacy queue. The shipped version spends two on **every** entry, deliberately — a recorded
  level is only what the trigger saw at commit time, and re-reading the commit is the only way to
  notice it has drifted from history. So this is more expensive than the sketch in the common case
  and cheaper in the legacy one; the extra cost buys the drift check that is `lint`'s reason to
  exist. Correcting an earlier claim of ours that the single pass simply "halves" it.
- **Mitigation:** none built, and none needed while the CLI is invoked by hand. Status nuance (migrated 2026-07-31): accepted — the consumer that makes it matter is deferred, not built
- **Residual:** whoever ships the nudge integration meets this first. Three ways out, cheapest
  first: one batched `git log --format=…` over all hashes instead of two calls per hash; a cap on
  how many entries the nudge path lints; or having the nudge report queue length only and leave
  problems to the CLI. Decide before the hook ships rather than after. Severity is latency on a
  `git commit`, bounded by queue length — not correctness: the plan's snippet wraps the call in
  `try/catch` plus a `main().catch`, so a *failing* lint stays fail-open and never blocks a commit.
  A *slow* one still delays it, which try/catch cannot help with.



### RISK-CLAUDEMD-001 — Legacy `@.claude/CLAUDE.md` imports double-load project context

- **Status:** Active
- **Context:** the removed session-init link-import step (deleted 2026-07-12) used to prepend
  `@.claude/CLAUDE.md` to a project's root `CLAUDE.md`. Claude Code auto-loads
  `<project>/.claude/CLAUDE.md` by itself (doc-verified + live-tested 2026-07-12), so any
  project still carrying that line loads the generated file twice per session.
- **Mitigation:** no hook can fix it (root `CLAUDE.md` is usually `CURATED:NOEDIT`, and the
  deny hook rightly blocks writes). Remove the `@.claude/CLAUDE.md` line by hand when
  touching an affected project's root `CLAUDE.md`. Status nuance (migrated 2026-07-31): accepted, manual cleanup
- **Residual:** duplicated context in affected projects until manually cleaned. Accepted.



### RISK-CLAUDEMD-002 — the shipped rules name commands, skills and paths that nothing verifies

- **Status:** Active
- **Context:** `payload/claude-md/` is assembled into `~/.claude/CLAUDE.md`, the highest-authority
  prose on the machine, and nothing checks that what it names exists. Three instances were found
  in one sweep of 19 fragments, each shipped and each wrong in a different way. (1) The register's
  location, `.planning/` or the project root, contradicted the probes in `add-risk.mjs` and
  `session-init.mjs`, which have read `.ultrapowers/` since phase 04 — already filed as
  `RISK-PLANTREE-001`. (2) `13-graphify.md` instructed the reader to invoke a `graphify` skill via
  `/graphify`; no such skill is installed, none ships in `payload/skills/`, and nothing in the
  bundle ever runs `graphify install --platform claude`, the command that would install one — the
  hook runs `graphify claude install`, which writes a CLAUDE.md section and PreToolUse hooks and
  no skill. (3) `14-context-mode.md` gave the diagnostics command as `/ctx-doctor` where the
  plugin's own declared trigger is `/context-mode:ctx-doctor`. `rules-src/` was swept the same way
  and is clean: its only unshipped commands are gsd-core's, which are external by construction.
- **Mitigation:** the three were corrected on 2026-07-31. Nothing prevents the fourth. Prose is the
  wrong layer to fix this in — a rule saying "keep the rules accurate" is itself unverified prose,
  and the drift here was not carelessness but the ordinary lag between changing code and
  remembering which paragraph described it. Status nuance (migrated 2026-07-31): 2026-07-31 — three instances found and fixed, the class is unfixed
- **Update 2026-07-31 — the check is built.** `docs-claims.test.mjs` asserts that every
  `` `/command` ``, every named skill and every bundle-relative path in `payload/claude-md/**` and
  `payload/rules-src/**` either ships or appears in an allowlist naming its source, and a fourth
  test asserts the allowlists cannot be padded with a bare name. It caught four things on its
  first run: one genuinely external path (`hooks/gsd-graphify-update.sh`, gsd-core's) and three
  mentions the check cannot distinguish from instructions — `/graphify` and `/ctx-doctor`, which
  the corrected prose names precisely to say they do not exist, and `/zod`, a package subpath.
  All four are allowlisted with their source.
- **Residual:** one of the three original defects is out of this check's reach and stays so. The
  register's location was prose about a path — `.planning/` or the project root — not a
  bundle-relative reference, and no mechanical check can tell a wrong location from a right one
  without encoding the answer. That half remains `RISK-PLANTREE-001`'s. The check also cannot
  read a denial: a fragment naming a command to say it does not exist looks identical to one
  telling the reader to run it, which is why the allowlist has entries that exist only to record
  "named in order to be denied".
- **Aggravating factor:** these rules bind only after a deploy, and `~/.claude/CLAUDE.md` is
  curated — the installer's default answer leaves it byte-for-byte unchanged. A correction can sit
  in `master`, pass every test, be deployed, and still not reach the file it corrects.
- **Residual:** a `Stop` or `SubagentStop` hook exiting non-zero on a malformed payload. The input
  comes from Claude Code rather than from a user, so the path is unlikely — but "unlikely" is what
  the same construct was assumed to be in `precompact-observe.mjs` before it was reproduced.
  Fixing it is a few minutes and belongs to whoever next touches that hook family.



### RISK-DESIGNSTACK-003 — Pro Max search requires Python 3

- **Status:** Active
- **Context:** `ui-ux-pro-max`'s `scripts/search.py` (local BM25 over the style/palette/font CSVs)
  needs a Python 3 interpreter (stdlib only, no network). On a machine without python3 the search
  step cannot run.
- **Mitigation:** soft-degrade — the orchestrator warns at install time if python3 is absent, and
  the grafted prose explicitly instructs "query search.py **if available**, else fall back to the
  reference tables below" (the same CSV data is also readable as prose tables the agent can consult). Status nuance (migrated 2026-07-31): accepted
- **Residual:** on a python-less machine the agent uses the static reference tables rather than
  ranked search — reduced quality, not a failure. Accepted.



### RISK-DESIGNSTACK-006 — Pinned npm package ids can drift or rename

- **Status:** Active
- **Context:** the updater's project probe reads latest versions via `npm view impeccable version`
  and `npm view ui-ux-pro-max-cli version`; the orchestrator installs by those ids. A rename or
  unpublish upstream would break the probe/install.
- **Mitigation:** `check()` is best-effort and fully fail-soft (wrapped in `safe()`, `main().catch`
  backstop) — a bad id yields no version signal and no crash; the install step warns and continues
  without aborting `/init-stack`. Status nuance (migrated 2026-07-31): accepted / low
- **Residual:** a silent rename leaves the components un-updated until the ids are corrected;
  detection is manual. Accepted / low.



### RISK-GSDEXEC-001 — `gsd-executor-decomposing.md` is a full fork with no inheritance, will drift

- **Status:** Active
- **Context:** `payload/agents/gsd-executor-decomposing.md` duplicates the entirety of
  `gsd-executor.md`'s execution machinery (commit protocol, deviation rules 1-4, TDD flow,
  checkpoint protocol, worktree safety assertions) because Claude Code agent files have no
  inheritance/include mechanism for another agent's full body — only prose `@`-references to
  shared reference docs, which `gsd-executor.md` doesn't itself use for these sections. Every
  future upstream `gsd-core` fix to `gsd-executor.md` (numbered fixes like #2924/#3097/#3542/
  #3678 already baked into the copy as of 2026-07-17) will NOT automatically reach the fork.
- **Mitigation:** `gsd-executor-decomposing.md`'s frontmatter `description` points at
  `.ultrapowers/archive/specs/2026-07-17-executor-task-decomposition-design.md`'s sync procedure —
  when `apply-gsd-agent-patches.mjs`/`gsd-agent-patches.mjs`'s `PATCHES` registry gains a new or
  upgraded entry for `gsd-executor.md`, the same patch must be manually re-applied (or the
  equivalent prose change hand-ported) to `gsd-executor-decomposing.md`, skipping only the two
  delta sections (`tools:`/`description` frontmatter and the `<task_stage_decomposition>` block
  that replaces `<no_recursive_agent_spawn>`). No automated drift check exists yet. Status nuance (migrated 2026-07-31): accepted
- **Residual:** silent drift between the two files is possible until a human notices (e.g. a
  `verify_isolated="true"` plan hits a bug already fixed in plain `gsd-executor`). Accepted as
  the cost of the only mechanism that gives a genuinely structural (tools-grant-based, not
  prose-based) depth-3 cap — see `rules-src/gsd.md`'s "The one sanctioned depth-3 exception"
  section for why the alternative (a prose-conditional single file) was rejected.



### RISK-HARNESS-001 — `Connection closed mid-response` truncates a turn, and the bundle cannot retry it

- **Status:** Active
  in this repository; the permanent fix is on the router.
- **Root cause:** the Keenetic gateway routes selected destinations into a TUN device served by
  `hev-socks5-tunnel`, whose generated config carries `misc.read-write-timeout: 20000` (upstream
  default is 60000). Any tunneled session with no payload for 20 s is closed and the client sees
  ECONNRESET. Reproduced with a 20-line `node` script and no Claude Code involved: a mid-body gap
  RSTs at exactly 20.0–20.1 s, 4/4; a pre-header gap 9/10 at ~21 s. Chain: PC → Mikrotik → Keenetic
  → fwmark policy routing → `t2sN` → hev-socks5-tunnel → sing-box SOCKS5 → VLESS Reality → server.
  The config is written by KeeneticOS (`interface ProxyN`, `proxy protocol socks5`) into
  `/var/run/proxy-cfg-t2s*`, so it is regenerated on restart and not editable in place.
- **How it was localized:** only proxied destinations fail — 30 s idle on an established TLS
  connection survives to `ya.ru`/`github.com` (routed direct) and dies at 20.4 s to `example.com`
  (routed through the tunnel). `curl -x socks5h://127.0.0.1:1083` from the router itself passed a
  25 s gap (HTTP 200 in 25.9 s), exonerating sing-box, VLESS and the server and leaving only the
  transparent layer. TCP keepalive at 5 s does not help (6/6 failures) because the timeout counts
  payload, not packets — which is also why traffic on other sockets cannot keep a session alive.
- **Refuted along the way:** CLI 2.1.220 (same version, same days, Opus 4.8 = 0 drops / 2009 turns
  vs Opus 5 = 46 / 2515); the model and the `[1m]` beta (second PC runs identical `opus[1m]` with no
  drops; the reproducer fails on opus-5 and sonnet-5 alike); context size and session length
  (reproduces in a fresh headless run at ~15 k); the Opus 5 migration in this repo
  (`model-migration.mjs` touches only `model` and `model_overrides`; no keepalive/poll knob exists
  anywhere in `payload`). Opus 5 is an amplifier, not a cause — it pauses past 20 s more often.
- **Why the client does not self-heal:** the binary retries a stale stream only while no text block
  has been delivered — retrying afterwards would duplicate the text — so it finalizes and prints the
  error instead. Visible drops are therefore only the after-text subset; the true rate is higher.
  The message maps to cause `stale_connection` (a real socket error); the client's own stall
  watchdog reports `Response stalled mid-stream` and did not fire here.
- **Mitigation in this repository:** `CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING=1` in
  `.claude/settings.json`. It streams tool-input JSON instead of buffering it server-side, so the
  silent gap before a large `Write` never forms: 4/4 success with it against 0/4 without, on a
  250-item single-`Write` reproducer (16/16 failures across all earlier control runs). It does not
  cover a gap caused by deliberation alone — that case would not reproduce headlessly and is
  untested. Recovery when a turn is still lost: `claude --continue` / `claude --resume <id>`.
- **Permanent fix (outside this repository):** raise `read-write-timeout` on the router. It is not
  exposed in the Keenetic CLI (`show running-config` lists no timeout for `interface ProxyN`), so
  either report it to Keenetic or bind-mount a wrapper over `/usr/bin/hev-socks5-tunnel` that
  rewrites the generated config before exec. Verify with a 25 s mid-body-gap HTTPS probe.
- **`CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1` does not help** — measured 2026-07-28, active at launch,
  no turn self-resumed. The name was inferred, not documented. Harmless to keep, not a mitigation.

- **Mitigation:** Status nuance (migrated 2026-07-31): Root-caused 2026-07-28 — a LAN-side proxy timeout, not a Claude Code defect. Mitigated



### RISK-HOOKSTDIN-001 — `token-usage-log.mjs` throws on a literal `null` on stdin

- **Status:** Active
- **Context:** `payload/hooks/token-usage-log.mjs:60-61` reads stdin as
  `try { d = JSON.parse(safe(() => readFileSync(0, "utf8")) || "{}"); } catch { process.exit(0); }`
  and later reaches `d.cwd` at line 133. `JSON.parse("null")` does not throw — it returns the
  primitive `null` — so the `catch` never fires and the property access throws a `TypeError`
  outside any guard, exiting non-zero. Phase 09's `precompact-observe.mjs` was written from this
  same idiom, inherited the same defect, and had it caught in review; the guard added there is
  `d = (d && typeof d === "object") ? d : {};` immediately after the parse. This hook is already
  deployed on this machine.
- **Mitigation:** none yet. The one-line guard above is known to work and is already proven in a
  sibling hook. Status nuance (migrated 2026-07-31): 2026-07-30 — found by phase 09, not caused by it, and deliberately not fixed there



### RISK-NEO4J-003 — Neo4j credentials leaking into the repo or argv

- **Status:** Active
- **Context:** the write path and the MCP both need a Neo4j password. Committing it, or passing it
  as `--password` on argv (visible in `ps`/shell history), would leak it.
- **Mitigation:** password lives only in `~/.graphify/neo4j.env` (user home, chmod 600, outside every
  repo) for the write path and in the user's private `~/.claude` MCP config for the read path. The
  wrapper loads that env file and relies on graphify's `NEO4J_PASSWORD` env support (never `--password`
  on argv). No connection string or password is ever written into this repo; the secrets-gate hook
  remains the backstop. Status nuance (migrated 2026-07-31): accepted
- **Residual:** a user could still hand-paste creds into a committed file; the gate catches common
  shapes but not all. Accepted.



### RISK-NEO4J-004 — graphify upgrade breaks the write path or the agent patch

- **Status:** Active
- **Context:** the integration depends on graphify's `export neo4j` CLI and on the `repo`/id-prefix
  node schema, and the Cypher agent guidance is injected as a prose patch into gsd-* agent files.
  An upstream graphify change could move any of these (the 0.9.13 refactor already relocated modules).
- **Mitigation:** the write path uses only the public, stable `graphify export neo4j` CLI and the
  documented `NEO4J_PASSWORD` env, not internals (verified intact through 0.9.22). The agent patch
  uses the existing versioned, anchor-based patch infra (`gsd-agent-patches.mjs`), which skips
  cleanly (`skippedNoAnchor`) if an anchor moves rather than corrupting a file, and re-applies
  idempotently on upgrade. Status nuance (migrated 2026-07-31): accepted / low
- **Residual:** a CLI-level breaking change in graphify would need a wrapper update; surfaced by the
  quality-check queries failing. Accepted.



### RISK-NEO4J-005 — Same repo cloned on two PCs flip-flops in Neo4j

- **Status:** Active
- **Context:** if the identical repo is present on two PCs at different states and both sync+push
  frequently, the per-repo refresh (RISK-NEO4J-001) makes them alternately overwrite that repo's
  nodes — last push wins, so the graph oscillates.
- **Mitigation:** default is last-writer-wins, which yields the latest-pushed state and is usually
  fine (same repo → same code). Optional hardening if it becomes a problem: designate one PC as
  authoritative for the shared repo, or namespace repo_tag with the hostname so the two clones are
  distinct nodes. Status nuance (migrated 2026-07-31): accepted
- **Residual:** transient oscillation for a genuinely divergent shared repo under frequent dual
  sync. Accepted; revisit only if observed.



### RISK-PHASEDIR-001 — `phase-dir` caps a kind at 99, and a leaked lock is never collected

- **Status:** Active
- **Context:** two independent limits in the fork's `transform/fork-owned/phase-dir`, the single
  allocator for `.ultrapowers/{phases,tasks,adhoc}/NN-slug/`. **The ceiling:** the scan for the
  highest existing number globs `[0-9][0-9]-*`, while `printf '%02d'` treats two digits as a
  minimum width, not a maximum — so the hundredth allocation writes `100-<slug>`, a name that glob
  cannot match. Verified empirically: with 99 numbered directories plus `100-a` and `100-b`
  present, the glob returns 99 and `next` recomputes to 100. Past 99 every distinct slug therefore
  takes the prefix `100` — `100-a` and `100-b` are different names, both `mkdir` cleanly, and
  neither is ever counted again. The same blindness breaks re-resolution: asking a second time for
  a slug already allocated at 100 does not find it, and the plain `mkdir` of the target then fails
  EEXIST under `set -e`, so the idempotent "same phase, same directory" contract the script's own
  header promises becomes a hard error rather than a duplicate. **The lock:** `.phase-dir.lock` is
  released by `trap … EXIT` plus `trap 'exit 1' INT TERM`, which covers a normal exit, a `set -e`
  abort, INT and TERM — but not SIGKILL, not a power cut, and not SIGHUP, which is untrapped and
  tears the shell down before EXIT runs. The window is narrow, but nothing anywhere collects a
  leaked lock, and one leaked lock blocks allocation for that kind on that machine permanently.
- **Mitigation:** neither failure is silent. When the 300-poll wait is exhausted the script prints
  the lock's path and, from its mtime, how long it has been held, so an operator can tell a live
  queue from a corpse; deletion stays manual by design, because the script itself cannot
  distinguish the two and guessing wrong would break a running allocation. The ceiling sits far
  above realistic use — the largest kind in this tree holds three directories — and both limits
  fail loudly rather than corrupting anything. Status nuance (migrated 2026-07-31): accepted, 2026-07-29
- **Residual:** no data-loss exposure in either case. The ceiling yields colliding prefixes plus a
  visible EEXIST; the leaked lock yields a refusal with an age in the message. Both are recoverable
  by hand (`rmdir` the lock; rename by hand past 99). Widening the prefix is deferred until a tree
  approaches the ceiling, since it would rename every existing directory and every document inside
  it.



### RISK-PLANTREE-001 — The risk register no longer lives where the rules say to look for it

- **Status:** Active
  still outstanding for fresh installs)
- **Update 2026-07-31:** the user ruled that the exception belongs in project scope, which
  outranks user scope on conflict, rather than moving the file or editing the protected one.
  It is written in `.claude/CLAUDE.md` — the root `CLAUDE.md` could not take it, carrying the
  `CURATED:NOEDIT` marker itself. `.gitignore` excluded `.claude/` outright, which would have
  confined the record to this machine, so the rule was narrowed to `.claude/*` with
  `!.claude/CLAUDE.md` (git cannot re-include a file under an excluded parent) and that one
  file is now tracked; `stack-rules.md` and the settings files stay ignored. One limit stays:
  the payload's own prose (`payload/claude-md/06-collaboration*.md`) still teaches the old
  locations, so every fresh install starts with the same disagreement until that source is
  changed — which is a decision about all projects, not just this one.
- **Context:** moving the register to `.ultrapowers/RISK_REGISTER.md` put it outside the only two
  places this bundle had ever probed. `hooks/session-init.mjs` and `add-risk.mjs` each checked the
  project root and walked `.planning/`, so the every-session self-heal the session-init header
  advertises stopped covering the register — for any project that adopts the tree, since that hook
  ships in the payload to every install. In this repository the effect was latent rather than
  active: the step is gated on `.planning/` existing and this repository has none, so its own
  register was never being appended to either way.
- **Mitigation:** both probes now include `.ultrapowers/RISK_REGISTER.md`, pinned end-to-end by
  `payload/hooks/session-init.test.mjs`. The pair must move together — session-init decides whether
  anything is pending and `add-risk.mjs` does the writing, so patching one alone leaves the hook
  spawning a subprocess every session that then finds nothing. Depth ordering is untouched: a root
  register still outranks `.ultrapowers/`, and a `.planning/` register ties with it, so both are
  maintained. Both READMEs' statement of the search locations was corrected with the code. Standing
  decision on the duplication: the two `listRegisters()` copies stay separate — six lines each, one
  a standalone CLI and one a hook entrypoint, with cross-referencing keep-in-sync comments — and are
  worth extracting into a shared module only when a third consumer appears. Status nuance (migrated 2026-07-31): Open (code half fixed 2026-07-29; prose half answered for this tree 2026-07-31,
- **Residual:** the prose half is not fixed, and what exists now disagrees about the answer in both
  directions. The user-scope `~/.claude/CLAUDE.md` still instructs that the register goes in
  `.planning/` if a GSD project exists and the project root otherwise; that file is hook-protected
  and the user's to edit, and its source in this bundle (`payload/claude-md/06-collaboration.md`,
  `06-collaboration.lite.md`) is deliberately left alone, so a fresh install still teaches the old
  locations. Any other consumer that hardcodes the root or `.planning/` misses `.ultrapowers/`
  exactly the way these two probes did. The planned replacement misses the opposite way:
  `resolveRecordPaths` in the decision-records plan (`records-paths.mjs`, consumed by `risks.mjs`)
  chooses a single base — `<root>/.ultrapowers` when that directory exists, otherwise `<root>` —
  and never probes `.planning/` under any condition, so a project keeping its register only in
  `.planning/` would be invisible to it. That plan has not been executed, so nothing is broken by it
  yet; what is missing is one agreed rule that the hook pair, the shipped prose and that resolver
  all implement. No data-loss exposure in any of these: the register is tracked in git and
  maintained by hand; what was lost was one automatic append.



### RISK-PNPM-001 — False positives from dynamic/conditional imports

- **Status:** Active
- **Context:** the scan statically extracts bare imports (`import`/`require`/`export-from`/dynamic
  `import()`) and flags any undeclared specifier whose package is installed somewhere in the
  workspace. A conditionally- or dynamically-imported package that the consumer never actually
  reaches at runtime could still be flagged.
- **Mitigation:** three layers make a false positive harmless. (1) The **installed-in-workspace
  gate** — a specifier is only flagged when its package is genuinely resolvable, so a genuinely
  absent optional adapter is never touched. (2) The fix is an **optional peer**
  (`peerDependenciesMeta.optional: true`) — declaring one that goes unused has no effect on
  resolution or install. (3) **Additive-only** writes — nothing existing is removed or rewritten,
  so an over-declaration is trivially reversible by hand. Status nuance (migrated 2026-07-31): accepted / low
- **Residual:** at worst a harmless, unused optional-peer line in `pnpm-workspace.yaml`. Accepted.



### RISK-PNPM-002 — Native-trigger coverage gap for sub-package installs

- **Status:** Active
- **Context:** the always-on trigger is a PostToolUse hook (fires after Claude-invoked
  `pnpm install`/`add`) plus a root `postinstall` (fires on the user's own top-level installs). An
  install run *inside a nested workspace package* in the user's own terminal may not fire the root
  `postinstall`, leaving a newly-introduced phantom undetected until the next top-level install.
- **Mitigation:** the Claude-side hook covers agent-driven installs regardless of directory, and the
  `/pnpm-phantom-fix` command is a manual backstop the user can run at any time. The failure mode is
  detection latency, not a wrong write. Status nuance (migrated 2026-07-31): accepted
- **Residual:** a phantom introduced by a manual sub-package install stays latent until the next
  top-level install or manual scan. Accepted; documented as a caveat in the command.



### RISK-PNPM-003 — Auto-writing pnpm-workspace.yaml

- **Status:** Active
- **Context:** the scan writes `packageExtensions` entries into `pnpm-workspace.yaml` automatically.
  Node has no stdlib YAML parser and npm deps are forbidden, so a minimal line-oriented handler
  edits the file — a full parser is not available to guarantee round-tripping arbitrary shapes.
- **Mitigation:** the handler is **additive-only** (only inserts new lines, never rewrites existing
  ones) and **fail-safe**: on any shape it can't safely edit (flow/JSON-style block, tabs, or a `P`
  key already present where a fresh block would risk a duplicate mapping key) it makes **no write**
  and prints the entries for manual addition. Idempotency and the fail-safe paths are locked by
  unit tests. Status nuance (migrated 2026-07-31): accepted / low
- **Residual:** an unusual hand-authored `pnpm-workspace.yaml` shape falls back to manual entry
  rather than an automated fix. Accepted — safety over convenience.



### RISK-RULESREACH-001 — Process rules bind only after a deploy, so a repository can run for weeks under rules it does not have
- **Status:** Active
- **Context:** the five process rules agreed during phase 09 live in `payload/rules-src/` and in
  the fork's deltas 011-013. Neither reaches a session until `node setup.mjs` runs and Claude
  Code restarts, and neither had run by 2026-07-31 — so phases 10, 11 and 12 were all executed
  under rules that existed only as files in this repository. The failure this produced was
  visible: state was kept current in `ROADMAP.md` and `NN-STATE.md`, which the written ruling
  names, while the deploy assessment, both READMEs and a quoted delta figure all fell behind,
  because nothing named them and nothing checked them. The user's framing is the accurate one —
  this is a reach problem, not an attention problem.
- **Mitigation:** partial and mechanical. `docs-coverage.test.mjs` now asserts the reverse
  direction the checks were missing: every registered hook is described in both READMEs, the
  claimed lite hook count matches what the bundle registers, and every phase directory has a
  roadmap row. `docs-claims.test.mjs` covers the forward direction. Both run in the repository's
  own suite, which needs no deploy to bind — that is the point of putting them there rather than
  in `rules-src/`.
- **Update 2026-07-31 — the rules now bind.** The deploy ran, so the two `rules-src/` rules and
  the corrected `~/.claude/CLAUDE.md` are on this machine at last; the fork's deltas 011-013 still
  wait on `/plugin update`. The reach problem is narrowed, not closed: the rules bind on the next
  session start, and they bound nothing while phases 10-12 were being built.
- **Residual:** the judgement half cannot be tested. "Update every document that states this
  status" is prose, and prose only binds once deployed — which is the risk restating itself one
  level up. Two structural options remain open and are the user's call: run the deploy so the
  rules-src rules actually bind, or move the rules that matter most into checks that live in the
  repository, where a test gates a commit without any installation step. The second is what this
  entry's own mitigation did, and it is the only half that worked today.



### RISK-SETUP-001 — A corrupt `settings.partial.json` crashes the installer instead of being reported

- **Status:** Active
- **Context:** `setup.mjs:926` reads `partial` as `partialRaw === undefined ? null : safe(() =>
  JSON.parse(...))`, and `safe()` returns **`undefined`** when the parse throws, not `null`. So the
  handler written for exactly this case — `if (partialRaw !== undefined && partial === null)`, which
  would have recorded `settings.partial.json: failed to parse - settings.json hooks left untouched`
  — is unreachable, and the guard below it (`partial !== null`, `setup.mjs:932`) lets an `undefined`
  through into `Object.values(partial.hooks || {})` at `setup.mjs:940`. The run dies there with an
  unhandled `TypeError: Cannot read properties of undefined (reading 'hooks')`. Reproduced directly:
  writing `{ not json` over `settings.partial.json` in a copied repository root aborts the install
  at that line. A *missing* file takes the `null` branch and is handled correctly; only a corrupt
  one is affected.
- **Mitigation:** none in code. What limits it is reach: `settings.partial.json` is repository
  content, not user state, so it is only corrupt after a bad merge, a truncated download, or a hand
  edit — and the crash happens before anything is written, so the config dir is left as it was. Status nuance (migrated 2026-07-31): 2026-07-29, found while verifying `RISK-VARIANT-005`'s neighbourhood — unfixed
- **Residual:** an unhandled stack trace where a one-line summary note was intended, on an input the
  code already knew could be bad. One-word fix (`?? null`, or comparing against `undefined`) plus a
  test that the note is actually emitted; left out of the gsd-core detector's fix wave because it is
  neither that feature's code nor on its recovery path.



### RISK-STACKRULES-001 — Model-driven rules compilation can lose requirements

- **Status:** Active
- **Context:** `.claude/stack-rules.md` is compiled from `~/.claude/rules-src/` by a subagent
  (deduplicated rewrite, not a mechanical concatenation — per user decision 2026-07-12). A
  careless build could drop or distort a rule requirement, and the loss would persist until
  the next rebuild.
- **Mitigation:** compiler instructions (`rules-src/README.md` § "Building stack-rules")
  require every "Avoid:" list and every version pin to be carried over verbatim; the snapshot
  frontmatter marks it machine-owned so fixes go into `rules-src/` (source of truth) and a
  rebuild is idempotent; the snapshot is a reviewable file, not hidden state. Status nuance (migrated 2026-07-31): accepted
- **Residual:** prose-level nuance can still be lossy between rebuilds. Accepted.



### RISK-STACKRULES-002 — Snapshot desync / stale auto-loading copies

- **Status:** Active
- **Context:** two desync paths. (1) `session-init.mjs` only checks whether
  `.claude/stack-rules.md` exists, never whether it is current, so nothing flags drift at session
  start. The 2026-07-13 simplification removed a sourceHash/stackFingerprint comparison that fired
  a rebuild instruction every session: `sourceHash` hashes path/size/mtime, so every `setup.mjs`
  deploy moved it with no rule text changing. Once a project has a snapshot it is never
  auto-flagged again, even if `~/.claude/rules-src/` changes or the project's stack changes (new
  framework added, etc.). (2) A machine that updates the bundle but never re-runs `setup.mjs` keeps
  the old auto-loaded `~/.claude/rules/` copies alongside the snapshot — every rule then loads
  twice.
- **Mitigation:** (1) `/init-stack` owns building the snapshot (rules-src/README.md § "Building
  stack-rules") and, since 2026-07-28, detects real drift when it runs: `stack-rules-check.mjs`
  compares the `markers` map the snapshot recorded — the root and every workspace — against the
  tree, and names the `{ workspace, marker }` pairs that appeared and vanished, so the rebuild is
  an additive edit rather than a regeneration. sourceHash/stackFingerprint are still stamped but
  decide nothing, which is what keeps the comparison from crying wolf the way the removed one did.
  (2) `setup.mjs` `migrateRulesDir()` deletes bundle-owned files from `~/.claude/rules/` and
  removes the directory when empty; user-authored files are kept and reported with a move-by-hand
  note. Status nuance (migrated 2026-07-31): accepted
- **Residual:** (1) drift is found only when `/init-stack` runs, never at session start — a
  project's rules can still sit stale indefinitely if nobody runs it. (2) Every snapshot stamped
  before the `markers:` line reads `legacy`: reported, never flagged as drift, and nothing prompts
  the one rebuild that makes it comparable — so every project that exists today stays silent until
  someone rebuilds it. Deliberate: flagging them would make every project on the machine report
  drift on first contact, which is how the check got switched off the first time. (3) The
  `/init-stack` re-check confirms the frontmatter parses, not that the body survived — it compares
  `markers` and never reads the rule sections. (4) Machines that skip `setup.mjs` after upgrading
  stay on the old (working) mechanism until they run it. All accepted.



### RISK-STATUSLINE-002 — the autocompact point is assumed until a compaction is observed

- **Status:** Active
- **Context:** phase 09 marks the context segment with an icon by percent of the way to automatic
  compaction. Where compaction fires cannot be read where it fires: `PreCompact` carries no
  `context_window`, so neither the percentage nor the window size is available in the hook. It is
  observed instead, from the transcript's last assistant `usage`, in absolute tokens. Until a first
  automatic compaction has been seen for a given model, `resolveAutocompact` returns
  `source: "assumed"` and the point is the full window (or the capacity set by
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, capped at the window). The icon ladder therefore collapses
  onto the colour ladder, and `💀` cannot appear before a compaction that has never happened.
- **Mitigation:** deliberate, and chosen over the alternative. The obvious seed is gsd-core's 16.5%
  reserve, and that is exactly the class of constant `RISK-STATUSLINE-001` was filed about — a
  number that looks like knowledge and is not. Being late and honest beats being early and invented.
  The warnings that matter still arrive: `💡` at 45% of the way and `⚠️` at 70%. The state file
  records `source`, so assumed and observed are distinguishable rather than silently equivalent. Status nuance (migrated 2026-07-31): accepted, 2026-07-30
- **Residual:** the first session on a new model warns later than it eventually will. One automatic
  compaction per model calibrates it permanently.
- **Acceptance check, at the deploy gate:** after one automatic compaction,
  `~/.claude/state/autocompact.json` holds a `models` entry for that model whose `tokens` is below
  its `windowSize`, and no `pending` key remains. If `pending` survives, promotion is not
  happening; if `tokens` equals `windowSize`, nothing was learned.



### RISK-SUP-001 — Hang supervision depends on the model wrapping the job

- **Status:** Active
- **Context:** the hard hang guarantee comes only from jobs launched through `supervise-bg.mjs`
  (or a self-bounded watcher like `gh run watch --exit-status`). A raw `run_in_background` job that
  hangs still emits no event. Hooks cannot force the wrapper or arm a timer, so the launch-time
  nudge is advisory, not enforced.
- **Mitigation:** the PreToolUse `bg-supervision-nudge` fires deterministically at every
  unsupervised bounded background launch, making the reminder reliable even if memory/prose is
  ignored. The wrapper itself is the guarantee once used. Status nuance (migrated 2026-07-31): accepted
- **Residual:** a model that ignores the nudge and launches a raw job can still hang invisibly.
  Accepted — this is the ceiling of what hooks can enforce.



### RISK-SUP-003 — supervise-bg could kill a legitimately long or quiet job

- **Status:** Active
- **Context:** the wrapper's wall-clock timeout and output-staleness watchdog could terminate a
  job that is genuinely long-running or intentionally quiet (a slow build, a silent long task).
- **Mitigation:** defaults are generous (30 min wall / 5 min staleness) and both are tunable per
  launch (`--timeout`, `--stale`); `--timeout 0` / `--stale 0` disable a check. The launch nudge
  skips obvious long-lived servers entirely, so those are not wrapped in the first place. Status nuance (migrated 2026-07-31): accepted / low
- **Residual:** a mis-tuned bound on an atypical job could kill it early; the `HANG` marker and
  exit code 124 make that diagnosable. Accepted.



### RISK-TESTUNIT-001 — `.test/unit/` is gitignored, so tests there rot unnoticed

- **Status:** Active
- **Context:** `.gitignore` excludes `.test/` entirely and commit `496eb1b` deliberately untracked
  the three files under `.test/unit/`, recording that they stay on disk and run via `node --test`.
  Phase 08 hit both consequences. First, deleting `gsd-context-meter-lib.mjs` orphaned its test
  and left two `ensureStatuslineOverride` assertions expecting a path the code no longer writes —
  three failures nobody saw, because the task's own sweep and the pre-plan blast-radius grep both
  reached only tracked files. Second and more pointed: the phase's final review raised a merge
  gate in `ensureStatuslineOverride`, the fix landed, and its entire regression coverage lives in
  that untracked directory — so the branch ships a merge-gate fix with no test inside it.
- **Mitigation:** none in place. The three files were repaired on disk during phase 08 and cannot
  be committed without `git add -f`, which would silently reverse `496eb1b`. Status nuance (migrated 2026-07-31): 2026-07-30 — needs a decision, not a mitigation
- **Residual:** either `.test/unit/` returns to git, or it is formally accepted as a local sandbox
  and removed from the definition of "the suite passes". The present middle state is what hid the
  breakage: the files look like part of the suite, run like part of the suite, and are absent from
  every fresh clone. Only the user can settle which it is.
- **Observed 2026-07-31, a second cause on `master` itself:** the gitignore is not the only thing
  hiding these tests. `.test/` starts with a dot and `node --test` does not descend into hidden
  directories, so a run from the repo root reports **556 passing** and never says that 23 tests
  were not collected. Naming the files explicitly — `node --test .test/unit/*.test.mjs` — gives
  23/23, and 556 + 23 = 579, the number the records carry. Passing the directory instead
  (`node --test .test/unit/`) reports `pass 0, fail 1` with no test having run, which reads as a
  broken suite rather than a wrong invocation. Both halves are green as of 2026-07-31; this
  sharpens the risk rather than changing its status, because whichever way the user settles it,
  "run the full suite" needs an invocation that actually collects these files.



### RISK-TOKENLOG-001 — Scraped model pricing can silently break

- **Status:** Active
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
  token counts only). Status nuance (migrated 2026-07-31): accepted
- **Residual:** `cost_usd` is always a **best-effort local estimate**, never billing-grade — same
  disclaimer Claude Code's own `/usage` command carries for its dollar figure. Accepted.



### RISK-ULTRAPOWERS-001 — Owning a fork carries merge burden on every upstream release

- **Status:** Active
- **Context:** Ultrapowers is an owned fork of `superpowers@claude-plugins-official`, not a patch
  over its plugin cache. The debt changed shape rather than disappearing: no longer reapplying
  rules after `/plugin update` replaces the cache directory, but merging each upstream release
  into a tree we maintain. The source analysis' objection — a fork fights merges every release —
  still holds and is accepted knowingly. What changed is the measured cost of the alternative:
  1504 occurrences across 111 files in 382 distinct spellings, and two classifier designs that
  failed review.
- **Mitigation:** the update is one command runnable from any project (`/up-update`), which either
  completes or refuses. The refusal thresholds are the actual bound — a delta from `patch` that
  fails to apply, an inventory scan still finding the upstream name outside the keep-list, an
  upstream diff over the size threshold, or a `main` carrying changes not derivable from
  `original` + `patch`. Deltas stay discrete rather than smeared into the rename, so one that
  upstream has since implemented is reported as obsolete instead of carried forever. Status nuance (migrated 2026-07-31): accepted, 2026-07-27; rewritten the same day, when the fork replaced the patcher
- **Residual:** a release that restructures the tree wholesale still needs a human read. That is
  what the size threshold exists to surface rather than hide.



### RISK-ULTRAPOWERS-004 — Keep-list rot devalues the completeness check

- **Status:** Active
  keep-list, and **narrowed again 2026-07-28 when the keep-list became an assertion**)
- **Context:** the transform carries a small set of things it must not rewrite. The 2026-07-28
  implementation found the keep-list mechanism itself to be the defect for `README.md`: all nine
  `obra/superpowers` occurrences upstream are **install instructions for upstream's own
  distribution channels**, so freezing them in place ships a README that installs the wrong
  plugin. Protecting a string and meaning an obligation are not the same thing.
- **Mitigation (as built):** the obligation is now discharged three ways, none of which is a
  freeze that can rot:
  1. `LICENSE` is `mode: "verbatim"` in the map — never passed through the rename, and the build
     asserts it is byte-identical to upstream's.
  2. `README.md` and the manifest `description` are **fork-owned or delta-authored**, and
     `config.attribution.require` asserts the credit is *present in the built tree*. The build
     refuses without it. An assertion cannot silently protect a string nobody needs any more.
  3. Exactly one global protected string remains — `obra/superpowers`, upstream's identity — with
     its reasoning recorded in `config.$protect-why`.
  Every rule and requirement carries a reason, asserted by the fork's own suite, and `/up-update
  check` prints all of them with their reasons.
- **Residual:** an entry kept for a reason that has quietly stopped being true. Reviewed on each
  upstream version bump, when the list is printed anyway. Materially smaller than before: the
  reviewable surface is one protected string plus three assertions, not a list of frozen files.

- **Mitigation:** Status nuance (migrated 2026-07-31): Open (mitigated by design; narrowed 2026-07-27 when the ignore list became a



### RISK-ULTRAPOWERS-006 — Agent registry adds resident context cost every session

- **Status:** Active
- **Context:** agent names and descriptions are injected into the system prompt every session.
  Measured on this machine: 37 installed agents = 8 381 chars = **~2 330 tokens resident**,
  average description 206 chars, spread 72-599. The Ultrapowers registry adds 39 more. For
  comparison, the resident weight this project criticized in Buildomator (приложение Б) was
  5 290 tokens — so an unbudgeted registry reaches ~40 % of the thing we called unacceptable.
- **Mitigation:** the registry does not ship to the `full` profile at all, where GSD's ~33 agents
  already occupy that slot (both together would be ~4 530 tokens); a description-length budget
  with a failing test guards `base`/`lite`; a lazy-description mode for rare heavy agents is an
  open question for layer 3 (the platform does this for tools via `ToolSearch`; no documented
  agent equivalent). Status nuance (migrated 2026-07-31): accepted with a budget
- **Residual:** ~1 300-2 200 tokens resident in `base`/`lite`, deliberately spent to buy per-agent
  tier selection. Accepted.



### RISK-ULTRAPOWERS-008 — Upstream may change its licence or its direction

- **Status:** Active
- **Context:** the fork rests on upstream being MIT (© Jesse Vincent, `obra/superpowers`). A
  licence change, a move to a closed model, or a direction we do not want to follow would all
  affect what we can take from future releases.
- **Mitigation:** none needed for what we already hold — MIT is irrevocable for the versions
  already published, so the exposure is strictly forward-looking. `LICENSE` is carried verbatim
  into the fork and never touched by the transform, and upstream authorship stays attributed in
  the fork's README and `plugin.json` description, stated as a fork rather than implied. Status nuance (migrated 2026-07-31): accepted, 2026-07-27
- **Residual:** future releases could become unusable to us. The fork keeps working at whatever
  version we last merged, which is the whole point of holding the objects ourselves.



### RISK-ULTRAPOWERS-010 — `/gsd-update` reinstalls gsd-core at any time

- **Status:** Active
- **Context:** the detector only observes divergence at the moment `setup.mjs` runs. `/gsd-update`
  is a separate tool the user can run whenever they like, and it will happily reinstall gsd-core
  into a `base`/`lite` machine minutes after the detector removed it. Between two `setup.mjs` runs
  the machine simply drifts, and nothing reports it.
- **Mitigation:** none beyond re-running `node setup.mjs`, which reports the divergence again and
  re-offers the removal. The removal is cheap to repeat because it is a move into a dated trash
  batch, not a destructive uninstall. Status nuance (migrated 2026-07-31): accepted, 2026-07-28
- **Residual:** deliberately not fixed. Enforcing gsd-core's absence at session start would mean a
  hook that polices another product's installation on every session — a standing background
  behaviour to remove software the user may have just deliberately installed. That is a worse
  trade than periodic drift, and it is out of scope for this feature.



### RISK-VARIANT-001 — Variant switch could delete a file the user hand-edited under `~/.claude`

- **Status:** Active
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
  (full→lite→full switch, asserting a hand-modified file survives prune). Status nuance (migrated 2026-07-31): accepted
- **Residual:** the real residual is a user who runs a bulk auto-confirm flag
  (`--replace-all`/`--merge-all`, which imply prune-confirm) without reading the printed surplus
  list first — the hash gate still protects modified files even then, but curated/unmodified
  surplus is removed without a per-file prompt. Accepted — same trust model as every other
  bulk-flag use in this installer.



### RISK-VARIANT-002 — `managedPlugins` marketplace ids can drift from the live marketplace

- **Status:** Active
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
  path rather than a silent no-op. Status nuance (migrated 2026-07-31): accepted
- **Residual:** until someone re-verifies `gsd`'s id against a live marketplace listing (`claude
  plugin list`/`claude plugin search` on a machine with `gsd` actually installed), a full-variant
  install/switch that needs to newly *install* `gsd` could fail at that one step on the
  interactive path; everything else in `setup.mjs` (file copy, hooks, settings merge) still
  completes. On the bulk path the same wrong id would instead surface as a printed manual command
  the user runs by hand, catching the failure before it executes. Accepted; revisit by
  confirming the id on a machine that has `gsd` installed via the marketplace.



### RISK-VARIANT-003 — The gsd-core detector edits hook entries this bundle does not own

- **Status:** Active
- **Context:** the planned `base`/`lite` gsd-core detector removes `settings.json` hook entries
  that reference `hooks/gsd-*`. Every other write in `setup.mjs` goes through `mentionsOurs(e)`
  (`setup.mjs:824-847`), which matches only basenames drawn from `settings.partial.json` — so
  foreign entries are left alone by construction. The detector is the first place that
  deliberately matches something this bundle never installed, and gsd-core owns 12 live
  registrations there.
- **Mitigation:** the edit fires only under both gates — profile is `base`/`lite` **and**
  `~/.claude/gsd-core/VERSION` exists — and only after explicit consent (`--replace-all` /
  `--merge-all` deliberately do **not** grant it; `--uninstall-gsd` is the scripted path). A copy
  of `settings.json` is written into the same `.cleanup-trash/<ts>/` batch before the edit, so
  `restoreBatch()` restores registrations and files together inside the 7-day window. Status nuance (migrated 2026-07-31): accepted at design time, 2026-07-28
- **Residual:** a hand-added hook entry that happens to reference a `gsd-*` script would be
  removed with the rest. It is restorable from the batch, but the user is not asked about it
  separately. Accepted: the alternative is leaving dead registrations pointing at deleted files.



### RISK-VARIANT-004 — `/gsd-update` reinstalls gsd-core behind the detector's back

- **Status:** Active
- **Context:** gsd-core updates through its own `/gsd-update`, not through `setup.mjs`. On a
  `base`/`lite` machine where the detector already removed it, a later `/gsd-update` — or any
  fresh gsd-core install — puts all 71 skills, 34 agents and 23 hooks back, plus their
  `settings.json` registrations.
- **Mitigation:** none beyond re-detection. The detector observes the divergence at the next
  `setup.mjs` run and offers removal again; nothing enforces the absence continuously. Status nuance (migrated 2026-07-31): accepted, 2026-07-28
- **Residual:** between two `setup.mjs` runs the machine can sit in a state the chosen profile
  says it should not be in, with no signal. A session-start guard was considered and left out of
  scope — it would put a foreign-product check on every session start for a condition the user
  creates deliberately.



### RISK-VARIANT-005 — A declined prune of `gsd-defaults.partial.json` is re-offered on every non-`full` run

- **Status:** Active
- **Context:** `pruneStale()` adds `gsd-defaults.partial.json` to its candidate set unconditionally
  whenever `VARIANT !== "full"` (`setup.mjs:532`). The file is a `full`-only mirror written straight
  into `~/.claude`, never through `placeFile()` — and `placeFile()` plus the assembled `CLAUDE.md`
  are the only two writers that push into `manifestNow`. Being untracked is also *why* the candidate
  is hardcoded rather than derived: there is no manifest entry whose disappearance would put it on
  the list. Every later gate then declines to apply to it — the `variantExcluded` branch skips the
  "still referenced in bundle" check, and with no recorded hash the "modified since install" check
  has nothing to compare — so it reaches the removal list on every `base`/`lite` run. Declining is
  honoured and the file survives, which is exactly what makes the next run list it again.
  Pre-existing since `a58bfe9` (2026-07-22); not introduced by the gsd-core detector, which only
  reads `pruneStale()`'s result.
- **Mitigation:** none, and none is needed for safety. The file is offered, never removed without a
  `y` or a bulk flag, and `existsSync` drops it from the candidate set the moment it does go —
  accepting the prune once ends the offer permanently, as does deleting the mirror by hand. Status nuance (migrated 2026-07-31): accepted, 2026-07-29
- **Residual:** noise, not data loss — one extra line under "stale files no longer in the bundle" on
  every `base`/`lite` run, for a user who keeps declining. The real fix is to record the mirror in
  the manifest when `full` writes it, so its staleness is derived like every other file's instead of
  hardcoded; that changes what `manifestNow` means (files this bundle *ships*, not files it writes)
  and was too broad to make inside the gsd-core detector's branch.



### RISK-VERBOSITY-001 — "Terse" verbosity axis slides into minification or drops load-bearing intent

- **Status:** Active
- **Context:** the verbosity axis tells the model to drop comments and filler whitespace. Over-
  interpreted, the model could shorten identifiers, collapse required structure, remove a comment
  that carried a non-obvious *why*, or delete a docstring that is a real public API contract.
  See design § 3.
- **Mitigation:** every tier text ends with a verbatim hard carve-out — preserve names, casing,
  mandatory syntax/indentation, error handling, validation, security; explicitly "NOT
  minification"; ultra is opt-in only. Correctness/security are out of the axis's scope by
  construction (same carve-out leanmode makes). Status nuance (migrated 2026-07-31): accepted, behavioral
- **Residual:** prose-guided behavior can still misfire on an edge case; caught in review, not
  hook-enforced. Accepted.



## Deferred
### RISK-GRAPHFRESH-001 — Stage 2 freshness edits regress the working graphify autosync

- **Status:** Deferred (until Stage 2)
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



### RISK-INJECT-001 — Generalizing the leanmode hook into an axis injector could change leanmode behavior

- **Status:** Deferred (until tests green)
- **Context:** `payload/hooks/leanmode-subagent.mjs` (single-axis SubagentStart) becomes
  `inject-axes.mjs`, iterating an axis registry over both SessionStart and SubagentStart. Any
  drift in how leanmode's level is resolved or injected per agent_type would silently weaken a
  working mechanic. See .ultrapowers/archive/specs/2026-07-26-ai-development-mode-design.md § 2.
- **Mitigation:** the leanmode axis re-exports `lib/leanmode-rules.mjs` unchanged, so its
  resolution logic is untouched; the full existing `leanmode-*` test suite is the gate; add an
  axis-independence test (leanmode=off still injects verbosity, and vice versa) and a
  per-event coverage test (SessionStart → verbosity only; SubagentStart → both when on).
- **Residual:** the injector composition layer is new code; regression risk retired once the
  leanmode suite + new tests are green.



### RISK-SUP-002 — Task* hook events unverified in this harness build

- **Status:** Deferred (verification pending)
- **Context:** `TaskCreated`/`TaskCompleted` are documented hook events but not confirmed wired in
  the running build. They are registered pointing at a probe, not at behaviour-changing logic.
- **Mitigation:** `task-lifecycle-probe.mjs` only logs firings + payload schema; if the events do
  not exist, the entries are inert (unknown events are ignored). Real handling is wired only after
  the probe log confirms they fire and reveals their schema (post-restart).
- **Residual:** the cleaner TaskCreated launch surface stays unused until verified. Accepted.



## Mitigated
### RISK-CLEANUP-001 — `/claude-cleanup` could cause irreversible loss of user data

- **Status:** Mitigated
- **Context:** `/claude-cleanup` scans and moves files under `~/.claude` (stale session
  temp dirs, orphaned plugin state, prunable caches, etc.). A bug in scope, timing, or move
  logic could destroy live config, active session state, or per-project data with no way to
  get it back.
- **Mitigation:** five independent layers, all implemented in Tasks 1-6. (1) **Allowlist-
  only scan** — `buildPlan` never considers anything outside enumerated category roots, so
  active config, `state/`, venvs (`security/`, `context-mode/`), and per-project `memory/`
  are structurally out of scope, not merely filtered out after the fact. (2) **Dry-run-
  first** — the command always renders a grouped report before anything moves; `apply`
  requires explicit user confirmation. (3) **Reversible by construction** — apply MOVES
  (never deletes) into a timestamped `~/.claude/.cleanup-trash/<ts>/` batch with a
  `manifest.json`; batches auto-purge only after a 7-day retention window; `restore --ts
  <ts>` moves everything back (no-clobber). (4) **Running-session guard** — a `<7d` KEEP
  window that also applies to ephemeral dirs (logs/session-env/daemon/shell-snapshots/
  cache/paste-cache), so the currently-running session's own transient files are protected
  by age alone; on top of that, sessions/temp additionally exclude the current session by
  its exact UUID via an explicit `--exclude-session <uuid>` flag; and a TOCTOU
  mtime-changed skip re-checked at apply time. (5) **Plugin-prune fail-safe** — an
  unreadable or mis-shaped `installed_plugins.json` causes the pruner to prune nothing
  rather than guess. Status nuance (migrated 2026-07-31): mitigated by design
- **Residual:** one known gap, accepted. A cross-device **directory** move interrupted
  mid-recursion can leave stray copies in the batch slot that are not recorded in
  `manifest.json` — the bytes physically survive under `.cleanup-trash` but are not
  auto-restorable via `restore`. Pre-existing edge case; possible future hardening is
  copy-all-then-remove for directories instead of a rename/move. (The `--exclude-slug`,
  `--keep-under`, and `--older-than` CLI flags were REMOVED — YAGNI, they were parsed but
  never wired into `buildPlan`; the running session stays protected by
  `--exclude-session <uuid>` plus the age-based KEEP window.)



### RISK-DESIGNSTACK-001 — Impeccable installer footgun writes into all harnesses + settings.local.json

- **Status:** Mitigated
  `.ultrapowers/archive/specs/2026-07-26-phase3-design-skills-integration-design.md`.
- **Context:** `npx impeccable install` is interactive and its **default** answer installs the
  skill into every detected harness (`~/.claude`, `~/.agents`, `~/.gemini`) AND appends a
  PostToolUse/Stop hook block to `settings.local.json`. `install --help` does not print flags — it
  re-runs the installer. A naive call from `/init-stack` could pollute the user's global config.
- **Mitigation:** the orchestrator (`bin/install-design-stack.mjs`) always invokes via
  `runInstaller` with a **scratch `HOME`/`USERPROFILE`** (fresh temp dir), `cwd=<project root>`, and
  explicit `--providers=claude --scope=project --no-hooks`, so nothing touches the real global
  harnesses and Impeccable's own settings writer is disabled; our settings-injector registers the
  design hook into the project's `.claude/settings.json` instead. An end-state test asserts the
  scratch HOME ≠ real HOME and that only `<root>/.claude` is written. Status nuance (migrated 2026-07-31): mitigated by design — Phase 3, spec
- **Residual:** relies on the installer honouring `--scope=project`/`--no-hooks`; a future
  Impeccable that ignores them would need the orchestrator pinned/updated. Accepted.



### RISK-DESIGNSTACK-002 — `impeccable update` clobbers the Pro Max content-graft

- **Status:** Mitigated
- **Context:** Pro Max is integrated by grafting "query search.py first" prose into Impeccable's
  `reference/*.md` (no first-class external-DB plug exists). `npx impeccable update` overwrites those
  files, silently removing the graft and the Pro Max enrichment with it.
- **Mitigation:** the updater's `afterUpdate` (`component-registry.mjs` `impeccable` entry) re-runs
  `applyPromaxGraft()` after every auto-update; the graft is anchored + sentinel-guarded
  (`<!-- promax-graft:v1 -->`) so re-apply is idempotent — same infra shape as
  `gsd-agent-patches.mjs`. Status nuance (migrated 2026-07-31): mitigated by design
- **Residual:** if an Impeccable release renames/removes the target reference files the anchor is
  not found and the graft is **skipped** (reported as `skippedNoAnchor`), not mis-inserted — the
  detector still works, just without Pro Max enrichment until the anchors are refreshed. Accepted.



### RISK-DESIGNSTACK-004 — Registered hook path couples to the installed skill's script location

- **Status:** Mitigated
- **Context:** the design hook we register into the project's `.claude/settings.json` points at
  `.claude/skills/impeccable/scripts/hook.mjs`. If an Impeccable upgrade relocates or renames that
  script, the hook silently stops firing.
- **Mitigation:** idempotent re-registration — re-running `/init-stack` (and the updater's
  post-update path) re-verifies the hook entry and the script path, re-registering if it moved;
  the registration step short-circuits only when a valid entry pointing at an existing script is
  present. Status nuance (migrated 2026-07-31): mitigated by design
- **Residual:** between an upstream rename and the next `/init-stack`/update cycle the hook could be
  stale. Low (Impeccable's script layout has been stable at v3.3.1); accepted.



### RISK-NEO4J-001 — Multi-source staleness when several PCs push the global graph to one Neo4j

- **Status:** Mitigated
- **Context:** each PC has its own `~/.graphify/global-graph.json` (aggregate of that PC's repos).
  Multiple PCs push into one shared Neo4j on the NAS. graphify's `MERGE` never deletes, so nodes
  for files deleted in a repo persist. A naive "rebuild = wipe the whole graph then re-push" would
  destroy the repos contributed by *other* PCs (they are not in the wiping PC's global graph).
- **Mitigation:** per-repo scoped refresh, never a global wipe. Every global-graph node carries a
  `repo` property (= repo_tag; `prefix_graph_for_global` in graphify `build.py`). Before the MERGE
  push, the wrapper deletes only the repos present in *this* PC's global graph:
  `MATCH (n {repo: $tag}) DETACH DELETE n`. Repos known only to other PCs are never matched. Status nuance (migrated 2026-07-31): mitigated by design
- **Residual:** shared external-library nodes (deduped by label) are owned by whichever repo added
  them first and can be briefly orphaned on that repo's refresh; MERGE re-adds them on next push.
  See RISK-NEO4J-005 for the same-repo-two-PCs case. Accepted.



### RISK-NEO4J-002 — NAS/Neo4j unavailable at push time

- **Status:** Mitigated
- **Context:** the push runs after a graph rebuild and may be chained onto `graphify-sync-all` or a
  commit-time flow. If the NAS is down/asleep or the bolt port is unreachable, a hard failure would
  block the sync (or a commit, if ever wired there).
- **Mitigation:** the wrapper does a short TCP reachability probe on the bolt host:port first and is
  **fail-soft** — on unreachable it warns and exits 0, leaving the JSON source of truth intact. The
  push is never a prerequisite for any commit/sync step. Status nuance (migrated 2026-07-31): mitigated by design
- **Residual:** Neo4j can lag the JSON until the next successful push. Acceptable — JSON is the
  source of truth graphify reads; Neo4j is an eventually-consistent mirror. Accepted.



### RISK-NEO4J-006 — Connection test at setup time depends on the neo4j driver being present

- **Status:** Mitigated
- **Context:** the 2026-07-24 C4 rewrite (`.ultrapowers/archive/specs/2026-07-24-graphify-neo4j-setup-test-before-save-plan.md`)
  makes `setup.mjs` **test** the Neo4j connection before writing `~/.graphify/neo4j.env`. The
  authoritative test (`RETURN 1` via the python driver) needs `neo4j` installed in graphify's
  interpreter. On a fresh PC where graphify/driver is absent, the test cannot run.
- **Mitigation:** the C4 flow calls `ensureNeo4jDriver` (uv `--with neo4j` / pipx inject / pip)
  right before the test, so the driver is installed exactly when Neo4j is configured — full
  always, lite only when the ecosystem is opted in (kept out of graphify's blanket extras so lite
  stays clean by default). If it still can't be made present, C4 does not save a false "enabled" —
  it leaves `GRAPHIFY_NEO4J` unset so the offer re-asks next run (same idiom as a filesystem-write
  failure). Governed by decision D1 in the plan. Status nuance (migrated 2026-07-31): mitigated by design
- **Residual:** on a PC with no way to install the driver, Neo4j config is deferred, not saved
  broken. Accepted — deferral is the correct outcome there.



### RISK-PNPM-004 — enableGlobalVirtualStore structurally incompatible with Turbopack

- **Status:** Mitigated
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
  preserves dedup, less-trodden, may hit Turbopack edge cases. Status nuance (migrated 2026-07-31): detector built; auto-apply intentionally not done
- **Detection:** `payload/bin/turbopack-gvs-check.mjs` (wired into init-stack, Next+pnpm only)
  flags Turbopack/Next + effective out-of-tree store (gVS flag OR a junctioned `.pnpm` OR an
  external `virtual-store-dir`) and prints the tailored Strategy-B recipe with a format-aware
  (CJS/ESM) next.config snippet. Strategy B chosen (sibling store + widened root) over disabling
  gVS, to preserve cross-worktree dedup.
- **Residual:** the detector WARNS with a recipe but does not auto-edit `.npmrc`/`next.config`
  (project-specific paths + arbitrary config formats make auto-writing unsafe) — applying it is a
  consent-gated manual step. Strategy B is the less-trodden path and may hit Turbopack edge cases;
  the fallback (disable gVS, store in-tree) is noted in the recipe. Accepted.



### RISK-ULTRAPOWERS-005 — Migration can mis-pair spec and plan documents

- **Status:** Mitigated
- **Context:** migration into `.ultrapowers/phases/<NN>-<slug>/` must pair 21 specs with 13 plans
  in `.ultrapowers/archive/`. Pairing is guessed from date and slug, not derived; some files pair with
  nothing (`2026-07-26-phase2-design-skills-HANDOFF.md`). A silent wrong pairing buries a design
  document under an unrelated phase.
- **Mitigation:** migration proposes and does not act — it prints the full mapping plus the
  unpaired list and waits for confirmation, the same rule Т.4 sets for the resume hook. `git mv`
  preserves history. Unpaired files go to `.ultrapowers/archive/` intact rather than being guessed
  at. Acceptance counts files in and out. Status nuance (migrated 2026-07-31): mitigated by design
- **Residual:** a confirmed-but-wrong pairing. Recoverable — `git mv` keeps history, so the move
  is reversible.



### RISK-ULTRAPOWERS-007 — A fork left un-updated drifts until merging stops being mechanical

- **Status:** Mitigated
- **Context:** the merge burden in `RISK-ULTRAPOWERS-001` is per release and small only while the
  fork stays close to upstream. Skip several releases and the accumulated diff crosses the point
  where the transform replays cleanly, at which case each delta has to be re-derived by hand. This
  is the failure mode that makes people abandon forks, and it arrives through inaction rather than
  through any decision.
- **Mitigation:** `/up-update` runs from any project, so checking never requires switching
  repositories — the cost of staying current is one command rather than a context switch. Release
  detection queries GitHub directly (no Claude Code command reports available plugin updates in
  machine-readable form; this was checked), so drift is surfaced rather than waiting to be asked
  about. Status nuance (migrated 2026-07-31): mitigated by design, 2026-07-27
- **Residual:** the command still has to be run. Whether a periodic nudge is warranted should be
  decided after the first few real updates, not guessed now.



### RISK-ULTRAPOWERS-009 — Removing foreign hook registrations weakens "only ever touch our own entries"

- **Status:** Mitigated
- **Context:** the settings merge in `setup.mjs` claims hook slots through `mentionsOurs(e)`, whose
  basenames are collected dynamically from `settings.partial.json`. Foreign entries are therefore
  safe *by construction* — the code cannot name a hook this bundle does not ship, so it cannot drop
  one. `filterGsdHooks` deliberately breaks that property: it matches `hooks/gsd-*` by pattern and
  removes registrations belonging to another product. It is the first code path in the installer
  that can delete a settings entry it did not author.
- **Mitigation:** containment around the match, not a narrower match — the match had to get *wider*,
  not tighter, to work at all. Every hook of a real gsd-core install is registered as one quoted
  command line with no `args` array (`"…/node.exe" "…/hooks/gsd-check-update.js"`), so a matcher
  reading only `args` — the shape this bundle uses — de-registered nothing while the inventory moved
  the files anyway, leaving 15 registrations pointing at paths that no longer exist. `filterGsdHooks`
  therefore tests `h.command` as well as `h.args`, unanchored and stopping at a quote or space.
  What holds the risk is the gate around it: the path runs only on `base`/`lite`, only when
  `~/.claude/gsd-core/VERSION` exists, and only with consent — the bulk flags (`--replace-all`,
  `--merge-all`) are neither consent nor even a prompt, scripted use needs the dedicated
  `--uninstall-gsd`, a bulk or non-TTY run reports and stops, and the interactive default is no.
  A copy of `settings.json` goes into the cleanup-trash batch *before* the edit and the exact `cp`
  that restores it is printed. `hooks/lib/gsd-*` stays deliberately unmatched: nothing registers a
  lib file as a hook, so matching it would widen the reach for no behaviour. Status nuance (migrated 2026-07-31): 2026-07-28, with the foreign gsd-core detector in `setup.mjs`
- **Residual:** any registration whose command line *mentions* a `hooks/gsd-*` path is dropped, so a
  third-party hook living at that path, or an unrelated command that merely passes one as an
  argument, goes with it — on a machine that has gsd-core installed and a user who consented.
  Reversible from the printed `cp`, and the file itself is only moved, never deleted. Accepted: the
  alternative is reading gsd-core's own manifest, which would couple this bundle to a foreign
  product's internal layout.



## Closed
### RISK-DESIGNSTACK-005 — Pro Max `design` sub-skill hardcodes global paths / prune could delete a user skill

- **Status:** Closed (2026-07-31) — subset choice + provenance-based prune
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



### RISK-FALLOW-001 — `fallow.enabled` is set optimistically, not gated on binary presence

- **Status:** Closed (2026-07-17) — the check-and-decision point already existed at
  `/init-stack` step 8; the bug was that the nag text pointed at the wrong step number.
  **Superseded context (2026-07-27):** `init-stack.md`'s steps 6-11 (including this fallow
  step 8) were later deleted wholesale in the GSD-free rewrite `eaf1a50` — the interactive
  fallow proposal no longer exists anywhere. See RISK-INITSTACK-001 for the current state.
  **Re-resolved (2026-07-27):** base/lite now receive fallow via the guarded Superpowers-review
  graft (`hooks/lib/superpowers-fallow-graft.mjs`, ships to all profiles) — see
  RISK-INITSTACK-001's resolution note for the full mechanism.
  **Mechanism moved (2026-07-28):** the graft is now `transform/deltas/001-fallow-graft.patch` in
  the ultrapowers fork, baked into the plugin at build time. The runtime graft and its hook were
  deleted: they patched the *upstream* plugin cache, and every profile now enables the fork
  instead, so it had become code that repaired a plugin nobody loads. The capability is unchanged
  and its `.planning/` guard is intact — what changed is that it is now part of the artifact and
  therefore watched by the rebuild, instead of being re-applied over someone else's files.
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



### RISK-INITSTACK-001 — `/init-stack` GSD-free rewrite deleted steps 6-11; ~24 stale references + 2 dropped capabilities

- **Status:** Closed (2026-07-27) — the stale references were fixed first; the two
  genuinely-dropped capabilities have now been reinstated (a third, `claude_orchestration`, is
  deliberately retired — see below).
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
- **Category-II reinstatement (done, 2026-07-27):** three capabilities were tracked; two were
  genuinely reinstated, one deliberately retired.
  1. **Fallow** (`fallow`'s install-proposal never reaching base/lite, and RISK-FALLOW-001) —
     reinstated via a `.planning/`-guarded graft into the code-review flow: it grafts the fallow
     devDependency proposal into the reviewer path, reaches **all profiles**, and is inert (no-op)
     inside GSD projects (detected via the `.planning/` marker) so GSD's own gate stays the sole
     enforcer there — no duplicate prompt, no cross-methodology stomp.
     **(2026-07-28)** delivery changed: it is now `transform/deltas/001-fallow-graft.patch` inside
     the ultrapowers fork rather than `hooks/lib/superpowers-fallow-graft.mjs` re-patching the
     installed cache at every SessionStart. Both files were deleted. Same behaviour, but the fork's
     rebuild now fails loudly if upstream rewrites the file underneath it, where the runtime graft
     would simply have stopped finding its anchor.
  2. **Stack-aware test/build-command proposal** — reinstated as `bin/detect-stack-commands.mjs`
     + `bin/lib/stack-commands.mjs`, wired into the rules compiler, which now emits a
     `## Detected commands` section into `stack-rules.md` (rebuild-safe: re-derived from the
     project's stack markers on every rebuild, not hand-maintained).
  3. **`claude_orchestration` pilot ask — deliberately retired, not reinstated.** Rationale:
     GSD-only relevance, narrow value versus the interactive-ask cost, fail-closed by design,
     and the gate it fed was usually closed in practice anyway. The reference doc
     `payload/references/gsd-claude-orchestration-pilot.md` is retained as-is (dormant, not
     deleted) for future reference; no interactive restore was built and none is planned.
  Profile-membership for both reinstated capabilities follows the `pnpm-phantom-fix`
  stack-marker pattern (not GSD-coupling), per memory `gsd-superpowers-orchestration-boundary`.
  All-profiles shipping is asserted by a regression test in `variants.test.mjs`
  ("Category-II files ship to all profiles").
- **Residual:** none outstanding for capabilities #1 and #2. Capability #3 stays permanently
  unreinstated by design — if the orchestration-pilot idea is revisited later, it starts fresh
  from the dormant reference doc rather than resuming this risk.



### RISK-STATUSLINE-001 — the context-window size field name is documented, not observed

- **Status:** Closed (2026-07-31) — observed, 2026-07-30
- **Resolution:** a live payload was captured on Claude Code 2.1.220 through the throwaway
  `_payload-dump.mjs` registered as `statusLine.command`, and it settles the question: the
  `context_window` block carries `total_input_tokens`, `total_output_tokens`,
  `context_window_size`, `current_usage`, `used_percentage`, `remaining_percentage`. The size
  arrives as **`context_window_size`** (1000000); **`total_tokens` is absent**. So the
  pre-phase-08 reader had indeed been falling through to the hardcoded `1_000_000` on every
  render, and phase 08's correction is right. The deploy-gate consistency check passed on the
  same payload: `current_usage` summed to 314415 against a 1000000 window — 31.4% — while
  `used_percentage` read 31. Numerator and denominator come from different fields and agree.
  Phase 08 plan task 1 is discharged; the `?? total_tokens` arm is kept as cheap insurance
  against a future rename, not because it is reachable today.
- **Context:** phase 08 found that `statusline-lib.mjs` read the context window size from
  `data.context_window.total_tokens`, a field the documented statusLine payload does not have —
  the documented name is `context_window_size`. Every occurrence of `total_tokens` in this
  repository was self-authored, in our own tests and design documents; no captured live payload
  existed anywhere in the tree. So the denominator had been falling through to a hardcoded
  `1_000_000` on every render regardless of model, and looked right only because the machine
  reporting it ran a 1M-context session. The correction is in, but the field name still comes
  from documentation rather than from an observed payload.
- **Mitigation:** the reader is `context_window_size ?? total_tokens ?? 1_000_000`, so it is
  correct under either name and degrades to the old behaviour if both are absent. Plan task 1 of
  phase 08 exists to capture a live payload and settle it; it was deferred because it needs a
  Claude Code restart no subagent can perform, and it remains outstanding rather than dropped.
- **Residual:** if the real field is neither name, the denominator silently reverts to 1M. The
  failure is self-diagnosing on the first render after a deploy: the token figure comes from the
  real `current_usage` sum while the percentage comes from `used_percentage`, so a wrong
  denominator shows up as an internally inconsistent segment — `34.0K/1M 17%` rather than a
  consistent pair. Treat that consistency check as the deploy-gate acceptance criterion for the
  statusline, which is what makes the outstanding task non-blocking in practice as well as in
  principle.



### RISK-ULTRAPOWERS-002 — Rebrand is machine-wide and cannot be gated per project

- **Status:** Closed (2026-07-27) — the fork removed the premise, not just the symptom.
- **Context:** the patch landed in `~/.claude/plugins/cache/.../superpowers/`, which has no
  project root. The `.planning`-based predicate that disables Ultrapowers inside GSD projects
  under the `full` profile therefore could not reach it: in a GSD project, Superpowers skills
  still presented themselves as Ultrapowers. Recorded as an accepted limitation because no
  mitigation existed — patching only skills GSD never calls was a half-measure, and suppressing
  the patch when any GSD project exists is unimplementable with no machine-wide project list.
- **Resolution:** a fork is a plugin, enabled and disabled per project like any other, so the
  existing gate reaches it. Nothing needed to be built for this; the limitation was an artefact
  of patching a machine-wide cache.



### RISK-ULTRAPOWERS-003 — Blind replacement would break `superpowers:` skill resolution

- **Status:** Closed (2026-07-27) — no classification survives, so there is nothing left to
  misclassify.
- **Context:** the skill namespace derived from the plugin directory name, which the rebrand
  deliberately did not touch, so a naive `\bSuperpowers\b` -> `Ultrapowers` pass would rewrite the
  prefix in `superpowers:writing-plans` too. The failure was delayed — the file still read
  correctly and only the invocation broke, at use time. The mitigation was a classification table
  whose protective buckets ran first and consumed their matches.
- **Resolution:** inside our own fork the rename is wholesale — directory name, plugin identity
  and namespace all become ours, and `ultrapowers:brainstorming` is the real invocation name
  rather than a label rewritten over a foreign one. There is no foreign identity to protect.
  The table was reverted in `47db796`; its review had already proven by execution that the
  enumeration could not be completed — four path shapes fell through to `brand` and were
  rewritten into paths that never resolve.
