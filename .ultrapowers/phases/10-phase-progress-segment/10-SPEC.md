# Phase and task progress in one segment — design

Date: 2026-07-31
Status: approved, not yet planned

The ultrapowers segment today prints one phase's task tally and its status. This phase makes
it answer the question a glance actually asks — *how far is this project, and what is
happening in it right now* — by giving it three display modes, five colour states, and a
current-action field that the state files do not have yet.

## Context

Phase 08 settled where the segment's facts come from, in strict order: `ROADMAP.md`'s
frontmatter `current:` names the phase in flight; failing that, the single phase whose
`status` is `running`, but only when exactly one matches; failing that, the newest SDD ledger
under `.ultrapowers/sdd/`. `statusline.mjs` implements it as `upState(root) = phaseSegment(root)
|| sddState(root)`, and `renderPhase` prints `NN (done/effective) status` — for example
`09 (2/6) running`.

Two things are wrong with that, and only the second is a bug.

The first is that the segment reports a life cycle where the reader wants an activity.
`running` is true of a phase being planned, being executed and being reviewed alike, so the
one word that changes least is the one on screen. The second is that with `current: null` —
the honest value between phases — `phaseSegment` returns nothing and the bar falls through to
the newest SDD ledger, rendering a finished plan's task tally as though it were live. The
roadmap records this as a known display defect and points here for the fix.

The GSD segment is not involved. `render()` composes `gsd` and `up` as independent segments
joined by `│`, and `gsdActive()` requires both an installed gsd-core and a project
`.planning/config.json`. Two trees can be present at once and each gets its own segment;
there is no contest for the position and therefore no disagreement to resolve. The open
question recorded as "what does it do when two trees disagree" is answered by construction.

## The vocabulary comes first

The status model ruled on 2026-07-29 is a precondition, not a side quest: this segment reads
the fields it renames, so doing it separately would mean touching every state file twice.

- **`status`** — the phase's life cycle only: `planned`, `running`, `blocked`, `complete`,
  `superseded`, `abandoned`. A `superseded` phase must carry `superseded_by` (already applied
  to phase 03 on 2026-07-31).
- **`delivery`** replaces `integration`: `branch`, `merged`, `deployed`. Nothing in the code
  reads `integration` — the rename is a documentation change with no reader to break.
- **`action`** — new, and the point of this phase: what is being done in the phase right now.
  A phase's status and its current activity are different facts, and one field holding both
  loses one every time the other is written.
- **Task counters** — `tasks_active`, `tasks_fixing` and `tasks_blocked` join the existing
  `tasks_total`, `tasks_done` and `tasks_dropped`.

The queue is **not** a field. It is `total - dropped - done - active - fixing - blocked`.
Storing it would create a seventh number free to disagree with the other six, and a state file
that contradicts itself is what this whole model exists to prevent.

## Three sources, and what each one actually knows

The counters come from `NN-STATE.md` frontmatter refined by the SDD ledger when a live one is
present — the ruling already taken. What this design adds is *which* source is trusted for
*what*, so that "refined by" is a rule rather than a preference.

| Source | Trusted for | Why |
|---|---|---|
| `ROADMAP.md` frontmatter | `current`, the phase list and its statuses | the only place that knows about phases as a set |
| `phases/NN-*/NN-STATE.md` | `action`, `tasks_fixing`, `tasks_blocked` | facts recorded nowhere else; a fix loop and a blocker are judgements, not artefacts |
| the live SDD ledger | `tasks_total`, `tasks_done`, `tasks_active`, and whether tasks are executing at all | it holds `task-N-brief.md` and `task-N-report.md` files — counting them is structural |

The ledger is read **structurally, never as prose**: briefs give the total, reports give the
done count, and a brief without its report is an active task. No line of the ledger's text is
parsed, so its wording can change freely without touching the renderer. This is what makes the
ledger safe to trust over frontmatter that may be minutes stale.

When there is no live ledger — the phase is closed, or has not started — frontmatter answers
everything. The ledger is gitignored and vanishes with the phase, which is exactly why it
cannot be the only source.

## Mode selection

Wholesale, not by substituting parts: in the first two modes the leading token is one phase's
id, in the third it is a tally across all phases and no id appears at all. Different kinds of
thing in the same position.

1. A live ledger holds a brief without its report → **executing**. "Live" means the ledger
   directory for the *resolved* phase exists — `.ultrapowers/sdd/phases-NN-<slug>/`. A ledger
   belonging to any other phase is never consulted, which is the precise thing that goes wrong
   today.
2. Otherwise a phase resolves (by `current`, else the single `running` phase) → **named
   action**.
3. No phase resolves → **tally**, naming the highest-numbered non-`abandoned` phase.

Note what this fixes: mode 3 is reached deliberately when `current: null`, instead of falling
through to a stale ledger. The ledger stops being a fallback source of a *phase* and becomes
what it always was — evidence about tasks inside one.

## The three modes

```
mode 1  executing      09 2/1/3 — phase-progress-segment
        ... with one blocked task:
                       09 2/1/3/1 — phase-progress-segment
mode 2  named action   09 (planning) phase-progress-segment
mode 3  tally          8/9 phase-progress-segment
```

The blocked line is not a fourth mode — it is mode 1 with its optional position present.

The phase id stays alongside the name in both phase modes: the number is how a phase is
addressed in `ROADMAP.md` and in its directory name, the name is what it is about, and neither
substitutes for the other. The fourth number is appended **only** when `tasks_blocked` is
non-zero — a position that is almost always `0` teaches the eye to skip it, and then it is not
a signal when it finally isn't.

## Five colour states on four positions

The counters carry four positions and five states; the second position resolves both.

| Position | State | Colour |
|---|---|---|
| 1st | done | green |
| 2nd | active | cyan |
| 2nd | any of them in the fix loop | yellow |
| 3rd | queued | uncoloured |
| 4th | blocked | red |

The second position counts `active + fixing` together and turns yellow when `tasks_fixing` is
non-zero. This keeps the format the user specified and still gives the fix loop its own
colour, which is what keeps red rare enough to mean something: a task inside a fix round is
still in flight, not failed. Had this rendered during phase 09, the segment would have been
yellow on each of its three tasks and never red.

Only numbers are coloured — separators and the em dash stay plain, so the colour marks a
quantity rather than decorating the line. In the named-action mode the action is cyan, or red
when `status: blocked`. In the tally mode the numerator is green and the denominator plain.

## What the tally counts

Every phase except `abandoned` ones. At the moment this design was written the tree held nine
phases, eight of them `complete`, so the segment read `8/9`. Registering this phase in the
roadmap makes it ten, and the segment reads `8/10` until it completes — the examples above use
the nine-phase tree and are illustrative, not a fixture.

This is the user's decision, taken against the alternative and knowing its consequence: phase
03 is `superseded` and will never become `complete`, so the counter cannot reach `9/9` while
it exists. The reasoning is that the denominator should say how many phases this project has
had, not how many are still capable of completing — a tally that quietly drops work from the
record to make itself tidy is the more misleading of the two.

## Failure is an empty segment, never a broken line

The rule phase 09 established for the context segment applies unchanged: rendering the segment
is never a precondition for printing the line. Any throw while reading or colouring yields an
empty segment and the rest of the bar renders.

Two degradations are specified rather than left to chance:

- **Contradictory counters.** If the queue computes negative, the segment prints the named
  action instead of the numbers. Showing arithmetic that is provably wrong is worse than
  showing no arithmetic.
- **Missing `action`.** If a phase resolves but has no `action`, the segment prints the id and
  the name alone. It never invents a word for what is happening.

## New units

`payload/hooks/lib/phase-segment.mjs`, holding two exported functions with one responsibility
each:

- `readPhaseState(root)` — all filesystem work: reads the roadmap, resolves the phase, reads
  its state file, counts the ledger's briefs and reports, applies the merge table above, and
  returns a plain object (`{mode, id, name, counts, action, status}`).
- `renderPhaseSegment(state)` — pure: object in, string out, including colour. Touches nothing.

`statusline.mjs` keeps only the wiring: `upState()` becomes
`renderPhaseSegment(readPhaseState(root))` inside the existing `safe()`. `renderPhase` and
`sddState` are deleted — the first is replaced by the three modes, the second by mode 3, which
is the correct answer to the case `sddState` was covering wrongly.

## Testing decisions

- **Rendering is verified as a pure function.** Three modes, five colour states, the appended
  fourth number and both degradations are asserted on objects passed straight to
  `renderPhaseSegment` — no fixture tree, no temp directory, no mtime.
- **Reading is verified on a fixture tree** in a temp directory: the merge table, the ledger
  outranking stale frontmatter for `done`/`active`, frontmatter answering alone when no ledger
  exists, and mode selection across the three cases.
- **The line survives a broken segment** — already covered by `statusline.test.mjs`; this
  phase extends the existing assertion to the new unit rather than adding a parallel one.

The vocabulary migration is documentation and needs no test of its own: no code reads
`integration`, and the fields the renderer does read are covered by the two seams above.

## Risks

- **`action` is written by people, and people forget.** A field nobody updates prints an
  activity that ended an hour ago. Mitigated structurally rather than by discipline: whenever
  tasks are actually executing, the live ledger takes over mode selection and the counters, so
  the stalest `action` can mislead only in the quieter modes. Worth filing with an ID during
  the phase.
- **`8/9` never converges** while phase 03 stays `superseded`. Accepted above, deliberately.
- **`RISK-TESTUNIT-001` applies here too.** This phase adds tests to `payload/`, which is
  tracked, so it does not add to the hidden-suite problem — but "the full suite passes" still
  means two invocations, and `node --test` from the root will not collect `.test/unit/`.

## Out of scope

- The GSD segment, and anything about gsd-core.
- The `.protected` mechanism and the decision-records CLI — their own phases.
- The context segment delivered by phase 09.
- **Changing the fork's skills.** If `action` turns out to need `executing-plans` to write it
  under instruction, that is a second repository and a fork republish, and it is separate
  work. This phase ships the field, its contract in the tree's rulings, and a renderer that
  degrades honestly when the field is absent.

## Depends on

- Phase 08's resolution order and `render()` composition, which this phase narrows rather than
  replaces.
- Phase 09's `safe()` discipline for segments.
- The status model ruled 2026-07-29, applied here in full for the first time.
