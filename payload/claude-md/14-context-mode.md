## CONTEXT-MODE (tool routing, if active)
- A `ctx_*` tool that errors as not-found is a deferred schema: `ToolSearch` `select:<tool>`
  once, then retry. Never fall back to the raw tool.
