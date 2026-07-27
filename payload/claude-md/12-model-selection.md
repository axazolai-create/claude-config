# Model Selection Policy
- DEFAULT executor: claude-opus-5. Step DOWN to claude-sonnet-5 for mechanical, high-volume,
  or latency-bound work; claude-haiku-4-5 for no-judgment classification/extraction.
  claude-fable-5 only when the user names it (2x Opus 5 cost).
- Tune cost with `effort`, not by dropping tier — `low`/`medium` on Opus 5 are strong.
  Start `xhigh` for coding/agentic work, `high` otherwise, then sweep down. `max` is a
  reserve, not a default; `effort` is inert on claude-haiku-4-5 (no such parameter).
- Opus 5 thinks by default and verifies its own work: do not add "verify"/"double-check"
  scaffolding, and revisit any `max_tokens` that was sized for a no-thinking budget.
- Full routing, the effort ladder, and the per-role GSD effort map → the
  `model-selection-policy` skill.
