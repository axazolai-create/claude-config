# Design: graphify ↔ Neo4j (LAN) — write, MCP read, Cypher layer

Date: 2026-07-21
Status: Approved for planning
Scope: claude-config (dotfiles/bootstrap repo)

## 1. Problem & resolved position

We want graphify's knowledge graph available in a Neo4j instance running on the LAN
(NAS), reproducibly configured when the config is deployed to another PC, plus a
Cypher-based read path.

**Hard constraint (verified in graphify source):** graphify can *write* to Neo4j
(`graphify export neo4j --push`) but cannot *read* from it — `query`/`serve`/`explain`
and the PreToolUse graph hooks are hardcoded to `graph.json`. "Neo4j instead of JSON"
is therefore impossible without forking graphify's read layer.

**Resolved position (endorsed by external analysis):**
- graphify/GSD-Core stay on JSON per-project — their read layer is untouched.
- Neo4j is an **agent-facing Cypher layer** over the *global* graph, reached via an MCP.
- The integrator is the agent (Claude), not GSD-Core: per-project questions → local
  `graphify query` (JSON); cross-project/global questions → Cypher over Neo4j via MCP.

Only the **global** graph (`~/.graphify/global-graph.json`) is pushed. It is already the
merged, prefixed aggregate of every project graph on the machine, so pushing per-project
graphs would be redundant and would lose the cross-project ID isolation.

## 2. Verified graphify facts (load-bearing)

- Write CLI: `graphify export neo4j [--graph PATH] [--push URI] [--user U] [--password P]`.
  Password is read from `NEO4J_PASSWORD` env when `--password` is omitted (keeps it off
  argv / shell history). Uses `MERGE` → idempotent, safe to re-run.
- `push_to_neo4j` writes node props via `SET n += $props`, edges via `SET r += $props`.
- Global graph nodes carry a **`repo` property** (= repo_tag) and IDs are `repo_tag::orig`
  (`prefix_graph_for_global` in `build.py`). This is the discriminator for scoped deletes.
- `pip install neo4j` is required for `--push` (driver not bundled).
- Global graph built by `graphify extract <dir> --global --as <tag>` (already done by
  `payload/graphify-sync-all.mjs`).

## 3. Components

### C1 — Write path: global graph → Neo4j (LAN), multi-PC-safe

**Config location:** `~/.graphify/neo4j.env` (user home, outside every repo, chmod 600).
Holds `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`. Never committed — satisfies the
no-secrets-in-commits invariant without relying on repo `.gitignore`.

**Wrapper:** `payload/bin/graphify-neo4j-push.mjs`
1. Load `~/.graphify/neo4j.env` into `process.env`; abort with a clear message if missing
   or incomplete.
2. Reachability probe on the bolt host:port (short TCP connect). If unreachable →
   **fail-soft**: warn and exit 0 (never block a commit/sync).
3. **Per-repo hygiene** (multi-PC-safe, replaces the rejected global wipe): read the set of
   `repo` tags present in this PC's `global-graph.json`; for each tag run
   `MATCH (n {repo: $tag}) DETACH DELETE n` against Neo4j. Repos known only to *other* PCs
   are not in this set → never touched.
4. Push: `graphify export neo4j --graph ~/.graphify/global-graph.json --push $NEO4J_URI
   --user $NEO4J_USER` (password from env). MERGE re-adds this PC's repos fresh.

Rationale: the ownership unit is the repo, not the PC. A per-repo scoped delete drops
stale nodes (deleted files) for repos this PC owns while leaving other PCs' repos intact.
Same repo on two PCs → last-writer-wins (correct "latest state"). See RISK-NEO4J-001.

**Integration:** opt-in `--neo4j-push` flag on `graphify-sync-all.mjs` that invokes the
wrapper after the global graph is rebuilt. Manual invocation also supported.

**Scoped-delete Cypher (load-bearing):**
```cypher
// run once per repo tag present in this PC's global graph, before the MERGE push
MATCH (n {repo: $tag}) DETACH DELETE n;
```

### C2 — Read path: Neo4j MCP for agents

Add a **Neo4j** section to `payload/commands/init-mcp.md` (mirrors the Postgres section:
consent → add → verify):
```
claude mcp add neo4j --scope user \
  -e NEO4J_URI="bolt://<nas>:7687" \
  -e NEO4J_USERNAME="neo4j" \
  -e NEO4J_PASSWORD="<pw>" \
  -- uvx mcp-neo4j-cypher
```
- **User scope** — the global graph is cross-project, so the MCP must be available in every
  repo, not wired per-project.
- Verify the exact package name (`mcp-neo4j-cypher`) via `claude mcp list` / WebSearch at
  wire time, per init-mcp's "verify the current package" discipline.
- Creds land in the user's private `~/.claude` MCP config (never this repo).

### C3 — Cypher cookbook + agent patch

**Cookbook** `payload/graphify-neo4j.cypher` — canned queries mapping graphify's
`query`/`path`/`explain` onto Cypher, so a human (Neo4j Browser / cypher-shell) or agent
has ready primitives:
```cypher
// god nodes (highest-degree) across all repos
MATCH (n) RETURN n.label, n.repo, size([(n)--() | 1]) AS degree
ORDER BY degree DESC LIMIT 20;

// neighbors of a concept
MATCH (n {label: $label})--(m) RETURN DISTINCT m.label, m.repo, m.source_file LIMIT 50;

// shortest path between two concepts (cross-repo bridges show here)
MATCH (a {label: $from}), (b {label: $to}),
      p = shortestPath((a)-[*..8]-(b)) RETURN p;

// what repos does a given external library connect?
MATCH (lib {label: $lib})--(m) RETURN DISTINCT m.repo ORDER BY m.repo;
```

**Patch** (analogous to the existing gsd-agent patches — a new versioned block in
`hooks/lib/gsd-agent-patches.mjs`, applied by `apply-gsd-agent-patches.mjs` / `/init-session`):
injects graphify guidance telling agents that a `neo4j` MCP holds the merged global graph,
and for cross-project/global questions they should query it with Cypher (cookbook), while
per-project questions still use `graphify query` on local JSON. The patch is anchored prose
with a version marker, so it is idempotent and resilient to graphify upgrades.

### C4 — Deploy wiring in `setup.mjs`

> **Updated 2026-07-24 → test-before-save.** See
> `2026-07-24-graphify-neo4j-setup-test-before-save-plan.md`. The original C4 wrote
> `neo4j.env` unconditionally (and defaulted the URI to localhost); a second-PC deploy then
> saved a wrong host/password silently and failed only at push time. C4 now *tests* first.

One-time interactive prompt reusing the `CLAUDE_CONFIG_UPDATE_CHECK` "decide once per
machine" idiom (gated `VARIANT === "full" && INTERACTIVE`):
- Ask "Configure graphify → Neo4j (LAN)?"; if yes, collect **host/IP, port (default 7687),
  user, password** via `askRaw` (case-preserving — `ask()` lowercases and would corrupt the
  password). Build `bolt://${host}:${port}` (direct scheme, no routing surprises).
- **Auto-install the driver, then test:** locate graphify's interpreter
  (`findGraphifyPython`), `ensureNeo4jDriver` (uv `--with neo4j` / pipx inject / pip), then
  `testNeo4jConnection` — TCP reachability + a real driver connect+auth+read (`RETURN 1` +
  node count), creds via env, never argv.
- **Persist only on success:** write `~/.graphify/neo4j.env` (chmod 600) + record the
  non-secret `GRAPHIFY_NEO4J="1"` flag in `settings.json.env`. On a failed test nothing is
  saved and `GRAPHIFY_NEO4J` is left unset, so the offer re-asks next run.
- The driver ships by default now: `graphify-setup.mjs` extras include `neo4j`
  (`graphifyy[neo4j]`), so a normal graphify install already carries it.
- Remind: run `/init-mcp neo4j` (+ restart) for the read MCP, and run the push wrapper /
  `graphify-sync-all --neo4j-push` for the write path.

### C5 — One-time push of the current global graph (phase 3)

After C1–C4 land, run the wrapper once against the NAS Neo4j (already running). Requires
the real URI + creds + `pip install neo4j` + reachability. Executed manually with consent.

### C6 — graphify freshness check in setup.mjs and init-stack (independent)

Independent of Neo4j — graphify-toolchain hygiene. The installed graphify can silently lag
PyPI (verified: 0.9.5 installed vs 0.9.22 latest at design time; upgraded to 0.9.22 during
design). Add a **standalone `payload/bin/graphify-freshness.mjs`** (more testable than a
`--check` mode buried in `graphify-setup.mjs`): read installed version (`graphify
--version`), fetch latest from PyPI
(`https://pypi.org/pypi/graphifyy/json` → `.info.version`), compare, and if behind print a
one-line nudge with the upgrade command (`node graphify-setup.mjs` / `uv tool upgrade
graphifyy` / `pip install -U graphifyy`). **Fail-soft**: no network / not installed →
silent skip, exit 0, never blocks.

- `setup.mjs` calls it once near its end summary (best-effort, like the existing
  `CLAUDE_CONFIG_UPDATE_CHECK` nudge).
- `init-stack` (`payload/commands/init-stack.md`) runs it as a step so a stack-init surfaces
  a stale graphify.

This component can be executed or skipped without affecting C1–C5.

## 4. Data flow

```
per-project graph.json ──graphify extract --global──▶ ~/.graphify/global-graph.json (JSON, source of truth for graphify reads)
                                                             │
                                   graphify-neo4j-push.mjs   │  (per-repo DETACH DELETE, then MERGE push)
                                                             ▼
                                                     Neo4j on NAS (bolt://<nas>:7687)
                                                             ▲
                                          neo4j MCP (uvx mcp-neo4j-cypher, user scope)
                                                             │  Cypher
                                                        Claude / subagents  ◀── graphify query (local JSON, per-project)
```

## 5. How to verify quality

- C1: after a push, `MATCH (n) RETURN count(n)` in Neo4j ≈ global graph node count; delete a
  file in a repo, re-sync+push, confirm its node is gone (stale hygiene works); other repos'
  counts unchanged (multi-PC safety).
- C1 fail-soft: point URI at an unreachable host → wrapper warns and exits 0, no crash.
- C4 test-before-save: in setup, enter a wrong password → connection test FAILS, `neo4j.env`
  is NOT written, `GRAPHIFY_NEO4J` stays unset (re-asks next run); enter correct host/port/pw →
  test prints the node count and `neo4j.env` is written. Unit-covered in `neo4j-config.test.mjs`
  (`testNeo4jConnection`: bad URI / unreachable / no-python / success / auth-failure).
- C2: `claude mcp list` shows `neo4j` connected; a Cypher query returns rows.
- C3 patch: `apply-gsd-agent-patches.mjs` reports the new patch applied; re-run is a no-op
  (idempotent); target files carry the version marker.
- Secrets: `git grep -i neo4j_password` in the repo returns nothing; password exists only in
  `~/.graphify/neo4j.env`.

## 6. Risks (tracked in RISK_REGISTER.md)

- RISK-NEO4J-001 — multi-source staleness (per-repo hygiene, not global wipe).
- RISK-NEO4J-002 — NAS unavailability at push time (fail-soft).
- RISK-NEO4J-003 — secret handling (env file only, never committed).
- RISK-NEO4J-004 — graphify upgrade fragility (anchored patch + public CLI).
- RISK-NEO4J-005 — same repo on two PCs flip-flopping (last-writer-wins; optional authoritative-PC).

## 7. Out of scope (local) / parallel upstream track

- **Local fork/patch of graphify's read layer — rejected** (heavy, brittle to upstream updates;
  see the option evaluation). Local reads go through the MCP with the agent as integrator.
- **Instead, an upstream feature request is prepared**: a pluggable Neo4j/Cypher graph-store
  backend with JSON fallback, so a Neo4j-native read path is maintained by graphify upstream
  rather than as a local site-packages patch. Draft:
  `docs/2026-07-21-graphify-neo4j-backend-feature-request.md` (to post at
  github.com/safishamsi/graphify/issues). This is a parallel, independent track — the mirror
  design ships regardless of if/when the upstream feature lands.
- Standing up Neo4j itself — it already runs on the NAS.
