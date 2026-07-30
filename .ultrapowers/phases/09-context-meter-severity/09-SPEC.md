# Context fill severity — design

The context segment says how full the window is but not how much that matters. This phase
gives it a severity: a colour that tracks the number printed beside it, and an icon that
tracks how close automatic compaction is. Both ladders are derived from the current model's
window, so the same code reads correctly on a 200K model and a 1M one.

## Context

Phase 08 replaced two statusline renderers with one, and settled the context segment on
figures rather than a bar: `319.9K/1M 32%`, where the token count is the `current_usage` sum
and the percentage is the payload's own `used_percentage` against the full window. The
segment is monochrome — it reads the same at 3% and at 93%.

The bundle used to wrap gsd-core's `gsd-statusline.js`, which did colour its bar
(`gsd-statusline.js:562-571`): green below 50, yellow below 65, orange `38;5;208` below 80,
and blinking red with a `💀` prefix above that. That wrapper is gone, and with it the only
severity signal this line ever had. This phase brings the signal back on our own terms.

Two things gsd did are deliberately not carried over. Its `used` was normalised against a
guessed 16.5% autocompact reserve, so the number disagreed with Claude Code's own
`/context` — gsd's own comment (`gsd-statusline.js:535-538`) records that this inflated the
context monitor by roughly 13 points. And its critical state used `\x1b[5m` blink, which
some terminals ignore, others render as a distraction, and which adds nothing the skull does
not already say. What is carried over is the orange step `38;5;208` — a real fifth gradation
that ANSI-16 cannot express, proven in this exact position — and the idea that the top of the
scale earns an icon.

## Two scales, one ladder

The ladder is a single list of boundaries: **15 / 45 / 70 / 85 / 95**. It is applied to two
different quantities, because the two answer different questions.

**Colour is driven by percent of the model's window** — the same quantity printed in the
segment. A reader who sees `32%` in yellow and cannot explain why has been misled by their
own statusline, so the colour is never allowed to disagree with the figure beside it.

**The icon is driven by progress toward automatic compaction.** That is the operational
question: not "how full is the window" but "how soon does the session lose its history".

Under the default configuration the autocompact window equals the model window, the two
quantities coincide, and the distinction is invisible. It becomes visible only when
`CLAUDE_CODE_AUTO_COMPACT_WINDOW` is set lower than the model window — the documented way to
compact early. Then the icon leads the colour: the warning arrives on time while the printed
percentage stays honest. This is the case the split exists for.

## The ladder

| window band → colour | ANSI | autocompact progress → icon |
|---|---|---|
| 0–15% grey | `2` | — |
| 15–45% green | `32` | — |
| 45–70% yellow | `33` | ≥ 45% → 💡 |
| 70–85% orange | `38;5;208` | ≥ 70% → ⚠️ |
| 85–95% red | `31` | ≥ 85% → 🔥 |
| 95%+ bright red | `91` | ≥ 95% → 💀 |

The two columns are read independently: the left is percent of the model's window, the right
is percent of the way to automatic compaction. The icon ladder uses only the top four
boundaries — 15 divides grey from green and has no icon meaning.

Percentages are the unit; the token figures follow from the window. On a 1M model the yellow
band opens at 450K, on a 200K model at 90K. Nothing in the implementation carries an absolute
token constant.

The emoji carry their own colour and ignore the surrounding SGR. For 💡, ⚠️ and 🔥 this
agrees with the band; for 💀, which renders pale, the bright-red figure beside it carries the
severity. `⚠️` includes variation selector `U+FE0F`, so its cell width varies between
terminals — accepted, because the context segment is followed by a separator and a shifted
separator is a cosmetic difference, not a broken line.

## Where the autocompact point comes from

`PreCompact` receives `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `trigger`,
`custom_instructions`, `permission_mode` and `effort`. It does **not** receive
`context_window`, so the hook cannot read the percentage at the moment compaction fires, and
it cannot read the window size either.

It can read the transcript. The last assistant entry in `transcript_path` carries a `usage`
block, and summing it gives the token count at which compaction triggered. That count is
self-sufficient: the statusline knows the window and compares tokens against tokens. This is
the same technique `token-usage-log.mjs` already uses, over the same helpers
(`hooks/lib/token-usage-shared.mjs` exports `safe`, `readJSON`, `writeFile`,
`readJSONLRecords`), so the hook introduces no new way of reading a transcript.

The observation is stored per model id. A figure observed on a 1M session is meaningless on a
200K one, and `model.id` is the one discriminator available at both ends.

Resolution order, highest first:

1. `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` — an explicit user setting, authoritative immediately.
2. The observed count for the current `model.id`, from `~/.claude/state/autocompact.json`.
3. **The full window.** Not a guessed reserve.

Point 3 is a decision, not a placeholder. The obvious alternative is to seed the default with
gsd's 16.5% reserve, and that is exactly the guess phase 08 deleted and `RISK-STATUSLINE-001`
was filed about: a constant that looks like knowledge and is not. Assuming the autocompact
point sits at the window makes the icon ladder collapse onto the colour ladder until the
first automatic compaction calibrates it. The cost is that 💀 will not be seen before that
first compaction; 💡 at 45% and ⚠️ at 70% still arrive, which is the warning that matters.
The state file records `source` so the difference between assumed and observed is legible
rather than silent.

When `autoCompactEnabled` is `false` in settings there is no compaction to warn about, and
the icon ladder runs against the window like the colour one.

```js
// payload/hooks/lib/autocompact.mjs — resolution only; no formatting, no I/O policy
export function resolveAutocompact({ windowSize, modelId, state, env = process.env, enabled = true }) {
  if (!Number.isFinite(windowSize) || windowSize <= 0) return null;
  if (!enabled) return { tokens: windowSize, source: "disabled" };
  const pct = Number(env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE);
  if (Number.isFinite(pct) && pct > 0 && pct <= 100) {
    return { tokens: (windowSize * pct) / 100, source: "env" };
  }
  const seen = state && state.models && state.models[modelId];
  const tokens = seen && Number(seen.tokens);
  if (Number.isFinite(tokens) && tokens > 0) return { tokens, source: "observed" };
  return { tokens: windowSize, source: "assumed" };
}
```

`~/.claude/state/autocompact.json` follows the convention of the other files in that
directory — a small JSON object, absent until something writes it. The count below is a shape
illustration, not a claim about where compaction fires; that number is unknown until observed,
which is the whole point of the file:

```json
{ "models": { "<model id>": { "tokens": 0, "observedAt": "<ISO-8601>" } } }
```

## New units

| unit | what it does | depends on |
|---|---|---|
| `payload/hooks/lib/context-severity.mjs` | `severityOf(windowPct, acProgress)` → `{ colour, icon }`. Pure; numbers in, two strings out. | nothing |
| `payload/hooks/lib/autocompact.mjs` | resolves the autocompact point from env, observation, or the window | nothing (state is passed in) |
| `payload/hooks/precompact-observe.mjs` | on `PreCompact` with `trigger === "auto"`, sums the transcript's last usage and records it per model id | `token-usage-shared.mjs` |

`computeContext` in `statusline-lib.mjs` gains a second argument (the resolved autocompact
point) and returns a coloured string with the icon appended, instead of a bare one. Its
existing contract — return `""` when there is nothing to show — is unchanged.

Nothing is written to `~/.claude` by hand: all three files ship in `payload/` and reach the
machine through `setup.mjs`, per the project rule that this repository is the source of an
installation and never a working configuration. `settings.partial.json` gains the
`PreCompact` registration so the installer wires the hook.

## Failure is a plain segment, never a broken line

The renderer's standing rule holds: any failure yields empty output rather than an exception.
Each new source is guarded on its own, so one failing input degrades one thing:

- No `autocompact.json` — not an error. `source: "assumed"`, icons follow the colour ladder.
- Unparseable `autocompact.json` — treated as absent.
- Unreadable transcript in the hook — the observation is skipped; the hook never blocks or
  delays compaction, and never exits non-zero.
- No `context_window` in the payload — the segment is empty, exactly as today.
- Colour or icon computation throwing — the segment renders uncoloured rather than not at
  all. Severity is an enhancement to the figure, never a precondition for printing it.

## Testing decisions

Two seams, both already in place.

The ladder is checked as pure logic at `context-severity.mjs`: boundary values on both sides
of 15/45/70/85/95, the two scales disagreeing, and the icon-free bands. This is where the
arithmetic is proved.

The assembled line is checked at the existing **entry-point seam** in `statusline.test.mjs`,
which already drives the whole process through stdin and asserts on rendered output. Adding
severity cases there proves the composition without inventing a new harness.

The observation hook is unit-tested on its parsing function, not on the process: what it
extracts from a transcript fixture, and that a `manual` trigger records nothing. Its
registration in `settings.partial.json` is pure wiring and is verified where the installer's
settings merge is already exercised, not by a test on the hook itself — the repository's
stated convention that wiring is covered by the integration it enables.

`resolveAutocompact` is pure and gets its own unit test per source in the priority list,
including the `enabled: false` branch.

## Risks

- **The default is late, not wrong.** Before the first observed compaction the icon ladder
  equals the colour ladder, so 💀 cannot appear ahead of a compaction that has never been
  seen. Accepted deliberately over seeding a guessed reserve. Register this as a risk with
  the acceptance check: after one automatic compaction, `autocompact.json` holds a `tokens`
  value below the window and `source` reads `observed`.
- **`⚠️` width varies by terminal.** Cosmetic; bounded to one separator's alignment.
- **256-colour orange assumes a 256-colour terminal.** Every terminal this bundle targets
  supports it and gsd shipped the same code, but a strictly 16-colour terminal renders it as
  its nearest match rather than failing.

## Out of scope

- The gsd and ultrapowers work-status segments, and the updates, model and project segments.
- The bridge file `gsd-statusline.js` wrote to `os.tmpdir()` for its context-monitor hook.
- User-configurable thresholds or palette. The ladder is a constant in this phase.
- Blink, and any reintroduction of buffer-normalised percentages.
- Reacting to `rate_limits`, `exceeds_200k_tokens`, `cost` or `effort`, all of which the
  payload carries and none of which this phase reads.

## Depends on

Phase 08's renderer and its `computeContext`, and the payload field names settled by
`RISK-STATUSLINE-001` — `context_window_size` for the window, `used_percentage` for the
percentage, `current_usage` for the token sum.
