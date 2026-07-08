---
paths:
  - "**/bot.py"
  - "**/handlers/**"
---

# Telegram bots (Python)
- Library: `aiogram` (async-only) for high-concurrency/broadcast-heavy bots; `python-telegram-bot`
  for easier data/ML-pipeline integration and a larger ecosystem — it also ships a built-in
  `AIORateLimiter`. Pick one per project, don't mix both in the same bot.
- Long polling by default — no domain/TLS/reverse-proxy needed, simplest to run and debug.
  Switch to webhooks only for a specific production-scale reason (lower latency/cost at
  volume); webhooks need a public HTTPS endpoint and add real deployment complexity.
- Rate limits: respect HTTP 429's `retry_after`, never blind-retry. Limits stack
  per-chat/per-group/global — queue outgoing messages for broadcasts rather than firing them
  all at once. Telegram's paid "Paid Broadcasts" (Stars-funded) raises the ceiling from
  30/sec to 1000/sec — an opt-in paid feature, not something to reach for by default.
- Session/state: don't hold conversation state (FSM/dialog steps) in memory past a toy bot —
  a restart loses every in-flight conversation. Persist to Redis/Postgres/SQLite keyed by
  chat id (aiogram's FSM storage backends handle this directly).
- Validate all user input the same as any other untrusted external input (see
  `security.md`) — a Telegram user id is not an auth credential by itself.
- Python rules (`python.base.md`) also apply.
- Avoid: blind-retrying on 429, in-memory-only FSM/session state past a prototype, mixing
  aiogram and python-telegram-bot in one codebase, treating chat/user id as auth.
