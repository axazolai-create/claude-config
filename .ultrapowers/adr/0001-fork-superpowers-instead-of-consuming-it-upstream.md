---
status: accepted
date: 2026-07-31
---

# ADR-0001 Fork superpowers instead of consuming it upstream

## Context

Upstream ships behaviour this repository needs to change — naming, defaults, and rules that
bind every session — in ways upstream will not take. Two approaches were tried before this one.
Patching the cached plugin in place was disproved by execution: a full scan found 1504
occurrences across 111 files in 382 distinct spellings, against a plan's baseline of 119
measured over three directories, and deciding 382 variants by hand cost more than the problem
the patching was meant to avoid. Consuming upstream unchanged was never viable, because the
changes are the reason the dependency exists at all.

## Decision

Fork. Keep `original` and `patch` as separate branches and rebuild `main` from
`original + patch` on every upstream release. Never hand-edit `main` — it is generated, and an
edit there is lost on the next rebuild without warning. Each change to upstream behaviour is a
numbered delta applied in filename order, so what we changed stays legible without diffing two
trees.

## Consequences

A permanent merge burden, which this project exists to absorb: it is therefore never an
argument against making a change, only against making one carelessly. The build refuses on
unclassified paths rather than guessing, which is what keeps the rebuild trustworthy. The
exposure — that a fork left un-updated drifts until merging stops being mechanical — is carried
as `RISK-ULTRAPOWERS-001`, and the `drift` check exists to make the distance visible before it
becomes expensive.
