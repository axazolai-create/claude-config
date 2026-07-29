# AI Development Mode — Design

- **Status:** Draft (awaiting user review)
- **Date:** 2026-07-26
- **Topic:** A toggleable "AI development mode" that (A) makes generated code terse — no
  decorative comments or filler whitespace — and (G) strengthens use of the existing graphify
  code graph for reading/navigation.
- **Scope:** claude-config bundle (`payload/` full + `payload-lite/` lite). No changes to
  `~/.claude/CLAUDE.md` (CURATED:NOEDIT).

## 1. Motivation

The AI over-comments and over-decorates code it writes (change-log comments, restating-the-code
comments, filler blank lines "for readability"), inflating both the file and the context cost of
re-reading it. The user wants a *mode* that produces terse-but-correct code — meaningful names,
correct casing, mandatory syntax (Python indentation) all preserved — while stripping the human
decoration. The original idea (a parallel `.md` comment tree keyed to line numbers, or minify +
a reconstruction map) was rejected during brainstorming: line-anchored sidecars are fragile,
double reading costs *more* tokens than inline comments, minify is strictly worse for an LLM to
edit, and the "persistent meaning map" it wanted **already exists** as graphify (symbol-anchored,
budget-queryable, persistent) plus context-mode/memory for intent. So the surviving, non-redundant
kernel is two orthogonal levers:

- **A (generation):** a comment/whitespace *verbosity* axis, independent of leanmode's structural
  minimalism (leanmode governs *how much code*; A governs *how much text around the code*).
- **G (reading):** strengthen how the model *uses* the already-built graphify graph instead of
  grepping, and keep that graph fresh — by editing existing mechanics, not building new subsystems.

### Non-goals

- No minification, no line-number-anchored comment sidecars, no parallel `.md` mirror tree.
- A must never degrade correctness, error handling, or security — same carve-out leanmode makes.
- G does not replace graphify; it nudges toward it and keeps it fresh.

## 2. Architecture — universal rule injector

Today `payload/hooks/leanmode-subagent.mjs` is a single-axis **SubagentStart** hook: it resolves
one leanmode level via `lib/leanmode-rules.mjs` and injects one rule block as `additionalContext`.
We generalize this into an **axis registry** so multiple independent rule axes share one injection
path and each resolves on its own — including when another axis is disabled.

### Axis contract

```js
// payload/hooks/lib/inject-axes.mjs
// Each axis is self-contained. The injector composes whichever axes resolve to a
// non-"off" level for the current event; axes never reference one another.
export const AXES = [leanmodeAxis, verbosityAxis];

// Shape every axis implements:
//   name:          "leanmode" | "verbosity"
//   events:        which hook events this axis injects on
//   killSwitchEnv: master off-switch env var for this axis alone
//   resolve(agentType, root): -> level string ("off" means skip)
//   loadRuleText(level):      -> the rule block for that level
export const verbosityAxis = {
  name: "verbosity",
  events: ["SessionStart", "SubagentStart"],  // global + agents (A must cover both)
  killSwitchEnv: "CLAUDE_VERBOSITY",
  resolve: (agentType, root) => resolveVerbosityLevel(agentType, root),
  loadRuleText: (level) => loadVerbosityRule(level),
};
```

### Injector hook

One hook file, registered in `settings.partial.json` on **both** `SessionStart` and
`SubagentStart` (no matcher — filtering stays in code, matching the existing leanmode pattern):

```js
// payload/hooks/inject-axes.mjs  (generalized successor of leanmode-subagent.mjs)
import { readFileSync } from "node:fs";
import { AXES } from "./lib/inject-axes.mjs";
import { findRoot } from "./lib/leanmode-rules.mjs";

const d = JSON.parse(readFileSync(0, "utf8") || "{}");
const event = d.hook_event_name;                 // "SessionStart" | "SubagentStart"
const agentType = d.agent_type || "main";        // SessionStart has no agent_type
const root = findRoot(d.cwd || process.cwd());

const blocks = [], labels = [];
for (const axis of AXES) {
  if (process.env[axis.killSwitchEnv] === "0") continue;
  if (!axis.events.includes(event)) continue;
  const level = axis.resolve(axis.name === "verbosity" ? agentType : d.agent_type, root);
  if (level === "off") continue;
  const text = axis.loadRuleText(level);
  if (text) { blocks.push(text); labels.push(`${axis.name}: ${level}`); }
}
if (!blocks.length) process.exit(0);

process.stdout.write(JSON.stringify({
  systemMessage: labels.join(" · "),
  hookSpecificOutput: { hookEventName: event, additionalContext: blocks.join("\n\n") },
}));
```

**Why this shape.** It is the minimal change that satisfies "universal injector, works even if
leanmode is off": leanmode becomes one axis whose behavior is unchanged (its resolver, config,
tiers, per-agent map, and `CLAUDE_LEANMODE` kill switch all stay), verbosity becomes a second
axis, and the two are independent — `leanmode=off` still lets verbosity inject, and vice versa.
Adding a future third axis is a one-line push to `AXES`.

**Coverage answers the A requirement directly:** verbosity subscribes to `SessionStart` (main
loop / global) *and* `SubagentStart` (agents); leanmode stays `SubagentStart`-only, unchanged.

**Migration of the existing hook:** `leanmode-subagent.mjs` is replaced by `inject-axes.mjs`. The
registration in `settings.partial.json` changes from one SubagentStart entry to one hook on two
events. `leanmode-rules.mjs` is kept as-is and re-exported as the leanmode axis, so its tests keep
passing untouched. See RISK-INJECT-001 for the regression guard.

## 3. Component A — verbosity axis

New files mirroring the leanmode layout:

- `payload/hooks/lib/verbosity-rules.mjs` — resolver (copy of `leanmode-rules.mjs` structure:
  `resolveEffectiveLevel`, base map, project dial), reading its own config (see §5).
- `payload/hooks/lib/verbosity-lite-rule.md`, `verbosity-full-rule.md`, `verbosity-ultra-rule.md`
  — the injected rule text per tier.
- `payload/commands/aidev.md` — the mode command (see §5).

### Tiers (text around code, NOT structure)

- **off** — default; no injection.
- **lite** — No change-log or restating-the-code comments. Comment only the non-obvious *why*,
  never the *what*. No decorative separator blank lines.
- **full** — lite, plus: no comments at all except a genuine non-obvious *why*; drop blank lines
  that only visually group; docstrings only for a public contract/API.
- **ultra** — full, plus: zero comments, zero optional blank lines.

Every tier text ends with the **hard carve-out** (verbatim, so the model cannot slide into
minification or drop safety): *"This is about comment/whitespace verbosity only. Preserve
meaningful names, correct casing (camelCase/PascalCase), mandatory syntax and indentation
(e.g. Python), error handling at real boundaries, validation, and security. This is NOT
minification — never shorten identifiers, never collapse required structure."*

### Rationale

Verbosity is orthogonal to leanmode by construction (confirmed against
`leanmode-{lite,full,ultra}-rule.md`, which govern abstractions/reuse/deletion and explicitly say
"about complexity, not correctness" — they never mention comments or whitespace). Keeping it a
*separate dial* preserves useful combinations ("full abstractions, zero comments" for a shipped
util; "lite abstractions, some comments" for a prototype) that a single shared dial would forbid.

## 4. Component G — strengthen graphify usage (staged)

`~/.claude/CLAUDE.md` already prefers the graph over grepping, but that prose is CURATED:NOEDIT and
passive. G makes it active by editing editable mechanics only. **Staged** to bank the safe win
before touching working code.

### Stage 1 — grep nudge (new, zero-risk to existing mechanics)

- `payload/hooks/graphify-grep-nudge.mjs` — a **PreToolUse** hook on `Grep`/`Glob`. If
  `graphify-out/graph.json` exists in the project root AND the query/pattern looks architectural
  (heuristic: matches "where is / what calls / how does .* work / depends on / imports" style
  intent, or a bare symbol name that is a known god-node), emit a non-blocking `additionalContext`
  suggesting `graphify query "<...>"` first. Never denies — advisory only, modeled on the
  context-mode grep nudge.
- If the graph is stale (see Stage 2 freshness signal), the nudge says so instead of pretending
  the graph is authoritative.

### Stage 2 — freshness (edits existing mechanics, guarded)

- Freshness was implemented additively: a local mtime-vs-HEAD check lives inside the Stage 1 nudge
  itself (`payload/hooks/graphify-grep-nudge.mjs`), comparing `graphify-out/graph.json`'s mtime to
  the repo's HEAD commit time. The existing autosync (`payload/hooks/graphify-global-sync.mjs`,
  `payload/hooks/lib/graphify-global-sync-run.mjs`) is untouched. `payload/bin/graphify-freshness*`
  is unrelated prior art — it checks the installed graphify CLI version against PyPI, not graph
  staleness.
- **Guard:** a regression test pinning current autosync behavior runs *before* the edit; the edit
  must not change it (RISK-GRAPHFRESH-001). Stage 2 lands only after Stage 1 is merged and green.

If Stage 2 proves riskier than expected during planning, it can be split into a follow-up spec;
Stage 1 stands alone.

## 5. Config & command surface

- **Config:** verbosity reads its own file to avoid touching leanmode's working
  `.claude/leanmode.json`. Proposed: a shared `.claude/dev-mode.json` with per-axis sub-objects
  `{ "verbosity": { "default": "...", "overrides": {...} } }`; the verbosity resolver reads it,
  and leanmode is left reading `leanmode.json` (optionally also honoring `dev-mode.json.leanmode`
  as a fallback later — out of scope here). Each axis owns its config; the injector is
  config-agnostic.
- **Command:** `payload/commands/aidev.md` — `/aidev [off|lite|full|ultra]` sets the verbosity
  project dial and prints the resolved level of *both* axes (so the user sees leanmode and
  verbosity side by side). No-arg form shows status.
- **Kill switches:** `CLAUDE_VERBOSITY=0` (verbosity axis), `CLAUDE_LEANMODE=0` (leanmode axis) —
  independent.

## 6. Variants (full + lite) — A is required in both

Per the requirement that A ships in both builds, add the new files to `variants.json → lite.include`
next to the existing leanmode entries (full includes them automatically). New include globs:

```
"hooks/inject-axes.mjs",
"hooks/lib/verbosity-*",
"commands/aidev.md",
"hooks/graphify-grep-nudge.mjs",
```

Notes:
- `hooks/leanmode-subagent.mjs` line is replaced by `hooks/inject-axes.mjs` (rename); update the
  existing lite include entry accordingly.
- `hooks/lib/leanmode-*` stays (leanmode axis resolver). `hooks/lib/verbosity-*` is new.
- The grep nudge goes in lite because graphify itself is a lite feature (`graphify-global-sync.mjs`
  and `bin/graphify-freshness*` are already in `lite.include`). This departs from other nudges
  (ci-watch, bg-supervision) which are GSD/full-only — flagged as a deliberate choice.
- Any new payload file must be classified in `variants.json` (per the standing lite follow-up), so
  the `setup-variants.e2e.test.mjs` "lite contains A" assertion (see §7) is the enforcement.

## 7. Testing

- **Verbosity resolver** unit tests mirroring `leanmode-rules.test.*`: tier resolution, project
  dial, per-agent base map, `off` short-circuit.
- **Axis independence** (RISK-INJECT-001): a test asserting `leanmode=off` still yields a verbosity
  block, and `verbosity=off` still yields a leanmode block, from one injector invocation per event.
- **Leanmode regression:** existing `leanmode-*` tests must pass unchanged after the refactor
  (the leanmode axis is behavior-preserving).
- **Coverage:** a test that a `SessionStart` event injects verbosity but NOT leanmode, and a
  `SubagentStart` event injects both when both are on.
- **Variants e2e:** extend `setup-variants.e2e.test.mjs` to assert the lite build contains
  `inject-axes.mjs`, `verbosity-*`, and `aidev.md` (A present in lite), and that byte-identical
  round-trip still holds.
- **G Stage 1:** nudge fires on an architectural grep when `graph.json` exists, stays silent when
  it does not, and never denies.
- **G Stage 2:** the autosync regression test (pin-then-edit) described in §4.

## 8. Risks (to log in RISK_REGISTER.md)

- **RISK-INJECT-001** — Generalizing `leanmode-subagent.mjs` into the axis injector could subtly
  change leanmode's resolved level or injection for some agent_type. *Mitigation:* leanmode axis
  re-exports `leanmode-rules.mjs` unchanged; full existing leanmode test suite is the gate; add the
  axis-independence test. *Status:* Open until tests green.
- **RISK-VERBOSITY-001** — The model over-interprets "terse" and slides into minification or drops
  a comment that carried load-bearing *why*, or removes a docstring that is a real public contract.
  *Mitigation:* the hard carve-out paragraph in every tier; ultra reserved for opt-in; correctness/
  security explicitly out of scope of the axis. *Status:* Open (accepted, behavioral).
- **RISK-GRAPHFRESH-001** — Stage 2 edits to the working `graphify-global-sync` autosync regress it
  (missed syncs, double syncs, or perf). *Mitigation:* pin-then-edit regression test; Stage 2 lands
  only after Stage 1; splittable into a follow-up spec if risk grows. *Status:* Open until Stage 2.

## 9. Rollout order

1. Universal injector refactor + leanmode axis (behavior-preserving) + tests green.
2. Verbosity axis + tiers + `/aidev` command + config + variants (A in full & lite).
3. G Stage 1 (grep nudge).
4. G Stage 2 (freshness, guarded) — or defer to follow-up spec.
