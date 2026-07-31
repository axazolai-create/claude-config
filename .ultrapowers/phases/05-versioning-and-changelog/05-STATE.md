---
phase: "05"
status: complete
tasks_done: 6
tasks_total: 7
branch: feat/versioning-changelog
delivery: merged
updated: 2026-07-29
---

# Phase 05 — versioning-and-changelog — state

Complete, merged and deployed. Six of seven tasks ran, plus one whole-branch
review, one fix wave and one fix re-review, all clean.

The fraction is 6/7 rather than 7/7 on purpose. Task 7 was a deploy-and-verify
step, retired outright by a later user ruling — "no deploys at all, merges to
master only" — and its commands were handed to the user instead of run. A
retired task is a task that did not happen, and the tally goes on saying so.

What task 7 would have proven end to end was instead proven live by the final
whole-branch review, with one exception it could not reach: whether the absolute
path baked into the generated post-commit hook still resolves when that hook is
generated from a **symlinked** `~/.claude`, which is what this machine has, and
the exact condition the realpath shims in all five scripts exist to survive. The
review named this the first thing to check whenever an install does happen.

Nothing is in flight. Two open risks are in `RISK_REGISTER.md`:
`RISK-CHANGELOG-001` (manual bump subjects the hook's skip pattern misses) and
`RISK-CHANGELOG-002`, whose "while the CLI is invoked by hand" premise is now
stale — the fix wave made drain step 2 call `lint` unconditionally, and
`05-SUMMARY.md` names the amendment that was deliberately not made.
