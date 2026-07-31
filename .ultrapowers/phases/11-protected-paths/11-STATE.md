---
phase: "11"
status: complete
action: null
tasks_done: 5
tasks_total: 5
branch: feat/protected-paths
delivery: branch
depends_on: []
updated: 2026-07-31
---

# Phase 11 — protected-paths — state

Implemented on `feat/protected-paths`, five tasks, both suites green: 602 from the repository
root and 23 in the hidden `.test/unit/`.

What shipped: `payload/hooks/lib/protected-lib.mjs` (a gitignore-subset matcher, rule assembly
down the target's chain, the bash heuristic and the verdict, all pure) and
`payload/hooks/protected-guard.mjs`, registered on `Edit|Write|MultiEdit|NotebookEdit|Bash`
for every profile including `lite`.

**The mechanism ships unarmed.** This repository has no `.protected` file; arming it is the
user's decision, and adding one is what turns the hook on.

Three defects were found by running tests rather than by reading them, and each is recorded in
the commit that fixed it: a bare directory name (`rm -rf docs`) produced no candidate because
"looks like a path" was tested by a slash or a dot; a path lifted from an unparseable command
carries junk ahead of the real one, so suffixes must be tried; and `variants.test.mjs` reported
a plain string constant as an import edge, because its scanner skipped across newlines from the
`import` keyword to the first dot-prefixed literal anywhere in the file. The last one was fixed
in the scanner rather than worked around in the source.

Two README claims were already stale before this phase and were corrected with it: `lite` was
described as carrying "exactly 6 hooks" when it carries nine, and one of the six named a hook
(`leanmode-subagent`) that does not exist under that name. That is `RISK-CLAUDEMD-002`'s class,
found again by hand — the mechanical check for it is still unbuilt.
