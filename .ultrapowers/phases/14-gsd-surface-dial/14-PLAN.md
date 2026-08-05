# Phase 14 — GSD surface profile as a bundle-managed dial

Status: planned, not started.

## Problem

`gsd-core` installs its skills and agents at USER scope (`~/.claude/skills/gsd-*`,
`~/.claude/agents/gsd-*.md`). Claude Code resolves both registries at startup and loads every
entry into `skill_listing` / `agent_listing` in every session, GSD project or not. On a `full`
machine that is 71 skills + 34 agents. Measured on the reporting machine: `skill_listing` +
`agent_listing` = 9.5k tokens, of which ~8k is GSD.

`gsd-core` already ships the lever (`--profile=`, `/gsd-surface`), but nothing in this bundle
owns it, so the profile is whatever the last hand-run command left behind.

## Facts

Verified against `@opengsd/gsd-core@1.9.1` (`npm pack`-ed to a scratchpad, not installed).
`.test/gsd-marketplace-probe/` holds `1.7.0-rc.6` — the `next` tag, stale, do not plan off it.

- `bin/install.js` parses `--profile=<name>`; `--minimal` / `--core-only` are back-compat
  aliases for `core` and are mutually exclusive with `--profile`.
- `resolveEffectiveProfile({requestedProfileName, targetDir})`: explicit flag > `.gsd-profile`
  marker (only when the marker is not `full`) > `full`. **A plain re-install cannot raise the
  profile** — a marker of `standard` survives it. Raising requires an explicit `--profile=full`.
- `writeActiveProfile()` persists the resolved name to `<configDir>/.gsd-profile`.
  `--uninstall` deletes that marker.
- Convergence on downgrade already exists: for the claude runtime the installer deletes every
  `agents/gsd-*.md` before re-staging (`install.js`, "Always remove stale gsd-* agents first so
  re-installing with `--minimal` actually shrinks a previously-full install"), and skills are
  re-staged the same way. No orphan files, in either direction.
- A **second, independent** layer exists: `/gsd-surface` writes `<configDir>/.gsd-surface.json`
  (`baseProfile`, `disabledClusters`) and re-stages from it. `reset` deletes that file and
  returns to the install-time profile.
- Cluster names are **not** valid profile modes. `resolveProfile` keeps only names present in
  `PROFILES` (`core|standard|full`) and silently drops the rest, so `--profile=standard,audit_review`
  resolves to plain `standard`. There is no way to extend a profile by one cluster.

Sizes, from `resolveProfile` against the real 71-command manifest:

| profile | skills | agents | listing weight (name+description) |
|---|---|---|---|
| `full` | 71 | 34 | ≈13 700 ch |
| `standard` | 23 | 8 | ≈3 550 ch |
| `core` | 15 | 6 | ≈2 370 ch |

`standard` is the closure of 15 declared stems, not 15 skills. It **keeps** `gsd-code-review`,
`gsd-verify-work`, `gsd-map-codebase` and the agents `gsd-planner`, `gsd-plan-checker`,
`gsd-executor`, `gsd-code-reviewer`, `gsd-code-fixer`, `gsd-phase-researcher`,
`gsd-codebase-mapper`, `gsd-roadmapper` — that is, every agent the July usage log confirmed
except `gsd-pattern-mapper`, `gsd-verifier` and the two `gsd-ui-*`. It **drops** ship, debug,
ui, milestone, ns-*, mempalace, graphify, extract-learnings, health, stats, sketch/spike/
forensics/explore.

This retires the conclusion in `.claude/_analize/optimizations.md` that `standard` cuts
`audit_review` and is therefore unsafe. On 1.9.1 it does not.

## The trap this phase exists to close

Two layers can each set a profile, and the second wins at re-stage time. An installer that
writes `--profile=standard` while a stale `.gsd-surface.json` still carries
`baseProfile: full` or a `disabledClusters` list produces a set that matches neither. Any
design that touches one layer and ignores the other reintroduces exactly the leftovers this
phase is meant to remove.

**Rule for the whole phase: the bundle owns `.gsd-profile` via the installer flag, and treats
`.gsd-surface.json` as state to clear, never to write.**

## Scope

The dial has meaning only in bundle variant `full`. `base` and `lite` exclude the GSD
machinery outright and `detectForeignGsdCore` already offers to remove `gsd-core` there — the
full → base/lite transition is an existing path and is not re-implemented here.

## Stages

### Stage 1 — the dial and where it lives

`setup.mjs` gains `--gsd-profile=core|standard|full`. The chosen value is persisted in the
bundle's own state so later runs and `/init-stack` reapply it without re-asking. Default is
`full`, so a machine that never passes the flag behaves exactly as today.

*Why a setup flag and not a `variants.json` key:* the profile is a per-machine call (how much
GSD work happens on this box), not a property of the bundle. `variants.json` is shared by
every machine and would force one answer on all of them.

*Why persisted and not read fresh each run:* the marker on disk records what `gsd-core` last
installed, not what the operator wants. Without a separate record of intent, drift is
indistinguishable from a deliberate choice.

### Stage 2 — the apply path

New `payload/bin/lib/gsd-surface-dial.mjs`, pure decision + one effectful runner:

```js
// Decision half — no I/O beyond the two reads, so it is unit-testable without a network.
export function planSurfaceChange({ desired, marker, overlay }) {
  const effective = overlay?.baseProfile || marker || "full";
  const dirty = Boolean(overlay && (overlay.baseProfile || overlay.disabledClusters?.length));
  if (effective === desired && !dirty) return { action: "none" };
  return {
    action: "reinstall",
    clearOverlay: dirty,
    // Explicit every time: a marker below `full` survives a plain re-install, so omitting the
    // flag silently pins the machine to the lower profile forever.
    flag: `--profile=${desired}`,
  };
}
```

Runner order, and each step's reason:

1. **Clear `.gsd-surface.json`** when dirty. Equivalent of `/gsd-surface reset`. Must precede
   the install, otherwise the overlay re-stages over the fresh set.
2. **Run** `npx -y @opengsd/gsd-core@latest --global --claude --profile=<desired>` (append
   `--config-dir "<dir>"` when the config dir is not the default — same condition
   `gsdCoreInstallPlan` already uses). This is what prunes and re-stages; the bundle never
   deletes skill or agent files itself.
3. **Re-apply this bundle's patches** — `node ~/.claude/apply-gsd-agent-patches.mjs`. A profile
   raise restores agent files that `gsd-core` wrote fresh, i.e. without the patches. Skipping
   this leaves the SessionStart pending-patch notes firing after every raise.
4. **Print the restart notice.** Both registries resolve at startup. Without a restart the
   session keeps advertising the old set, and any claim that the change is active is false.

### Stage 3 — drift reporting, check-only

`session-init.mjs` gains one note in the existing `if (FULL)` block, next to the gsd patch
checks and following the same check-only / apply-gated split already used there: if the dial
and the effective profile disagree, say so and name the command. It never writes.

`/init-stack` gains the apply step, since it is already the "make this machine match the
bundle" command.

### Stage 4 — tests

- Unit, over `planSurfaceChange`: equal + clean → `none`; equal + dirty overlay → `reinstall`
  with `clearOverlay`; raise from a `standard` marker → flag present (the regression that
  guards the marker-precedence trap); lower from `full` → `reinstall`.
- e2e, real installer into a temp `--config-dir`, no network beyond the one `npx`: install
  `full`, snapshot the file set, switch to `standard`, assert counts (23 skills / 8 agents),
  switch back to `full`, assert the file set is **byte-identical to the first snapshot**. That
  round-trip is the acceptance criterion for "no leftovers, nothing missing".

## How to verify quality

- The round-trip test above is the load-bearing one; a passing count check alone would not
  catch a file that came back unpatched or renamed.
- After a real switch on the machine: `/gsd-surface status` (its own token number, not this
  plan's estimate), then a fresh session's `/context` to confirm the listing actually shrank.
- `standard` must still resolve `gsd-code-review` and `gsd-verify-work`; if a future `gsd-core`
  moves them out of the closure, the dial's default recommendation changes with it.

## Risks

Filed in `.ultrapowers/RISK_REGISTER.md`: `RISK-GSDSURFACE-001` (two-layer profile state),
`RISK-GSDSURFACE-002` (`@latest` + flag semantics verified only against 1.9.1),
`RISK-GSDSURFACE-003` (a raise restores unpatched agent files).
