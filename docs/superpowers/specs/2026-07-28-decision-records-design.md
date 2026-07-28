# Decision records: glossary, ADRs and a self-maintaining risk register — design

Date: 2026-07-28
Status: approved, not yet planned

> **Amended 2026-07-28, after the `.ultrapowers/` layout was approved.** Every path in this
> document moves inside the tree: ADRs are `.ultrapowers/adr/NNNN-slug.md`, the glossary is
> `.ultrapowers/GLOSSARY.md`, the register is `.ultrapowers/RISK_REGISTER.md`. The reasoning
> below for choosing `docs/adr/` — that it is the discovery path of `/gsd-ingest-docs`, so ADRs
> migrate into a `.planning/` setup for free — no longer holds, and the base-to-full bridge
> becomes explicit work this design does not cover. Everything else stands: the four-section
> register, the status vocabulary, the CLI split between deterministic and judgement, and the
> non-blocking nudge hook.

## Context

Four kinds of durable knowledge are wanted, three of which do not exist yet:

- **Glossary** — nothing today. claude-config's vocabulary (`profile` vs `variant`, `payload` vs
  `bundle`, `delta`, `graft`, `optional group`, `curated`, `manifest`, `tier`) is explained only
  inside `setup.mjs` comments.
- **ADRs** — nothing today. The format is nevertheless already fixed from outside:
  `gsd-doc-classifier` recognises `docs/adr/NNNN-slug.md` with frontmatter `status:`, a
  `# ADR-NNNN Title` heading and `## Context` / `## Decision` / `## Consequences`, and marks such
  a document `locked: true`.
- **Risk register** — exists, 44 entries over 814 lines, and is drifting: 12 distinct spellings
  of the Status field, closed entries interleaved with open ones. Nothing parses it
  programmatically (`add-risk.mjs` targets a different file, `.planning/codebase/RISK_REGISTER.md`,
  in a different format), so its structure is free to change.

The requirement is that these be a standing practice, not something the user has to remember.

## What can be automated, and what cannot

| Deterministic — code | Judgement — instruction |
|---|---|
| Section order, sorting, table of contents | Whether a risk is genuinely closed |
| Normalising Status into a fixed vocabulary | Whether a decision deserves an ADR |
| Next free ADR number, template, format check | What a term actually means |
| Dangling references: `RISK-*` / `ADR-*` that do not exist | Which term is overloaded enough to define |
| Terms frequent in prose but absent from the glossary | — |

Everything on the right stays as instruction. A hook that guesses "this was an irreversible
decision" would be wrong often enough to train the user to ignore it.

## Layer 1 — CLI, in `payload/bin/`

Placed in claude-config rather than the fork: this is code, and `payload/` already has the test
convention (`*.test.mjs` beside each module, run with `node --test`) that plugin skills lack.
`alwaysExclude` keeps `**.test.mjs` out of installs.

### `risks`

- `risks lint` — non-zero exit on: unknown Status vocabulary, an entry in the wrong section, a
  duplicate or reused ID, a dangling `ADR-*` reference.
- `risks normalize` — rebuilds the file into four sections and regenerates the table of contents.
  Idempotent: a second run is a no-op.
- `risks add "<title>" --prefix VARIANT` — allocates the next free ID in that prefix and writes
  the skeleton. Never reuses an ID, including ones belonging to closed entries.

Status vocabulary, replacing the current twelve spellings:

| Status | Meaning |
|---|---|
| `Active` | Needs a decision or ongoing watch |
| `Deferred (<what is awaited>)` | Blocked on an external event — today's `until tests green`, `until Stage 2`, `verification pending` |
| `Mitigated` | Addressed by design; kept because the exposure is real |
| `Closed (<date>) — <why>` | Resolved; retained for provenance |

Nuances currently encoded in the status line (`accepted`, `mitigated by design`, `low`) move into
the Mitigation field, where they belong.

Closed entries are **never deleted**: their IDs are cited from at least ten documents across
`docs/`, and a closed risk explains why the code looks the way it does. They move to the bottom.
Splitting them into a separate file is deferred until roughly twenty accumulate; at six it is
only an extra file to open.

### `adr`

- `adr new "<title>"` — next number, `docs/adr/NNNN-slug.md`, frontmatter and the three sections,
  in the shape `gsd-doc-classifier` recognises.
- `adr lint` — format check, plus dangling cross-references in both directions.

`docs/adr/` is deliberately the discovery path of `/gsd-ingest-docs`, which scans `docs/adr/`,
`docs/prd/`, `docs/specs/`, `docs/rfc/`. ADRs therefore migrate into a `.planning/` setup for free
when a project moves from the base profile to full, at the highest precedence in
`ADR > SPEC > PRD > DOC`.

### `glossary`

- `glossary lint` — format check on `GLOSSARY.md`.
- `glossary suggest` — frequency pass over `docs/` and top-level `*.md`, reporting terms that
  appear often and are not defined. It proposes nothing and writes nothing: it only exposes gaps.

The file is `GLOSSARY.md` at the repository root. **Not** `CONTEXT.md`, despite that being the
upstream convention in `grill-with-docs`: GSD already uses
`.planning/phases/XX-name/{N}-CONTEXT.md` for per-phase decisions, and two different documents
sharing one name in projects that may host both is a trap.

## Layer 2 — nudge hook

`PreToolUse` on `Bash`, matching `git commit`. If the index contains `RISK_REGISTER.md`,
`docs/adr/**` or `GLOSSARY.md` and the corresponding `lint` fails, it prints what is wrong and the
command that fixes it.

It **does not block**. This follows `ci-watch-nudge` and `graphify-grep-nudge`, not
`secrets-gate` and `deny-curated-claude-md`: an unnormalised register is untidy, not dangerous.
In a repository without these files it stays silent.

## Layer 3 — instruction, as a fork delta

A delta to `brainstorming` stating what code cannot check:

- A term sharpened during the session goes into `GLOSSARY.md` **at that moment**, not batched at
  the end. Inline capture is exactly what separates a living glossary from a dead one.
- An ADR is written only when **all three** hold: the decision is hard to reverse, it is
  surprising without context, and it was a real trade-off. Failing any one, no ADR. A register
  that accumulates rubber-stamped entries stops being read — the same failure mode as a bloated
  risk register.

This follows delta `006`, which grafted the `grilling` interview discipline.

## Retrospective ADRs

The practice is dead if the directory is empty. Candidates from decisions already made, each
passing all three conditions:

1. Forking superpowers instead of consuming it upstream — permanent merge burden; context partly
   in `RISK-ULTRAPOWERS-001`.
2. `setup.mjs` printing `claude plugin install` commands instead of running them.
3. Reversible deletion through a trash batch with 7-day retention instead of `rm` — the shape of
   both `/claude-cleanup` and the planned gsd-core detector.
4. Three profiles replacing the two-variant allowlist model.
5. Leaving `~/.gsd/` untouched when switching profiles.

Start with 1, 2 and 3: they already constrain decisions being taken now.

## Risks

- Four documents can start duplicating each other. The boundary: an ADR records the **choice**, a
  risk entry records its **consequence**, a spec records the **scope of work**, the glossary
  records the **language**. One decision may legitimately produce both an ADR and a risk entry;
  they then cross-reference by stable ID.
- `risks normalize` rewrites a hand-maintained file. It must be a pure move — never an edit to
  the prose of an entry — so the diff reads as reordering and nothing else.

## Out of scope

- Migrating `.planning/codebase/RISK_REGISTER.md` or changing `add-risk.mjs`.
- Enforcing any of this in CI.
- Splitting closed risks into a separate file.
