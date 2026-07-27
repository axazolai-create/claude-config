# Ultrapowers — fork of upstream Superpowers, and its update automation

**Date:** 2026-07-27
**Supersedes:** the "Layer 0 — rebrand patcher" section of `2026-07-27-ultrapowers-rework-design.md`, and the plan `2026-07-27-ultrapowers-layer0-patcher.md` in full.
**Status:** design; replaces two abandoned approaches (see "Why this replaced the patcher").

## Goal

Maintain `ultrapowers` as an owned fork of `superpowers@claude-plugins-official`, fully rebranded, installed instead of upstream — and keep it current with one command runnable from any project, which either completes the update or refuses and says what needs work.

## Why this replaced the patcher

The original design patched the upstream plugin in place inside `~/.claude/plugins/cache/`. Three findings killed it, in order of severity:

1. **`/plugin update` replaces the plugin's cache directory wholesale; local modifications are not preserved** (verified against the official plugin reference). The patch would not survive a single upstream update — it only ever appeared to work because nothing had updated yet.
2. **A full scan found 1504 occurrences across 111 files and 382 distinct exact spellings**, not the 119 the earlier plan recorded. That 119 was measured over `skills/`, `hooks/` and `scripts/` only, and was carried into the plan as an acceptance baseline without the scope being stated. Classifying 382 variants — by machine or by hand — costs more than owning the code.
3. **Two classifier designs failed review.** Enumerate-and-protect could not be completed: four path shapes fell through and were silently rewritten into paths that never resolve, each verified by execution. Inverting the default was safer but still had a machine guessing intent in a codebase we do not own.

Inside our own fork none of this exists: identity is ours, so there is nothing to protect, nothing to classify, and nothing to reapply after an update.

**This reverses a non-goal.** `2026-07-27-ultrapowers-rework-design.md` listed "forking or vendoring upstream Superpowers" as explicitly out of scope, citing the source analysis's argument that a fork fights merges every release. That argument still holds — the cost is real and is accepted here, bounded by the automation below. What changed is the measured cost of the alternative.

## Licensing

Upstream is MIT, © Jesse Vincent (`obra/superpowers`). A renamed, redistributed fork is permitted, and the obligation is concrete:

- `LICENSE` is carried into the fork **verbatim** and is never touched by the transform.
- Upstream authorship and the upstream repository URL stay attributed in the fork's own README, stated as a fork rather than implied.
- `plugin.json`'s `author` field becomes ours (we maintain this artifact), with upstream credited in `description`/README — not silently dropped.

The transform therefore has a small **keep-list**: files and fields it must not rewrite. This is the fork's only equivalent of the abandoned ignore list, and it exists for legal reasons rather than technical ones.

## Repository layout

A public GitHub repository, three long-lived branches (user decision 2026-07-27):

| Branch | Contents | Written by |
|---|---|---|
| `original` | Pristine upstream snapshots. One commit per upstream release, tagged with the upstream version. | The updater, never by hand |
| `patch` | The working materials: the rename transform, its rule set, the keep-list, and our own additive deltas as discrete patch files. | By hand |
| `main` | The finished plugin: `original` with `patch` applied. Installable as-is, and carries `.claude-plugin/marketplace.json` so the repository is its own marketplace. | The updater, never by hand |

`main` is generated. Hand-editing it is a mistake the updater must detect and refuse to overwrite silently — a change on `main` that is not derivable from `original` + `patch` means someone edited the output instead of the source.

Public rather than private so `/plugin marketplace add` works on a new machine with no git authentication, which is what the bootstrap install depends on.

## Install mechanics

Verified against the official plugin and marketplace references (high confidence except where noted):

- A marketplace and the plugins it lists may live in the same repository; a plugin entry's `source` may be a relative path, e.g. `"./plugins/ultrapowers"`.
- Minimum `.claude-plugin/marketplace.json`: `name`, `owner.name`, and `plugins[]` entries each carrying `name` and `source`.
- `/plugin marketplace add <owner>/<repo>` registers it; `/plugin install ultrapowers@<marketplace>` installs; `/plugin disable superpowers@claude-plugins-official` stops upstream loading its skills and hooks without uninstalling it.
- `enabledPlugins` in `settings.json` maps `plugin@marketplace` to a boolean. `false` disables but does not uninstall.

**Upstream is disabled, not uninstalled.** Two reasons: rollback is one command, and it sidesteps the one thing the documentation does not answer — what happens when two enabled plugins provide skills with the same name. Fourteen skill names collide between the fork and upstream; whether both descriptions get injected into context is undocumented, so we do not find out the hard way.

`claude-config` owns this wiring: `variants.json → managedPlugins` gains the fork and flips upstream to disabled, so `/init-stack` and the installer converge on it like any other managed plugin.

## Version policy

Explicit `version` in `plugin.json`, tied to upstream (user decision 2026-07-27):

```
<upstream version>-up.<our revision>      e.g. 6.2.0-up.1, then 6.2.0-up.2, then 6.3.0-up.1
```

The version field's presence is what makes updates deliberate: with it, `/plugin update` only offers something when we bump it; without it, every commit on `main` ships to every machine, including a half-finished build. The format also makes "which upstream is this built on" answerable without opening the repo.

## The transform

Lives on `patch`, applied to `original` to produce `main`. It is deterministic and re-runnable — that is the whole point, since every update replays it.

Three parts:

1. **Rename.** Inside our own fork this is a wholesale substitution: directory names, `plugin.json` identity, the skill namespace (`ultrapowers:brainstorming` becomes the real invocation name), and every mention in prose. No protective classification is needed, because there is no foreign identity left to protect.
2. **Keep-list.** `LICENSE` verbatim; upstream attribution and the upstream repository URL in README and `plugin.json` description; anything else the fork must preserve for legal or merge-tracking reasons. Every entry carries a recorded reason, printed by `/up-update`.
3. **Our deltas.** Genuine changes of our own — the layer 1-4 improvements that live inside the plugin rather than in `claude-config` — kept as discrete, individually-applicable patches, not as edits smeared into the rename.

Keeping (3) separate from (1) is what makes the "upstream implemented it for us" detection possible at all.

`ultrapowers-patches/scan-inventory.mjs` in `claude-config` survives from the abandoned approach and is still useful here: it enumerates every occurrence deterministically, which is how the transform's completeness is checked after a rebuild.

## `/up-update` — the update command

Ships from `claude-config`, runnable **from any project**, so a version check never requires switching repositories.

### What it does

1. **Detect.** Query GitHub for the latest release of `obra/superpowers`; compare against the version recorded on `original`. No Claude Code command reports available plugin updates in machine-readable form — this was checked, and it is why detection goes to GitHub directly rather than through the plugin system.
2. **Fetch.** Update the local fork checkout; commit the new upstream tree to `original`, tagged with its version.
3. **Rebuild.** Re-run the transform on the new `original`; apply our deltas in order.
4. **Assess.** Decide whether this was a fast path or needs a human — see the thresholds below.
5. **Edit both repositories.** The fork gets the rebuilt `main` and a version bump; `claude-config` gets whatever must follow — the pinned version in `variants.json`, references in docs, anything the new upstream renamed out from under us.
6. **Report, then ask.** Nothing is pushed without explicit confirmation. Publishing is outward-facing and hard to reverse; the command prepares and shows, the human releases.

### When it refuses

The command must be able to say "I did not manage this" rather than produce a plausible-looking broken build. It stops and reports **patcher needs work** when any of:

- a delta from `patch` fails to apply;
- the rename leaves occurrences of the upstream name outside the keep-list after a rebuild (the inventory scan is the check);
- the upstream diff exceeds a size threshold — a release that rewrote a large share of the tree deserves a human read even if everything applied cleanly;
- `main` contains changes not derivable from `original` + `patch`, i.e. someone hand-edited the generated branch.

**Assumption, stated because I am choosing it rather than being told:** the size threshold is *upstream touched more than 25% of the files the transform rewrites, or any file on the keep-list*. It is recorded in config, not hard-coded, and the first few real updates should calibrate it — a threshold that never fires is decoration, and one that always fires is noise.

### The delta that upstream implemented for us

After a rebuild, any delta from `patch` that applies to zero lines — or whose effect is already present in the new `original` — is reported as **obsolete: upstream did this**. It is not dropped automatically; it is surfaced with the upstream commit that made it redundant, and removing it is a decision. Carrying a delta that no longer does anything is how a fork accumulates the maintenance burden that makes people abandon forks.

## What this changes in the umbrella design

- **Layer 0 is replaced entirely.** No classification table, no ignore list, no drift detector over a foreign cache, no patch-reapplication cost log, no `/up-doctor` in its former role.
- **The accepted limitation disappears.** The umbrella spec recorded that the rebrand was machine-wide and could not be gated per project, so a GSD project under the `full` profile would still see "Ultrapowers". A fork is a plugin: it is enabled and disabled like any other, so the `.planning` gate reaches it. `RISK-ULTRAPOWERS-002` is resolved rather than accepted.
- **Layers 1-4 are unaffected** in substance. Where they add skills or agents, those now land in the fork's `patch` deltas rather than in a separate additive package — which is simpler, and makes them candidates for upstreaming.

## Acceptance

1. `/plugin marketplace add`, `/plugin install`, `/plugin disable superpowers@…` produce a session where every skill resolves as `ultrapowers:<name>` and no upstream skill is loaded.
2. A rebuild from `original` + `patch` reproduces `main` byte-for-byte — the transform is deterministic, or it is not a transform.
3. `scan-inventory.mjs` over built `main` reports zero occurrences of the upstream name outside the keep-list.
4. `LICENSE` in `main` is byte-identical to upstream's.
5. `/up-update` against an unchanged upstream reports "up to date" and writes nothing.
6. `/up-update` against a synthetic upstream bump rebuilds, bumps the version, edits both repositories, and stops before pushing.
7. A deliberately broken delta makes `/up-update` refuse with "patcher needs work" and leave both repositories untouched.

## Risks

Revised from `RISK_REGISTER.md`; the register is updated when this design is accepted.

| ID | Change |
|---|---|
| `RISK-ULTRAPOWERS-001` | Rewritten: the debt is now merge burden per upstream release, not patch reapplication. Bounded by `/up-update` and its refusal thresholds. |
| `RISK-ULTRAPOWERS-002` | **Resolved.** A fork is per-project gateable; the machine-wide limitation no longer exists. |
| `RISK-ULTRAPOWERS-003` | **Resolved.** No classification, so no misclassification. |
| `RISK-ULTRAPOWERS-004` | Rewritten and narrowed: the keep-list is small and legally motivated; each entry still carries a reason and is printed. |
| `RISK-ULTRAPOWERS-005` | Unchanged in substance — migration of our own artifacts is layer 1's problem. |
| `RISK-ULTRAPOWERS-006` | Unchanged. Agent registry resident cost is independent of how the plugin is distributed. |
| **New** | Divergence: a fork not updated for several releases drifts far enough that a merge stops being mechanical. Mitigated by making the update one command from any project, and by the release watch surfacing it rather than waiting to be asked. |
| **New** | Upstream could change its license or direction. MIT is irrevocable for the version we forked, so the exposure is limited to future releases, not to what we already have. |

## Open assumptions

Stated rather than assumed silently; correct any that are wrong before implementation:

- Repository is `<user>/ultrapowers`, public, with the plugin at `./plugins/ultrapowers` and the marketplace at the repository root.
- The local fork checkout lives at a fixed path recorded in `claude-config` config, cloned on first `/up-update` if absent.
- `/up-update` never pushes without confirmation, and never edits a dirty working tree in either repository.
- The 25% / keep-list-touched threshold above is a starting value to be calibrated, not a measured one.
