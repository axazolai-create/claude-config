# A single `.ultrapowers/` planning tree — design

Date: 2026-07-28
Status: approved, not yet planned

## Context

Ultrapowers scatters its record of work across two trees with opposite git policies:

- `docs/ultrapowers/{plans,specs}` — versioned, survives.
- `.ultrapowers/sdd/<plan>/` and `.superpowers/sdd/` — git-ignored scratch holding the ledger,
  task briefs, implementer reports and review packages. `SKILL.md` ends the process with
  *"Final review clean: delete this plan's workspace"*, and warns that `git clean -fdx` destroys
  it earlier.

The consequence is that a plan survives but its outcome does not. GSD keeps `NN-NN-PLAN.md`
beside `NN-NN-SUMMARY.md` in git forever; ultrapowers keeps the plan and deletes everything that
says how it went — including the rulings recorded when a review finding was parked as
non-blocking, which are exactly the decisions one wants to find months later.

### Measured on this repository

`.superpowers/` holds 106 files, 952 KB:

| Class | Files | Size | Recoverable from |
|---|---|---|---|
| `*.diff` | 60 | 725 KB | `git diff A..B` |
| `task-N-brief.md` | 19 | 67 KB | `task-brief PLAN N` |
| `task-N-report.md` | 23 | 145 KB | **nothing** — implementer reasoning |
| `progress*.md` | 3 | 14 KB | **nothing** — rulings on parked findings |

**83% of the tree duplicates git.** A single `review-94a0997..d7f4d8e.diff` is 130 KB and is
literally the output of `git diff 94a0997..d7f4d8e`. Only 159 KB is irreplaceable, and it is not
just the ledger: the reports carry the reasoning, the ledger carries chronology and rulings.

## Target layout

One tree, everything in git, with exactly one ignored subdirectory:

```
.ultrapowers/
  PROJECT.md          purpose, domain specifics, global goals
  ROADMAP.md          planned work as a checklist, ticked as it lands
  STATE.md            what is happening now and how to resume
  SUMMARY.md          global summary across phases
  GLOSSARY.md
  RISK_REGISTER.md
  docs/               artefacts and external sources, not process records
  phases/NN-slug/     NN-SPEC, NN-PLAN, NN-SUMMARY, NN-VERIFICATION, NN-REVIEW
  tasks/              quick work, same file set, shorter
  adhoc/              unplanned, out-of-phase work
  sdd/                *** the only git-ignored path ***
```

`sdd/` keeps its self-ignoring `.gitignore` (`*`) and holds what is convenient to have during the
work and worthless afterwards: diffs, briefs, the in-flight ledger, review packages. Losing it
costs nothing — by construction, everything in it is either derivable from git or already folded
into a SUMMARY.

`docs/` moves inside the tree and changes meaning: it is for artefacts and external sources, not
for the record of how work proceeded. `docs/ultrapowers/plans` and `docs/ultrapowers/specs`
disappear; `.superpowers/` disappears with them, being the pre-rebrand name.

## Phase granularity — five files, not thirty

A GSD phase in a live project holds 30 files, and its `phases/` tree reaches ~184k tokens over
two phases. That granularity is a product of GSD's agent roster: a separate researcher writes
RESEARCH, a pattern-mapper writes PATTERNS, planner writes PLAN, executor writes SUMMARY,
verifier writes VERIFICATION, plus ui/security/eval auditors.

Ultrapowers has six skills that produce a document at all:

| Skill | Artefact |
|---|---|
| `brainstorming` | `NN-SPEC.md` |
| `writing-plans` | `NN-PLAN.md` |
| `subagent-driven-development` | `NN-SUMMARY.md` |
| `requesting-code-review` | `NN-REVIEW.md` |
| `systematic-debugging` | `NN-DEBUG.md` |
| `verification-before-completion` | `NN-VERIFICATION.md` |

`test-driven-development`, `using-git-worktrees`, `finishing-a-development-branch` and
`dispatching-parallel-agents` produce none. So a phase is ~5 files against GSD's 30 — the
branching follows the skills that actually write, which is what keeps this from becoming
ceremony.

## What a SUMMARY contains

Written at the end of the work, from the ledger **and** the reports. This replaces today's
final step, *"Final review clean: delete this plan's workspace"* — but only its deletion half.
The SUMMARY is written; the workspace **stays**. Diffs and briefs remain on disk, at hand, for as
long as they are useful.

Clearing `sdd/` becomes a separate, deliberate act — a janitorial one, in the same family as
`/claude-cleanup` — rather than the closing move of every plan. Nothing is lost when it happens,
which is precisely why it need not happen on a schedule.

- tasks with their commit ranges — chronology plus an entry point into `git log`;
- rulings: which review findings were parked and on what grounds;
- from the reports: deviations from the plan and decisions taken along the way — extracted, not
  copied wholesale;
- for each review, **both** the workspace path and the hash range:
  `sdd/<plan>/review-94a0997..d7f4d8e.diff` — `git diff 94a0997..d7f4d8e`.

Two references rather than one, because they fail at different times. While the work is live the
file is right there and opening it beats regenerating it — that is the whole point of keeping
`sdd/` on disk instead of deleting the workspace. Once `sdd/` is cleared the path goes stale, and
the hash range still reconstructs the same diff exactly. A SUMMARY carrying only the path would
rot; one carrying only the range would make you regenerate what is already sitting next to you.

What is never *archived into git* is the diff content itself — 725 KB of it here, byte-identical
to what `git diff` already stores. The file stays available for as long as the workspace does.

Expected size: 15–30 KB for a large plan, against 952 KB on disk today — and with *more*
provenance retained, because it lands in git.

## Lazy creation

No file is scaffolded empty. `PROJECT.md` and `ROADMAP.md` appear when there is something to put
in them; a one-hook fix needs neither. This mirrors how `grill-with-docs` treats its glossary and
ADRs — created at the moment the first entry exists.

## Migration

Three distinct strata exist today and need different handling:

1. **`.superpowers/sdd/archive-graphify-neo4j`** — finished work, manually set aside. Fold
   `progress-graphify-neo4j.archive.md` plus ten `task-*-report.md` into one SUMMARY; drop 34
   diffs.
2. **The flat `.superpowers/sdd/*` root** — the pre-plan-scoped format that `SKILL.md` itself
   calls a "stray ledger at the old flat path". Holds the work finished 2026-07-26. Fold the same
   way.
3. **`2026-07-27-ultrapowers-layer0-patcher`** — the only plan-scoped directory, work is recent.
   Check whether it is complete; fold it or leave it running.

## Risks

- **ROADMAP and STATE both answer "where are we".** Split by tense: ROADMAP is what is planned
  and what is ticked; STATE is what is happening right now and how to resume. Ticks live in
  ROADMAP only, and STATE points at them rather than restating them.
- **Drift.** These files rot unless something notices. The nudge hook from the decision-records
  design covers it: a phase committed with an untouched SUMMARY is worth one line of output.
- **Context weight.** The top level runs ~14k tokens in a mature project. It is not auto-loaded —
  GSD reads `.planning` on demand and this tree works the same way — so the cost is paid on
  access, and it replaces re-explaining the project every session.

## Out of scope

- Phase numbering semantics borrowed wholesale from GSD (`NN-NN` per task).
- Any automatic conversion of this tree into `.planning/` — `/gsd-ingest-docs` already covers the
  base-to-full move via `docs/adr/` and `docs/specs/`.
- Retaining diffs or briefs under any policy.
