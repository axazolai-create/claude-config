# Phase 2 — design skills into the frontend template — HANDOFF (resume after /clear)

**Why this file:** Phase 1 (three-profile unification) is SHIPPED and merged to `master`. Phase 2
is the second, orthogonal deliverable from the same design spec. This captures everything needed to
resume Phase 2 in a fresh session without re-deriving it.

## Phase 1 status (done — context only)
- Merged to `master` and pushed. Executed via subagent-driven-development, 9 tasks, all reviews
  clean, final whole-branch review clean, plus a merge-time CRLF-in-assembler CRITICAL fix.
- Profiles now unified: `full` / `base` / `lite` differ only by component set; one resolver
  (`variants.mjs` extends-chain denylist), one Node `payload/bin/init-stack.mjs` with a plugin
  **`tier` filter**, single-source `payload/bin/lib/stack-markers.mjs`, composable
  `payload/claude-md/` fragments assembled by `payload/bin/lib/assemble-claude-md.mjs`.
- **Phase 2 depends on Phase 1's shipped mechanisms:** the per-plugin `tier` field + `maxPluginTier`
  cap (Task 6), the setting-template `skills[]` install channel, and init-stack's
  `gatherSkills`/`installSkills` (already ported to Node).

## Phase 2 goal (spec §8)
Replace the `frontend-design` plugin with **UI UX Pro Max** + **Impeccable**, wired into
`payload/setting-templates/frontend/_base.json`, so both apply **only when `/init-stack` detects a
frontend stack**, in **all three profiles** (`tier: core`).

## Locked decisions
- **OI-2 RESOLVED → VENDOR Pro Max.** Generate the Pro Max skill via the CLI installer with
  `--offline` and commit the generated skill into the bundle (reproducible, offline, version-pinned,
  deterministic on Windows). Do NOT rely on live per-project marketplace install.
- Both skills are `tier: core` ⇒ present in full/base/lite. Frontend-scoped via the template.

## Verified facts (don't re-research)
- **UI UX Pro Max (basic)** = MIT, fully local (BM25 over local CSV), **no account / API key**,
  explicit `--offline`. Premium (uupm.cc) is a separate paid product, unused. Marketplace install
  breaks on Windows < 2.5.1 (`Zip file contains a symbolic link`) → that's why we use the CLI
  installer / vendoring: `npm i -g ui-ux-pro-max-cli && uipro init --ai claude --offline`.
- **Impeccable** = Apache-2.0, npx skill (`npx impeccable install` → `/impeccable init`),
  deterministic detector rules, no LLM/API key. Install channel = template `skills[]` entry
  (same pattern as the existing `shadcn` skill).

## Open questions to resolve in brainstorming (before writing the Phase-2 plan)
- **Vendoring mechanics for Pro Max:** run `uipro init --offline` where, and vendor the generated
  skill under which path (e.g. `payload/skills/ui-ux-pro-max/**`)? How does `installSkills`/the
  template `skills[]` entry reference a VENDORED skill vs an npx one? (init-stack's `gatherSkills`
  keys skills by dirname under `~/.claude/skills` + `./.claude/skills`.)
- **frontend/_base.json edit:** remove the `frontend-design` plugin entry AND its `enabledPlugins`
  key; add the two skills[] entries. Confirm nothing else references `frontend-design`.
- **Tests:** frontend template resolves Pro Max + Impeccable in all three profiles; a non-frontend
  fixture (e.g. Kotlin/Python) never surfaces them; Windows offline-install smoke for Pro Max.

## Machine-level side effect from Phase-1 sessions (NOT git)
`~/.claude/settings.json` had `frontend-design@claude-plugins-official` set to
`enabledPlugins:false` (unused, slated for this Phase-2 replacement). Requires a Claude Code restart
to take effect. Not part of the repo.

## How to resume (fresh session after /clear)
1. Read this file + the project memory (`three-profile-unification`) + spec §8
   (`docs/superpowers/specs/2026-07-26-three-profile-unification-design.md`).
2. `superpowers:brainstorming` on the open questions above (vendoring mechanics is the main one).
3. `superpowers:writing-plans` → `superpowers:subagent-driven-development`.
