# Delta 007 — glossary, ADRs, seams and Out of Scope in `brainstorming`

Date: 2026-07-28
Status: approved, not yet planned

Target: `plugins/ultrapowers/skills/brainstorming/SKILL.md` in the ultrapowers fork.
File: `transform/deltas/007-design-records.patch`.

## What it adds, and where

Four rules, in two hunks, both in sections that already exist.

### Hunk A — the design itself (around line 87)

Today the design checklist is one line: `- Cover: architecture, components, data flow, error
handling, testing`. "Testing" is named and left undefined.

Added after it:

- **Testing Decisions** — name the seams at which the behaviour will be verified. Prefer existing
  seams to new ones, take the highest one available, aim for one per change. A seam is stated as
  an intent to verify — "behaviour is checked at the HTTP contract" — never as a file or a class,
  so it survives a change of structure. Required only when the work produces executable
  behaviour; for documentation or configuration it is omitted explicitly, not silently.
- **Out of Scope** — a required section naming what this design deliberately does not cover.

### Hunk B — after the design (around line 105, `**Documentation:**`)

- **Glossary** — when a term is sharpened during the session, write it to `GLOSSARY.md` **at that
  moment**, not batched at the end. Definition only: no implementation, no decisions.
- **ADR** — write one only when all three hold: the decision is hard to reverse, it is surprising
  without context, and it was a real trade-off. Failing any one, no ADR. Format
  `docs/adr/NNNN-slug.md` with frontmatter `status:`, `# ADR-NNNN Title`, and `## Context` /
  `## Decision` / `## Consequences`.

## Why these belong in the skill rather than in rules

Each is a judgement no code can make: whether a term is overloaded, whether a decision was a real
trade-off, where a seam belongs. The deterministic halves — next ADR number, format checking,
finding undefined terms — live in the CLI from the decision-records design. This delta carries
only what must be decided by a thinking reader.

The seams rule specifically must **not** be duplicated into `testing.md`. That file answers *how*
a test is written; this answers *where* behaviour is verified. Two files, two questions, no shared
text to drift apart.

## Format constraints

The fork's own parser is stricter than `git apply` and must be the acceptance test:

- `parsePatch` asserts hunk geometry exactly; a blank context line stripped of its leading space
  fails with `header declares N/M, body has N-1/M-1`.
- `git apply --check` tolerates that and will pass a patch the build rejects. Verify with
  `parsePatch` + `applyPatch` against `.build/`, never with `git apply` alone.
- Keep hunks free of blank context lines where possible; it removes the failure mode entirely.

Attribution: the ADR shape follows the format `gsd-doc-classifier` recognises, and the glossary
discipline comes from `grill-with-docs` in mattpocock/skills (MIT). Marker comment in the same
style as `grilling-graft:v1` from delta 006.

## Decision taken 2026-07-28 (was: open)

The question was whether to move `brainstorming`'s spec output from `docs/ultrapowers/specs/` to
`docs/specs/`, putting it in the discovery path of `/gsd-ingest-docs`.

**Neither.** The spec is a phase document and lives at `.ultrapowers/phases/NN-slug/NN-SPEC.md`;
`docs/specs/` is not created. ADRs move to `.ultrapowers/adr/NNNN-slug.md` for the same reason.

Consequence, accepted knowingly: `/gsd-ingest-docs` scans `docs/adr/`, `docs/prd/`, `docs/specs/`
and `docs/rfc/`, so neither specs nor ADRs migrate into a `.planning/` setup for free any more.
The base-to-full bridge becomes explicit work rather than a property of where files sit.

Planned in `docs/superpowers/plans/2026-07-28-ultrapowers-planning-tree.md` (delta `007`) and
`…-design-records-and-stack-rules.md` (delta `010`). The delta numbering in this document is
superseded: the build applies deltas in filename order, and a delta must be authored against the
tree its predecessors produce, so design records became `010`.

## Out of scope

- Any change to `testing.md` or the rules compiler.
- The CLI tooling (`adr`, `glossary`, `risks`) — separate design.
- Retrofitting existing specs into the new sections.
