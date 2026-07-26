## CONTEXT-MODE (tool routing, if active)
- context-mode (base plugin) hard-denies `WebFetch` (use `ctx_fetch_and_index`+`ctx_search`)
  and nudges Bash/Grep/large-`Read` toward its `ctx_*` MCP tools so raw output stays out of
  context. Reach for them PROACTIVELY, not after a denial: filter/aggregate command output
  via `ctx_execute`/`ctx_batch_execute`; summarize large files via `ctx_execute_file` (plain
  `Read` only when you will `Edit`). If a `ctx_*` tool errors as not-found it's a deferred
  schema — `ToolSearch` `select:<tool>` once and retry, never fall back to the raw tool.
  Diagnostics: `/ctx-doctor`.
