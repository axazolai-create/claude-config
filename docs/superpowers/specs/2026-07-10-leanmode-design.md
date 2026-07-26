# leanmode design

## Motivation

Evaluated the `ponytail` plugin (github.com/DietrichGebert/ponytail) — a YAGNI/"lazy senior
dev" prompt-injection plugin. Verified its manifest/hooks match its description (no supply
chain surprises), but its granularity is too coarse for this repo's needs: `SubagentStart`
fires unconditionally for every subagent (no `matcher`), and the only tuning knob is a single
global `off/lite/full/ultra` mode — no per-agent-type or per-project control.

`leanmode` is a from-scratch, first-party replacement: same underlying idea (inject a
minimal-code ruleset into subagents), but with per-`agent_type` granularity, a per-project
override file, and a project-wide intensity dial — modeled on this repo's existing
`gsd-config-patch.mjs` per-agent `model_overrides` pattern.

Confirmed via Claude Code's hooks reference docs: `SubagentStart` natively supports a
`matcher` on `agent_type` (`general-purpose`, `Explore`, custom names, `^plugin:name$`), and
`additionalContext` returned from a `SubagentStart` hook is injected at the start of that
subagent's own conversation — this is the primitive the whole design is built on.

## Architecture

Full replacement, no dependency on the `ponytail` plugin. Lives in this repo, deployed via
`node setup.mjs` (which recursively syncs `payload/` into `~/.claude/`, so no plumbing changes
are needed for new files placed anywhere under `payload/`).

```
payload/
  hooks/
    leanmode-subagent.mjs        # SubagentStart hook (thin: reads agent_type, resolves, emits)
    lib/
      leanmode-rules.mjs         # resolveLevel() + resolveDial() + shift() + text loader
      leanmode-lite-rule.md      # tier text: lite
      leanmode-full-rule.md      # tier text: full
      leanmode-ultra-rule.md     # tier text: ultra (extends full)
      mark-initstack-done.mjs    # tiny marker script, called from init-stack.md's last step
  agents/
    leanmode-executor.md         # new custom subagent (see below)
  commands/
    leanmode.md                  # /leanmode command (interactive + --flag forms)
```

No one-time state tracking needed for the hook itself (unlike `gsd-config-patch.mjs`) — level
resolution is stateless, computed fresh from current config on every `SubagentStart`.

## Rule text — 4 tiers

`off` has no text (hook emits nothing). The other three are markdown files under
`payload/hooks/lib/`, loaded at runtime by `leanmode-rules.mjs` — kept as prose files, not JS
string constants, so they're easy to read/edit on their own.

**lite** (`leanmode-lite-rule.md`):
```
Before writing code: does this need to exist, and does the codebase already have something
for it? Prefer the smallest correct change over new abstractions.
```

**full** (`leanmode-full-rule.md`):
```
1. Does this need to be built at all?
2. Does it already exist in this codebase — reuse it, don't rewrite it.
3. Does stdlib/the language runtime already do it?
4. Is there an already-installed dependency that does it?
5. Otherwise: the minimum code that satisfies the actual requirement.
No speculative flexibility, no unrequested abstractions, no config knobs nobody asked for.
This is about complexity, not correctness: error handling at real boundaries, validation,
and security practices stay in place regardless of level.
```

**ultra** (`leanmode-ultra-rule.md`, extends full — only reached via the project dial, see
below; no baseline `agent_type` maps to `ultra` directly):
```
Beyond the ladder above: actively look for existing code to delete or simplify while you're
in the area, not just avoid adding new. Don't introduce an abstraction for 2 call sites —
inline until there are genuinely 4+. No new files unless the existing ones can't reasonably
hold this. No new dependencies, even ones already used elsewhere in a monorepo, unless
already a direct dependency of this package. Hard-code the literal case in front of you over
a general solution nobody asked for. This still does not touch correctness, error handling at
real boundaries, or security practices — those stay exactly as required regardless of level.
```

The last line of `full` and `ultra` is deliberate and matches ponytail's own benchmark
finding (its `full`-equivalent kept every safety guard where a naive "write one-liners"
prompt dropped one) — leanmode must not read as license to skip validation/security work.

## `DEFAULT_LEANMODE_MAP` (baseline, before any project dial is applied)

Verified against the actual current agent roster: `~/.claude/agents/*.md` (34 GSD custom
agents — confirmed by listing that directory; GSD's agents live there directly, not inside
any plugin cache) + 6 Claude Code built-ins (`claude`, `claude-code-guide`, `Explore`,
`general-purpose`, `Plan`, `statusline-setup`) + 1 new custom agent (`leanmode-executor`,
below). No other currently-installed plugin (`context-mode`, `context7`,
`security-guidance`, `frontend-design`, `skill-creator`, `kotlin-lsp`) defines a custom
agent — confirmed by searching the plugin cache for `agents/` directories (none found).

Categorization rule: `full` only for agents that write application code or literally do
reuse/pattern-detection; `lite` for agents that touch code sometimes but aren't dedicated to
it; `off` for everything else (planning, research, docs, review/verify/audit, UI) — the rule
text is code-writing-specific and is noise for non-code-writing agents.

Runtime object holds only the 11 non-`off` entries — `off` is already the global fallback
(BASE step 4), so a key that would just say `"off"` adds nothing at lookup time and only
bloats the object every `resolveLevel()` call has to scan. The always-off keys are pulled
out into a separate, grouped comment block instead: not part of `DEFAULT_LEANMODE_MAP`, never
read by the resolver, exists purely so a reader scanning `leanmode-rules.mjs` sees at a glance
which of the 40 known `agent_type`s were deliberately considered and excluded, rather than
silently absent. This is the actual shape `lib/leanmode-rules.mjs` will use, not just JSON for
this doc:

```js
export const DEFAULT_LEANMODE_MAP = {
  "general-purpose": "lite", // catch-all agent, code-writing is common but not certain - mild nudge only
  "claude": "lite", // default catch-all when no agent name given - same reasoning as general-purpose
  "statusline-setup": "lite", // narrow single-purpose config edit - small scope, minimal is naturally correct here
  "leanmode-executor": "full", // new custom agent (see below) - explicit per-task opt-in to lean implementation
  "gsd-executor": "full", // writes/edits application code implementing plans - primary target for this system
  "gsd-code-fixer": "full", // applies fixes to code review findings - writes application code
  "gsd-debugger": "full", // investigates bugs and writes fix code
  "gsd-pattern-mapper": "full", // maps existing code patterns for reuse - directly synergistic with YAGNI/reuse-first
  "gsd-codebase-mapper": "full", // maps codebase structure/tech for planning - reinforces "reuse what's already there"
  "gsd-nyquist-auditor": "lite", // generates tests to fill validation gaps - some minimalism helps, doesn't need the full push
  "gsd-debug-session-manager": "lite", // orchestrates debug cycles and applies fixes itself - code-touching but mostly a manager role
};

// ALWAYS OFF - documentation only. NOT part of DEFAULT_LEANMODE_MAP, never read by
// resolveLevel(), and pinned under the project dial too (resolveDial() never shifts "off" to
// "lite"/"full" on the ultra dial - see the design doc's dial section for why). Every
// agent_type known at design time that isn't in the map above was deliberately considered and
// landed on "off" - listed here so that's an auditable decision, not a silent gap.
//
// Explore, Plan, claude-code-guide                    - built-in: no Write/Edit tool, or no code-writing intent
// gsd-planner, gsd-roadmapper                         - planning/roadmap, needs full scope latitude
// gsd-advisor-researcher, gsd-ai-researcher, gsd-domain-researcher, gsd-phase-researcher,
//   gsd-project-researcher, gsd-research-synthesizer  - research, no application code
// gsd-doc-classifier, gsd-doc-synthesizer, gsd-doc-verifier, gsd-doc-writer,
//   gsd-intel-updater, gsd-mempalace-curator, gsd-user-profiler   - docs/meta output, not app code
// gsd-code-reviewer                                   - own dedicated broad quality gate, don't narrow it
// gsd-security-auditor                                - safety-critical, kept fully outside "write less" framing
// gsd-verifier, gsd-plan-checker, gsd-integration-checker, gsd-eval-auditor,
//   gsd-eval-planner, gsd-framework-selector, gsd-assumptions-analyzer  - checking/design, not code-writing
// gsd-ui-auditor, gsd-ui-checker, gsd-ui-researcher   - UI design/audit, orthogonal to code-minimalism
```

Totals: `full` = 6 (leanmode-executor, gsd-executor, gsd-code-fixer, gsd-debugger,
gsd-pattern-mapper, gsd-codebase-mapper), `lite` = 5, `off` = 30 (comment-only, listed above).
Unlisted/unknown `agent_type` values (any future plugin's custom agent) fall through to the
project `default` or the global `"off"` fallback — never `full` by surprise.

## New custom agent: `leanmode-executor`

`payload/agents/leanmode-executor.md` — a `general-purpose`-equivalent implementation agent
(no `tools:` restriction — full access, true drop-in), whose `<role>` describes *when to pick
it* ("use for implementation tasks where lean, minimal code is explicitly wanted, as an
alternative to `general-purpose`") but does **not** statically embed the ruleset text.

This was a deliberate correction during design: an earlier version of this idea considered
baking the `full` rule text directly into the agent's own body via Claude Code's `@path`
import syntax (confirmed supported — `gsd-executor.md` itself uses
`@$HOME/.claude/gsd-core/references/mandatory-initial-read.md` in its `<role>`). Rejected
because a statically-embedded ruleset can't respond to the project dial (below) — an
explicitly-invoked `leanmode-executor` should still go fully inert under `--off` and should
still tighten to `ultra` text under `--ultra`, same as everything else. So it goes through
the exact same `SubagentStart` hook + map pipeline as every other `agent_type`, with a
baseline of `full` in `DEFAULT_LEANMODE_MAP`.

Rationale for adding a new agent at all rather than only tuning existing ones: per-`agent_type`
config only gives *automatic, passive* control ("this type of agent always gets level X"). It
cannot give *per-task, active* control — "I want lean treatment for this specific piece of
work regardless of which generic executor would otherwise run." `leanmode-executor` is that
explicit choice: a real, discoverable `subagent_type` that superpowers'
`dispatching-parallel-agents`/`subagent-driven-development` (or the user directly) can select
instead of `general-purpose` when they specifically want it, without touching any config.

Explicitly NOT adding a mirror `leanmode-review` agent (over-engineering-focused code review,
the analog of ponytail's `/ponytail-review`): the already-available `simplify` skill covers
that exact job ("Review the changed code for reuse, simplification, efficiency, and altitude
cleanups, then apply the fixes. Quality only"). Adding a duplicate would violate the same
YAGNI principle this whole system exists to enforce.

## Config resolution

Two independent axes, resolved in order: **BASE level** (which text tier would this
`agent_type` get, ignoring the project dial) → **project dial** (a uniform shift applied to
whatever BASE resolved to).

### BASE level (4-step, highest priority first)

1. `<project>/.claude/leanmode.json` → `overrides[agent_type]`, if present.
2. `DEFAULT_LEANMODE_MAP[agent_type]`, if present (the table above).
3. `<project>/.claude/leanmode.json` → `default`, if present.
4. `"off"` (global fallback for anything not covered by 1–3).

Deliberately NOT stored inside `.claude/settings.json` — that file is partially validated by
Claude Code itself, and unrecognized top-level keys are a real risk (this is why GSD keeps
its own config in `.planning/config.json` rather than `settings.json`, and why
`session-init.mjs` only ever adds to the one key — `claudeMdExcludes` — that's actually part
of the recognized schema). `leanmode.json` is a dedicated file our own hook owns exclusively.

### Project dial (applies a shift to BASE — `off` is pinned, not shifted)

`off` is an anchor, not a rung on the shift ladder: it only ever changes via the `off` dial
itself (hard override), never via the `lite`/`ultra` shift. Checked this against all 30
`off` entries in the map above, including the ones that technically hold `Write`/`Edit` tool
access (`gsd-planner`, `gsd-doc-writer`, `gsd-security-auditor`, `gsd-ui-researcher`,
`gsd-eval-planner`, and others) — every one of them writes plans, reports, docs, or specs,
never application source code, so the code-minimalism ladder is genuine noise for all of
them, not just the read-only ones (`Explore`, `Plan`, `gsd-advisor-researcher`,
`gsd-plan-checker`, etc.). Pinning `off` avoids exactly the "передушить" failure mode: an
`ultra` dial should never be able to nudge a planner or a security auditor toward writing
less, even mildly — that pressure has no legitimate target there and would only risk
under-scoped plans or a diluted security pass.

Only `lite` and `full` (and, under `ultra`, `full`→`ultra`) actually move:

| dial | effect | example |
|---|---|---|
| `off` | every `agent_type` → `off`, unconditionally (hard override, not a shift) | `full` → off, `lite` → off, `off` → off |
| `lite` | shift down one step; `off` stays `off` | `full` → lite, `lite` → off, `off` → off |
| `full` | identity — use BASE as authored (this is the default meaning of "full": the table above, not "everyone gets full text") | `full` → full, `lite` → lite, `off` → off |
| `ultra` | shift up one step; `off` stays `off` (pinned — see above), only `lite`/`full` rise | `off` → off, `lite` → full, `full` → ultra |

So under `ultra`, only the 11 agents whose BASE is `lite` or `full` are affected at all
(the 5 `lite` ones rise to `full`, the 6 `full` ones rise to `ultra`); the 30 `off` agents
are untouched — same set, same behavior, regardless of dial, short of the `off` dial itself.
`ultra` text is reached exclusively through this shift, never assigned as a BASE value
directly, so there's no need for `ultra` rationale entries in the map itself.

Dial value resolution, highest priority first:
1. `<project>/.claude/leanmode.json` → `dial`, if explicitly set.
2. `"full"` (identity), if `~/.claude/state/project-init.json` → `state[root].initStackRun`
   is truthy for this project root.
3. `"off"`, otherwise (i.e. `/init-stack` has never been run for this project — leanmode
   stays fully inert until the project has gone through normal onboarding or the user
   explicitly sets a dial).

This requires one small addition outside this feature's own files: `payload/commands/
init-stack.md` gets a final step appended to its instructions, running
`node ~/.claude/hooks/lib/mark-initstack-done.mjs` — a ~10-line idempotent script that stamps
`state[root].initStackRun = <ISO timestamp>` into the same shared
`~/.claude/state/project-init.json` file `session-init.mjs` and `gsd-config-patch.mjs`
already read/write (same per-root state object, new independent key — no collision, same
pattern as every other one-time flag in that file).

## `.claude/leanmode.json` format

```json
{
  "dial": "ultra",
  "default": "lite",
  "overrides": { "gsd-pattern-mapper": "off" }
}
```

All three keys optional. Absent file = BASE step 4 fallback (`off`) for everything, dial
resolved per the init-stack rule above.

## `/leanmode` command

`payload/commands/leanmode.md`, styled like `init-stack.md`'s own interactive flow.

- `/leanmode` (no args) → interactive: present the four options (off/lite/full/ultra) with
  the one-line effect description from the table above, the same way Claude Code's own model
  picker presents choices. Selection writes/merges `dial` into `.claude/leanmode.json`
  (creating the file if absent, preserving any existing `default`/`overrides`).
- `/leanmode --off` / `--lite` / `--full` / `--ultra` → same write, skipping the menu.
- After writing, report the resulting EFFECTIVE level for every `agent_type` that ends up
  *not* `off` (i.e. the actually-active subset) — so the user can see real impact instead of
  trusting the dial blindly.

## Hook wiring

`settings.partial.json` gains one new `SubagentStart` entry, no `matcher` (filtering is
internal to the script, driven by the resolution above — consistent with why no matcher is
used: the alternative, one matcher entry per `agent_type`, would need editing on every new
agent addition):

```json
"SubagentStart": [
  {
    "hooks": [
      { "type": "command", "command": "node", "args": ["<HOME>/.claude/hooks/leanmode-subagent.mjs"] }
    ]
  }
]
```

Master kill switch: `CLAUDE_LEANMODE=0` (same convention as this repo's other hooks, e.g.
`CLAUDE_GSD_CONFIG_AUTOPATCH=0`) disables the hook entirely regardless of dial/config.

## Future extension: third-party / MCP agents (placeholder, not implemented)

Deferred by design — no concrete third-party agent to design against yet, and the binding
mechanism genuinely differs per invocation channel, so guessing now would mean redoing it
later. Recorded here only so the shape isn't lost.

Proposed future shape, one entry per third-party agent, each with one or more bindings (the
same external agent can be reachable more than one way, each needing its own level):

```json
{
  "agent": "name",
  "bindings": [
    { "type": "mcp", "lean": "off" },
    { "type": "trigger", "lean": "lite" }
  ]
}
```

What's already confirmed, technically, for when this gets built:

- **`mcp`**: an MCP tool call is not a Claude Code subagent — `SubagentStart` never fires for
  it, and Claude Code has no visibility into whatever happens inside a third-party MCP
  server's own process. The only real injection point is `PreToolUse`/`PostToolUse` matching
  `mcp__<server>__.*` (confirmed both support `hookSpecificOutput.additionalContext`). That
  lands the ruleset in the **main thread's** context around the tool call, not inside the
  MCP server's own internal agent loop (if it has one) — a fundamentally different guarantee
  than `SubagentStart` gives for real subagents. Any future implementation must make this
  distinction explicit to the user, not imply parity with the `agent_type` map above.
- **`trigger`**: intentionally left undefined. Not one specific hook event — could resolve
  to `PreToolUse` on a `Bash` pattern (external CLI agent), `UserPromptExpansion` on a
  specific command name, `Notification` (`agent_needs_input`/`agent_completed` for
  background/agent-view sessions), or something else entirely, depending on the concrete
  agent this ends up describing. Design this binding type only against a real case, not
  speculatively.

## Explicitly out of scope

- No fifth text tier beyond `ultra` — `ultra` is already a shift-only ceiling, not a BASE
  value; adding a sixth level for a shift-ceiling nobody can reach would be the system
  contradicting its own philosophy.
- No `leanmode-review` agent — `simplify` skill already covers that job (see above).
- No statusline badge, no multi-host (Codex/Cursor/etc.) support — Claude Code only, matching
  the rest of this repo.
- No runtime `/leanmode <agent-type> <level>` per-agent override command — one-off per-agent
  tuning goes through hand-editing `.claude/leanmode.json` → `overrides`, not a command
  surface. Revisit only if that proves too friction-heavy in practice.
