# Phase 3 — design-skills integration (Impeccable + Pro Max) — design

> **Status:** design (brainstorming output). Supersedes the vendoring plan in
> `2026-07-26-phase2-design-skills-HANDOFF.md`. Built ON TOP of the shipped Phase 2
> component-update-checker (`2026-07-26-component-update-checker-design.md`).
> Verified install/trigger/license facts live in the project memory `impeccable-promax-facts`.

## 1. Goal

Replace the Anthropic `frontend-design` plugin with **Impeccable** (Apache-2.0, deterministic
58-rule design detector, no LLM/API key) as the design-guidance surface for frontend projects,
and graft **UI-UX-Pro-Max** (MIT, local BM25 over 67 styles / 161 palettes / 57 font-pairings /
UX guidelines) into Impeccable as a content enhancement — never a standalone skill. Both are
installed **per-project via `/init-stack` only when a frontend stack is detected**, and kept
fresh + graft-reapplied by the Phase 2 updater.

End state: on a frontend project, `/init-stack` yields Impeccable auto-firing on any UI edit
(by any agent / superpowers / GSD executor, not just at a discuss stage), enriched with Pro Max
style/palette/font search; the updater tracks both and re-applies the graft after each
`npx impeccable update`; non-frontend projects surface none of it.

## 2. Locked decisions (from brainstorming, 2026-07-26)

| # | Decision |
|---|---|
| D1 | `frontend-design@claude-plugins-official` removed entirely from `frontend/_base.json` (both `merge.enabledPlugins` and `plugins[]`). |
| D2 | Impeccable installed via its **official installer**, project scope, isolated: `npx impeccable install --providers=claude --scope=project --no-hooks` (HOME set to a scratch dir to dodge the global-all-harnesses footgun). NOT vendored into `payload/`. |
| D3 | Pro Max subset = **`ui-ux-pro-max` + `ui-styling` + `design-system`** only. The other suite skills (`design`, `brand`, `banner-design`, `slides`, `banner`) are pruned after `uipro init` — `design` hardcodes global `~/.claude/skills/design` paths (breaks project-local copies), the rest reference absent premium skills. |
| D4 | Design hook registered through **our** settings-injector into the **project's** `.claude/settings.json` (project-scoped gating = only written on frontend detect), pointing at the installed `.claude/skills/impeccable/scripts/hook.mjs`. Installer runs with `--no-hooks` so Impeccable never writes its own `settings.local.json` block. |
| D5 | Pro Max integration = **content-graft** into Impeccable's `reference/*.md` (Impeccable exposes no first-class external-DB plug; `.impeccable/config.json` only reads the project's own design system). `npx impeccable update` clobbers the graft → re-applied via the updater's `afterUpdate`, anchored/idempotent, mirroring `apply-gsd-agent-patches.mjs`. |
| D6 | Python 3 for Pro Max `search.py` is **soft-degrade**: installer warns if absent; the graft prose says "query search.py if available, else use the reference tables". |
| D7 | Scope = full integration incl. the Phase 2 updater's project-scope probe (`--root`, `check()`/`update()`/`afterUpdate` for `impeccable` + `ui-ux-pro-max`). Closes the "updater-first" loop — the registry placeholders become live. |
| D8 | Install channel = a **dedicated idempotent orchestrator** `bin/install-design-stack.mjs`, invoked as a gated `/init-stack` step, NOT an enriched generic `skills[]` entry (`installSkills` only runs a single `install.cmd`, no post-processing). |

## 3. Architecture

```
/init-stack (frontend stack detected)
        │
        ▼
bin/install-design-stack.mjs --root <project>        ← U2 orchestrator (idempotent)
   ├─ (a) npx impeccable install --providers=claude --scope=project --no-hooks   [isolated HOME]
   ├─ (b) uipro init --ai claude --offline  →  prune to {ui-ux-pro-max, ui-styling, design-system}
   ├─ (c) register design hook → <root>/.claude/settings.json   (settings-injector, project-scoped)
   ├─ (d) applyPromaxGraft({ skillsDir })                        ← U3 hooks/lib/impeccable-promax-graft.mjs
   ├─ (e) record baseline versions → <root>/.claude/state/component-updates.json
   └─ (f) soft-check python3 → warn if missing

session start (any later session on that project)
        │
        ▼
component-update-check-run.mjs --root <project>       ← U4 project-probe (worker)
   ├─ project PROBES: impeccable / ui-ux-pro-max  → check() installed-vs-latest (npm)
   ├─ decide() → auto-update (safe) → probe.update()  = `npx impeccable update` (+ uipro)
   └─ afterUpdate(impeccable) → re-run applyPromaxGraft()   (graft survives the clobber)
```

Reused Phase 1/2 mechanisms: `hooks/lib/component-registry.mjs` (the `impeccable` / `ui-ux-pro-max`
entries already exist as `scope:"project", kind:"version", updateClass:"safe"` placeholders),
`hooks/lib/component-update-check-run.mjs` (the worker with its `TODO(phase3)` `--root` stub),
the settings-injector, and `variants.json` tiering (both are `tier: core` ⇒ present in all three
profiles, frontend-scoped by the template).

## 4. Unit specs

### U1 — Template edit: `payload/setting-templates/frontend/_base.json`

**What.** Remove the `frontend-design@claude-plugins-official` key from `merge.enabledPlugins`
and the whole `frontend-design` object from `plugins[]`. Add a declarative `designStack` block
consumed by the orchestrator (subset + toggles), keeping the template a pure data contract:

```jsonc
// _base.json, new top-level key (config, not an install command):
"designStack": {
  "description": "Impeccable (design detector) + grafted UI-UX-Pro-Max search DB. Installed per-project on frontend detect via bin/install-design-stack.mjs.",
  "impeccable": { "install": "npx impeccable install --providers=claude --scope=project --no-hooks" },
  "proMax":     { "install": "uipro init --ai claude --offline",
                  "keepSkills": ["ui-ux-pro-max", "ui-styling", "design-system"] }
}
```

**Rationale.** frontend-design is a plugin (marketplace `enabledPlugins` + a `plugins[]` install
recipe); Impeccable/Pro Max are installed skills with post-processing, so they cannot live in the
`plugins[]` or `skills[]` channels (the latter runs one `install.cmd`, no prune/hook/graft). A
declarative `designStack` block keeps the invocation in the orchestrator while the template stays
the single source of what-and-which-subset.

**Verify.** grep `_base.json` (and its resolved chain for `react`/`next`/`react-native`) → zero
`frontend-design` matches; `designStack.proMax.keepSkills` equals the D3 subset.

### U2 — Orchestrator: `payload/bin/install-design-stack.mjs` (+ `bin/lib/design-stack.mjs`)

Idempotent, project-scoped, fail-soft. Invoked `node install-design-stack.mjs --root <path>`
(default cwd) as a new `/init-stack` step, gated on frontend ∈ detected stacks. Steps (a)–(f)
per §3. **Source of truth:** the orchestrator reads the install commands and `keepSkills` subset
from the resolved `designStack` block of the frontend template (U1), falling back to built-in
defaults only if the block is absent — the template stays the single place that defines
what-and-which-subset. Isolation contract for both installers (dodges RISK-DESIGNSTACK-001):

```js
// bin/lib/design-stack.mjs — isolated, non-interactive installer invocation
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export function runInstaller(cmd, args, { root }) {
  const scratchHome = mkdtempSync(join(tmpdir(), "design-stack-home-"));
  // Fresh HOME → Impeccable's "install into ALL detected harnesses" default finds none but the
  // scratch; --scope=project + cwd=root make it write into <root>/.claude only. --no-hooks stops
  // its settings.local.json writer. Never inherit the real HOME here.
  const env = { ...process.env, HOME: scratchHome, USERPROFILE: scratchHome };
  const r = spawnSync(cmd, args, { cwd: root, env, encoding: "utf8", timeout: 180000 });
  return { ok: !r.error && r.status === 0, stdout: r.stdout, stderr: r.stderr };
}
```

Idempotency: (a)/(b) skip if `<root>/.claude/skills/{impeccable,ui-ux-pro-max}` already present;
(c) skip if the hook entry already registered; (d) re-applies the graft only if the sentinel is
missing; every step is wrapped so a single failure warns and continues (init-stack never aborts on
a design-stack hiccup). Prune (b) is **provenance-based**: snapshot `<root>/.claude/skills`
immediately before `uipro init`, and after it delete only the dirs the install **created** that
aren't in `keepSkills` (pass the before-snapshot as `protect`). A pre-existing skill of any name
(even one named `design`) is never deleted — this closes the user-data-loss hole a hardcoded
extras-name list would open (DS-005).

**Rationale.** A dedicated CLI matches the repo idiom (`apply-gsd-agent-patches.mjs`,
`sync-gsd-context-mode-tool.mjs`, `graphify-setup.mjs`) and isolates all design-stack complexity in
one focused module rather than bloating `installSkills`. Isolated HOME is the load-bearing safety
control against the Impeccable installer footgun.

**Verify.** unit: `runInstaller` sets a scratch HOME ≠ real HOME and `cwd=root`; prune leaves only
the subset; re-running the orchestrator on an already-installed project performs no re-install and
still re-verifies hook + graft. e2e (mocked installers): a frontend fixture ends with impeccable +
the 3 pro-max skills + a registered hook + the graft sentinel; a non-frontend fixture is untouched.

### U3 — Graft module: `payload/hooks/lib/impeccable-promax-graft.mjs`

Anchored, idempotent content-graft (same shape as `gsd-agent-patches.mjs`): insert a "query Pro Max
first" step into Impeccable's `reference/{new-work,shape,colorize,typeset}.md`, guarded by a sentinel
marker so re-apply after an `impeccable update` clobber is safe.

```js
// hooks/lib/impeccable-promax-graft.mjs (shape)
const SENTINEL = "<!-- promax-graft:v1 -->";
const GRAFT = `${SENTINEL}
**Query the Pro Max style DB first.** Before proposing visuals, run
\`python .claude/skills/ui-ux-pro-max/scripts/search.py "<design intent>"\` for candidate
styles / palettes / font-pairings and prefer its results. If python3 or the skill is absent,
fall back to the reference tables below.`;

// ANCHORS: { "new-work.md": "<anchor prose present in the shipped reference file>", ... }
export function applyPromaxGraft({ skillsDir }) {
  const refDir = join(skillsDir, "impeccable", "reference");
  const applied = [], skippedNoAnchor = [], already = [];
  for (const [file, anchor] of Object.entries(ANCHORS)) {
    const p = join(refDir, file);
    if (!existsSync(p)) { skippedNoAnchor.push(file); continue; }
    const txt = readFileSync(p, "utf8");
    if (txt.includes(SENTINEL)) { already.push(file); continue; }   // idempotent
    const at = txt.indexOf(anchor);
    if (at < 0) { skippedNoAnchor.push(file); continue; }           // upstream moved → skip, don't corrupt
    writeFileSync(p, txt.slice(0, at) + GRAFT + "\n\n" + txt.slice(at));
    applied.push(file);
  }
  return { applied, already, skippedNoAnchor };
}
```

**Rationale.** Impeccable has no external-DB extension point (spiked: `.impeccable/config.json`
only reads the project's own design system), so grafting guidance prose into the files the detector
already tells the agent to read is the only integration surface. Anchoring + sentinel gives
clobber-survival and idempotency; skipping on a missing anchor degrades safely (surfaced, never a
corrupt file) exactly like the existing agent-patch infra.

**Verify.** apply → sentinel present in each target; second apply → all `already`, no double-insert;
delete sentinel (simulate `impeccable update`) → re-apply restores it; missing/renamed reference
file → `skippedNoAnchor`, file untouched.

### U4 — Updater project-scope probe (Phase 2 carry)

Turn the `component-registry.mjs` project placeholders live and finish the worker's `TODO(phase3)`.

1. **`component-update-check-run.mjs`:** parse `--root <path>` (default cwd). Add a project PROBES
   map for `impeccable` / `ui-ux-pro-max`, gated on `COMPONENTS[].scope === "project"`. Each probe:
   `present()` = skill dir exists under `<root>/.claude/skills/`; `check()` = installed version
   (from the installed skill's `package.json`/VERSION) vs `npm view <pkg> version`, returns
   `{installed, latest, updateAvailable}`; `update()` = `npx impeccable update` (or `uipro`
   re-init). Project-scope state lives in `<root>/.claude/state/component-updates.json` (per-project
   freshness), separate from the global `~/.claude/state/` entries. All probe bodies internally
   `safe()`-wrapped; `main().catch(() => {})` stays the backstop.
2. **`component-registry.mjs`:** add an optional `afterUpdate` field on the `impeccable` entry
   naming the graft re-apply. The worker, after a successful `probe.update()` (i.e. `action==="auto"`
   and `updateAvailable`), invokes the `afterUpdate` → `applyPromaxGraft({ skillsDir })`.

```js
// component-registry.mjs — the only functional delta (afterUpdate marker):
{ name: "impeccable", scope: "project", kind: "version", updateClass: "safe",
  legacyEnv: null, afterUpdate: "promax-graft" },
```

```js
// component-update-check-run.mjs — after update, re-apply graft (worker side):
if (action === "auto" && probe.update) {
  probe.update(); entry.autoUpdated = true;
  if (comp.afterUpdate === "promax-graft")
    safe(() => applyPromaxGraft({ skillsDir: join(root, ".claude", "skills") }));
}
```

**Rationale.** Phase 2 deliberately shipped these two components as inert placeholders (registry
comment: "probe arrives in Phase 3"); wiring the probe + `afterUpdate` is what makes "official
installers (fresh) + centralized update tracking" real, and couples the graft's freshness to the
updater (validating the "updater-first" decomposition). Per-project state keeps one machine's many
frontend projects independent.

**Verify.** `--root` parses and defaults to cwd; project probe `present()` false when the skill dir
is absent (skip, no throw); `check()` returns a well-formed verdict against a faked `npm view`;
`decide()` → auto → `update()` then `afterUpdate` re-runs the graft (sentinel restored); an
exception inside any probe is swallowed and the worker still writes state.

### U5 — Tests

- **Template:** `_base.json` + resolved `react`/`next`/`react-native` chains contain no
  `frontend-design`; `designStack.proMax.keepSkills` == D3 subset. Non-frontend template
  (Kotlin/Python fixture) has no `designStack`.
- **Orchestrator:** isolation (scratch HOME ≠ real, cwd=root); prune leaves only the subset;
  idempotent re-run; frontend fixture end-state vs non-frontend no-op (installers mocked).
- **Graft:** apply / idempotent re-apply / clobber-restore / missing-anchor-safe.
- **Updater:** `--root` parse; project probe present/check/afterUpdate; fail-soft on probe throw.
- All existing suites (222/222 component-update + `setup-variants.e2e`) stay green.

## 5. Error handling, isolation, idempotency (cross-cutting)

- **Installer footgun containment:** both installers always run via `runInstaller` (scratch HOME,
  `cwd=root`, `--scope=project`, `--no-hooks`); the real `~/.claude`, `~/.agents`, `~/.gemini` are
  never in scope. (RISK-DESIGNSTACK-001)
- **Fail-soft:** every orchestrator step and every worker probe is wrapped; a failure warns and
  continues — a design-stack problem never aborts `/init-stack` or the detached update worker.
- **Idempotent everywhere:** skill-present short-circuits, hook-registered short-circuit, graft
  sentinel — safe to re-run `/init-stack` and safe against the update-worker's 24h throttle loop.
- **Soft-degrade:** missing python3 → warn + graft prose fallback; missing/renamed Impeccable
  reference file → graft `skippedNoAnchor`, no corruption.

## 6. Risks (mirror to RISK_REGISTER.md as RISK-DESIGNSTACK-00N)

- **DS-001** Impeccable installer footgun (default = install into ALL harnesses + append
  `settings.local.json` hooks; `--help` re-runs the installer). *Mitigation:* isolated scratch
  HOME + explicit `--providers=claude --scope=project --no-hooks`; end-state assertion in tests.
- **DS-002** `npx impeccable update` clobbers the Pro Max graft. *Mitigation:* `afterUpdate`
  re-apply, anchored + sentinel-idempotent. *Residual:* if upstream renames the reference files the
  graft is skipped (surfaced), not corrupt.
- **DS-003** Pro Max `search.py` needs Python 3. *Mitigation:* soft-degrade to reference tables +
  install-time warning.
- **DS-004** Registered hook path couples to `.claude/skills/impeccable/scripts/hook.mjs`; an
  upstream rename breaks firing. *Mitigation:* the updater's `afterUpdate`/next `/init-stack`
  re-verifies + re-registers the path.
- **DS-005** Pro Max `design` sub-skill hardcodes global `~/.claude/skills/design` paths; a
  name-based prune would also delete a user's own pre-existing skill named `design`/`brand`/etc.
  *Mitigation:* provenance-based prune (snapshot before/after `uipro init`, remove only
  install-created non-kept dirs) — pre-existing user skills of any name are protected.
- **DS-006** Pinned npm ids (`impeccable`, `ui-ux-pro-max-cli`) can drift/rename. *Mitigation:*
  `check()` is best-effort, fail-soft; a wrong id surfaces as a failed probe, never a crash.

## 7. Out of scope / follow-ups

- Existing installs still carrying an enabled `frontend-design` plugin: the template stops enabling
  it for new inits; actively disabling it on an already-configured machine is a migration nicety,
  not required here (the machine in question already has it disabled).
- Statusline: the `⬆N` segment (full profile) already counts global pending; surfacing project-scope
  pending in the same segment is a small follow-up, tracked but not blocking.
- The Chinese-language fragment in `ui-ux-pro-max` SKILL.md "When to Apply" is cosmetic — left as-is.

## 8. How this maps to the phase queue

Phase 3 (this) ships the design integration on top of Phase 2's updater. Deferred siblings held in
project memory: **Phase 4** = intelligent user-scope `~/.claude` cleanup; **Phase 5** = Opus 5
migration + deploy-time old-model cleanup.
