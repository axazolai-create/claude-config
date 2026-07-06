---
name: update-changelog
description: Backfills this project's changelog.json from git history — turns a range of commits into human-readable, Russian, end-user-facing changelog entries with one patch version bump per entry. Use this whenever the user runs /update-changelog, asks to "update the changelog", "generate changelog entries from commits", "bump the version and changelog", or wants git history turned into release notes for this MES SPA. Only applies to Node-based projects that already use (or want) the `{version, changes[]}` changelog.json format — single project or monorepo. In a monorepo (web/backend/mobile, etc.) it also cross-notifies every other part's changelog with an abstracted, non-technical entry — see "Monorepo mode". Do not use for generic CHANGELOG.md / Keep-a-Changelog style projects — this is specific to this project's JSON schema and its React renderer.
---

# Update Changelog

Turns a slice of git history into entries in `changelog.json`, bumping `package.json` /
`version.json` one patch version per entry. Output is Russian, human-readable, and stripped
of every trace of AI tooling, GSD, and internal implementation detail — it's release notes
for a shop-floor operator, not a commit log. Finishes by committing exactly the files it
touched, tagged `vX.Y.Z`.

## 0. Guardrail — monorepo check, then React/Next

Run `node .claude/skills/update-changelog/scripts/list-workspaces.mjs` from the repo root
first. If `isMonorepo` is `true` (2+ directories with their own `package.json`), stop here
and follow **Monorepo mode** below instead of the rest of this section — it re-uses steps
1–4 per workspace, so read those first, but the outer flow (which commits touch which part,
how versions bump, how the final commit is composed) is different.

If `isMonorepo` is `false`, continue as a single project:

Run `node .claude/skills/update-changelog/scripts/detect-project.mjs` from the repo root.
If `isReactOrNext` is `false`, stop and tell the user this skill only applies to React/Next
projects — do not proceed.

The same call also tells you:
- `changelogPath` — where `changelog.json` lives (repo root or `src/`), or where it *would*
  be created if `changelogExists` is `false`.
- `baselineVersion` — the version to start bumping from (top entry of `changelog.json` if it
  has any, else `package.json`'s current version). No "v" prefix.
- `versionJsonPath` — `null` if the project has no `version.json` (skip step 8 in that case).

## 1. Ask which branch and starting commit

Ask the user two things before touching any commits — never guess these:

1. **Local branch to scan.** List local branches (`git branch --format='%(refname:short)'`)
   and ask via AskUserQuestion — offer the current branch plus a couple of likely candidates,
   "Other" covers the rest.
2. **Starting commit (exclusive).** Show the last ~15–20 commits of the chosen branch
   (`node scripts/list-commits.mjs --branch <branch> --recent 20`) as plain text so the user
   can see hash + subject, then ask them which commit to start *after*. This is an open-ended
   pick, not a good fit for AskUserQuestion's fixed options — ask conversationally.

If the range turns out to contain zero commits after the chosen starting point, say so and
stop — don't touch any file (spec step 8).

## 2. Gather the commit range

```
node .claude/skills/update-changelog/scripts/list-commits.mjs --branch <branch> --since <startHash>
```

Returns oldest-first JSON: `[{ hash, subject, body }, ...]`. This walks **full history**
reachable from the branch tip after `since` — including commits brought in through a regular
(non-squash) merge, not just the first-parent line. That matches how this repo actually
merges feature work (see `2ac2cdd` "Merge branch 'ai-redisign-pr' into dev", which alone
carries ~30 commits).

## 3. Editorial pass — the actual work

Process commits **oldest to newest**. For each one, decide: skip it, or turn it into one
changelog entry (one patch version bump). This step is why this is a skill and not a script —
judging "is this meaningful to a shop-floor operator" and rewriting it in natural Russian
needs reading comprehension, not pattern matching.

### 3.1 The meaningfulness test

Ask: *would a shop-floor operator using the finished app ever notice this?* A UI change, a
new capability, a fixed bug, a changed data behavior — yes. Repo housekeeping, planning
documents, reference-file syncs, internal tooling, config-only changes, merge commits — no.

Skip anything that fails this test (spec step 7). Concrete examples from this repo's own
history:
- `docs(quick-260630-p0f): storage GetReleaseZones migration plan/summary/verification` →
  skip (GSD planning artifact, zero app effect)
- `chore(reference): sync swagger.json with backend build 2026.06.30 17:54` → skip (internal
  API contract sync, not a shipped change by itself)
- `Merge branch 'ai-redisign-pr' into dev`, `pre merge` → skip (git plumbing, no content)
- `style(menu): remove button rounding in side nav` → **keep** (visible UI change)
- `fix(storage): render releases with null or unmatched zoneId in "Без зоны" group` →
  **keep** (fixes something the operator would have seen break)

### 3.2 Strip before rewriting

Before composing the Russian sentence, mentally discard from the source commit:
- Any mention of AI, Claude, or GSD — including commit trailers like
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`, which show up in
  this repo's commit bodies and must never leak into the changelog.
- GSD scope/decision identifiers: phase numbers (`16-01`), quick-task ids (`quick-260630-p0f`),
  decision codes (`D-05`, `DKP-02`), references to `PLAN.md` / `STATE.md` / `ROADMAP.md` /
  "checkpoint" / "human-verify".
- File names, variable/component/token names (`ThemeColorsDark.textPrimary`, `ZoneRow`,
  `IReleaseZone`), and exact literal values (hex colors, px numbers, decision-specific measurements).
- The commit **scope** entirely — always drop it, keep only the type. `feat(16-01): ...` and
  `feat(storage): ...` both become plain `feat: ...`.

What survives is the *user-facing meaning*: what changed, from the operator's point of view.

### 3.3 Prefix mapping

`ChangeItem` (the React component rendering `changes[]`) only paints a colored pill for these
exact words at the start of a change string: `feat`, `add`, `fix`, `upd`, `build`, `refactor`,
`replace`. Anything else renders as plain text — still fine, just untagged. Map the commit's
conventional-commit type accordingly:

| git commit type | changelog prefix | reason |
|---|---|---|
| `feat` | `feat` | recognized, green pill |
| `fix` | `fix` | recognized, orange pill |
| `refactor` | `refactor` | recognized, neutral pill |
| `build` | `build` | recognized, neutral pill |
| `style` | `upd` | visual tweak — "updated", not natively tagged |
| `perf` | `upd` | performance tweak — same reasoning |
| `chore` | `upd` | rare survivor of the meaningfulness test — same reasoning |
| `docs` | (almost always skipped, see 3.1) | if a rare one survives, treat as `upd` |
| anything else / no discernible type | `upd`, or judge from content | best effort |

### 3.4 Compose the entry

- `changes[0]` = `"{prefix}: {Russian sentence describing the user-facing effect}."` — natural,
  concise, capitalized like a sentence, ends with a period.
- `changes[1..]` (optional) — at most 1–2 more plain Russian sentences (**no prefix**) pulled
  from the commit body, only if they add genuinely new information beyond the title, after the
  same stripping pass. Most commits will end up with just `changes[0]` — that matches this
  project's existing convention (single-line entries are the norm, extra bullets are the
  exception).

**Worked example** (from this project's own history, `fb29200`):

```
Input commit:
feat(16-01): DKP-02 soften dark text.primary token to #C9D1D9

- ThemeColorsDark.textPrimary: '#E6EDF3' → '#C9D1D9' (GitHub-style muted white)
- Light scheme ThemeColors.textPrimary (#0F172A) unchanged per D-03
- Cascades globally to all pages using text.primary in dark scheme

Output entry.changes:
[
  "feat: Смягчение цвета шрифта в тёмной теме.",
  "Добавлен приглушённый белый в стиле GitHub для тёмной темы",
  "Обновление цвета по умолчанию в тёмной теме для всех страниц"
]
```

Note what got dropped: the scope `(16-01)`, both decision IDs (`DKP-02`, `D-03`), every hex
value, the token/variable name, and the bullet about the *light* scheme being unchanged (a
non-event, not something the operator experiences).

### 3.5 If no sentence can be formed

Skip the commit — no entry, no version bump for it (spec step 7). **Exception:** the very
last commit in the range must always be accounted for, even if it's unparseable on its own or
the last three commits in the range are all meaningless together. In that case do **not**
write a changelog entry for it — a line that only says "nothing worth mentioning happened" is
worse than no line, and it's exactly the kind of noise the "Незначительные правки"/
"Незначительные изменения" filler used to add. Instead, consume a version number for it
**silently**: bump the patch component by 1 with no matching entry in `changes[]`. This still
guarantees the version written to `version.json`/`package.json` reflects the true tip of the
range, without cluttering the visible log. See step 4 for how this interacts with
`finalVersion`.

## 4. Version bumping

Only commits that survive step 3 consume a version number — skipped commits don't bump
anything. Starting from `baselineVersion` (e.g. `0.3.0`), increment the **patch** component by
exactly 1 per surviving entry, in commit order: `0.3.1`, `0.3.2`, `0.3.3`, ... Never touch
major/minor regardless of commit type — that matches this project's actual version history
(every commit from v0.2.23 onward is a flat patch increment, feat and fix alike).

The silent trailing bump from step 3.5 (unparseable tail, no entry written) also consumes one
patch version, on top of the last real entry. `finalVersion` — the number written to
`version.json`/`package.json` and used in the closing commit message — is always the *last*
number consumed, so it can end up one patch ahead of the newest entry actually visible in
`changelog.json`. Example: the newest written entry is `v0.1.14`, the range's last commit is
meaningless on its own → `finalVersion` is `0.1.15`, and that's what lands in
`version.json`/`package.json` and the commit message `v0.1.15`.

## 5. Write the files

Build the entries list **newest-first** (reverse of processing order, matching how
`changelog.json` is sorted today — v0.3.0 at the top). Write it to a scratch JSON file:

```json
{
  "entries": [
    { "version": "v0.3.3", "changes": ["..."] },
    { "version": "v0.3.2", "changes": ["..."] },
    { "version": "v0.3.1", "changes": ["..."] }
  ],
  "finalVersion": "0.3.3"
}
```

Then apply it:

```
node .claude/skills/update-changelog/scripts/write-changelog.mjs --entries-file <scratch-path>
```

This prepends the entries to `changelog.json` (creating it at the repo root if it doesn't
exist anywhere yet — spec step 1), updates `package.json`'s `version` field in place (regex
replace, doesn't reformat the rest of the file), and rewrites `version.json` if the project
has one — all without the `v` prefix in those two files, matching this project's existing
convention (`changelog.json` uses `"v0.3.0"`, `package.json`/`version.json` use `"0.3.0"`).

## 6. Commit

Stage **exactly** the files `write-changelog.mjs` reported touching (`changelogPath`,
`packageJsonPath`, and `versionJsonPath` when non-null) — never `git add -A` / `git add .`.
This repo routinely has unrelated work-in-progress changes sitting in the tree, and this
skill must not sweep them into its commit.

```
git add <changelogPath> <packageJsonPath> [<versionJsonPath>]
git commit -m "v<finalVersion>"
```

`finalVersion` is the same value from the scratch file (step 5) — with the `v` prefix and
nothing else in the message, matching this project's existing version-bump commits (e.g.
`v0.3.14`). Don't add a body, don't mention the changelog contents, don't add trailers.

## 7. Report back

Summarize in Russian: how many commits were processed, how many became entries vs. were
skipped and why (in general terms — no need to relitigate each one), the final version, which
files changed, and the commit hash/message just created. Point out explicitly any silent
trailing bump from step 3.5 — i.e. when `finalVersion` ended up one patch ahead of the newest
visible entry in `changelog.json` — so the user understands why the two numbers differ.

## Monorepo mode

Triggered by step 0 when `list-workspaces.mjs` reports `isMonorepo: true`. Each returned
workspace (e.g. `apps/web`, `apps/backend`, `apps/mobile`) is a **part**. A part is a
**destination** if it has (or the user confirms it should have) its own `changelog.json` —
i.e. `detect-project.mjs --root <dir>` reports `changelogExists: true`, or the user says to
create one there. A part is always a **source** of changes regardless of whether it's a
destination — this is what makes an API-only backend (no changelog UI of its own) still show
up, abstracted, in web's and mobile's logs without needing a changelog.json of its own.

### M1. Ask which branch and starting commit

Same as step 1 — one branch, one starting commit for the *whole monorepo* (not per part;
commits aren't scoped to one workspace ahead of time).

### M2. Gather the commit range + which files each commit touched

```
node .claude/skills/update-changelog/scripts/list-commits.mjs --branch <branch> --since <startHash>
node .claude/skills/update-changelog/scripts/list-changed-files.mjs --branch <branch> --since <startHash>
```

The second call returns `{ "<hash>": ["apps/backend/src/models/user.ts", ...], ... }` — look
up each commit's hash there to get its changed paths.

### M3. Attribute each commit to its home part(s)

For each commit, match its changed file paths against each workspace's `relDir` prefix
(from `list-workspaces.mjs`):
- All changed paths fall under exactly one workspace's `relDir` → that workspace is the
  commit's **home** (the one that gets the real, detailed entry — steps 3–3.5 apply exactly
  as written, unchanged).
- Changed paths span two or more workspaces → treat each touched workspace as a home (the
  commit gets its own detailed entry, independently authored per part, in each one).
- No changed path falls under any workspace's `relDir` (root-level tooling, shared
  `packages/*` outside the app dirs, CI config, root `README`) → there is no home part. If
  the commit passes the meaningfulness test at all (§3.1) treat it as touching **every**
  destination part with the generic entry from M5 below (no detailed version anywhere) —
  most root-level commits fail §3.1 and are simply skipped, same as today.

### M4. Home entry — unchanged

Run §3 (the editorial pass) exactly as written against the commit's home workspace(s). This
is the detailed, precise Russian entry — same rules, same prefix mapping, same stripping.

### M5. Cross-part entry — abstract, don't leak implementation

For every **other** destination part (every destination that isn't a home for this commit),
write a **second, separate** entry — same `changes[0]` prefix mapping (§3.3) if a type is
clear, but the sentence itself must never mention: model/entity/field/variable names,
endpoint paths, file names, or any implementation noun from the source part. Pick from (or
closely paraphrase) a short fixed vocabulary instead — this is the whole point: a web user
does not need to know a backend model gained a field, only that "something changed under the
hood."

| what actually happened in the home part | generic cross-part phrasing |
|---|---|
| new dependency, build tooling, infra/CI change | "обновление кодовой базы" |
| new backend field/filter/query param, extended API surface | "расширение параметризации фильтрации" (only if unmistakably about filtering/search) or "расширение функциональности" otherwise |
| performance work, internal refactor | "оптимизация производительности" / "внутренние доработки" |
| bug fix that isn't visible from another part's UI | "исправления в смежных модулях" |
| security/auth-related change | "обновления безопасности" |
| anything else, or unclear | "системные доработки" |

One sentence, no prefix pill required (plain untagged text is fine — see §3.3). Do **not**
add the extra 1–2 sentences §3.4 allows for the home entry; a cross-part entry is always
exactly one line.

### M6. Version bumping — independent per part

Each destination part keeps its **own** patch counter, starting from its own
`baselineVersion` (from `detect-project.mjs --root <dir>`), exactly like step 4 — but a
part's counter advances once for **every** entry it receives in this run, home or cross-part
alike. A part with 3 of its own commits and 5 cross-part mentions from other parts' work
bumps by 8 total, not 3. Parts will end up on different version numbers from each other —
that's expected, not a bug; there's no shared/lockstep version across the monorepo.

### M7. Write the files

Build one entries-list + `finalVersion` per **destination** part (same shape as step 5), then
apply each with its own `--root`:

```
node .claude/skills/update-changelog/scripts/write-changelog.mjs --entries-file <scratch-web.json> --root apps/web
node .claude/skills/update-changelog/scripts/write-changelog.mjs --entries-file <scratch-backend.json> --root apps/backend
node .claude/skills/update-changelog/scripts/write-changelog.mjs --entries-file <scratch-mobile.json> --root apps/mobile
```

(Only for parts that are destinations — a source-only part like a changelog-less backend
never gets a `write-changelog.mjs` call for itself.)

### M8. Commit — one combined commit is fine

Unlike the single-project flow (step 6, one commit per run), a monorepo update naturally
touches every destination part's `changelog.json` + `package.json` (+ `version.json`) at
once — it's fine to stage and commit all of them together rather than one commit per part.
Stage exactly the files each `write-changelog.mjs` call reported touching, nothing else
(never `git add -A`), and compose the message as one line per destination part:

```
git commit -m "web: v0.4.7, backend: v1.9.2, mobile: v2.3.1"
```

Order parts alphabetically by `relDir` for a stable, diffable message. If the user prefers
separate commits per part instead, that's a reasonable alternative — ask if it isn't already
obvious from how they work.

### M9. Report back

Same spirit as step 7, per part: how many commits were attributed as home vs. cross-part
mentions for each destination, each part's final version, and the commit(s) created. Call
out any part that had zero home commits but still bumped purely from cross-part mentions —
that's the mechanism working as intended, not a mistake.

## Single-commit mode (for a future automated trigger)

Not currently wired to anything — no hook exists yet — but keep the algorithm capable of
this so it's a drop-in later. To process exactly one commit (typically `HEAD`) instead of a
range:

- Skip step 1 entirely (no questions — the commit is already chosen).
- Run step 3 (the editorial pass) on that single commit only.
- If it passes the meaningfulness test → write one entry, bump the patch version by 1, apply
  via `write-changelog.mjs` and commit exactly as in steps 5–6.
- If it fails → do **nothing**. No entry, no silent bump, no file writes, no commit. The
  silent trailing bump is a range-end guarantee (step 3.5) — it must never fire on every
  skipped commit in single-commit mode, or `version.json` would bump on every no-op commit.
- Never ask the user anything in this mode.
