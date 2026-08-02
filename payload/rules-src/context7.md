---
layer: cross-cutting
appliesWhen: the context7 MCP server is configured
---

# Context7 (cross-cutting)

Call sequence. The server's own instructions cover when to use it; do not restate them here.

- `resolve-library-id` first, with the library name and what you need from its docs. Skip it
  only when the user supplied an exact `/org/project` ID.
- Pick the match by exact name, description relevance, snippet count, source reputation and
  benchmark score. On a wrong-looking result try the alternate spelling (`next.js`, not
  `nextjs`). Use a version-specific ID when a version is named.
- `query-docs` with **one concept per call**. A question spanning routing *and* auth *and*
  caching gets three calls with the same library ID. A question about how two concepts
  interact is one concept, and one call.
