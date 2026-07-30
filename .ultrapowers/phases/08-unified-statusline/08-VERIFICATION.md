# Phase 08 — unified-statusline — verification

Date: 2026-07-30
Verified against: `7a7e919..01aeaf0` on `feat/unified-statusline` (HEAD `01aeaf0`), the working
tree at that commit, and a run of the test suite. Not against any implementer report or ledger.

## Goal

> **Goal:** Replace the install-time choice between two statusline renderers with one renderer
> that composes a fixed floor plus segments that appear only when their source exists.

**ACHIEVED.**

## Evidence

The goal carries four claims. Each is listed with what delivers it.

### 1. The install-time choice is gone — registration no longer varies by profile

- `setup.mjs:1019-1028` — one branch, `if (partial.statusLine)`, writing
  `join(CDIR, "hooks", "statusline.mjs")` unconditionally. The diff removed both the
  `VARIANT === "full"` guard and the `else if (VARIANT !== "full")` arm that wrote the wrapper.
- `settings.partial.json:101-104` — the shipped `statusLine.command` is
  `node "<HOME>/.claude/hooks/statusline.mjs"`.
- `payload/hooks/lib/gsd-statusline-registration.mjs:11-14` — `desiredCommand()` targets
  `hooks/statusline.mjs`; `:24-25` `isOurs` recognises the retired `gsd-context-meter` name, and
  `:26-33` **migrates** it rather than reporting "already set" (commit `be8b67f`) — without that,
  a machine carrying the old entry would keep a command naming a deleted file.
- Test: `setup-variants.e2e.test.mjs:183-206` — `full`, `base`, `base` again (idempotence),
  `lite`; each asserts `/hooks\/statusline\.mjs"$/` **and** `existsSync` of the file the command
  names, so a prune that invalidated the registration would fail the test rather than the prompt.
- Test: `variants.test.mjs:254,267` — `lite`'s resolved file set contains `statusline.mjs`.

### 2. Two renderers became one — the wrapper is deleted

- Deleted in the diff and absent from disk: `payload/hooks/gsd-context-meter.mjs`,
  `payload/hooks/lib/gsd-context-meter-lib.mjs`,
  `payload/hooks/lib/gsd-context-meter-lib.test.mjs` (verified with `ls`, all three missing).
- `setup-variants.e2e.test.mjs:190` asserts the wrapper is gone after a `full` install.
- `payload/hooks/lib/statusline-lib.mjs` now exports exactly three symbols
  (`formatCurrentTokens`, `formatContextWindow`, `computeContext`); `computeUsedTokenMetrics`,
  `usedTokensOf`, `appendUpdatesSegment` and `rewriteContextBar` no longer exist anywhere.
- `renderGit` and `plainState` are absent from `payload/hooks/statusline.mjs`, and the
  `node:child_process` import went with them (`:5-10`).

### 3. One renderer composing a fixed floor

- `payload/hooks/statusline.mjs:60-64` — `render({ updates, model, context, project, gsd, up })`
  is the only place segment order is decided; `.filter(Boolean).join(DIM(" │ "))`.
- The model segment, which this bundle never had, is `statusline.mjs:187`
  (`data.model.display_name`). Project is `basename(root)` at `:189`.
- Live proof against this checkout (read-only, real payload shape):
  `Opus 5 (1M) │ 165.6K/1M 17% │ claude-config │ 08 ✔7/8 running`, exit 0 — the spec's example
  line, rendered by the shipped file.
- Tests: `statusline.test.mjs:82-106` (order, updates-first, gsd-then-up, all-empty),
  `:184-189` (project segment is the directory name and nothing else).

### 4. Segments appear only when their source exists

| segment | gate in code | test |
|---|---|---|
| updates | `renderUpdates` `statusline.mjs:17-22` — `""` unless a non-empty array | `statusline.test.mjs:13-22`, `:210-262` |
| context | `computeContext` `statusline-lib.mjs:28-44` — `""` when neither usage nor percentage | `statusline-lib.test.mjs:17-57`, entry point `statusline.test.mjs:263-287` |
| gsd | `gsdActive` `statusline.mjs:175-178` — `<claudeDir>/gsd-core/VERSION` **and** `<root>/.planning/config.json`; applied at `:190` | `statusline.test.mjs:491-503`, `:304-341` |
| up | `installedProfile` `statusline.mjs:55-58`, applied at `:191` — only `lite` suppresses, absent manifest fails open | `statusline.test.mjs:524-535` (incl. the legacy `variant` key), `:537-550` |

All five rows of the spec's composition matrix are exercised: `full`+gsd
(`statusline.test.mjs:371-379`, both segments in one line), `full`/`base` without gsd (`:491-503`,
first half), `base` with a hand-installed gsd-core (`:502`), and `lite` (`:542-543`).

### 5. Supporting claims the goal depends on

- **The context-window field fix.** `statusline-lib.mjs:31` —
  `cw.context_window_size ?? cw.total_tokens ?? 1_000_000`. The buffer-normalisation arithmetic
  and the `CLAUDE_CODE_AUTO_COMPACT_WINDOW` dependency are gone; `statusline-lib.test.mjs:51-57`
  asserts the env var no longer changes the output.
- **Deterministic in-flight selection.** `phaseSegment` `statusline.mjs:145-168` (ROADMAP
  `current`, else exactly one `running`, else nothing) and `upState` `:171-173` (a phase always
  outranks a ledger). `renderPhase` `:42-53` prints a tally, subtracts `tasks_dropped`, and never
  a percentage. Tests `statusline.test.mjs:396-489`, including `:460` where a ledger with a
  future mtime still loses to the declared phase.
- **No subprocess at all.** `grep` for `child_process|execFileSync|spawnSync|execSync` over
  `statusline.mjs` and `statusline-lib.mjs` returns nothing, and
  `statusline.test.mjs:168-182` walks the static import graph from the entry point and asserts
  the property of the *source*, so a reintroduced spawn fails even if no rendered line changes.
- **The two findings carried out of phase 07.** `renderGsd` guard `statusline.mjs:25`,
  `renderSdd` guard `:38`, both tested against the `null` shape production actually passes
  (`statusline.test.mjs:131-143`, commits `fb4a82c`/`9d1ed58`). Hanging stdin: the `unref`'d
  guard timer `statusline.mjs:222-223` plus `process.stdin.destroy()` at `:218` — releasing the
  handle is what ends the process, tested with a real `spawn` whose stdin is never closed
  (`statusline.test.mjs:554-568`).
- **Documentation.** `README.md:856-882` and `README.en.md:858-884` describe one renderer for all
  three profiles, the six segments in order, both conditions, the deterministic selection order,
  and the no-percentage rule. No `gsd-context-meter.mjs` component-table row survives in either
  file; the remaining mentions (`README.md:431,517,859`, `README.en.md:522,861`) explain why the
  migration predicate still recognises the old name — a behaviour the plan's own Task 8 Step 2
  requires to persist.
- **Suite.** `node --test payload/hooks/statusline.test.mjs payload/hooks/lib/statusline-lib.test.mjs
  setup-variants.e2e.test.mjs variants.test.mjs payload/bin/lib/gsd-core-detect.test.mjs`
  → **112 pass, 0 fail, 0 skipped**.
- **Code graph.** `graphify-out/` is gitignored, so it cannot appear in the diff; verified locally
  instead — `graph.json` mtime `16:12` against the last commit's `16:11`, and its node offsets
  (`main()` L180, `phaseSegment()` L145) match the current `statusline.mjs` exactly. Task 8
  Step 4 ran.

### 6. Phase state — the plan's Task 8 Step 3 deviation

The plan prescribed `tasks_done: 8`, `tasks_total: 8`, `status: complete`. The branch records
`08-STATE.md:3,7-8` as `status: running`, `tasks_done: 7`, `tasks_total: 8`, with `:27-33`
naming Task 1 as deferred-not-dropped and explicitly refusing a `tasks_dropped` entry for it.
That is honest state over plan compliance, and the state files are the controller's. Checked for
internal consistency, and they are:

- Seven tasks (2-8) have implementation commits on the branch; Task 1 has none — 7 of 8 is the
  true count, and `status: running` is the correct vocabulary for a phase with an open task.
- `.ultrapowers/ROADMAP.md` agrees: `current: "08"`, the phase row is
  `status: running, delivery: branch`, and the table says `feat/unified-statusline, 7/8 tasks`.
- `08-STATE.md:4-5` `delivery: branch` / `branch: feat/unified-statusline` matches the branch that
  exists.
- The renderer this phase built, run against this tree, reads those same files and prints
  `08 ✔7/8 running` — the state is not only consistent but parseable by the thing it describes.
- One cosmetic staleness: `08-STATE.md:31` says `tasks_done` "**will** reach 7 of 8" in future
  tense while the frontmatter already says 7. Prose only, no contradiction.

### 7. Scope added beyond the plan (noted, not a defect)

`setup.mjs:570-587` adds `warnStatuslineNamesMissingFile()`, called at `:1269` after the prune
(commit `5983f58`). It closes a real hole the plan did not cover — answering `(s)` to the
settings diff and yes to the prune leaves a command naming a deleted file, with no visible cause.
It has **no test**: no file outside `setup.mjs` references the function or its message string.
The logic has real branching (quoted-token extraction, `CDIR` prefix match, `existsSync`), so it
is not pure wiring under the repo's boundary-trust rule. Flagged for whoever reviews the branch;
it does not bear on the goal.

## Global constraints

| # | constraint | verdict | checked at |
|---|---|---|---|
| 1 | No npm dependencies; `node:*` built-ins only | **HELD** | No `package.json` in the tree (`ls` fails). `payload/hooks/statusline.mjs:5-10` imports `node:fs`, `node:path`, `node:os`, `node:url` plus two relative libs under `hooks/`; `payload/hooks/lib/statusline-lib.mjs` imports nothing at all. |
| 2 | Payload-only; never into `~/.claude` or this project's `.claude/` | **HELD** | `git diff --name-only 7a7e919..01aeaf0` touches `payload/**`, `setup.mjs`, `settings.partial.json`, `README.md`, `README.en.md`, `.ultrapowers/**` — all on the exception list — plus `.gitignore` (+3 lines ignoring `graphify-sync.log`), which is not on that list but is neither `~/.claude` nor `.claude/`. Nothing was written to either prohibited location. |
| 3 | Tests run with `node --test <file>`, `node:test` + `node:assert/strict` | **HELD** | `payload/hooks/statusline.test.mjs:2-3`; same imports in `statusline-lib.test.mjs:1-3`. The five-file `node --test` run above executed 112 tests without a runner. |
| 4 | Small helpers reimplemented locally, not cross-imported across `hooks/` ↔ `bin/` | **HELD** | `gsdActive` is a local `existsSync` pair at `payload/hooks/statusline.mjs:175-178`, not an import of `payload/bin/lib/gsd-core-detect.mjs`. The file's only non-`node:` imports are `./lib/statusline-lib.mjs` and `./lib/component-registry.mjs` (`:9-10`), both inside `hooks/`. |
| 5 | The statusline never breaks the prompt | **HELD** | `safe()` `statusline.mjs:15`, applied per segment at `:188,190,191`; `main(input)` inside `try/catch` at `:213`; `process.exitCode = 0` at `:214`; `process.stdout.on("error")` swallowed at `:203`. Tests: malformed JSON `statusline.test.mjs:191-201`, empty stdin `:202-209`, unreadable/malformed state files `:219-249`, a non-existent workspace dir `:505-510` — every one asserts exit 0 and empty stderr. |
| 6 | Terse code; comments only for a non-obvious *why* | **HELD** | Every comment in `statusline.mjs` states a reason the code cannot: `:44-45` why `== null` and not `Number(null)`, `:104-106` why the ledger tie-break is code-unit, `:123` why `(.+)$` under `/m` already stops before CRLF, `:206-208` why there is no `process.exit()` on Windows, `:215-217` why rendering alone does not end the process. No restatement-of-code comments found in the touched files. |
| 7 | No deploy in this plan | **HELD** | The diff contains no deploy path and writes nothing under `~/.claude`. `08-STATE.md:45-47` restates the rule; `.ultrapowers/ROADMAP.md` "Next" item 2 keeps the deploy gated on an audit and a written impact assessment, from `master`. |

## Gaps

- **unverifiable: the context-window size arrives as `context_window_size` rather than
  `total_tokens`** (plan Task 1, deferred by the user — it needs a Claude Code restart no
  subagent can perform). `.ultrapowers/phases/08-unified-statusline/refs/live-statusline-payload.json`
  does not exist; the phase directory holds only `08-PLAN.md`, `08-SPEC.md`, `08-STATE.md`.
  This is a gap in the **evidence**, not in the code: `statusline-lib.mjs:31` reads
  `context_window_size ?? total_tokens ?? 1_000_000` and is correct under either name, and
  `statusline-lib.test.mjs:25-30` covers the fallback.
  *What would settle it:* run plan Task 1 Steps 1-2 (register `_payload-dump.mjs` as
  `statusLine.command`, backing up the previous value), restart Claude Code, send one prompt,
  then print `Object.keys(payload.context_window)` from `~/.claude/_payload.json` and restore the
  setting per Steps 4-5. One real payload closes it permanently.

- **Task 8 Step 2's grep is not clean.** The step's stated expectation was that only
  `setup.mjs`'s and `gsd-statusline-registration.mjs`'s migration predicates and the
  `.ultrapowers/` records would still name `gsd-context-meter`. Three further live hits remain, at
  `payload/bin/lib/gsd-core-detect.test.mjs:49,50,54`, where the deleted filenames are used as
  arbitrary fixture path strings in the manifest-subtraction test. Inert — the strings are never
  resolved against the real payload and the test passes — but it is a stale name the step said
  would be gone.
