# stack-rules: per-project compiled rules snapshot (design)

Date: 2026-07-12
Status: implemented (all decisions user-confirmed 2026-07-12, incl. the open ones below:
source dir `rules-src`, "щадящее" root-CLAUDE.md handling, gitignore yes; plus: setup.mjs
must clean bundle-owned files out of `~/.claude/rules/` and delete the dir if empty).
Replaces path-scoped auto-loading of `~/.claude/rules/*.md` as the rules delivery mechanism.

**Amendment 2026-07-13**: the "Rebuild trigger" row below (desync check via sourceHash +
stackFingerprint on every session start) was replaced with a plain existence check —
`session-init.mjs` only checks whether `.claude/stack-rules.md` exists; generation moved into
`/init-stack` as one of its own steps (`payload/commands/init-stack.md`). The hash-based
desync check was considered too eager: it fired a rebuild instruction every session for any
drift. `hooks/lib/stack-rules-check.mjs` is unchanged and still used by the compiler subagent
to stamp `sourceHash`/`stackFingerprint` into the snapshot's frontmatter — it's just no longer
invoked automatically by `session-init.mjs`. See `RISK-STACKRULES-002` for the accepted
tradeoff (no more auto-freshness) and `rules-src/README.md` for the current mechanism
description. The rest of this document (sections 1, 2, 4, 5) is otherwise still accurate.

## Problem

1. Files under `~/.claude/rules/` without `paths:` frontmatter load into EVERY session of
   EVERY project: `rules/README.md` (4.9 KB) + `rules/templates/*.md` (2.4 KB) —
   ~7.3 KB/session of overhead confirmed live (they appear verbatim in session context).
2. `paths:` glob scoping is fragile for frameworks sharing extensions — `python.fastapi.md`
   and `python.flask.md` carry their own "if it doesn't trigger, import manually" warnings.
3. Overlapping rules load separately and pay for the overlap twice (`mobile.md` vs
   `kotlin.android.md` permissions/secrets guidance, etc.).

## Decisions (user-confirmed 2026-07-12)

| Axis | Choice |
| --- | --- |
| Delivery into context | `.claude/stack-rules.md` per project, inlined via an `@stack-rules.md` import line in `.claude/CLAUDE.md` (which auto-loads at project scope) |
| Source auto-load | Removed entirely — no double loading with the snapshot |
| Rebuild trigger | Desync only: source hash + stack fingerprint checked by `session-init.mjs` on every session start; quiet when in sync |
| Snapshot format | Deduplicated compilation for the project's stack, not concatenation |

## Verified constraints (claude-code-guide against current docs, 2026-07-12)

- Rules without `paths:` load unconditionally; `rules/` subdirectories are scanned
  recursively; **no disable mechanism exists** (`claudeMdExcludes` covers only CLAUDE.md
  files). The only way to stop loading is to move files out of `~/.claude/rules/`.
- `<project>/.claude/CLAUDE.md` auto-loads alongside `<project>/CLAUDE.md` (same scope,
  siblings, no documented ordering).
- `@import` resolves relative to the importing file's directory: from `.claude/CLAUDE.md`,
  `@stack-rules.md` targets `.claude/stack-rules.md`. Recursive, max 4 hops. A **missing**
  import target triggers an approval dialog — the snapshot must exist before the import
  line is written.
- SessionStart `additionalContext` is capped at 10k chars (our instruction is far below).

## Mechanism

### 1. Source of truth moves: `payload/rules/` → `payload/rules-src/`
Deployed as `~/.claude/rules-src/`. Forced by the no-disable constraint above — this is the
only deviation from the original sketch ("source of truth stays in `~/.claude/rules`"): the
directory keeps its content and role but must leave the scanned path. `paths:` frontmatter
in the source files is KEPT — Claude Code no longer reads it, but the compiler uses it as
selection metadata (which file globs each rule targets), and it documents scope.
`rules-src/templates/` moves along with the directory, which by itself fixes Problem 1.

### 2. Per-project snapshot: `.claude/stack-rules.md`
Frontmatter written by the compiler:

```yaml
---
generated: stack-rules compiler        # marker: machine-owned, do not hand-edit
sourceHash: <hash of ~/.claude/rules-src contents>
stackFingerprint: <hash of detected signature files>
stacks: [next, telegram-node]
generatedAt: 2026-07-12T12:00:00Z
---
```

Body: compiled rules for the detected stack(s) — base + direction + cross-cutting per the
selection table in `rules-src/README.md`, deduplicated (shared guidance stated once), with
every rule's AVOID list preserved verbatim (loss-prevention anchor: dedup may merge prose
but must not drop a single AVOID item).

### 3. Session-start check (`session-init.mjs`, new step + `hooks/lib/stack-rules-check.mjs`)
Hooks cannot spawn subagents, so the hook only detects and instructs (same pattern as the
leanmode announcement note):

- Compute `sourceHash` over `~/.claude/rules-src/` (relative path + size + mtime per file —
  cheap; content hashing not needed at this fidelity).
- Compute `stackFingerprint` from the project's signature files (the existing fallback
  table: package.json, next.config.*, pyproject.toml, AndroidManifest.xml, ...): which
  exist, keyed by name.
- Compare both against the snapshot's frontmatter. On missing snapshot or mismatch, append
  one note to `additionalContext`: dispatch a subagent per `~/.claude/rules-src/README.md`
  § "Building stack-rules" to (re)build `.claude/stack-rules.md`. Otherwise stay silent.
- Opt-out env: `CLAUDE_STACK_RULES=0`.

### 4. Compiler instructions live in `rules-src/README.md` § "Building stack-rules"
The subagent (general-purpose) follows README:
1. Detect stacks from signature files (same table the hook fingerprints).
2. Select rules: `<lang>.base` for each detected language, `<lang>.<direction>` for each
   detected framework, cross-cutting rules whose concern applies (testing + security
   always; docker/ci/monorepo/api-contracts/mobile by their signature files).
3. Compile with dedup; keep all AVOID items verbatim; keep version pins.
4. Write `.claude/stack-rules.md` with the frontmatter above.
5. Ensure `.claude/CLAUDE.md` exists and contains the `@stack-rules.md` import (create the
   snapshot FIRST — missing-import dialog otherwise).
6. Root `CLAUDE.md` mention + templates step — per "Open decisions" below.

### 5. Templates step (user's step 6)
During build, apply `rules-src/templates/`:
- Next stack detected and no root `AGENTS.md` → copy `next.AGENTS.md` there.
- `graphify-out/` exists and root `CLAUDE.md` lacks the graphify block → insert/instruct
  per current template flow (subject to the curated-file rule below).
Import lines inside compiled rules that assume the old location (`@AGENTS.md` in
`node.next.md`) must be rewritten by the compiler for the snapshot's directory
(`@../AGENTS.md` from `.claude/`) or dropped if the target auto-loads anyway.

## Open decisions (to confirm before implementation)

1. **Source dir name**: `rules-src` (proposed) vs something else.
2. **Root `CLAUDE.md` mention** (user's step 4): the mention is navigational only (both
   files auto-load). Proposal: create `.claude/CLAUDE.md` always; touch root `CLAUDE.md`
   only when it exists and is not `CURATED:NOEDIT` (the deny hook blocks curated files;
   GSD quarantine applies); when root is missing, do NOT create it (avoids colliding with
   GSD-generated CLAUDE.md and the auto-mark flow).
3. **Gitignore**: add `.claude/stack-rules.md` to the project's `.gitignore` at build time
   (it is machine-generated personal config, like `.claude/changelog-queue`) — yes/no.

## Migration

- `setup.mjs` deploys `payload/*` → `~/.claude/*` verbatim; after the rename it must also
  REMOVE a stale `~/.claude/rules/` left from previous installs, or the old copies keep
  auto-loading and everything double-loads. Add an explicit migration step (delete
  `~/.claude/rules` when `~/.claude/rules-src` is being installed; prompt like other
  destructive setup actions if needed).
- Existing projects need no action: first session after upgrade sees no snapshot and gets
  the build instruction.
- Rollback: `git mv` the directory back; snapshots become inert files (their import line
  stays but content is static; remove by hand or leave).

## Cross-reference updates required

- `payload/CLAUDE.md`: READING ORDER + RULES RESOLUTION sections (deployed copy is
  hook-protected; edit the payload copy, user redeploys via `setup.mjs`).
- `payload/rules/gsd.md`: references `rules/templates/graphify.PROJECT.md`.
- `rules-src/README.md`: rewrite "How loading works" (now describes compilation, not
  auto-loading), add § "Building stack-rules".
- Repo `README.md`/`README.en.md`: rules mechanism section (standing rule: README sync in
  the same pass as hook/script changes).
- `RISK_REGISTER.md`: new entries (see below).

## Risks (to be logged in RISK_REGISTER.md with stable IDs)

- Snapshot staleness if the hook's mtime-based hash misses a change (e.g. same-second
  edits, or a restore that preserves mtimes) — accepted; any real edit via setup.mjs
  touches mtimes.
- Lossy dedup: the compiler is a model, not a script — a careless build could drop a
  requirement. Mitigations: AVOID-lists-verbatim rule, frontmatter marks the file
  machine-owned, source stays authoritative, rebuild is idempotent.
- Rules stop applying in never-initialized projects until the first session's build runs
  (one-session lag vs today's immediate glob loading).
- A stale `~/.claude/rules/` dir on machines that skip the setup.mjs migration step
  double-loads everything (mitigated by the explicit delete in setup.mjs).

## Verification plan

1. Unit-ish: run `stack-rules-check.mjs` against a fixture project — missing snapshot,
   fresh snapshot, stale hash, changed fingerprint → correct instruct/silence in each case.
2. Live: fresh session in this repo → note appears; run the build; restart → silence;
   `/memory` (or session context) shows stack-rules content via the import and does NOT
   show `rules-src/README.md` or templates.
3. Confirm a `paths:`-scoped rule from the old mechanism no longer loads (edit a `.ps1`
   and check `shell.md` is absent from context; its content should come from the snapshot
   instead when the stack includes shell).

## Effect estimate

- Every session, every project: −7.3 KB unconditional (README + templates).
- Sessions touching matching files: rules arrive deduplicated once instead of per-glob
  stacking; FastAPI/Flask-style trigger gaps disappear.
- New cost: one subagent build per project per source-change (hash-gated), ~0 when idle.
