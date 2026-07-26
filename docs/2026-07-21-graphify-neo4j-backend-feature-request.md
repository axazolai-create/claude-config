# Feature request: pluggable graph-store backend (Neo4j / Cypher) with JSON fallback

Draft for https://github.com/safishamsi/graphify/issues — tested against graphify 0.9.5.

## Summary

graphify already *writes* a graph to Neo4j and FalkorDB (`graphify export neo4j|falkordb
--push`), but every *read* path — `query`, `path`, `explain`, `serve` (MCP) — is hardcoded to
load `graph.json` into NetworkX. I'd like graphify to be able to **read** from the same graph
database it can already write to, behind a small pluggable backend interface, with JSON
remaining the default and the offline fallback.

## Motivation

The write half already exists; only the read half is missing, so the feature is half-built:

- `graphify/export.py`: `push_to_neo4j(uri, user, password, ...)`, `push_to_falkordb(...)`,
  `to_cypher(G, path)` — MERGE-based, idempotent, driver code already present.
- Node model already suits a graph DB: the global graph prefixes IDs `repo_tag::orig` and sets a
  `repo` property on every node (`prefix_graph_for_global` in `build.py`), so cross-project
  isolation and per-repo scoping are already encoded.

What's missing is symmetry: after pushing the merged **global** graph
(`~/.graphify/global-graph.json`) to Neo4j, there's no way to run `graphify query` against it.
Users who want cross-project / cross-repo queries have to bolt on a separate Neo4j MCP + a Cypher
cookbook and teach their agents a second read path — duplicating the UX graphify already ships
and that its own PreToolUse hooks nudge toward (`run graphify query "<question>"`).

## Proposal

Introduce a `GraphBackend` abstraction that the read commands go through:

```python
class GraphBackend(Protocol):
    def load(self, graph_ref: str | None) -> nx.Graph: ...          # whole graph / scope
    def neighbors(self, node_id: str) -> Iterable[dict]: ...
    def shortest_path(self, src_terms, tgt_terms) -> list[dict]: ...
    def score_nodes(self, terms: list[str]) -> list[tuple]: ...      # for query/path/explain match
```

- **`JsonBackend`** — the current behavior, refactored behind this interface (reads `graph.json`,
  `node_link_graph`, existing `_score_nodes`/BFS/DFS). Stays the **default**, zero-config, no new
  dependency.
- **`Neo4jBackend`** (and by symmetry a Cypher/FalkorDB variant) — implements the same operations
  as Cypher against the configured instance. Traversal (`neighbors`, `shortestPath`) pushes down
  to the database instead of loading the whole graph into memory.

Selection + config via env (reuse the existing push env so there's one set of knobs):

```
GRAPHIFY_GRAPH_BACKEND = json | neo4j | falkordb        # default: json
NEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORD             # already used by export --push
```

**Fallback (preserves the offline property):** if `GRAPHIFY_GRAPH_BACKEND=neo4j` but the instance
is unreachable, transparently fall back to the local `graph.json` and print a one-line notice.
A laptop off the LAN keeps working exactly as today.

The existing `export neo4j --push` naturally becomes the backend's write/sync operation, unifying
the write and read code around one connection config.

## Benefits

1. **Completes an existing half-feature** — graphify can already push to Neo4j/FalkorDB; this makes
   the round trip symmetric.
2. **Cross-project queries in the native tool** — `graphify query`/`path`/`explain` (and the MCP
   `serve`) work against the merged global graph with no external MCP or Cypher cookbook, and the
   built-in hooks that already say "run graphify query" just work at global scope.
3. **Live data** — reads reflect the database directly, with no rebuild → JSON → push lag.
4. **Scales past in-memory limits** — Cypher pushdown avoids loading one large JSON/NetworkX graph
   into memory (relevant given the existing 5000-node viz cap and `check_graph_file_size_cap`).
5. **Low blast radius** — JSON stays the default and the fallback; the new backend is opt-in and
   reuses the Cypher generation and driver code already in `export.py`.

## Non-goals / backward compatibility

- No change to extraction/build: graphify still produces `graph.json` as the canonical build
  artifact; the backend only affects *reads*.
- JSON remains the default backend — zero-config and offline behavior are unchanged.
- The graph-DB backend is strictly opt-in; unreachable → JSON fallback, never a hard failure.

## Scope / contribution

Happy to contribute a PR if the interface shape above is acceptable — starting with the
`JsonBackend` refactor (behavior-preserving) + a `Neo4jBackend` implementing `neighbors` and
`shortest_path` via Cypher, gated behind `GRAPHIFY_GRAPH_BACKEND` with the JSON fallback. Would
appreciate maintainer guidance on whether the backend seam should sit at `load()` (hydrate a
NetworkX graph from the DB, smaller surface) or at the per-operation level (true Cypher pushdown,
better scaling) — I lean toward the per-operation seam for the scaling win but the hydrate seam is
a smaller first step.
