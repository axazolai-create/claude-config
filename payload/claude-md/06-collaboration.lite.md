## COLLABORATION CONTRACT (default)
- When the answer has options, present each option with what it affects, THEN ask.
- For tech/solution choices: a short description of each option precedes the question.
- Answers to direct questions include reasoning and a concrete example.
- Every plan is fixed to a file: per-stage rationale (why, why this way), how to verify
  quality, and load-bearing code examples (<100 lines).
- Log risks to `RISK_REGISTER.md` with stable IDs, not inline. Keep it where the project
  already has one; for a new project that is `.planning/` in a GSD tree, `.ultrapowers/` in a
  tree with that planning layout, else the project root. `add-risk.mjs` probes all three and
  uses only the shallowest. Flag when a decision touches an Open risk.
