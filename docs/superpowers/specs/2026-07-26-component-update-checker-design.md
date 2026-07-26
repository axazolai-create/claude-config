# Centralized component-update checker — design

**Date:** 2026-07-26 · **Status:** DESIGN DRAFT (awaiting user review → writing-plans)

**Context / re-decomposition.** This is the **new Phase 2** of the design-skills work. The original
`docs/superpowers/specs/2026-07-26-phase2-design-skills-HANDOFF.md` treated "Impeccable + UI-UX-Pro-Max
into the frontend template" as Phase 2. During brainstorming (2026-07-26) that split in two:

- **Phase 2 (this spec)** — a centralized update checker for every installer-managed component, so
  self-installing tools (Impeccable, Pro Max, …) don't silently fall behind, mirroring what GSD-Core
  already does for itself. This is the *foundation* the design-skills install strategy leans on.
- **Phase 3 (own spec, later)** — Impeccable + Pro Max into the frontend template: install via each
  tool's official installer, register Impeccable's design hook through **our** centralized hook
  system (not its `settings.local.json` writer), and **graft** Pro Max's style DB into Impeccable
  as a content patch re-applied after each Impeccable update. See [[impeccable-promax-facts]].

The install philosophy pivoted from "vendor everything for determinism" to "official installers
(always fresh) + centralized update tracking" — which is why the updater comes first.

---

## 1. Goal

One machine-wide, non-blocking, throttled SessionStart facility that, for a registry of
installer-managed components, detects an available update, and either **auto-applies it in the
background** (when the update needs no `/init-stack` re-run) or **signals** the user to run the
right command — surfaced both in the statusline and as a SessionStart note. Toggleable globally and
per component, exactly like the existing tool self-upgrade block.

## 2. What already exists (reuse, do not reinvent)

Three seams in the bundle already implement most of the mechanics:

1. **Trigger + throttle + background apply** — `payload/hooks/session-init.mjs` `KNOWN_TOOLS` block
   (context-mode, graphify): detached `spawn().unref()`, 24h throttle per tool via
   `state/tool-upgrade.json`, toggles `CLAUDE_TOOL_AUTOUPGRADE` / `CLAUDE_TOOL_AUTOUPGRADE_<NAME>`.
   Phase 2 **generalizes this into a component registry** (below), superseding the ad-hoc array.
2. **Version check worker + state file** — `payload/hooks/lib/config-update-check-run.mjs` already
   does the "read installed baseline → compare to remote → write `state/update-check.json`, a later
   session reads it" pattern for the claude-config bundle SHA. **Finding:** it is currently
   written but **never spawned** and its `update-check.json` is **never read** by `session-init.mjs`
   — the plumbing is half-built. Phase 2 wires it in and reshapes it as one entry of the general
   worker.
3. **Statusline** — `payload/hooks/gsd-context-meter.mjs` renders `statusLine.command`
   (registered by `lib/gsd-statusline-registration.mjs`). Phase 2 adds an "updates available"
   segment fed from the new state file.

Also relevant to Phase 3, noted here so the shape is designed for it now: the repo's existing
`payload/hooks/lib/gsd-agent-patches.mjs` ("modify installer-managed files, detect/re-apply after
upstream rewrites") is the exact pattern Phase 3's Pro Max graft re-apply will reuse — the updater
must expose a **post-update hook** per component so an update can chain a re-graft.

## 3. Component registry

A single declarative array (`payload/hooks/lib/component-registry.mjs`), each entry:

```js
// engine = generic; a component only provides how to detect/check/update itself.
{
  name: "impeccable",
  detectVersion: () => localVersionOrNull(),   // e.g. read installed skill's version marker
  checkLatest:   () => remoteVersionOrNull(),   // e.g. `npx impeccable check` / npm registry
  updateClass:   "safe",                        // "safe" (no /init-stack) | "reinit"
  update:        () => runDetached("npx", ["impeccable", "update"]),
  afterUpdate:   null,                          // Phase 3: re-apply Pro Max graft patch here
  reloadHint:    "restart the session to pick up the new skill files",
  installedWhen: () => skillInstalledInAnyProject(),  // skip entirely if not installed anywhere
}
```

Absent `updateClass` ⇒ `reinit` (conservative: never auto-mutate unless a component is explicitly
tagged safe). A component the user hasn't installed (`installedWhen()` false) is skipped silently —
so Impeccable/ProMax can ship in the registry before Phase 3 lands and simply no-op until present.

Initial entries: `claude-config` (bundle SHA, `reinit` — needs `setup.mjs`), `context-mode`
(`safe`, native `upgrade`), `graphify` (`safe`, `uv tool upgrade`), `impeccable` (`safe`, native
`check`/`update`), `ui-ux-pro-max` (`safe`, native `uipro versions`/`update`). The last two are
Phase-3-installed but registered now.

## 4. Update classification (the crux)

- **`safe`** — the update only refreshes on-disk skill/tool payload in place; the install *shape*
  (which plugins/skills a template enables, hook wiring, settings keys) is unchanged. Claude Code
  resolves skills/plugins at startup and does **not** hot-reload (confirmed: user `~/.claude/CLAUDE.md`
  states `enabledPlugins` is resolved at STARTUP), so "apply" = update files in background + tell the
  user the change is live next session (a restart, if they want it now). There is **no** `/reload-skill`
  / `/reload-plugins` command in Claude Code — do not invent one; the honest instruction is "restart".
- **`reinit`** — the update changes the install shape (new/removed template plugins, new hook wiring,
  a settings migration). Auto-apply is unsafe; signal only, and point at `/init-stack` (or `setup.mjs`
  for the bundle itself).

Classification is per-component (a registry field), not auto-derived — deterministic and reviewable.

## 5. Auto-update behavior + toggles

Default (user-confirmed): **`safe` updates auto-apply in the background** (detached, never blocks the
session) **+ a SessionStart note** "updated X → vN (live next session)". Throttled 24h/component.
Toggles mirror the existing convention: `CLAUDE_COMPONENT_AUTOUPDATE=0` (global),
`CLAUDE_COMPONENT_AUTOUPDATE_<NAME>=0` (per component). `reinit` updates are never auto-applied
regardless of toggle — they only ever notify.

Accepted risk (already accepted for context-mode/graphify today): a background update may rewrite a
tool's files while the same session's first calls use it. No new risk class introduced.

## 6. State + worker

- `payload/hooks/lib/component-update-check-run.mjs` — the detached worker (generalization of
  `config-update-check-run.mjs`): for each registered+installed+un-throttled component, record
  `detectVersion`/`checkLatest`, set `updateAvailable`, and — when `safe` and autoupdate on — run
  `update()` (then `afterUpdate()` in Phase 3). Best-effort: every failure (offline, registry down)
  swallowed silently, same policy as the existing worker. Writes `state/component-updates.json`:

```jsonc
{ "impeccable": { "installed":"3.2.0","latest":"3.3.1","updateAvailable":true,
                  "class":"safe","autoUpdated":true,"lastCheckedAt":"…" }, … }
```

- `session-init.mjs` spawns this worker (unref'd) on its 24h throttle, and — on a LATER session —
  reads `component-updates.json` to emit the note(s). `config-update-check-run.mjs` is folded in as
  the `claude-config` entry (finally wired to the notify path).

## 7. Statusline signal

`gsd-context-meter.mjs` reads `state/component-updates.json` and, when any `updateAvailable` is
still pending user action (all `reinit`, or `safe` awaiting restart), appends a compact segment
(e.g. `⬆2`). Zero pending ⇒ no segment (no noise). Read-only, cheap (one JSON read), never blocks
the meter render.

**Profile caveat (found during planning):** `gsd-context-meter.mjs`/`gsd-context-meter-lib.mjs`
match `variants.json`'s `hooks/gsd-*` + `hooks/lib/gsd-*` excludes, so they ship **full-only**
(base/lite drop the GSD context meter). The statusline segment is therefore a **full-only garnish**;
in base/lite the update signal comes through the `session-init.mjs` note channel (universal, all
three profiles), which is the primary channel regardless. The new updater libs
(`component-registry.mjs`, `component-update-check-run.mjs`) are NOT `gsd-*`-prefixed, so they ship
in all three profiles as intended — no `variants.json` change needed.

## 8. Files touched

- **New:** `payload/hooks/lib/component-registry.mjs`, `payload/hooks/lib/component-update-check-run.mjs`.
- **Edit:** `payload/hooks/session-init.mjs` (replace `KNOWN_TOOLS` block with registry-driven spawn;
  add the `component-updates.json` notify block), `payload/hooks/gsd-context-meter.mjs` (updates
  segment), `payload/hooks/lib/config-update-check-run.mjs` (refactor into the `claude-config`
  registry entry, or keep as the bundle checker the entry delegates to).
- **Tests:** registry classification (safe vs reinit routing), worker throttle + best-effort
  swallow, notify emission from state, statusline segment on/off, "not-installed ⇒ skip".

## 9. Testing strategy

- **Registry/worker (unit):** table-driven fixtures — a `safe` component with autoupdate on runs
  `update`; with the per-name toggle off it does not; a `reinit` component never auto-updates; a
  not-installed component is skipped; a throttled component is skipped; every network/exec failure
  is swallowed (state still records `lastCheckedAt`).
- **session-init (unit):** given a `component-updates.json` with pending entries, the emitted
  additionalContext lists them with the correct command (`safe`→restart, `reinit`→`/init-stack`);
  empty/absent state ⇒ no note.
- **statusline (unit):** segment appears iff ≥1 pending; absent otherwise.
- **No live network in tests** — inject `detectVersion`/`checkLatest`/`update` via the registry
  shape (pure functions), fake them in fixtures.

## 10. Phase 3 coupling (forward reference — not built here)

The `afterUpdate` hook and the per-component `updateClass` exist so Phase 3 can register: Impeccable
= `safe` + `afterUpdate` re-applies the Pro Max content-graft patch (via the `gsd-agent-patches.mjs`
pattern); Pro Max = `safe`. Building the registry now with these fields keeps Phase 3 a data change,
not a re-architecture.

## 11. Open items

- **OI-1** How each component reports its installed version (Impeccable/ProMax: a version marker file
  in the installed skill vs calling the CLI). Resolve at plan time by inspecting the installed skill.
- **OI-2** Whether `config-update-check-run.mjs` is refactored away or kept as a delegate for the
  `claude-config` entry (mechanical; plan-time call).
- **OI-4** Exact statusline segment glyph/wording (a cosmetic knob; align with existing meter style).

**Resolved (user, 2026-07-26):** OI-3 — the updater ships in **all three profiles** (full/base/lite):
universal infra, cheap, self-gating on installed components. OI-1 (per-component version detection)
is deferred to plan time (inspect the installed skill then).

## 12. Risks (log to RISK_REGISTER.md with IDs at plan time)

- Background auto-update rewriting a tool mid-session (pre-existing, accepted for context-mode/graphify).
- A component's native `update` being interactive/blocking (mitigate: detached+unref, never read
  stdout; and prefer non-interactive flags — Impeccable's installer footgun (global-all-harnesses
  interactive default) is documented in [[impeccable-promax-facts]] and MUST be avoided here).
- False "update available" from a flaky version probe (mitigate: best-effort, throttle, never block).
