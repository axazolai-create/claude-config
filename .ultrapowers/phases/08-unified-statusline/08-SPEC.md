# One statusline for every profile — design

Date: 2026-07-30
Status: approved, not yet planned

## Context

The bar is currently a choice between two renderers, and the choice is made at install time.
`full` gets `hooks/gsd-context-meter.mjs`, which spawns gsd-core's own `gsd-statusline.js` as a
black box and rewrites one segment of its output. `base` and `lite` get `hooks/statusline.mjs`,
which renders the whole line itself. Neither renders a model segment: on `full` the model came
from gsd-core, and nowhere in this bundle is there code that produces it.

That split is the defect. The user's requirement is a composition, not an alternative:

- The line shows **always**, whatever plugins are installed.
- Its floor is pending component updates, the model, and context fill as **both a token count
  and a percentage** — the floor set on 2026-07-29 and recorded in `RESUME.md`.
- An active gsd-core **adds** its work status.
- The ultrapowers work status **adds** on every profile except `lite`.
- `lite` is the floor and nothing more.

A wrapper cannot express that. To put updates on the left of a line gsd-core has already
composed, the wrapper would have to regex-prepend into someone else's format; to avoid printing
the model twice it would have to regex-excise it. gsd-core's line is not a contract, so every
one of its releases could silently start duplicating or dropping a segment. And the wrapper's
one virtue — that gsd's segments always match whatever gsd currently ships — is worth nothing
once the requirement is that *we* own the line.

Three findings from 2026-07-29 constrain the design, all recorded in `RESUME.md`:

1. The GSD reader's regexes are **correct** against a real `.planning/STATE.md`. Phase 07's
   "format nobody verified" caveat is discharged; the parser is not the problem.
2. The milestone percentage it reads is **wrong at the source**. A real tree stated its progress
   three times and disagreed with itself — frontmatter `11/12`, roadmap checkboxes `14/15`, plans
   `95/95`, with `current_phase: 13` above `total_phases: 12`. A reader that trusts one field
   publishes a false number with full confidence.
3. Against **this** tree the bar is simply wrong. It renders a stale SDD ledger for a phase that
   is complete and merged, because `gsdState` requires `.planning/config.json` and `sddState`
   intercepts first. `ROADMAP.md` and `NN-STATE.md` are never read. Worse, `sddState` picks the
   "plan in flight" by file **mtime**, so a checkout changes what the bar claims.

Finding 3 is why selection below is deterministic and mtime is demoted to a tie-breaker.

## The line

One renderer, `payload/hooks/statusline.mjs`, for every profile. Six segments, joined by a dim
`│`, in this order:

```
⬆ ultrapowers │ Opus 5 (1M) │ 165.6K/1M 17% │ claude-config │ v1.0 [██░] 67% · Phase 3 executing │ 08 ✔2/6 running
```

| # | segment | shown |
|---|---|---|
| 1 | pending updates, **named** | when any component is pending |
| 2 | model | always |
| 3 | context — tokens **and** percent | when the payload carries usage |
| 4 | project name | always |
| 5 | gsd work status | when gsd-core is installed **and** active here |
| 6 | ultrapowers work status | on every profile except `lite` |

Updates are named, not counted, and they sit on the **left**. The count-on-the-right form
(`appendUpdatesSegment`, reached only from the wrapper) is deleted.

Segment 4 is the project name only. The git branch and its dirty/ahead flags are deliberately
not in the line — see Out of scope.

### Composition matrix

| profile | gsd-core active | line |
|---|---|---|
| `full` | yes | floor + gsd + up |
| `full` | no | floor + up |
| `base` | no | floor + up |
| `base` | yes, installed by hand | floor + gsd + up |
| `lite` | either | floor |

The two conditions are of different kinds on purpose, and that is the user's wording: gsd is
gated on **fact** (is it there and driving this project), ultrapowers on **profile**.

`profile` is read from `~/.claude/state/bundle-manifest.json`. An absent or unreadable manifest
fails **open** — the up segment shows — because only `lite` suppresses it, and a machine with no
manifest is more likely mid-install than deliberately `lite`.

## Where each segment comes from

| segment | source | cost per render |
|---|---|---|
| updates | `state/component-updates.json` → `pendingNames()` | 1 read |
| model | stdin `.model.display_name` | none |
| context | stdin `.context_window` | none |
| project | stdin `.workspace.current_dir ?? .project_dir`, basename | none |
| gsd | `<root>/.planning/STATE.md` | 2 stats + 1 read |
| up | `ROADMAP.md`, one `NN-STATE.md`, or an SDD ledger | 1–2 reads + 1 dir scan |

No subprocess. The line currently spawns `git status` on every render; that call goes away with
the git segment, so the new renderer spawns nothing at all.

Composition is one function, and it is the only place segment order is decided:

```js
export function render({ updates, model, context, project, gsd, up }) {
  return [renderUpdates(updates), model, context, project, gsd, up]
    .filter(Boolean)
    .join(DIM(" │ "));
}
```

`gsdCorePresent` is reimplemented locally as a single `existsSync` on
`<claudeDir>/gsd-core/VERSION` rather than imported from `bin/lib/gsd-core-detect.mjs`. That
module pulls in `claude-cleanup-lib.mjs` from another layer for helpers this predicate does not
need, and reimplementing small helpers instead of cross-importing is this repository's stated
convention.

## The context segment, and the bug it fixes

`statusline-lib.mjs` reads `data.context_window.total_tokens`. **That field does not exist in the
statusLine payload** — the documented name for the window size is `context_window_size`. Every
occurrence of `total_tokens` in this repository is self-authored, in our own tests and design
documents; no captured live payload exists anywhere in the tree. So `totalCtx` falls through to
the hardcoded `1_000_000` on every render, regardless of the model. It has looked correct only
because the machine that reported it was running a 1M-context session.

This is asserted from documentation, not from a live payload, so the plan owes a verification
step: capture one real statusLine payload and confirm the field name before relying on it. The
reader is defensive either way.

```js
export function computeContext(data) {
  const cw = data && data.context_window;
  if (!cw) return "";
  const total = cw.context_window_size ?? cw.total_tokens ?? 1_000_000;
  const u = cw.current_usage;
  const used = u
    ? (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) +
      (u.cache_read_input_tokens || 0) + (u.output_tokens || 0)
    : null;
  const pct = cw.used_percentage;
  if (used == null && pct == null) return "";
  const left = used != null ? used : (total * pct) / 100;
  return `${formatCurrentTokens(left)}/${formatContextWindow(total)}` +
    (pct == null ? "" : ` ${Math.round(pct)}%`);
}
```

The percentage is now the payload's own `used_percentage`, measured against the full window.
The buffer-normalisation arithmetic in `computeUsedTokenMetrics` — and with it the dependency on
`CLAUDE_CODE_AUTO_COMPACT_WINDOW` and the guessed 16.5% autocompact reserve — is deleted. That
arithmetic existed for exactly one reason: to make our number agree with gsd-core's bar. There
is no gsd-core bar any more.

The consequence is visible and intended: the same session that read `20.4%` against the usable
window reads `17%` against the full one. Both `current_usage` and `used_percentage` are
documented as null early in a session and after `/compact`; the segment then degrades to
whichever half survives, and disappears only when both are absent.

## Which work is in flight

Selection is deterministic. mtime decides nothing on its own.

**gsd segment.** Rendered only when all three hold: `<claudeDir>/gsd-core/VERSION` exists,
`<root>/.planning/config.json` exists, and `<root>/.planning/STATE.md` yields both a milestone
and a phase. Format is unchanged from `renderGsd`. Finding 2 above means its percentage can be
false at the source; that is gsd-core's file to fix, and this design neither corrects nor hides
it — it reports what the file says, because inventing a reconciliation across three disagreeing
fields would be a second false number rather than a fix.

**ultrapowers segment**, in strict order:

1. `.ultrapowers/ROADMAP.md` frontmatter `current:` names the phase in flight. Resolve it to
   `phases/<current>-*/`, read that `NN-STATE.md`.
2. `current: null` — no phase is running. Fall back to the phase whose `status: running`, but
   only if **exactly one** matches. Zero or several means the tree does not know, and the bar
   says nothing rather than guessing.
3. Only when no phase resolves at all, consult the newest SDD ledger under `.ultrapowers/sdd/`.
   Here mtime is the tie-breaker it always was, but it can no longer override a phase.

A phase renders as `NN ✔done/effective status`:

```
08 ✔2/6 running
```

`effective = tasks_total - tasks_dropped`. **The bar never computes a percentage for a phase.**
This is the direct answer to the user's ruling that a dropped task is a field and not a
sentence: `07-STATE.md` records `tasks_done: 6 / tasks_total: 7` and explains the retired
seventh task in prose, so any parser deriving a percentage publishes 86% for a phase that is
complete. Printing the tally and refusing to derive a percentage removes the trap without
waiting for the migration; `tasks_dropped` then makes the tally itself read `✔6/6`.

`tasks_dropped` is absent from every existing `NN-STATE.md`. It is treated as `0` when missing,
and writing it into the phases that need it belongs to the state-vocabulary migration, not here
— see Depends on.

A phase whose spec is approved but whose plan does not exist yet has no task tally at all. When
`tasks_total` is absent the segment renders the phase and its status alone — `08 planned` — and
never a `✔0/0`, which would read as a phase that had failed to do any of its work rather than
one that has not yet been planned.

## What is deleted

| removed | reason |
|---|---|
| `payload/hooks/gsd-context-meter.mjs` | the wrapper has nothing left to wrap |
| `payload/hooks/lib/gsd-context-meter-lib.mjs` | only `rewriteContextBar` was gsd-specific; the rest were re-exports |
| `rewriteContextBar` | there is no foreign bar to rewrite |
| `appendUpdatesSegment` | updates moved left, into the normal composition |
| `renderGit` and its `git status` call | the git segment is out of scope |
| buffer arithmetic in `computeUsedTokenMetrics` | existed only to match gsd-core's bar |

`setup.mjs` must migrate an existing registration. A `full` machine has
`statusLine.command` pointing at `gsd-context-meter.mjs`; once that file is gone the command
resolves to nothing and the prompt renders an empty line. The `ourStatusLine` predicate already
recognises both paths, so the fix is to make every profile's branch write `hooks/statusline.mjs`
— the `full`-only special case disappears along with the file it pointed to.

## Failure is a missing segment, never a missing line

Every source is wrapped so that its failure costs only its own segment. An empty line is an
acceptable result; an exception reaching the top level is not.

Two findings left Outstanding in `07-SUMMARY.md` are closed here, because both live in the file
being rewritten:

- **stdin never closing hangs the renderer.** There is no timeout on the data/end listener
  chain, inherited verbatim from `gsd-context-meter.mjs`. An `unref`'d timer now forces the
  flush and lets the process end.
- **`renderGsd`/`renderSdd` interpolate the literal `undefined`** when called with missing
  fields. Unreachable through the entry point, latent because both are exported. Guarded at
  entry.

## Testing decisions

Behaviour is verified at the **process boundary** — the renderer's actual stdout for a given
stdin payload. That seam already exists as `runEntry(payload(...))` in `statusline.test.mjs`; it
is the highest one available and it survives any reshuffling of the modules beneath it.

- All five rows of the composition matrix.
- Degradation when `current_usage` and `used_percentage` are null, individually and together.
- Deterministic in-flight selection: `current` set, `current: null` with exactly one `running`
  phase, `current: null` with none, and with several. A checkout that changes mtimes must not
  change the chosen phase.
- The tally renders no percentage, and `tasks_dropped` moves the denominator.
- No subprocess is spawned during a render.

Pure formatting keeps its unit tests in `statusline-lib.test.mjs`. The `setup.mjs` registration
is configuration wiring, covered by the existing assertion on the written `statusLine.command`
rather than a unit test of its own — the boundary-trust rule in `.claude/stack-rules.md`.

## Risks, and how each is closed

- **`context_window_size` is asserted from documentation.** Closed by a plan step that captures a
  live payload before the code is trusted, and by a read order that falls back through
  `total_tokens` to `1_000_000` regardless.
- **`ROADMAP.md`'s `current` goes stale.** The bar then shows nothing where it used to show
  something wrong. That is the chosen direction of failure: silence over a false claim.
- **A hand-edited or absent `bundle-manifest.json`.** Fails open to showing the up segment; the
  worst case is one extra segment on a `lite` machine, not a broken line.
- **An existing `full` registration pointing at the deleted wrapper.** Closed by the `setup.mjs`
  change above; a machine that skips the settings merge (`--skip-all`) keeps a dead command, which
  is the pre-existing behaviour for a skipped merge and not a regression introduced here.

## Out of scope

- **The subagent token counter.** `14m 16s · ↓ 149.7k tokens` comes from Claude Code's built-in
  agents panel, not from this bundle. Nothing here affects it.
- **`rate_limits`, `effort`, `thinking`, `fast_mode`, `vim`, `pr`, `worktree`, `agent.name`.**
  All present in the payload, none in this line.
- **The git branch and its flags.** Removed by decision, not oversight: the project name answers
  "where am I", and dropping it removes the only subprocess in the render path.
- **The state-vocabulary migration** — `status`/`delivery`/`depends_on`, `superseded_by`, and
  writing `tasks_dropped` into existing phases. Settled on 2026-07-29, applied elsewhere.
- **Deploying any of this.** Phase 07's rule stands: one serialised deploy from `master` after
  the branches land, gated on an audit and a written impact assessment.

## Depends on

- **The state-vocabulary migration**, for `tasks_dropped` to exist in the files this reader
  parses. The reader is written against the settled vocabulary and treats the field as `0` when
  absent, so it is correct before the migration and more accurate after it. No ordering
  constraint either way.
- **Phase 07's own `07-SPEC.md` and `07-PLAN.md`**, which are owed as a move of
  `.ultrapowers/archive/{specs,plans}/2026-07-28-gsd-core-detector-and-statusline*.md` into that
  directory. Unrelated work, named here only so it is not mistaken for this phase's.
