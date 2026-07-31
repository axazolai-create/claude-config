---
status: accepted
date: 2026-07-31
---

# ADR-0003 Reversible deletion through a trash batch instead of rm

## Context

Cleanup operations have to remove files: stale bundle content, a foreign gsd-core installation,
components a profile no longer ships. Removing them outright is simpler and is what every such
tool does by default.

## Decision

Every removal is a **move** into `.cleanup-trash/<timestamp>/`, with seven-day retention and a
documented `restoreBatch` rollback. Nothing is unlinked. The batch directory is printed before
the first move, so a crash part-way through still leaves the operator the one string the
rollback needs.

## Consequences

`/claude-cleanup` and the foreign gsd-core detector share one mechanism instead of each
inventing a removal path. Deletion becomes reviewable: what went is a directory listing, not a
memory. The trash needs its own retention sweep, which `purgeRetention()` provides, and a
machine that never runs the sweep accumulates batches — a cost accepted against the alternative,
where a wrong removal is unrecoverable. Consent is asked once per batch rather than once per
file, which is what makes the offer answerable at all.
