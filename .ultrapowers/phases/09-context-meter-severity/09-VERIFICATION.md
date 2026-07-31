# Phase 09 — context-meter-severity — verification

Verified against the branch `feat/context-meter-severity` at HEAD `e5f8194`, the diff
`51a65d0..e5f8194`, and the code in the worktree. Not against implementer reports.

## Goal

> **Goal:** Colour the statusline's context segment by how full the model's window is, and mark
> it with an icon by how close automatic compaction is.

**ACHIEVED.**

## Evidence

**Claim 1 — the context segment is coloured.**
`paintContext(text, { colour, icon })` at `payload/hooks/statusline.mjs:57-62` wraps the text in
`\x1b[<colour>m … \x1b[0m` and returns `""` for empty text, so an absent segment stays absent
rather than becoming a bare escape pair. It is reached from `contextSegment` at
`statusline.mjs:211`, which is what `main` puts in the `context:` slot (`statusline.mjs:223`).
Covered by `payload/hooks/statusline.test.mjs:571-575` (unit) and by the entry-point tests at
`statusline.test.mjs:583-604`, which drive the whole process through stdin and assert `\x1b[91m`
and `\x1b[2m30.0K/1M 3%\x1b[0m` in real stdout. Confirmed live: driving
`payload/hooks/statusline.mjs` with a 1M/32% payload emits `\x1b[32m320.0K/1M 32%\x1b[0m`.

**Claim 2 — the colour is driven by how full the model's window is.**
`statusline.mjs:205` computes `windowPct` from the payload's own `used_percentage`, falling back
to `m.tokens / m.windowSize * 100` when the percentage is absent — the same number printed in the
segment, never a normalised one. It feeds only `severityOf(...).colour`. The colour table
`COLOURS` at `payload/hooks/lib/context-severity.mjs:1` is `[[95,"91"],[85,"31"],
[70,"38;5;208"],[45,"33"],[15,"32"]]` with fallback `"2"`, matched top-down by `pick`
(`context-severity.mjs:4-8`). Boundary-proved on both sides of every step at
`payload/hooks/lib/context-severity.test.mjs:5-15`.

**Claim 3 — the segment is marked with an icon.**
`paintContext` appends the icon *outside* the SGR pair (`statusline.mjs:61`), matching the spec's
reason (emoji ignore the surrounding colour). Asserted at `statusline.test.mjs:573`
(`"\x1b[91m12K/1M 12%\x1b[0m 💀"`). `ICONS` at `context-severity.mjs:2` is
`[[95,"💀"],[85,"🔥"],[70,"⚠️"],[45,"💡"]]` with `""` below 45 — exactly the plan's ladder from 45
up. Boundary-proved at `context-severity.test.mjs:17-25`.

**Claim 4 — the icon is driven by how close automatic compaction is.**
`statusline.mjs:210` computes `acProgress = m.tokens / ac.tokens * 100`, where `ac` comes from
`resolveAutocompact` (`payload/hooks/lib/autocompact.mjs:5-20`). That function resolves the point
in order: null without a usable window (`:8`), `disabled` when `autoCompactEnabled === false`
(`:9`), a `CLAUDE_CODE_AUTO_COMPACT_WINDOW` capacity capped at the model window (`:12-13`),
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` as `env` (`:14-15`), a stored observation for *this* `model.id`
capped at that capacity (`:16-18`), else the capacity itself as `assumed` (`:19`). Eleven
`resolveAutocompact` cases at `payload/hooks/lib/autocompact.test.mjs:5-78` cover every arm,
including the three `CLAUDE_CODE_AUTO_COMPACT_WINDOW` cases (set, capped, junk-ignored) and the
stale-observation fall-through at `:67-72`.

**Claim 5 — colour and icon are genuinely two different numbers.**
This is the claim that would be easiest to fake and it holds. `severityOf` reads `windowPct` and
`acProgress` through two independent `pick` calls (`context-severity.mjs:12-15`); proved
independent at `context-severity.test.mjs:27-30`
(`{windowPct:32, acProgress:96} → {colour:"32", icon:"💀"}`). At the entry point,
`statusline.test.mjs:606-620` renders 320K of a 1M window against an observed 600K compaction
point and asserts green **and** 💡 in the same line. Verified live for the case the spec says the
split exists for: the same payload with `CLAUDE_CODE_AUTO_COMPACT_WINDOW=600000` renders
`\x1b[32m320.0K/1M 32%\x1b[0m 💡`, and without it renders the same green text with no icon.
`statusline.mjs:209` is the guard that makes the default case honest — the ladders collapse onto
each other only when `source === "assumed"` *and* `ac.tokens === m.windowSize`, so a rounding
disagreement between `used_percentage` and the `current_usage` sum can never light an icon while
the colour says calm (`statusline.test.mjs:622-633`, at 44% printed against a 45.2% sum).

**Claim 6 — where the compaction point is learned from.**
`payload/hooks/precompact-observe.mjs:18` ignores anything but `trigger === "auto"`;
`:20` sums the transcript's last assistant `usage` via `observationFrom`
(`autocompact.mjs:22-33`, tested at `autocompact.test.mjs:80-96`); `:24-25` writes it unkeyed as
`pending`. `promotePending` (`autocompact.mjs:39-52`) keys it to the render's `model.id` once
both the id and the window are known, discards a figure larger than the window, and refuses a
pending written by a different model (`baseModelId`, `autocompact.mjs:35-37,43`) — tested at
`autocompact.test.mjs:98-151` and end-to-end at `statusline.test.mjs:635-668`. Verified live as a
round trip: the hook wrote `{"pending":{"tokens":10,"model":"claude-opus-5",…}}`, the next
statusline render turned it into
`{"models":{"claude-opus-5[1m]":{"tokens":10,"windowSize":1000000,"observedAt":…}}}` with no
`pending` left. The on-disk shape matches the plan's Interfaces block exactly. (The *spec* also
says "the state file records `source`"; the plan's Interfaces block does not list `source` and the
code does not write it — the presence or absence of a `models` entry is what distinguishes
observed from assumed.)

**Claim 7 — it reaches a real installation.**
`settings.partial.json:82-88` registers `PreCompact → node <HOME>/.claude/hooks/precompact-observe.mjs`
in the same shape as the neighbouring events. `node setup.mjs --dry-run` exits 0 and lists
`created hooks/lib/autocompact.mjs`, `created hooks/lib/context-severity.mjs`,
`created hooks/precompact-observe.mjs`, `updated hooks/lib/statusline-lib.mjs`,
`updated hooks/statusline.mjs`, plus the `PreCompact` settings insertion, and closes with
"expect: … PreCompact x1 …". `variants.json` needs no change as the plan predicted:
`alwaysExclude` is `hooks/task-lifecycle-probe*`, `claude-md/**`, `**.test.mjs`, and `base`/`lite`
exclude `hooks/gsd-*` — `hooks/precompact-observe.mjs` matches none, so it ships on all three
profiles. Documented at `README.md:366,865-871` and `README.en.md:375,867-873`.

**Supporting — the refactor changed nothing it was not allowed to change.**
`contextMetrics` (`payload/hooks/lib/statusline-lib.mjs:25-39`) is the extracted parse and
`computeContext` (`:42-47`) is a thin consumer of it. The three pre-existing `computeContext`
tests and the two pre-existing entry-point context tests
(`statusline.test.mjs:273`, `:279` — `"43.5K/200K 22% │ "`, `"20.0K/200K 10% │ "`) are unedited in
the diff and pass.

**Suite:** `node --test $(find payload -name '*.test.mjs')` — **497 pass, 0 fail**.

## Global constraints

- **No npm dependencies; `node:*` built-ins only; no `package.json`.** HELD. `context-severity.mjs`
  and `autocompact.mjs` import nothing at all; `precompact-observe.mjs:6-10` and
  `statusline.mjs:5-12` import only `node:fs`/`node:path`/`node:os`/`node:url` and relative
  payload modules. No `package.json` exists in the repo root.
- **Everything new goes in `payload/` or the installer; never write to `~/.claude` by hand.** HELD.
  `git diff --stat 51a65d0..e5f8194` touches only `payload/hooks/**`, `settings.partial.json`,
  `README.md`, `README.en.md` and `.ultrapowers/` documents. Nothing outside the repo was written;
  the installer's dry run is what put the files in `~/.claude`.
- **Terse code: no comments except a genuine non-obvious *why*; no grouping blank lines.** HELD.
  `context-severity.mjs` carries zero comments. The four comment blocks that exist are all
  *why*: the pending/promote split (`autocompact.mjs:1-4`), the capacity-vs-trigger distinction
  (`autocompact.mjs:10-11`), why `PreCompact` cannot read the point (`precompact-observe.mjs:3-5`),
  and why the collapse guard is conditional (`statusline.mjs:206-208`).
- **The statusline never breaks the prompt — a failure yields a missing segment, never an
  exception, never a non-zero exit.** HELD. Every new source is individually wrapped in `safe`
  (`statusline.mjs:190,192,196,197,200,202,203,211`), and `:211` falls back to the *unpainted*
  text rather than to nothing, so severity is an enhancement and never a precondition. Verified
  live: a deliberately corrupted `autocompact.json` still rendered the full green segment and
  exited 0.
- **The ladder is exactly `15 / 45 / 70 / 85 / 95`; colours `2, 32, 33, 38;5;208, 31, 91`; icons
  from 45 up `💡 ⚠️ 🔥 💀`.** HELD, verbatim at `context-severity.mjs:1-2` with the `"2"` and `""`
  fallbacks at `:13-14`; no other threshold or colour constant exists in the new code.
- **Colour is percent of the model window; the icon is percent of the way to automatic compaction
  — two different numbers.** HELD. `statusline.mjs:205` (window) and `:210` (compaction) are
  computed from different denominators and never assigned from one another except through the
  explicit `collapse` guard at `:209`.
- **The default autocompact point is the full window; never seed a guessed reserve.** HELD.
  `autocompact.mjs:19` returns the capacity, which is the model window unless the user set
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW`. A grep for `16.5`, `0.165`, `0.835`, `835000` across the five
  changed payload files finds nothing outside test fixtures.
- **Run tests with `node --test <file>`; full suite over `payload` and `.test/unit`.** HELD. 497
  pass, 0 fail. (`.test/unit` does not exist in this worktree; `find` warns and the `payload` half
  of the command is the whole suite. Not a phase-09 regression — the path is absent at `51a65d0`
  too.)

## Gaps

- **`RISK-STATUSLINE-002` is written but not committed.** The plan's closing section requires it in
  `RISK_REGISTER.md`, and the text is there —
  `.ultrapowers/RISK_REGISTER.md:1088-1109`, with the status, the mitigation rationale and the
  acceptance check the plan specifies. But `git status` reports `M .ultrapowers/RISK_REGISTER.md`
  and `git show e5f8194:.ultrapowers/RISK_REGISTER.md` contains no `RISK-STATUSLINE-002`. At HEAD
  the risk is unfiled. `.ultrapowers/phases/09-context-meter-severity/09-STATE.md` is likewise
  untracked (`??`). Both are one `git add` away; neither is a code defect.
- **The READMEs document a resolution order the code no longer follows.** `README.md:867-871` and
  `README.en.md:869-873` state the order as `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` → observation → "the
  full window", and add "the default is the full window, never a guessed reserve". Since
  `autocompact.mjs:12-13` reads `CLAUDE_CODE_AUTO_COMPACT_WINDOW` as the capacity, the documented
  default is wrong whenever that variable is set — which is precisely the configuration the spec
  calls "the case the split exists for". The docs were written at `145874d`, before the capacity
  arm landed at `4eac74e`, and were not revisited.
- **No entry-point test for the `CLAUDE_CODE_AUTO_COMPACT_WINDOW` split.** `resolveAutocompact` has
  three unit tests for it, but `runEntry` deletes the variable
  (`statusline.test.mjs:159`), so nothing in the suite proves the renderer's composition for the
  spec's headline case, and nothing pins the `collapse` guard's `ac.tokens === m.windowSize` arm
  against a future edit. I verified it manually — `CLAUDE_CODE_AUTO_COMPACT_WINDOW=600000` on a
  1M/32% payload renders green plus 💡 — so the behaviour is right today; it is the regression
  guard that is missing.
- **The `collapse` guard does not cover `source: "disabled"`.** `statusline.mjs:209` requires
  `source === "assumed"`, so with `autoCompactEnabled: false` the icon runs on
  `m.tokens / windowSize` while the colour runs on `used_percentage`. Where the payload's rounded
  percentage straddles a boundary the icon can lead the colour in a configuration that has nothing
  to warn about. Narrow and cosmetic, but it is the same disagreement `aacebb8` was written to
  eliminate, left in one branch.
- **unverifiable: "Deploy with `node setup.mjs`, restart Claude Code, and confirm the context
  segment is coloured at the current fill level."** — the plan's own deploy gate. `--dry-run` exits
  0 and lists the right files, but a real install plus a Claude Code restart is outside what I can
  observe. Watching one live prompt after `node setup.mjs` would settle it.
- **unverifiable: the `RISK-STATUSLINE-002` acceptance check** — that after one *real* automatic
  compaction `~/.claude/state/autocompact.json` holds a `models` entry with `tokens < windowSize`
  and no `pending`. I proved the mechanism by driving the hook and the renderer with a synthetic
  transcript, which exercises every line of the path; what remains unproven is only that a live
  `PreCompact` payload has the `trigger` and `transcript_path` shape the hook expects. One observed
  automatic compaction would settle it.
