---
paths:
  - "**/bot.ts"
  - "**/bot.js"
  - "**/telegraf.config.*"
---

# Telegram bots (Node)
- Library: `grammy` is the 2026 default — tracks new Bot API methods faster, stronger
  TypeScript types/docs. `telegraf` has a larger legacy install base but lags API versions
  and has thinner docs — fine to keep maintaining an existing Telegraf bot, don't migrate a
  working one just to switch libraries.
- Long polling by default — no domain/TLS/reverse-proxy needed, simplest to run and debug.
  Switch to webhooks only for a specific production-scale reason (lower latency/cost at
  volume); webhooks need a public HTTPS endpoint and add real deployment complexity.
- Rate limits: respect HTTP 429's `retry_after` header, never blind-retry. Limits stack
  per-chat/per-group/global — queue outgoing messages for broadcasts rather than firing them
  all at once. Telegram's paid "Paid Broadcasts" (Stars-funded) raises the ceiling from
  30/sec to 1000/sec — an opt-in paid feature, not something to reach for by default.
- Session/state: don't hold conversation state in memory past a toy bot — a restart loses
  every in-flight conversation. Persist to Redis/Postgres/SQLite keyed by chat id.
- Validate all user input the same as any other untrusted external input (see
  `security.md`) — a Telegram user id is not an auth credential by itself.
- Node rules (`node.base.md`) also apply.
- Avoid: blind-retrying on 429, in-memory-only session state past a prototype, migrating a
  working Telegraf bot to grammY without a real reason, treating chat/user id as auth.
