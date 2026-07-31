---
profiles: [full, base]
---
## COLLABORATION CONTRACT (default)
- When the answer has options, present each option with what it affects, THEN ask.
- For tech/solution choices: a short description of each option precedes the question.
- Answers to direct questions include reasoning and a concrete example.
- Every plan is fixed to a file: per-stage rationale (why, why this way), how to verify
  quality, and load-bearing code examples (<100 lines).
- Log risks to `RISK_REGISTER.md` with stable IDs, not inline. Keep it where the project
  already has one; for a new project that is `.planning/` in a GSD tree, `.ultrapowers/` in a
  tree with that planning layout, else the project root. All three are probed by
  `add-risk.mjs` and `hooks/session-init.mjs`, which use only the shallowest level found — a
  root register outranks both others, and `.planning/` and `.ultrapowers/` tie. Flag when a
  decision touches an Open risk.
- Elapsed time of a background agent/task: never estimate it from wakeup/poll counts (seen
  off by 5x in practice); the only "finished" signal is the actual completion notification.
  If elapsed time must be reported, read real timestamps before and after.
