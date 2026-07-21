---
name: update-changelog
description: Backfills a project's changelog.json from git history — commits become Russian, end-user-facing entries, one patch version bump per entry. Use when the user runs /update-changelog (incl. --drain), asks to "update the changelog", "generate changelog entries from commits", "bump the version and changelog", or wants git history turned into release notes. For Node projects with a user-facing frontend using the {version, changes[]} changelog.json format — single project or monorepo (per-part changelogs plus one aggregate cross-part feed; config in .changelog.config.json). Not for generic CHANGELOG.md / Keep-a-Changelog projects.
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
stop — don't touch any file.

## 2. Gather the commit range

```
node .claude/skills/update-changelog/scripts/list-commits.mjs --branch <branch> --since <startHash>
```

Returns oldest-first JSON: `[{ hash, subject, body }, ...]`. This walks **full history**
reachable from the branch tip after `since` — including commits brought in through a regular
(non-squash) merge, not just the first-parent line (a single regular merge can carry
dozens of real commits).

## 3. Editorial pass — the actual work

Process commits **oldest to newest**. For each one, decide: skip it, or turn it into one
changelog entry (one patch version bump). This needs judgment, not pattern matching — deciding
"is this meaningful to a shop-floor operator" and rewriting it in natural Russian.

### 3.1 The meaningfulness test

Ask: *would a shop-floor operator using the finished app ever notice this?* A UI change, a
new capability, a fixed bug, a changed data behavior — yes. Repo housekeeping, planning
documents, reference-file syncs, internal tooling, config-only changes, merge commits — no.

Skip anything that fails this test. Examples:
- `docs(...)`: GSD planning artifacts (plan/summary/verification) → skip (zero app effect)
- `chore(reference): sync swagger.json with backend build` → skip (internal API contract
  sync, not a shipped change by itself)
- merge commits, `pre merge` → skip (git plumbing, no content)
- `style(menu): remove button rounding in side nav` → **keep** (visible UI change)
- `fix(storage): render releases with null or unmatched zoneId in "Без зоны" group` →
  **keep** (fixes something the operator would have seen break)

### 3.2 Strip before rewriting

Before composing the Russian sentence, mentally discard from the source commit:
- Any mention of AI, Claude, or GSD — including `Co-Authored-By: Claude ...` commit
  trailers; they must never leak into the changelog.
- GSD scope/decision identifiers: phase numbers (`16-01`), quick-task ids (`quick-260630-p0f`),
  decision codes (`D-05`, `DKP-02`), references to `PLAN.md` / `STATE.md` / `ROADMAP.md` /
  "checkpoint" / "human-verify".
- File names, variable/component/token names (`AppColorsDark.textPrimary`, `ListRow`,
  `IEntity`), and exact literal values (hex colors, px numbers, decision-specific measurements).
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
  same stripping pass. Most commits will end up with just `changes[0]` — single-line
  entries are the norm, extra bullets the exception.

**Worked example** (illustrative):

```
Input commit:
feat(16-01): DKP-02 soften dark text.primary token to #C9D1D9

- AppColorsDark.textPrimary: '#E6EDF3' → '#C9D1D9' (GitHub-style muted white)
- Light scheme AppColors.textPrimary (#0F172A) unchanged per D-03
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

Skip the commit — no entry, no version bump for it. **Exception:** the very
last commit in the range must always be accounted for, even if it's unparseable on its own or
the last three commits in the range are all meaningless together. In that case do **not**
write a changelog entry for it — a line that only says "nothing worth mentioning happened"
is worse than no line. Instead, consume a version number for it
**silently**: bump the patch component by 1 with no matching entry in `changes[]`. This still
guarantees the version written to `version.json`/`package.json` reflects the true tip of the
range, without cluttering the visible log. See step 4 for how this interacts with
`finalVersion`.

## 4. Version bumping

Only commits that survive step 3 consume a version number — skipped commits don't bump
anything. Starting from `baselineVersion` (e.g. `0.3.0`), increment the **patch** component by
exactly 1 per surviving entry, in commit order: `0.3.1`, `0.3.2`, `0.3.3`, ... Never touch
major/minor regardless of commit type.

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
exist anywhere yet), updates `package.json`'s `version` field in place (regex replace,
doesn't reformat the rest of the file), and rewrites `version.json` if the project has
one — all without the `v` prefix in those two files (`changelog.json` uses `"v0.3.0"`,
`package.json`/`version.json` use `"0.3.0"`).

## 6. Commit

Stage **exactly** the files `write-changelog.mjs` reported touching (`changelogPath`,
`packageJsonPath`, and `versionJsonPath` when non-null) — never `git add -A` / `git add .` —
the tree may hold unrelated work-in-progress changes, and this skill must not sweep them
into its commit.

```
git add <changelogPath> <packageJsonPath> [<versionJsonPath>]
git commit -m "v<finalVersion>"
```

`finalVersion` is the same value from the scratch file (step 5) — with the `v` prefix and
nothing else in the message. Don't add a body, don't mention the changelog contents, don't
add trailers.

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
  `packages/*` outside the app dirs, CI config, root `README`) → there is no home part. A
  no-home commit gets **no entry in any part** — it is skipped even if it would pass the
  meaningfulness test (§3.1); there is no cross-part fan-out. Most
  root-level commits fail §3.1 and are skipped anyway, same as today.

### M4. Home entry — unchanged

Run §3 (the editorial pass) exactly as written against the commit's home workspace(s). This
is the detailed, precise Russian entry — same rules, same prefix mapping, same stripping.

### M6. Version bumping — independent per part

Each destination part keeps its **own** patch counter, starting from its own
`baselineVersion` (from `detect-project.mjs --root <dir>`), exactly like step 4: the counter
advances once per **home** entry the part receives in this run (there are no cross-part
entries anymore — the aggregate feed in M7a is separate and does not bump any part's
version). Parts will end up on different version numbers from each other — that's expected,
not a bug; there's no shared/lockstep version across the monorepo.

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

### M7a. Write the aggregate

For each entry written to a part's own `changelog.json`, also emit an aggregate entry
`{ version, name, date, changes }` where `name = partName(config, relDir)` (from
`config.mjs`) and `date` = the commit's author date in ISO 8601 UTC (e.g.
`2026-02-01T04:05:06Z`). Collect all such entries for the run into a scratch JSON array and
apply once:

```
node .claude/skills/update-changelog/scripts/write-aggregate.mjs \
  --file <aggregatePath> --entries-file <scratch-aggregate.json>
```

`aggregatePath` comes from `.changelog.config.json` (`aggregatePath(config)`); the file is
upserted (key `name|version`, last write wins) and re-sorted by `date` descending on every
run. If there is no config or it defines no aggregate, skip this step with a warning —
per-part changelogs still work without it.

### M8. Commit — one combined commit is fine

Unlike the single-project flow (step 6, one commit per run), a monorepo update naturally
touches every destination part's `changelog.json` + `package.json` (+ `version.json`) at
once — it's fine to stage and commit all of them together rather than one commit per part.
Stage exactly the files each `write-changelog.mjs` call reported touching **plus** the
aggregate file (`aggregatePath`, when M7a ran), nothing else (never `git add -A`), and
compose the message as one line per destination part:

```
git commit -m "web: v0.4.7, backend: v1.9.2, mobile: v2.3.1"
```

Order parts alphabetically by `relDir` for a stable, diffable message. If the user prefers
separate commits per part instead, that's a reasonable alternative — ask if it isn't already
obvious from how they work.

### M9. Report back

Same spirit as step 7, per part: how many commits were attributed as home entries for each
destination, each part's final version, and the commit(s) created. Also report the aggregate
feed — how many entries were upserted into it and where it lives (`aggregatePath`) — or note
that it was skipped because no `.changelog.config.json` aggregate is configured.

## Automated mode (queue + drain)

An enqueue-then-drain trigger turns everyday commits into changelog entries without anyone
running the range flow by hand. A native `post-commit` hook **enqueues** each commit's hash;
the AI skill later **drains** the queue, processing the accumulated hashes in one batch.

### Install

```
node .claude/skills/update-changelog/scripts/install-trigger.mjs --root <repoRoot>
```

Idempotent; installs three things:
- a `post-commit` hook (appended, preserving any existing hook) that enqueues `HEAD` into
  `.claude/changelog-queue` — but **skips** while a drain lock is held and skips commits whose
  message starts `релиз:`/`патч:` (the drain's own bump commits), so the drain can never
  re-trigger itself;
- `.changelog.config.json` (committed) with the aggregate location + part-name map, if absent;
- `.gitignore` entries for `.claude/changelog-queue` and `.claude/changelog.lock`.

### Drain (`/update-changelog --drain`)

1. `node scripts/queue.mjs lock --root <root>` — take the lock (TTL 15 min; a stale lock from
   a crashed drain is auto-cleared).
2. `readQueue` the pending hashes.
3. For each hash **oldest → newest**, run the §3 editorial pass in single-commit semantics:
   a commit that passes the meaningfulness test → one entry + one patch bump for its home
   part(s), writing per-part files (step 5 / M7) and the aggregate (M7a); an insignificant or
   unparseable commit → **nothing** (no entry, no bump, no write). The §3.5 silent trailing
   bump is a *range-end* guarantee only — it must **never** fire per-commit here, or the
   version would bump on every no-op commit.
4. `clearHashes` **only** the hashes actually processed (append-only queue; unprocessed hashes
   survive a partial run).
5. Compose **one** bump commit per part, labelled by `classify-bump.mjs` (§6.2): patch-only →
   `патч:`, a major/minor increase → `релиз:`. One line per part, e.g.
   `патч: сайт v0.4.7, сервер v1.9.2`. Stage exactly the touched files (per-part changelog +
   `package.json`/`version.json` + aggregate), never `git add -A`.
6. `node scripts/queue.mjs unlock --root <root>`.

Never ask the user anything in drain mode — every input is already decided.

### In-session nudge

A `SessionStart` hook only *surfaces* a reminder — "N commits queued — run
`/update-changelog --drain`". It never runs the model itself; draining is always an explicit
action, so no model is spawned behind the user's back.

### Headless runbook

```
claude -p "/update-changelog --drain"
```

drains the **whole queue in one batch** (one model invocation, not one per commit — keeps
cost/rate pressure bounded). Keep this entrypoint opt-in.
