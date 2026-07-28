# Stack rules resolved at design time — design

Date: 2026-07-28
Status: approved, not yet planned

## Context

The machinery already exists and was switched off for the wrong reason.

`hooks/lib/stack-rules-check.mjs` prints
`{ status, sourceHash, stackFingerprint, markers, snapshotPath }`, and the per-project snapshot
`.claude/stack-rules.md` already carries its provenance in frontmatter:

```yaml
sourceHash: 4f4fe69a69c9cefd
stackFingerprint: da39a3ee5e6b4b0d
stacks: []
generatedAt: 2026-07-22T00:48:15.000Z
```

`session-init.mjs` dropped the desync check on 2026-07-13 as "too eager to fire a rebuild
instruction every session". The culprit was `sourceHash`: it hashes path + size + **mtime** across
`rules-src/`, so every `setup.mjs` run rewrites the files, mtime moves, and the hash diverges
although not one byte of rule text changed.

`stackFingerprint` is a different signal — root markers of the project itself (`package.json`,
`next.config.*`, `nest-cli.json`, `manage.py`, `build.gradle.kts`, `Package.swift`). Its own
comment says it "only needs to CHANGE when the project's stack changes". It was never the noisy
one. It was disabled as collateral.

## The mechanism

1. **Trigger point is planning, not session start.** This is the actual cure for "too eager":
   brainstorming happens orders of magnitude less often than a session start, and "have we drifted
   from the stack?" is a meaningful question there and noise everywhere else.
2. **Compare** the current `stackFingerprint` against the value in the snapshot's frontmatter.
   Equal — say nothing.
3. **Diverged** — name what appeared or vanished (`markers` already returns the list) and add the
   `rules-src/` layers answering the new markers. Not a full rebuild: layers are added, the
   snapshot is not regenerated from scratch.
4. `sourceHash` takes no part in this check. "The bundled rules changed" is a different question
   asked at a different moment.

This covers both entry conditions: an empty start (no markers → `stacks: []`, cross-cutting rules
only, exactly today's state for claude-config) and joining a project mid-flight (markers already
present → the layers arrive on the first planning pass).

Rules are written **only for what was actually detected**. A project with no Python marker never
receives Python rules, and the snapshot says so explicitly rather than by omission.

## Testing rules move to design time — the "where", not the "how"

`stack-rules.md` already carries "boundary trust": test the behaviour at the boundary that
guarantees it, and do not re-test it downstream. That is the same notion as the *seams* that
`to-spec` sketches — but it currently lives in the testing rules, so it applies when the test is
already being written, at which point the structure is fixed and moving a seam is expensive.

The fix is not to move the rule but to cut it in two, so no text is duplicated:

| Where | Question | Content |
|---|---|---|
| `brainstorming` (design) | **Where** is behaviour verified | Name the seams; prefer existing to new; take the highest; aim for one per change |
| `testing.md` (code) | **How** is the test written | AAA, never mock the unit under test, determinism, factories over literals |

Two guards make this safe:

- A seam is named as an **intent to verify** — "behaviour is checked at the HTTP contract" — never
  as a file or class. Such a statement survives a change of structure; `UserController.spec.ts`
  does not.
- The section is required only when the work produces executable behaviour. For documentation or
  configuration it is omitted **explicitly**, not silently.

The same delta adds a mandatory **Out of Scope** section to the design, which neither
`brainstorming` nor `writing-plans` requires today, and which is cheap insurance against creep.

## Risks, and how each is closed

1. **`sourceHash` gives false desync.** It hashes mtime, which every deploy moves. Closed here by
   not using it in this check at all. If freshness-of-rules ever needs its own signal, it must
   hash content, not mtime — otherwise it will be switched off a second time for the same reason.
2. **`ROOT_PATTERNS` only looks at the repository root.** In a monorepo `next.config.ts` sits in
   `apps/web/`, so the frontend stack stays invisible. Closed by computing the fingerprint over
   the root **plus every workspace**, reusing `list-workspaces.mjs` — which already exists and was
   repaired today.
3. **One snapshot, several stacks.** `stacks:` is a flat list, so a monorepo cannot express that
   Next belongs to `apps/web` and Nest to `apps/backend`; the rules would arrive everywhere.
   Closed by making it a map of workspace to stacks, with the snapshot's sections scoped
   accordingly.
4. **Drift is symmetric.** A stack can also disappear — Vite removed, migrated to Next — leaving
   rules that no longer apply. The comparison must report both directions; reacting only to
   additions leaves stale rules in place indefinitely.

## Out of scope

- Restoring any check to `session-init.mjs`; the existence-only check there stays as it is.
- Rebuilding a snapshot wholesale on divergence.
- Automatic editing of `rules-src/` itself.
