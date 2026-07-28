# Ultrapowers — Superpowers rework, umbrella design

**Date:** 2026-07-27
**Source:** `.ultrapowers/archive/rework/workflow-frameworks-analysis.md` (ред. 8 + приложения А-Ц, 2906 lines).
Appendix references below use the source's own Cyrillic labels.
**Status:** design approved in conversation; layers 2-4 get their own specs before implementation.

## Goal

Turn the 22 improvements identified in the source analysis into an additive package shipped by
this repository, delivered per profile (`base`, `lite`, then selectively `full`), and rebranded
end to end as **Ultrapowers** so that "the improvements are installed" is visible rather than
inferred.

The source analysis chose an **additive package, not a fork**, because upstream Superpowers moves
fast and a fork would fight merges every release. That choice stands. The rebrand is layered on
top of it as a patch mechanism, not as a fork.

## Non-goals

- Forking or vendoring upstream Superpowers.
- Renaming upstream plugin directories, manifest identity, or the `superpowers:` skill namespace
  (see "Rebrand boundary" below — this is a hard constraint, not a preference).
- Implementing layers 2-4 from this document. They are sketched here for ordering only.

## Provenance and what changed after verification

The source document's own methodological lesson — stated three times, and adopted from приложение Е
onward — is *verify before designing*. Everything below that contradicts the source document does
so because it was measured on this machine during design. Each such correction is called out.

| Source claim | Verified finding | Effect |
|---|---|---|
| Artifacts live in `.superpowers/`, tracked (Т.4) | `.superpowers/` is gitignored wholesale in this repo, so the ledger and every phase report under it are untracked. (`RISK_REGISTER.md` also appears in `.gitignore`, but that line is a **no-op** — the file has been tracked since 2026-07-08 and gitignore does not apply to tracked files) | New root `.ultrapowers/`; scratch isolated by a nested `.gitignore` |
| Agent registry is "34 agents" | В.10 lists **39** by name; the tier table says 12/15/12 (=39) but computes percentages against 34, summing to 114 % | Ship all 39; recomputed tiers below |
| Agent registry cost is not resident | 37 installed agents = 8 381 chars of name+description = **~2 330 tokens resident per session** | Registry excluded from `full`; description budget becomes a tested constraint |
| Reuse `add-risk.mjs` for R-NNN numbering (В.4) | The script is hardcoded to append one specific risk ("GSD CLAUDE.md clobber"); only its ID-allocation and idempotency logic is reusable. This repo's register uses `RISK-<AREA>-NNN` sections, not an `R-NNN` table | Layer 1 generalizes the script; ID scheme decided per project, not globally |
| Hook the plugin-update event | **No plugin-lifecycle hook event exists.** `/reload-plugins` exists as a command but emits no event | `SessionStart` + manual `/up-doctor` is the load-bearing path; probe D explores the rest |
| (not in source) | Plugin skills hot-reload live; plugin **hooks** do not — they keep the previous `${CLAUDE_PLUGIN_ROOT}` until `/reload-plugins` or restart | Version-keyed patches must be verified at `SessionStart`, not mid-session |

## Naming and the rebrand boundary

The product name is **Ultrapowers**. The artifact root is `.ultrapowers/`. Our commands are
`/up-*`.

Plugin identity is a tuple `<name>@<marketplace>` resolved against a **remote** catalog:

```
plugins/installed_plugins.json     "superpowers@claude-plugins-official" -> installPath, version, gitCommitSha
plugins/known_marketplaces.json    claude-plugins-official -> github:anthropics/claude-plugins-official
plugins/plugin-catalog-cache.json  catalog with fetchedAt; refetched from the remote
.claude-plugin/plugin.json         "name": "superpowers"
```

Renaming the local files and directories to `ultrapowers` would probably *load* — `installPath` is
stored explicitly — but it fabricates a marketplace identity that the machinery keeps correcting:
`/plugin update` resolves against a catalog that has no `ultrapowers`; the catalog cache is
refetched and drops the invented entry; the marketplace git clone restores the true listing; and
this repo's own `plugin-reconcile.mjs` + `variants.json → managedPlugins` would reinstall the real
`superpowers` alongside it, producing two plugins with 14 identically-named skills. The failure is
delayed and self-inflicted, which is the worst diagnostic shape. **Rejected.**

Therefore:

- **Brand prose is patched.** Identifiers are not.
- Skill invocations stay `superpowers:brainstorming`, `superpowers:writing-plans`, and so on.
- One explanatory line ships in our documentation: `superpowers:` is the technical package name,
  not the brand. The cosmetic seam is accepted and explained once.

## Decomposition

Five layers. Each gets its own spec -> plan -> implementation cycle. Each ships twice: `base`+`lite`
first, then `full` behind the gate. Ten phases total.

| Layer | Subproject | Improvements | Why here |
|---|---|---|---|
| **0** | Rebrand and patcher | rename table, applier, drift detector, `component-registry` entry, cost log | First: it also rewrites artifact paths inside upstream prose to `.ultrapowers/`. Doing it after layer 1 means patching twice |
| **1** | Artifact foundation | 12 structure, 3 position, 16 risk register, 9 decisions, 20 clean-guard, **+ migration** | Nothing else has anywhere to write until this exists. Verifiable without executing anything |
| **2** | Orchestration | 2 wave dispatcher, 5 order gate (hook already written), 17 liveness check, 4 resume hooks, 19 `/up-resume`, 11 quick-task | Stands on layer 1 (position, ledger) and on native tasks |
| **3** | Registry and economics | 15 agent registry (39), 7 tier->model-name table, 18 artifact language, Leanmode 4->3 levels + remap | Layer 2 has nothing to dispatch without it, but can be debugged against current agents |
| **4** | Intent and closing gates | 8 Context7/Graphify enforcement, 13 `ui-spec`, 10 goal gate + `expected.md`, 14 onboarding, 22 `jscpd`, 21 `docs-first`, 6 non-interactive profile | Most expensive and most dependent: needs both layer 1 artifacts and layer 3 agents |

Three deviations from the source document's section 7 plan:

1. **Layer 0 is new.** The rebrand does not exist in the source document at all.
2. **Migration moved into layer 1** rather than standing alone: it writes exactly the files layer 1
   defines, and without them it has no destination.
3. **Improvement 6 (non-interactive profile) moved to layer 4, last.** The source document files it
   under "discipline". A non-interactive run is only meaningful to test once the gates it runs
   through actually exist — otherwise we automate passing through nothing and cannot tell.

Deliberately **not** in this pass: `MAP.md` as an inventory. В.4 warns against it itself when
Graphify is live; layer 4 keeps a half-page intent document instead.

## Full-profile gating

Two filters, not one.

**Static, at install time** (`variants.json`): what ships to `full` at all. Criterion: does
GSD-Core already have an equivalent.

**Runtime, on every invocation**: whatever did ship consults one shared predicate.

```js
// payload/hooks/lib/ultrapowers-active.mjs
export function ultrapowersActive(root, profile) {
  if (profile !== "full") return { active: true, reason: "profile" };
  if (!existsSync(join(root, ".claude", "stack-rules.md")))
    return { active: false, reason: "no-init-stack" };
  if (existsSync(join(root, ".planning")))
    return { active: false, reason: "gsd-project" };
  return { active: true, reason: "gsd-free" };
}
```

Both markers already exist and are not invented for this: `.claude/stack-rules.md` is compiled by
`/init-stack`, and `.planning/` is already the GSD-project marker in the user's global CLAUDE.md.

**Failure direction is inverted here.** Ordinary hooks in this package fail open so a session is
never broken. This predicate fails **closed** in `full`: if state cannot be determined, the answer
is "inactive". The cost is asymmetric — a silent extra hook is harmless, a hook that walks into a
GSD phase breaks someone else's process.

### Enforcement, not request

Hooks gate themselves in code. Skills and commands are markdown and cannot disable themselves; a
"check the predicate first" preamble is the same failure mode the source document criticizes for
improvement 3. Enforcement is a **`PreToolUse` hook with matcher `Skill`**: it inspects the skill
being invoked, and if it is ours and the predicate is inactive, it denies with an explanation. One
hook covers every skill, and it has its own kill switch.

Physical install/uninstall on state change was considered and rejected: destructive, and it races
with itself when two projects share a machine — приложение С of the source document already
documents that class of bug, where a hook guarded another project's tasks.

### When `.planning/` appears mid-project

Nothing is deleted. One notice, then silence:

```
Обнаружен .planning/ — проект перешёл на GSD-Core.
Ultrapowers выключен в этом проекте. Артефакты в .ultrapowers/ сохранены
(последняя позиция: фаза 03-import, план 2, задача 4 из 7).
Вернуть: удалить .planning/, либо ULTRAPOWERS=1 для разового включения.
```

### What ships to `full`

| Does not ship (GSD equivalent exists) | Ships, gated | Ships ungated |
|---|---|---|
| 15 agent registry (GSD has ~33 of its own; both = ~4 530 resident tokens) | 12 structure, 3 position, 9 decisions, 16 risks | 20 clean-guard — `.planning/` is gitignored too, GSD projects are equally exposed |
| 14 onboarding (`map-codebase`) | 2 waves, 5 order, 17 liveness, 4 resume, 19 `/up-resume`, 11 quick-task | 22 `jscpd` at plan close — GSD has no such gate |
| 13 `ui-spec` (`/gsd-ui-phase`) | 8 Context7/Graphify enforcement | 7 tier->model-name table — already a shared mechanism |
| 10 goal gate (`gsd-verifier`) | 21 `docs-first`, 6 non-interactive | 18 artifact language — a rule, not machinery |

### Accepted limitation: layer 0 has nothing to gate on

The patch lands in `~/.claude/plugins/cache/.../superpowers/` — **machine-wide, not per project**.
The predicate takes a project root; the patch has none.

Practically: inside a GSD project under the `full` profile, Superpowers skills will still present
themselves as Ultrapowers. The `.planning` gate does not reach them. Accepted deliberately: GSD and
Superpowers skills already coexist, and renaming the brand of a foreign skill package does not
interfere with the GSD process — it only reads as unfamiliar. The two alternatives (patch only what
GSD never calls; suppress patching when any GSD project exists on the machine) are respectively
half-measures and unimplementable — the machine does not know the list of projects.

## Layer 0 — rebrand patcher

### Layout

```
ultrapowers-patches/                        (repo root, mirrors gsd-core-patches/)
  rename-rules.json                         classification table
  ignore.json                               foreign harnesses + companion internals, each with a reason
  manifest/<version>.json                   before/after hashes per file
  cost-log.jsonl                            one line per upstream update
payload/
  bin/apply-ultrapowers-patches.mjs         CLI applier (mirrors apply-gsd-agent-patches.mjs)
  hooks/lib/ultrapowers-patch-rules.mjs     pure: classify + replace, no I/O
  hooks/lib/ultrapowers-patch-drift.mjs     detector: hash check + unclassified-mention scan
  commands/up-doctor.md                     manual run + report
```

Splitting the pure logic from the applier is not aesthetics: it is what makes the table testable
on strings, with no plugin on disk and no writes into `~/.claude`.

### Classification table

Measured surface in `superpowers@6.2.0`: **119 mentions across 25 files** — 78 in 22 skill files,
12 in `hooks/session-start`, 29 in two Codex packaging scripts.

Every mention falls in exactly one bucket:

| Bucket | Example | Action |
|---|---|---|
| `brand` | `You have superpowers`, `Superpowers' most common process skills` | replace |
| `invocation` | `superpowers:brainstorming` | **never** — namespace comes from the plugin directory name |
| `plugin-path` | `skills/using-superpowers/references/...`, `${CLAUDE_PLUGIN_ROOT}` | **never** |
| `artifact-path` | `.ultrapowers/archive/plans/`, `.superpowers/sdd/` | rewrite to `.ultrapowers/...` |
| `ignored` | `scripts/*codex*`, `references/{gemini,pi}-tools.md`, `.opencode/`, `.pi/` | skip, with a recorded reason |

```json
{ "bucket": "invocation", "match": "superpowers:[a-z-]+", "replace": null,
  "why": "namespace derives from the plugin directory name; renaming breaks skill resolution" },
{ "bucket": "brand",      "match": "\\bSuperpowers\\b",   "replace": "Ultrapowers" },
{ "bucket": "artifact",   "match": ".ultrapowers/archive/(plans|specs)/", "replace": ".ultrapowers/phases/" }
```

**Application order is load-bearing.** Protective buckets (`invocation`, `plugin-path`) run first
and consume their matches; `brand` runs last. Reversed, `\bSuperpowers\b` eats the prefix of
`superpowers:writing-plans` and skill resolution breaks — a delayed failure, since the file still
looks correct.

### Rules, not stored copies

GSD patches store whole post-patch files (`gsd-core-patches/2285/after/...`). For a rename that is
the wrong shape: any upstream edit anywhere in the same file invalidates the copy and the patch
drops out entirely.

Ultrapowers stores **rules plus before/after hashes**. An upstream edit outside the patched region
applies cleanly; anything else surfaces as drift. Stored copies remain only where a rule cannot
express the change — expected to be `hooks/session-start` alone.

### Drift detector — three states

| State | Condition | Reaction |
|---|---|---|
| Green | Hashes match the manifest for the current version | Silent |
| **Red: reapply** | Version directory changed, or a patched file's hash reverted to upstream | `session-init` prints "patches were lost — run `/init-stack`"; logged to `cost-log` |
| **Red: extend the table** | A brand mention found outside the ignore list, matched by no rule | Prints file and line; **blocks green status** until the table covers it |

The second red flag is the point of the whole mechanism. It catches not "the patch fell off" but
"upstream started describing itself differently and our table does not know". Without it the
rebrand rots silently.

### Ignore list is structural, not convenience

Without an explicit ignore list the detector raises a red flag on 29 deliberately-untouched
mentions on every run, and the flag is worthless within a week — after which the real one is not
read either. Each entry carries a reason, and `/up-doctor` prints them: a silent skip here is the
same defect that Ц.4 forbids in the duplication audit.

### Update detection

There is no plugin-lifecycle hook event. Load-bearing path: `SessionStart` compares the installed
version directory and the manifest hashes; `/up-doctor` does the same on demand. `component-registry.mjs`
gains an entry for the plugin with `updateClass: "reinit"`, so the existing centralized notifier
carries the message — no new hook is needed for the notification itself.

### Cost log and the rollback trigger

The user accepted the maintenance risk on condition of being able to back out. "Too often" must be
measurable in advance rather than judged in the moment of annoyance — the same discipline Ц.6
applies to Leanmode.

```
6.2.0 -> 6.3.0   rules broken: 0   new mentions: 3   manual rework: 15 min
```

**Rollback trigger:** two consecutive updates requiring table rework, or one update costing more
than 30 minutes. On trip, `session-init` prints "the patcher required rework N times in a row —
reconsider: prose-only rebrand, or an honest fork", not merely "reapply patches".

### Layer 0 task order

1. **Probe D** — which of `ConfigChange`, `UserPromptSubmit` (on `/reload-plugins`), `FileChanged`
   actually fires, and with what payload. Requires a session restart (hook registration is read at
   startup), so it runs as a separate step with the user, like пробы А/Б/В in приложение И. Result is
   appended to the source document as a new appendix.
2. Classification table + pure logic + string-level tests (no disk).
3. Applier, hash manifest, `/up-doctor`.
4. Drift detector + `component-registry` entry.
5. Cost log + rollback trigger.
6. Run against live 6.2.0 and record the bucket histogram.

**Layer acceptance is arithmetic:** the per-bucket counts plus the ignore list must sum to the 119
measured mentions. A lost mention is visible by subtraction, not by re-reading.

## Layer 1 — artifact foundation and migration

### Layout

```
.ultrapowers/
  STATE.md ROADMAP.md PROJECT.md STACK.md MAP.md
  CONVENTIONS.md DECISIONS.md RISK-REGISTER.md          tracked
  phases/<NN>-<slug>/{spec,ui-spec,research,plan,expected,verify}.md
  quick/<YYMMDD>-<slug>/
  archive/                                              unpaired migration artifacts
  sdd/
    .gitignore  ->  *  and  !.gitignore                 scratch, ignores itself
```

The project's root `.gitignore` is not touched at all. That is the point of the nested one: the
structural protection Т.4 calls the main measure cannot be undone by adding a line, because there
is no line to add. `.ultrapowers` is also a name no existing `.gitignore` covers, unlike
`.superpowers`.

**Resident-context constraint (source document, section 1).** None of `STATE.md`, `PROJECT.md`,
`STACK.md`, `MAP.md`, `RISK-REGISTER.md` may be injected into `CLAUDE.md`. They are read on demand:
`STATE.md` by the resume hook, the rest by whichever phase skill needs them. Violating this
reproduces the 5 290 resident tokens measured and criticized in приложение Б.

### Position is written by a hook, not by instruction

The source document revises itself here (У.2), and the revision matters: `STATE.md` was to be
maintained by a `state-writer` agent following an instruction, and instructions are forgotten. The
`TaskCompleted` event provides platform-level updates — a task closed, the position rewritten. No
discipline required.

Position spans four levels: milestone -> phase -> plan -> task, updated on every transition at any
level, so recovery can start from any of them.

`STATE.md` has a **hard 40-line cap with a failing test on overrun**. The single criterion: having
read only it, work can continue. A snapshot, not a journal — the journal is the ledger in `sdd/`,
which stays out of context.

### Risk register

The source document's claim that `add-risk.mjs` can be reused wholesale is wrong: the script is
hardcoded to append one specific risk. Reusable parts are its ID allocation (next free ID in the
file's own prefix/separator/zero-pad scheme) and per-file idempotency. Layer 1 generalizes it into
a callable that takes a risk body.

Numbering scheme is per project, not global: this repository already uses `RISK-<AREA>-NNN` prose
sections, and the source document's `R-NNN` flat numbering would be a third convention in the same
tree. The generalized script keeps detecting the scheme in use rather than imposing one.

`RISK_REGISTER.md` was listed in `.gitignore`, which suggested it was exposed to `git clean -fdx`.
It was not: the file has been tracked since 2026-07-08 and gitignore has no effect on tracked
files, so the line was inert and misleading. It has been removed for hygiene, not to change
behaviour — the register was already safe and stays at the repository root under its existing
`RISK-<AREA>-NNN` scheme.

What *is* genuinely exposed here is `.superpowers/` — ledger, briefs, review reports, and phase
diffs, all untracked and all removable by one `git clean -fdx`. That is improvement 20's scenario
on this repository, and it is what the `.ultrapowers/` layout fixes structurally.

**Standing relocation rule (user decision 2026-07-27):** the register moves to
`.ultrapowers/RISK-REGISTER.md` once `.ultrapowers/` exists in a project, and lives at the
project root only until then. Layer 1's migration performs the move; the generalized risk
writer resolves the destination in that order — `.ultrapowers/RISK-REGISTER.md` first, root
`RISK_REGISTER.md` as the fallback — so nothing has to be re-pointed by hand.

### Migration

Sources: `.ultrapowers/archive/{specs,plans}/` (21 + 13 files) and `.superpowers/sdd/`. This repository
is the first subject; both directories are non-empty.

Spec-to-plan pairs are **guessed** from date and slug, not derived — and some files pair with
nothing (`2026-07-26-phase2-design-skills-HANDOFF.md`). So migration proposes and does not act,
the same rule Т.4 sets for the resume hook:

```
Proposed mapping (34 files):
  specs/2026-07-27-claude-cleanup-design.md
  plans/2026-07-27-claude-cleanup.md            -> phases/01-claude-cleanup/{spec,plan}.md
  ...
Unpaired (3): 2026-07-26-phase2-design-skills-HANDOFF.md, ...
  -> .ultrapowers/archive/

Apply? [git mv, history preserved]
```

`git mv`, not copy: file history moves with the file. Unpaired files are neither discarded nor
guessed at — they go to `archive/` intact.

Two entry points, with different roles:

- `/init-stack` **performs** the migration.
- A `SessionStart` hook only **detects and offers** it: `.ultrapowers/` absent while
  `.ultrapowers/archive/` or `.superpowers/` is present. Under `full` the `.planning` gate applies on
  top. It never migrates by itself — the action is hard to reverse.

### Clean-guard (improvement 20)

`PreToolUse` on `Bash`, intercepting `git clean` with `-x`/`-X`/`-fd`, and `rm -rf` against the state
directory. **It does not block** — it shows a dry run and requires confirmation. Blocking outright
is wrong: cleaning a working tree is legitimate, and a hard ban gets routed around. The goal is to
prevent doing it blind. Own kill switch `CLEAN_GUARD=0`, fail-open, decision trace — the same
skeleton as the already-written `pre-task-blockedby-enforce.mjs`.

### Layer 1 acceptance

All of it verifiable without executing the system:

1. `.ultrapowers/sdd/` is ignored and everything else under `.ultrapowers/` is tracked — checked via
   `git check-ignore`.
2. A `STATE.md` longer than 40 lines fails a test.
3. Migration against a copy of this repository yields 34 files in the new layout, zero losses —
   checked by count.
4. `git clean -fdx --dry-run` after migration lists no phase artifact.

Item 4 is the one that matters: it verifies the reason the layer exists, not the code.

## Layers 2-4 — sketch only

Each gets its own spec before implementation. Recorded here only so ordering and dependencies are
not re-derived:

- **Layer 2** consumes layer 1's position and ledger. Wave computation is `TaskList` (ids/status
  only — no `description`, no `owner`) plus `TaskGet` per candidate, i.e. N+1 calls per wave;
  `plan.md` can carry `Files` and tier to collapse it back toward one. Subagents have no Task tools
  at all, so every status transition is coordinator-side by construction. `blockedBy` is a marker,
  not a gate — the already-written `pre-task-blockedby-enforce.mjs` supplies the enforcement.
- **Layer 3** ships all **39** agents (user decision 2026-07-27: cut only what genuinely does not
  apply, rather than trimming to the source document's self-imposed 34). Recomputed tiers over the
  full 39: cheap 12, mid 16, high 11. Description length is a resident cost (~206 chars average
  measured), so a budget test guards it; a lazy mode for rare heavy agents is an open question — the
  platform does this for tools via `ToolSearch`, but no agent equivalent is documented.
- **Layer 4** needs both layer 1 artifacts and layer 3 agents. `expected.md` is written and frozen
  before execution, its hash recorded in the ledger and re-checked by the goal gate; the evidence
  format `AC: <criterion> - PROVEN BY <evidence>` is taken from the `pcvelz` hooks so their parser
  can enforce it for free.

## Risks

Filed in `RISK_REGISTER.md` 2026-07-27 with stable IDs, under the register's existing
`RISK-<AREA>-NNN` scheme. Full context, mitigation, and residual live there; this is the index.

| ID | Risk | Status |
|---|---|---|
| `RISK-ULTRAPOWERS-001` | Rebrand patch maintenance debt on every upstream release | Open (accepted; bounded by cost log + rollback trigger) |
| `RISK-ULTRAPOWERS-002` | Rebrand is machine-wide and cannot be gated per project | Open (accepted; no mitigation available) |
| `RISK-ULTRAPOWERS-003` | Blind replacement would break `superpowers:` skill resolution | Open (mitigated: bucket ordering + regression test + arithmetic acceptance) |
| `RISK-ULTRAPOWERS-004` | Ignore-list rot devalues the drift flag | Open (mitigated: reasons per entry, printed by `/up-doctor`) |
| `RISK-ULTRAPOWERS-005` | Migration can mis-pair spec and plan documents | Open (mitigated: propose-then-confirm, `git mv`, `archive/`) |
| `RISK-ULTRAPOWERS-006` | Agent registry adds resident context cost every session | Open (accepted with a budget; excluded from `full`) |

## Open items

- **Probe D** (layer 0, task 1): which event, if any, fires on `/reload-plugins` or on a plugin
  update.
- **Lazy agent descriptions** (layer 3): whether a deferred-agent mechanism exists at all.
**Resolved 2026-07-27 — artifact language (improvement 18).** The source document requires
human-verified artifacts in Russian; this repository keeps documentation in English per its own
CLAUDE.md. Both hold, because they address different scopes: improvement 18 governs artifacts of
*projects managed by Ultrapowers* (`spec.md`, `ui-spec.md`, `expected.md`, `verify.md`, project
summaries), while `claude-config`'s own specs, code comments, and configs stay English. No conflict
to resolve at layer 3.
