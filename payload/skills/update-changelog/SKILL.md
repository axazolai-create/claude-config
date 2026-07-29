---
name: update-changelog
description: Backfills a project's changelog.json from git history — commits become Russian, end-user-facing entries, and the version moves once per run by the level the commits imply. Use when the user runs /update-changelog (incl. --drain), asks to "update the changelog", "generate changelog entries from commits", "bump the version and changelog", or wants git history turned into release notes. For any Node project with a package.json — a part with a React/Next frontend gets a rendered changelog.json, one without still gets versions; single project or monorepo (per-part changelogs plus one aggregate cross-part feed; config in .changelog.config.json). Not for generic CHANGELOG.md / Keep-a-Changelog projects.
---

# Update Changelog

Turns a slice of git history into entries in `changelog.json` and moves `package.json` /
`version.json` **once**, by the level those commits imply (§4). Output is Russian,
human-readable, and stripped of every trace of AI tooling, GSD, and internal implementation
detail — it's release notes for a shop-floor operator, not a commit log. Finishes by
committing exactly the files it touched, tagged `vX.Y.Z`.

## 0. Detect — monorepo check, then React/Next

Run `node ~/.claude/skills/update-changelog/scripts/list-workspaces.mjs` from the repo root
first. If `isMonorepo` is `true` (2+ directories with their own `package.json`), stop here
and follow **Monorepo mode** below instead of the rest of this section — it re-uses steps
1–4 per workspace, so read those first, but the outer flow (which commits touch which part,
how versions bump, how the final commit is composed) is different.

If `isMonorepo` is `false`, continue as a single project:

Run `node ~/.claude/skills/update-changelog/scripts/detect-project.mjs` from the repo root.

`isReactOrNext` no longer decides whether to run. It decides only whether a **rendered
changelog** belongs here:

- `isReactOrNext: true` — this part has a changelog UI. Write `changelog.json` and bump.
- `isReactOrNext: false` — this part has no UI of its own. Bump the version with
  `write-changelog.mjs --version-only`, and let its entries appear in the frontend parts'
  changelogs (Monorepo mode, §M7a). A backend still gets versions and still contributes
  entries; it simply has nowhere of its own to show them.

Any Node project with a `package.json` is in scope. The old gate is what excluded every Node
project *without* a React/Next frontend — API backends, CLI parts, shared libraries — from
having a derived version at all.

What did not change is the `package.json` requirement itself. A repository without one is
still out of scope, and `detect-project.mjs` says so and exits 1 (`package.json not found at
repo root — not a Node project.`); so does `write-changelog.mjs`. Stop there rather than
reaching for `--version-only` — there is nothing to write a version into.

In a **single** project with no frontend, `--version-only` is the whole write: the version
moves, no `changelog.json` is created, because nothing would render it — the record is the
version and the history behind it. A **monorepo** with no frontend part anywhere is the one
exception: §M7 puts a single changelog at the repository root, because its parts still need a
shared destination.

The same call also tells you:
- `changelogPath` — where `changelog.json` lives (repo root or `src/`), or where it *would*
  be created if `changelogExists` is `false`.
- `baselineVersion` — the version to start bumping from (top entry of `changelog.json` if it
  has any, else `package.json`'s current version). No "v" prefix.
- `versionJsonPath` — `null` if the project has no `version.json`; `write-changelog.mjs`
  rewrites it only when it already exists, so there is nothing to do in that case.

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
node ~/.claude/skills/update-changelog/scripts/list-commits.mjs --branch <branch> --since <startHash>
```

Returns oldest-first JSON: `[{ hash, subject, body }, ...]`. This walks **full history**
reachable from the branch tip after `since` — including commits brought in through a regular
(non-squash) merge, not just the first-parent line (a single regular merge can carry
dozens of real commits).

## 3. Editorial pass — the actual work

Process commits **oldest to newest**. For each one, decide: skip it, or turn it into one line
of the run's changelog entry. This needs judgment, not pattern matching — deciding "is this
meaningful to a shop-floor operator" and rewriting it in natural Russian. The version is not
decided here: it falls out of the commit types, once for the whole run (§4).

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

### 3.4 Compose the lines

A run writes **one** entry per part (§5); each surviving commit contributes lines to its
`changes[]`:

- a **prefixed line** — `"{prefix}: {Russian sentence describing the user-facing effect}."` —
  natural, concise, capitalized like a sentence, ends with a period.
- optionally, at most 1–2 more plain Russian sentences (**no prefix**) pulled from the commit
  body, only if they add genuinely new information beyond the title, after the same stripping
  pass. Most commits contribute just the prefixed line — single-line contributions are the
  norm, extra bullets the exception.

**Worked example** (illustrative):

```
Input commit:
feat(16-01): DKP-02 soften dark text.primary token to #C9D1D9

- AppColorsDark.textPrimary: '#E6EDF3' → '#C9D1D9' (GitHub-style muted white)
- Light scheme AppColors.textPrimary (#0F172A) unchanged per D-03
- Cascades globally to all pages using text.primary in dark scheme

Its lines in changes[]:
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

Skip the commit — it contributes no line. It still contributes its **level** (§4), which for
an unparseable subject is `none`. There is no silent trailing bump: the version follows the
commit types, not the endpoint of the range, so a range that ends on an unparseable commit
needs no special handling and a range of nothing but `docs` and `chore` ends where it started.

## 4. Version bumping

The level is **derived from the commits**, and the version moves **once**, by the maximum
level accumulated across the whole range or drain — not once per entry.

| Commit | Level |
|---|---|
| `feat:` | minor |
| `fix:`, `perf:`, `refactor:`, `build:` | patch |
| `docs:`, `chore:`, `test:`, `style:`, `ci:` | no bump |
| `feat!:`, any type with `!`, `BREAKING CHANGE:` in the body | proposes major — never applies it |
| anything with no recognised type | no bump, counted as `unrecognised` — surfaced by `lint-versions.mjs` |

A range holding one `feat` and six `fix` yields a single minor. A range holding only `docs`
and `chore` yields **no bump at all**: the version is not a commit counter.

**Major is never automatic.** When a proposal surfaces — from your own classification in manual
mode, from `lint-versions.mjs` in automated mode (below) — stop and ask, quoting the reason it
gives. Without approval, fall back to minor and say that you did. This departs from strict
SemVer deliberately — a major is a promise to consumers, an unwanted one is effectively
irreversible once published, and the cost of waiting is one question.

A proposal comes only from an **explicit marker**: a `!` on the type, or a `BREAKING CHANGE:`
footer in the body. Volume never triggers one — a range of forty `feat` commits is still a
single minor, with no question asked.

In **manual** mode you classify the range's commits yourself, by the table above — that is
where "stop and ask" happens, and where the `unrecognised` count in your report comes from.
Don't invent a different rule.

In **automated** mode the two roles are split between two scripts, and it matters which one
you ask.

`node ~/.claude/skills/update-changelog/scripts/queue.mjs drain --root <root>` returns
`{ level, proposals, unrecognised, hashes }`, but it answers exactly one question: **by what
level does this batch move**. An entry the trigger already classified is taken at its recorded
level and never re-read, so `proposals` and `unrecognised` stay empty for it — they fill in
only for the bare hashes an older trigger left behind. A silent `drain` therefore does **not**
mean "no breaking commit, nothing unparseable". Never read it that way.

Disclosure is `lint`'s job:

```
node ~/.claude/skills/update-changelog/scripts/lint-versions.mjs --root <root>
```

It re-reads **every** queued commit from `git log`, recorded level or not — a recorded level is
only what the trigger saw at commit time, and re-reading is the only way to notice history has
drifted from it. One line per problem on stderr: queued commits with no recognised type (a
commit that bumps nothing would otherwise vanish without a trace), queued hashes `git log` can
no longer resolve, a version-bump commit that reached the queue (so a version moved outside a
drain), and any major proposal still awaiting approval. Exit 1 when it found something, 0 and
silent when it did not, so a script can branch on it.

Run it **unconditionally** before a drain writes (drain step 2), not on a trigger from `drain`'s
output, and offer to look at the commits it names.

**What is decided by code, and what is not.** Code decides: the level from the commit type,
which files each commit changed (`list-changed-files.mjs`), whether a frontend part exists,
where the changelog file belongs. A human or the model decides, working from those outputs:
which workspace(s) a commit belongs to — the `relDir` prefix match of §M3 — the root version
from the parts' bumps plus root commits (§M6), whether a major is warranted, whether another
part's change is relevant here, the Russian wording of an entry, and whether a change is
meaningful at all (§3.1). Automating the second column produces confident nonsense.

## 5. Write the files

One run, one version (§4), so one entry — its `changes[]` holds every surviving commit's
lines in processing order (oldest → newest). Newest-first ordering is how `changelog.json`
itself is sorted, and `write-changelog.mjs` prepends, so the run's single entry lands on top.
Write it to a scratch JSON file:

```json
{
  "entries": [
    { "version": "v0.4.0", "changes": ["feat: ...", "fix: ...", "fix: ..."] }
  ],
  "finalVersion": "0.4.0"
}
```

Then apply it:

```
node ~/.claude/skills/update-changelog/scripts/write-changelog.mjs --entries-file <scratch-path>
```

This prepends the entries to `changelog.json` (creating it at the repo root if it doesn't
exist anywhere yet), updates `package.json`'s `version` field in place (regex replace,
doesn't reformat the rest of the file), and rewrites `version.json` if the project has
one — all without the `v` prefix in those two files (`changelog.json` uses `"v0.4.0"`,
`package.json`/`version.json` use `"0.4.0"`).

For a part that bumps but renders nothing (§0), skip the scratch file and pass the version
directly — `changelog.json` is left untouched and the reported `changelogPath` is `null`:

```
node ~/.claude/skills/update-changelog/scripts/write-changelog.mjs --version-only --final-version 1.9.0 --root <dir>
```

If §4's level is `none`, there is nothing to write at all: no entry, no version move, no call.
The table wins over the editorial pass — if a `docs`/`chore` commit survived §3.1 and its line
now has no version to sit under, say so and leave both alone. That mismatch almost always
means the commit was mis-typed, which is worth a sentence in the report and nothing more.

## 6. Commit

Stage **exactly** the files `write-changelog.mjs` reported touching (`changelogPath`,
`packageJsonPath`, and `versionJsonPath` when non-null; under `--version-only` the first of
those is `null` and there is nothing to stage for it) — never `git add -A` / `git add .` —
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

Summarize in Russian: how many commits were processed, how many became lines vs. were
skipped and why (in general terms — no need to relitigate each one), the final version, which
files changed, and the commit hash/message just created. Report three things about the version
specifically: the level §4 settled on and which commit type set it, any major proposal and how
it was resolved (approved, or fallen back to minor), and the `unrecognised` count when it is
non-zero. In drain mode those last two come from `lint-versions.mjs`, not from `drain` (§4).
If the level was `none`, say that the version deliberately did not move.

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
node ~/.claude/skills/update-changelog/scripts/list-commits.mjs --branch <branch> --since <startHash>
node ~/.claude/skills/update-changelog/scripts/list-changed-files.mjs --branch <branch> --since <startHash>
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
  `packages/*` outside the app dirs, CI config, root `README`) → no workspace is its home.

Every frontend part's changelog carries, besides its own detailed entries, entries originating
in **other** parts — including other frontend parts — in reduced form.

Reduction is about **density, not wording**. The filter is relevance to *this* part's users:

- a backend's character-encoding change: omitted — invisible from this frontend;
- a new endpoint for external integrations: included — it changes what this frontend can offer.

The entry is written in the same voice as any other. It is chosen, not softened.

A commit that belongs to no workspace is **not** dropped. It belongs to the repository root,
which carries its own version (§M6).

### M4. Home entry — unchanged

Run §3 (the editorial pass) exactly as written against the commit's home workspace(s). This
is the detailed, precise Russian entry — same rules, same prefix mapping, same stripping.

### M6. Version bumping — independent per part, once per run

Each part's version moves **once** in this run, from its own `baselineVersion` (from
`detect-project.mjs --root <dir>`), by the maximum level accumulated across the commits behind
the entries it receives — its own home commits and the reduced cross-part entries of §M3
alike. All of a run's lines for a part share that one version, so a received entry counts
toward the level exactly like a home one; the reduction is in the text, not the arithmetic.
A part that receives nothing, or only `docs`/`chore`, does not move at all.

Parts will end up on different version numbers from each other — that's expected, not a bug;
there's no shared/lockstep version across the monorepo.

The repository root carries a version too: the maximum of the parts' bumps in this drain,
combined with its own root-level commits. This closes the hole where a root-level commit
belonged to no workspace and was therefore dropped entirely.

### M7. Write the files

**Where the changelog file goes:**

- no frontend part (`detect-project.mjs` reports `isReactOrNext: false` everywhere) → a single
  changelog at the repository root;
- one or more frontend parts → one changelog **inside each frontend part**, at that part's own
  `changelogPath`.

Parts stay independently versioned. There is no lockstep across the monorepo, by design.

Build one entries-list + `finalVersion` per **destination** part (same shape as step 5), then
apply each with its own `--root`:

```
node ~/.claude/skills/update-changelog/scripts/write-changelog.mjs --entries-file <scratch-web.json> --root apps/web
node ~/.claude/skills/update-changelog/scripts/write-changelog.mjs --entries-file <scratch-backend.json> --root apps/backend
node ~/.claude/skills/update-changelog/scripts/write-changelog.mjs --entries-file <scratch-mobile.json> --root apps/mobile
```

A source-only part — a changelog-less backend — still gets a call, just without entries:

```
node ~/.claude/skills/update-changelog/scripts/write-changelog.mjs --version-only --final-version 1.9.0 --root apps/backend
```

Its version moves like everyone else's (§0, §M6); only the rendering is absent, and its
changes reach users through the frontend parts' reduced entries (§M3). The repository root is
written the same way — `--version-only --root .` — unless the placement rule above already
puts a changelog there.

### M7a. Write the aggregate

For each **home** entry written to a part's own `changelog.json`, also emit an aggregate entry
`{ version, name, date, changes }` where `name = partName(config, relDir)` (from
`config.mjs`) and `date` = the commit's author date in ISO 8601 UTC (e.g.
`2026-02-01T04:05:06Z`). Collect all such entries for the run into a scratch JSON array and
apply once:

```
node ~/.claude/skills/update-changelog/scripts/write-aggregate.mjs \
  --file <aggregatePath> --entries-file <scratch-aggregate.json>
```

Reduced cross-part entries (§M3) are **not** aggregated again. The aggregate already carries
the originating part's own entry; adding the reduction would show one change twice, under two
part names.

`aggregatePath` comes from `.changelog.config.json` (`aggregatePath(config)`); the file is
upserted (key `name|version`, last write wins) and re-sorted by `date` descending on every
run. If there is no config or it defines no aggregate, skip this step with a warning —
per-part changelogs still work without it.

### M8. Commit — one combined commit is fine

Unlike the single-project flow (step 6, one commit per run), a monorepo update naturally
touches every moved part's `package.json` (+ `version.json`, + `changelog.json` where one is
rendered) at once — it's fine to stage and commit all of them together rather than one commit
per part. Stage exactly the files each `write-changelog.mjs` call reported touching **plus**
the aggregate file (`aggregatePath`, when M7a ran), nothing else (never `git add -A`), and
compose the message as one line per part that moved — including `--version-only` parts, whose
version moved even though no changelog did:

```
git commit -m "web: v0.4.7, backend: v1.9.2, mobile: v2.3.1"
```

Order parts alphabetically by `relDir` for a stable, diffable message. If the user prefers
separate commits per part instead, that's a reasonable alternative — ask if it isn't already
obvious from how they work.

### M9. Report back

Same spirit as step 7, per part: how many commits were attributed as home entries for each
destination, how many reached it as reduced cross-part entries (§M3), each part's final
version and the level behind it, and the commit(s) created. Also report the aggregate
feed — how many entries were upserted into it and where it lives (`aggregatePath`) — or note
that it was skipped because no `.changelog.config.json` aggregate is configured.

## Automated mode (queue + drain)

An enqueue-then-drain trigger turns everyday commits into changelog entries without anyone
running the range flow by hand. A native `post-commit` hook **enqueues** each commit's hash;
the AI skill later **drains** the queue, processing the accumulated hashes in one batch.

### Install

```
node ~/.claude/skills/update-changelog/scripts/install-trigger.mjs --root <repoRoot>
```

Idempotent; installs three things:
- a `post-commit` hook (appended, preserving any existing hook) that enqueues `HEAD` into
  `.claude/changelog-queue` — but **skips** while a drain lock is held and skips commits whose
  message starts `релиз:`/`патч:` (the drain's own bump commits), so the drain can never
  re-trigger itself. It enqueues `<hash> <level>`, classifying the commit at commit time
  (`queue.mjs append --classify`); if that classification fails the hash is still queued, bare,
  and gets classified at drain time instead. The line carries the **level and nothing else** —
  a breaking marker leaves no trace in the queue, which is why `lint` re-reads the commits
  rather than trusting it (§4). Nothing walks history at install time, so adopting the trigger
  on an existing project never moves its version retroactively;
- `.changelog.config.json` (committed) with the aggregate location + part-name map, if absent;
- `.gitignore` entries for `.claude/changelog-queue` and `.claude/changelog.lock`.

### Drain (`/update-changelog --drain`)

1. `node scripts/queue.mjs lock --root <root>` — take the lock (TTL 15 min; a stale lock from
   a crashed drain is auto-cleared).
2. `node scripts/queue.mjs drain --root <root>` — the batch's level in one call:
   `{ level, proposals, unrecognised, hashes }`. Entries queued with a level are used as-is;
   bare hashes left by an older trigger are classified here from their `git log` subject/body.
   `level` is already the maximum across the batch — this is §4's single move, computed.
   Then `node scripts/lint-versions.mjs --root <root>` — **always**, not only when `drain`
   reported something. `drain` trusts each entry's recorded level, so for a trigger-queued
   commit its `proposals` and `unrecognised` are empty by construction (§4); `lint` re-reads
   every queued commit and is the only thing that names a breaking marker, an unparseable
   subject, or a hash that has drifted out of history. It changes nothing about what gets
   written — it is what you report.
3. For each hash in `hashes`, **oldest → newest**, run the §3 editorial pass: a commit that
   passes the meaningfulness test contributes its lines to its home part(s); an insignificant
   or unparseable commit contributes nothing. Then write **once** per part (step 5 / M7) at the
   version `level` implies, plus the aggregate (M7a). If `level` is `none` there is no write at
   all — an all-`chore` batch leaves every version where it was. If step 2's `lint` named a
   major proposal, drain mode has nobody to ask and `level` has already fallen back to minor —
   don't act on it, disclose it: quote the reason in the report, verbatim.
4. `clearHashes` **only** the hashes actually processed (append-only queue; unprocessed hashes
   survive a partial run). A `level: none` batch processed nothing, so clear nothing: those
   hashes stay queued and are written out by the first later drain that does move a version.
5. Compose **one** bump commit per part, labelled by `classify-bump.mjs`'s
   `classifyBump(oldVersion, newVersion)`: patch-only → `патч:`, a major/minor increase →
   `релиз:`. One line per part, e.g. `патч: сайт v0.4.7, сервер v1.9.2`. Those two Russian
   words are load-bearing — the post-commit hook matches them literally to know not to
   re-enqueue its own bump commit. Stage exactly the touched files (per-part changelog +
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
