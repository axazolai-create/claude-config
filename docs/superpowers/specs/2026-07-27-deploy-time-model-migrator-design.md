# Deploy-time old-model migrator (Phase 5 Part B)

**Date:** 2026-07-27 · **Phase 5, Part B** · Follows Part A (`1ec69b7`) + §6.1 (`9ac160d`)
**Source:** `docs/opus5/2026-07-26-opus5-migration.md` §6.3 (the "defaults don't reach existing
projects" gap) + project memory `project_phase5-opus5-migration`.

## 1. Problem

Two places on a machine keep old-model settings that the normal install does not fix:

1. **Existing GSD projects.** `gsd-config-patch.mjs` tier 1 stamps a project's model config once
   (`gsdModelConfigPatched` in `state/project-init.json`) and is then a permanent no-op. So the
   §6.3 override changes (five roles `haiku→sonnet`, `gsd-verifier sonnet→opus`) never reach a
   project that was stamped before the change. New projects pick them up; existing ones never do.
2. **The machine's session model.** `settings.partial.json` deliberately preserves the user's
   `settings.json "model"` value, so `setup.mjs` never touches it. A machine pinned to a
   superseded full id (e.g. `claude-opus-4-8`) stays there across reinstalls.

Part B migrates both — **surgically and without clobbering deliberate user choices**, the same
non-clobber ethos as §6.1.

## 2. Decisions (from brainstorm)

- **Project re-migration trigger:** explicit `/init-stack` only (not a self-propagating
  version-bump, not a machine-wide sweep). The migration doc §7.2 already positions `/init-stack`
  as the per-project refresh command.
- **Settings model migration:** `setup.mjs` **prompts** when it finds a known-superseded full id
  (keep / migrate to `claude-opus-5`); aliases and current ids are left alone, except `opus[1m]`,
  which migrates too; non-TTY / `--*-all` runs are report-only (no write).
- **Non-clobber everywhere:** a value is only changed when it currently holds a *known old*
  value. Anything the user set deliberately is reported and left as-is.

## 3. Design

### 3.1 Shared lib — `payload/bin/lib/model-migration.mjs`

Not gsd-prefixed, so it ships in every profile; pure, testable functions with no I/O:

```
migrateSettingsModel(model) -> { value, changed, from }
migrateProjectModelConfig(config) -> { config, changes }   // changes: [{ role, from, to }]
```

- `migrateSettingsModel` — when `model` matches a SUPERSEDED family, returns
  `{ value: <tier-preserving current id>, changed: true, from: model }`; otherwise
  `{ value: model, changed: false }`. **Tier-preserving:** an old opus id migrates to
  `claude-opus-5`, an old sonnet id to `claude-sonnet-5`, an old haiku id to `claude-haiku-4-5` —
  the migration never crosses tiers (a deliberate sonnet user is not dragged onto opus billing).
  Never matches a current id (`claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`,
  `claude-fable-5`) or an alias — with one deliberate exception, `opus[1m]`, which migrates to
  `claude-opus-5`: Opus 5 serves a 1M window by default, so the suffix buys nothing and makes the
  string invalid under `CLAUDE_CODE_DISABLE_1M_CONTEXT`. Bare `opus` still passes through.
- `migrateProjectModelConfig` — walks `config.model_overrides` and, per the §6.3 map, flips a
  role **only if it currently holds the known-old value**; records each change; leaves foreign
  and already-migrated values untouched. Returns a new config object (does not mutate input) and
  the list of changes (empty = nothing to do).

The GSD role names it references are inert data — harmless in base/lite, where the function is
never invoked (see 3.3).

### 3.2 `setup.mjs` — settings model prompt

After the settings merge, read the resolved `settings.json "model"`. If
`migrateSettingsModel(model).changed`:
- **Interactive TTY:** prompt keep / migrate to the tier-preserving target
  (`migrateSettingsModel(model).value`), reusing the existing conflict-prompt helper. On
  "migrate", write the new value back into `settings.json`; record in `summary`.
- **Non-TTY or a `--merge-all`/`--replace-all`/`--skip-all` run:** do not write — add a
  report-only line to `summary` ("model `X` looks superseded; re-run interactively or set
  `<target>` by hand"). This matches how bulk mode already defers curated conflicts.

`setup.mjs` is not itself installed, so importing the lib does not affect any profile's import
closure.

### 3.3 `/init-stack` — project config re-migration

A new step, guarded on `.planning/config.json` existing in the project root:
- Read `.planning/config.json`, run `migrateProjectModelConfig`.
- If `changes` is non-empty, write the file back with only those values changed (preserve
  formatting/other keys) and print the per-role changes.
- If there is no `.planning/config.json` (non-GSD project, or base/lite user), the step is a
  silent no-op — `init-stack` stays stack-focused for non-GSD projects.

Lives in `bin/init-stack.mjs` (the backing CLI) with a one-line description in `init-stack.md`.
`bin/init-stack.mjs` ships in all profiles and imports the shared lib statically; the
GSD-specific function is only *called* behind the `.planning/config.json` runtime guard, so
base/lite never execute it and the import closure stays clean (non-gsd lib).

This is independent of tier 1's `gsdModelConfigPatched` boolean: `/init-stack` performs an
explicit surgical migration regardless of that flag, and does not touch the flag.

## 4. Data maps

- **SUPERSEDED session-model families** (prefix match) → tier-preserving target:
  - opus family → `claude-opus-5`: `claude-opus-4`, `claude-3-opus`, `opus[1m]`.
  - sonnet family → `claude-sonnet-5`: `claude-sonnet-4`, `claude-3-5-sonnet`, `claude-3-7-sonnet`.
  - haiku family → `claude-haiku-4-5`: `claude-3-5-haiku`, `claude-3-haiku`.

  Explicit per-family prefixes (not a "not-in-allowlist" heuristic) so a future `claude-opus-6`
  is never mis-flagged, and no cross-tier surprise. Easily extended as new models supersede old.
- **Project `model_overrides` map** (role: old→new), exactly the §6.3 changes:
  `gsd-pattern-mapper`, `gsd-integration-checker`, `gsd-nyquist-auditor`, `gsd-ui-checker`,
  `gsd-ui-auditor`: `haiku→sonnet`; `gsd-verifier`: `sonnet→opus`. (`models` block unchanged —
  `verification` was already `opus`.)

## 5. Testing (TDD)

- **`model-migration.test.mjs`:**
  - `migrateSettingsModel`: each superseded family → its tier-preserving target
    (opus→`claude-opus-5`, sonnet→`claude-sonnet-5`, haiku→`claude-haiku-4-5`), all `changed`;
    `opus[1m]`→`claude-opus-5`; every other alias and each current id → unchanged; an
    unknown/future id (`claude-opus-6`) → unchanged.
  - `migrateProjectModelConfig`: each of the six roles old→new; already-migrated value → no
    change; a foreign value → left as-is, not in `changes`; a role absent from the config →
    skipped; input object not mutated.
- **init-stack integration:** a fixture project with `.planning/config.json` holding old values
  is migrated on `/init-stack`; a project without `.planning/config.json` is untouched; re-run is
  idempotent (empty `changes`).
- **Full suite** stays green.

## 6. Out of scope

- Machine-wide sweep of all known projects (rejected — touches many git-tracked configs at once).
- Self-propagating version-bump re-migration in the tier-1 hook (rejected — explicit
  `/init-stack` chosen instead).
- Effort re-tune of GSD agents/skills — that is §6.1 (`9ac160d`), a separate mechanism.
- Rewriting `models`/`model_overrides` wholesale — only the known-old values move.

## 7. Rollback

- Remove the `settings.model` block from `setup.mjs` and the `.planning`-guarded step from
  `bin/init-stack.mjs` / `init-stack.md`; delete `model-migration.mjs` + its test. Both call
  sites are additive and isolated, so removal reverts to today's behavior. Already-migrated
  values keep their new settings (the migrator never reverts).
