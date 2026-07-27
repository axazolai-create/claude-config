# Category-II GSD-Capability Reintegration — Design

**Date:** 2026-07-27
**Status:** Approved (design); implementation plan pending
**Related risks:** RISK-INITSTACK-001, RISK-FALLOW-001
**Prior context:** `eaf1a50` ("GSD-free" rewrite of `init-stack.md`) deleted old steps 6–11
wholesale. The mechanical/stale-reference half was already fixed (`25f339a` / `420a1cd` /
`05b9b1a`). This design covers the *substantive* half: reinstating the genuinely-dropped,
generally-useful capabilities, decoupled from GSD-only gating.

---

## Goal

Reinstate three capabilities dropped in the GSD-free `init-stack` rewrite, each mounted so it
reaches the profiles that can actually use it — without re-coupling them to GSD-only gates and
without stripping anything GSD owns in the full profile.

## Mounting model (established, not re-litigated here)

GSD gates own orchestration in the **full** profile; Superpowers gates own it in **base/lite**.
Moving a patch to Superpowers *universally* would strip GSD of the tool in full — so mounts are
per-profile, and profile membership is expressed the same way `pnpm-phantom-fix` /
`turbopack-gvs-check` express it: a self-contained artifact gated by a cheap marker check and
listed in `variants.json`, with **no** GSD dependency. See
`docs/superpowers/specs/2026-07-21-pnpm-phantom-fix-design.md` for the template.

## The three capabilities

| # | Capability | Was (full, via GSD) | Reinstated as | Profiles |
|---|-----------|---------------------|---------------|----------|
| 1 | `fallow` structural pre-pass | `code_quality.fallow.enabled` flag consumed by `/gsd-code-review` | Graft into Superpowers review, `.planning/`-guarded | all (inert in GSD projects) |
| 2 | Stack-aware test/build commands | `test_command`/`build_command` in `.planning/config.json` | `## Detected commands` section emitted into `.claude/stack-rules.md` by the rules compiler | all |
| 3 | `claude_orchestration` pilot ask | interactive `/init-stack` prompt | **Retired** — reference doc only | — |

---

## Capability #1 — `fallow` → Superpowers review graft

### Problem

`fallow` today is *only* a config flag (`code_quality.fallow.enabled`, set by
`gsd-config-patch.mjs` to `existsSync(package.json)`). Its **only consumer** is GSD's
`/gsd-code-review` / `/gsd-ship` workflow. In base/lite there is no GSD review workflow, so
"bring fallow to base/lite" cannot mean "set the flag" — there is no consumer. It needs a new
consumer that exists in a GSD-less profile: **Superpowers' code review.**

### Design

Graft a **Structural pre-pass (fallow)** step into the Superpowers `requesting-code-review`
skill's `code-reviewer.md` — the dispatched reviewer prompt (self-contained; a better target
than `SKILL.md`, which is coordinator how-to). The reviewer is a `general-purpose` subagent with
Bash and is read-only on the checkout; `fallow` is read-only static analysis, so running it there
is compatible.

**Graft mechanism:** reuse the Phase-3 anchored+sentinel graft pattern
(`payload/hooks/lib/impeccable-promax-graft.mjs`). New lib
`payload/hooks/lib/superpowers-fallow-graft.mjs`:

- `SENTINEL = "<!-- fallow-graft:v1 -->"`
- Anchor: the `## What to Check` heading inside `code-reviewer.md`'s fenced prompt.
- `applyFallowGraft({ skillFile }) → { applied, already, skippedNoAnchor }` — inserts the block
  immediately under the anchor if the sentinel is absent; no-op if present; reports
  `skippedNoAnchor` if the anchor is gone (upstream restructure) instead of throwing.

**Injected block** (self-gating; no separate installer, since the reviewer is read-only):

```
<!-- fallow-graft:v1 -->
**Structural pre-pass (fallow):** Before the checks below —
- If this repo is a GSD project (a `.planning/` directory exists), SKIP this pre-pass: GSD's own
  review owns the fallow pass there. Do not run fallow.
- Otherwise, if the `fallow` binary is resolvable (`node_modules/.bin/fallow`, or on PATH), run it
  over the changed files and fold any dead-code / duplication / circular-dependency findings into
  the Issues section, at the severity fallow reports.
- Otherwise (fallow not installed), add ONE Minor note: "Structural pre-pass skipped — install
  with `pnpm add -D fallow` (workspace root: `pnpm add -D fallow -w`)." Never fail the review over
  a missing fallow binary.
```

### Activation & membership

- **Guard:** `.planning/`-absent, inside the injected prose. In GSD projects the step self-skips
  → GSD review remains the single fallow enforcer (honors the "never double-gate" rule in
  `rules-src/gsd.md`, and hardens the soft single-enforcer convention into a local fact).
- **Membership:** all profiles. The guard makes the graft inert in GSD projects, so shipping it
  everywhere is safe; a non-GSD project on any machine gets fallow in its Superpowers review.

### Re-application (self-healing across plugin updates)

Superpowers lives in the shared plugin cache under a versioned path
(`…/superpowers/<version>/skills/requesting-code-review/code-reviewer.md`); an update lands a
fresh, unpatched file at a new version path. Re-graft idempotently from `session-init.mjs`:

1. Resolve the **active** Superpowers skill file — the installed/highest-precedence version dir,
   not every cached version. (Helper: resolve the plugin's active version the same way the plugin
   loader does; fall back to highest semver dir if no explicit pointer.)
2. If the file exists and lacks `SENTINEL`, call `applyFallowGraft`. Guarded never-throw
   (same defensive posture as the existing session-init steps).

No new entry in `component-registry.mjs` — Superpowers is not one of our tracked update
components; the session-init re-graft is the self-healing mechanism (mirrors how
`gsd-agent-patches` re-applies).

### Tests

- Unit (mirror `impeccable-promax-graft` tests): `applied` on a clean file, `already` on a second
  call, `skippedNoAnchor` when the anchor is absent.
- Behavioral: a clobbered (upstream-rewritten, sentinel-stripped) file gets re-grafted on the next
  `applyFallowGraft` — proves self-healing.
- Guard-prose presence: the injected block contains the `.planning/` skip and the install nudge
  (string assertions on the constant, not on the graft of a live plugin file).

---

## Capability #2 — stack-aware test/build commands → `stack-rules.md`

### Problem

The `/init-stack` step that proposed `test_command`/`build_command` into `.planning/config.json`
was removed in `eaf1a50`; GSD still auto-detects a generic default, but base/lite have no such
detection. Exact commands (`pnpm test` vs `npm test`, `uv run pytest` vs `pytest`, `./gradlew`,
`flutter test`) beat guessing — and are most valuable exactly where there's no GSD to guess well.

### Design — producer is the rules compiler (rebuild-safe by construction)

`.claude/stack-rules.md` is a **compiled snapshot** stamped with `sourceHash` + `stackFingerprint`
(`stack-rules-check.mjs`); `session-init` nudges a rebuild on desync and a compiler subagent
regenerates the file from `rules-src/`. A section merely *appended* by an init-stack step would be
**wiped on the next rebuild**. Therefore the detected-commands section must be emitted **by the
compiler**, as derived data from the same markers the snapshot already fingerprints.

- **Reuse existing detection:** `detectMarkers(root)` in `stack-rules-check.mjs` already yields
  the stack tags (`node`, `next`, `django`, `kotlin`, `dart`, `go`, `pnpm-ws`, …).
- **New helper:** `payload/bin/detect-stack-commands.mjs --root <root>` prints a
  `## Detected commands` markdown block, derived via a pure lookup
  `commandsForMarkers(markers) → { test, build }` (new lib, e.g.
  `payload/bin/lib/stack-commands.mjs`). Precedence rules: `pnpm-ws` → workspace-aware forms
  (`pnpm -w …`); `next`/`vite`/`node` → `pnpm test` / `pnpm build`; `django` → `uv run pytest`;
  `python` → `uv run pytest` (or `pytest`); `kotlin` → `./gradlew test` / `./gradlew build`;
  `dart` → `flutter test` / `flutter build`; `go` → `go test ./...` / `go build ./...`. Unknown /
  low-confidence stack → emit the section with an explicit "no confident default — set manually"
  line rather than a wrong guess.
- **Compiler directive:** extend the "Building stack-rules" instructions in
  `rules-src/README.md` so the compiler runs `detect-stack-commands.mjs` and includes its block in
  the snapshot. On any stack change → `stackFingerprint` changes → session-init nudges rebuild →
  the compiler re-emits correct commands. Auto-fresh, no wipe.

### Membership

All profiles. The section is pure reference data (no gate, no runtime conflict with GSD, which
reads its own `.planning/config.json` independently). In full it is simply extra in-context
grounding for the human and for any non-GSD flow.

### Tests

- `commandsForMarkers` unit table: each stack tag → expected `{test,build}`, including the
  `pnpm-ws` workspace precedence and the unknown-stack "no confident default" path.
- `detect-stack-commands.mjs` on a fixture root emits a well-formed `## Detected commands` block
  containing the resolved commands.

---

## Capability #3 — `claude_orchestration` pilot → retire

`claude_orchestration` is a purely GSD-internal capability (`.planning/config.json` key changing
`/gsd-execute-phase`'s wave-dispatch backend). It has no meaning outside a GSD project (Category
I). Its value is narrow (`resumeFromRunId` + `budget()` cap — **not** parallelism, which the inline
path already provides), it is fail-closed by construction, and its gate is usually closed (host
rarely supplies a known Agent SDK version, leaving an enabled key a no-op). The reference doc's own
recommendation is "pilot, don't flip on by default."

**Decision: retire the interactive ask.** Keep `payload/references/gsd-claude-orchestration-pilot.md`
as manual guidance; anyone wanting to pilot sets the key by hand. No interactive prompt is
reinstated — a rarely-useful, often-no-op pilot does not earn a permanent slot on every GSD init.

---

## Cross-cutting

- **RISK-INITSTACK-001** → move from *Partially-resolved* to *Resolved*: #1 and #2 reinstate the
  two genuinely-lost capabilities; #3 is deliberately retired with the rationale above.
- **RISK-FALLOW-001** (base/lite receive zero fallow) → **closed** by #1.
- **Template reuse:** `pnpm-phantom-fix` (variants.json membership shape),
  `impeccable-promax-graft` (graft mechanism + re-application posture).

## Out of scope

- Phase 4 (intelligent `~/.claude` cleanup) and Phase 5 (Opus 5 migration) — separate, deferred.
- Reconciling `gsd-config-patch.mjs`'s Tier-2 exclusions with `gsd-defaults.partial.json`
  (pre-existing, unscheduled — see `docs/gsd-config-defaults.md` addendum).
- Any change to GSD's own `/gsd-code-review` fallow flag — full-profile behavior is unchanged.

## File touch-list (for the plan)

**New**
- `payload/hooks/lib/superpowers-fallow-graft.mjs` (+ `.test.mjs`)
- `payload/bin/detect-stack-commands.mjs`
- `payload/bin/lib/stack-commands.mjs` (+ `.test.mjs`)

**Modified**
- `payload/hooks/session-init.mjs` — active-version resolution + idempotent fallow re-graft step
- `payload/rules-src/README.md` — compiler directive to emit `## Detected commands`
- `variants.json` — membership entries for the new fallow-graft lib and stack-commands bin
- `RISK_REGISTER.md` — RISK-INITSTACK-001 → Resolved; RISK-FALLOW-001 → Resolved

**Unchanged but relevant**
- `payload/references/gsd-claude-orchestration-pilot.md` — kept as-is (capability #3 retired)
- `payload/hooks/gsd-config-patch.mjs` — full-profile fallow flag untouched
