# graphify ↔ Neo4j Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror graphify's merged global graph into a LAN Neo4j (write), expose it to agents via a Neo4j MCP + Cypher (read), wire the whole thing into new-PC deployment, and add a graphify freshness check — JSON stays graphify's source of truth.

**Architecture:** graphify keeps building/reading `graph.json` per project. A Node wrapper pushes the merged global graph (`~/.graphify/global-graph.json`) to Neo4j with a per-repo `DETACH DELETE`-then-`MERGE` cycle (multi-PC-safe, no global wipe). Agents read the cross-project graph through a user-scope Neo4j MCP with a Cypher cookbook; a gsd-agent patch teaches them when to use it. Secrets live only in `~/.graphify/neo4j.env`.

**Tech Stack:** Node ≥20 (stdlib only — no npm deps), Python neo4j driver (already required by `graphify export neo4j --push`), graphify ≥0.9.22 CLI, Neo4j (bolt), `node --test` for unit tests.

## Global Constraints

- **No npm dependencies** — all `.mjs` use Node stdlib only (`node:fs`, `node:net`, `node:https`, `node:child_process`). Matches the repo's existing dependency-free scripts.
- **Secrets never in the repo or on argv** — Neo4j password lives only in `~/.graphify/neo4j.env` (chmod 600) and is passed to graphify via the `NEO4J_PASSWORD` env var, never `--password`. `git grep -i neo4j_password` in the repo MUST stay empty.
- **Fail-soft everywhere** — missing config, unreachable Neo4j, no network, or graphify absent → warn and `exit 0`. A push/check must never break a commit, sync, or setup run.
- **Multi-PC hygiene is per-repo, never a global wipe** — delete only nodes whose `repo` property is a tag present in *this* PC's global graph, then MERGE-push. Verified graphify internals: `prefix_graph_for_global` sets `data["repo"] = repo_tag` (build.py); `push_to_neo4j` writes props via `SET n += $props`.
- **graphify read path is untouched** — JSON stays the source of truth for `query`/`explain`/`path`/`serve`; Neo4j is an additive agent-facing mirror.
- **Docs and config files in English.**
- **Repo sources only** — edit files under `D:\6__Work\claude-config\payload\...` and repo root, never the installed `~/.claude/...` copies (setup.mjs deploys them).

## File Structure

- Create `payload/bin/lib/neo4j-config.mjs` — pure config/URI/graph helpers (testable).
- Create `payload/bin/lib/neo4j-config.test.mjs` — `node --test` unit tests.
- Create `payload/bin/graphify-neo4j-prune.py` — per-repo `DETACH DELETE` via the neo4j driver.
- Create `payload/bin/graphify-neo4j-push.mjs` — orchestrator (load → probe → prune → push).
- Create `payload/graphify-neo4j.cypher` — read cookbook (god-nodes, neighbors, path, bridges).
- Create `payload/bin/graphify-freshness.mjs` — best-effort "graphify is stale" nudge.
- Create `payload/bin/graphify-freshness.test.mjs` — `node --test` for the semver compare.
- Modify `payload/graphify-sync-all.mjs` — add opt-in `--neo4j-push`.
- Modify `payload/commands/init-mcp.md` — add a Neo4j MCP section.
- Modify `payload/hooks/lib/gsd-agent-patches.mjs` — add the Cypher/MCP guidance patch.
- Modify `setup.mjs` — Neo4j opt-in prompt (writes `~/.graphify/neo4j.env`) + freshness call.
- Modify `payload/commands/init-stack.md` — add a freshness-check step.

---

## Task 1: Config + graph helpers (`neo4j-config.mjs`)

**Files:**
- Create: `payload/bin/lib/neo4j-config.mjs`
- Test: `payload/bin/lib/neo4j-config.test.mjs`

**Interfaces:**
- Produces:
  - `NEO4J_ENV_PATH: string`, `GLOBAL_GRAPH_PATH: string`
  - `parseEnvFile(text: string) -> Record<string,string>`
  - `loadNeo4jConfig(path?: string) -> {ok:true, config:{uri,user,password}} | {ok:false, error:string}`
  - `parseBoltHostPort(uri: string) -> {host:string, port:number} | null`
  - `repoTagsFromGlobalGraph(graphJsonText: string) -> string[]`
  - `probeReachable(host: string, port: number, timeoutMs?: number) -> Promise<boolean>`

- [ ] **Step 1: Write the failing test**

```js
// payload/bin/lib/neo4j-config.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnvFile, loadNeo4jConfig, parseBoltHostPort, repoTagsFromGlobalGraph, probeReachable } from "./neo4j-config.mjs";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("parseEnvFile ignores comments/blanks and strips quotes", () => {
  const env = parseEnvFile('# c\n\nNEO4J_URI="bolt://nas:7687"\nNEO4J_USER=neo4j\nNEO4J_PASSWORD=\'p@ss\'\n');
  assert.deepEqual(env, { NEO4J_URI: "bolt://nas:7687", NEO4J_USER: "neo4j", NEO4J_PASSWORD: "p@ss" });
});

test("loadNeo4jConfig reports missing file / missing keys / ok", () => {
  assert.equal(loadNeo4jConfig(join(tmpdir(), "nope-xyz.env")).ok, false);
  const p = join(tmpdir(), `n4j-${process.pid}.env`);
  writeFileSync(p, "NEO4J_URI=bolt://h:7687\n");
  assert.match(loadNeo4jConfig(p).error, /NEO4J_PASSWORD/);
  writeFileSync(p, "NEO4J_URI=bolt://h:7687\nNEO4J_PASSWORD=x\n");
  const r = loadNeo4jConfig(p);
  assert.equal(r.ok, true);
  assert.equal(r.config.user, "neo4j"); // defaulted
  rmSync(p);
});

test("parseBoltHostPort defaults port 7687 and accepts +s", () => {
  assert.deepEqual(parseBoltHostPort("bolt://nas:7687"), { host: "nas", port: 7687 });
  assert.deepEqual(parseBoltHostPort("neo4j://host"), { host: "host", port: 7687 });
  assert.deepEqual(parseBoltHostPort("neo4j+s://a.io:7999"), { host: "a.io", port: 7999 });
  assert.equal(parseBoltHostPort("http://x"), null);
});

test("repoTagsFromGlobalGraph returns distinct repo tags", () => {
  const g = JSON.stringify({ nodes: [{ id: "a::x", repo: "a" }, { id: "a::y", repo: "a" }, { id: "b::z", repo: "b" }, { id: "n" }] });
  assert.deepEqual(repoTagsFromGlobalGraph(g).sort(), ["a", "b"]);
});

test("probeReachable resolves false for a closed port", async () => {
  assert.equal(await probeReachable("127.0.0.1", 1, 500), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test payload/bin/lib/neo4j-config.test.mjs`
Expected: FAIL — `Cannot find module './neo4j-config.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// payload/bin/lib/neo4j-config.mjs
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import net from "node:net";

export const NEO4J_ENV_PATH = join(homedir(), ".graphify", "neo4j.env");
export const GLOBAL_GRAPH_PATH = join(homedir(), ".graphify", "global-graph.json");

export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

export function loadNeo4jConfig(path = NEO4J_ENV_PATH) {
  if (!existsSync(path)) return { ok: false, error: `config not found: ${path}` };
  const env = parseEnvFile(readFileSync(path, "utf8"));
  const uri = env.NEO4J_URI;
  const user = env.NEO4J_USER || "neo4j";
  const password = env.NEO4J_PASSWORD;
  const missing = [];
  if (!uri) missing.push("NEO4J_URI");
  if (!password) missing.push("NEO4J_PASSWORD");
  if (missing.length) return { ok: false, error: `missing ${missing.join(", ")} in ${path}` };
  return { ok: true, config: { uri, user, password } };
}

export function parseBoltHostPort(uri) {
  if (!uri) return null;
  const m = String(uri).match(/^(?:bolt|neo4j)(?:\+s|\+ssc)?:\/\/([^/:]+)(?::(\d+))?/i);
  if (!m) return null;
  return { host: m[1], port: m[2] ? Number(m[2]) : 7687 };
}

export function repoTagsFromGlobalGraph(graphJsonText) {
  const data = JSON.parse(graphJsonText);
  const tags = new Set();
  for (const n of data.nodes || []) if (n && n.repo) tags.add(n.repo);
  return [...tags];
}

export function probeReachable(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    let done = false;
    const finish = (ok) => { if (done) return; done = true; sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test payload/bin/lib/neo4j-config.test.mjs`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add payload/bin/lib/neo4j-config.mjs payload/bin/lib/neo4j-config.test.mjs
git commit -m "feat(graphify-neo4j): config + graph helpers with tests"
```

---

## Task 2: Per-repo prune helper (`graphify-neo4j-prune.py`)

**Files:**
- Create: `payload/bin/graphify-neo4j-prune.py`

**Interfaces:**
- Consumes: `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` from env; repo tags from argv.
- Produces: CLI `python graphify-neo4j-prune.py <tag> [<tag>...]` — exit 0 ok, 2 missing creds, 3 driver missing. Called by Task 3.

This talks to Neo4j, so it is verified against a live/ephemeral instance, not unit-tested.

- [ ] **Step 1: Write the implementation**

```python
#!/usr/bin/env python3
"""Per-repo staleness hygiene: DETACH DELETE all nodes for the given repo tags.

Multi-PC-safe by construction: only repos passed as argv (the tags present in THIS
machine's global graph) are touched, so other machines' repos in the shared Neo4j are
never deleted. Idempotent - deleting a repo with no nodes is a no-op.

Reads NEO4J_URI / NEO4J_USER (default 'neo4j') / NEO4J_PASSWORD from the environment.
Requires the neo4j driver (already a prerequisite for `graphify export neo4j --push`):
    pip install neo4j
"""
import os
import sys


def main(tags):
    uri = os.environ.get("NEO4J_URI")
    user = os.environ.get("NEO4J_USER", "neo4j")
    password = os.environ.get("NEO4J_PASSWORD")
    if not uri or not password:
        print("prune: NEO4J_URI/NEO4J_PASSWORD not set in env", file=sys.stderr)
        return 2
    if not tags:
        print("prune: no repo tags given - nothing to delete")
        return 0
    try:
        from neo4j import GraphDatabase
    except ImportError:
        print("prune: neo4j driver missing - run: pip install neo4j", file=sys.stderr)
        return 3
    driver = GraphDatabase.driver(uri, auth=(user, password))
    try:
        with driver.session() as session:
            for tag in tags:
                count = session.run(
                    "MATCH (n {repo: $tag}) RETURN count(n) AS c", tag=tag
                ).single()["c"]
                session.run("MATCH (n {repo: $tag}) DETACH DELETE n", tag=tag)
                print(f"prune: {tag!r} - {count} node(s) cleared")
    finally:
        driver.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
```

- [ ] **Step 2: Verify it fails cleanly with no creds**

Run: `python payload/bin/graphify-neo4j-prune.py sometag`
Expected: stderr `prune: NEO4J_URI/NEO4J_PASSWORD not set in env`, exit code 2.

- [ ] **Step 3: Verify against a throwaway Neo4j (integration)**

```bash
docker run -d --rm --name n4j-test -p 7688:7687 -e NEO4J_AUTH=neo4j/testpass123 neo4j:5
# wait ~15s for startup, then:
NEO4J_URI=bolt://localhost:7688 NEO4J_USER=neo4j NEO4J_PASSWORD=testpass123 \
  python payload/bin/graphify-neo4j-prune.py demo-repo
```
Expected: `prune: 'demo-repo' - 0 node(s) cleared`, exit 0. Then `docker stop n4j-test`.

- [ ] **Step 4: Commit**

```bash
git add payload/bin/graphify-neo4j-prune.py
git commit -m "feat(graphify-neo4j): per-repo DETACH DELETE prune helper"
```

---

## Task 3: Push orchestrator (`graphify-neo4j-push.mjs`)

**Files:**
- Create: `payload/bin/graphify-neo4j-push.mjs`

**Interfaces:**
- Consumes: all exports of Task 1; `graphify-neo4j-prune.py` (Task 2).
- Produces: CLI `node graphify-neo4j-push.mjs` — exit 0 on success or fail-soft skip; exit 1 only on a real push/prune failure after a reachable connect. Invoked by Task 4.

- [ ] **Step 1: Write the implementation**

```js
#!/usr/bin/env node
// Push the merged global graph to Neo4j, multi-PC-safe.
// Sequence: load config -> reachability probe -> per-repo prune -> MERGE push.
// Fail-soft: missing config / unreachable NAS / no global graph => warn + exit 0.
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadNeo4jConfig, parseBoltHostPort, repoTagsFromGlobalGraph, probeReachable,
  GLOBAL_GRAPH_PATH,
} from "./lib/neo4j-config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const log = (s = "") => process.stdout.write(s + "\n");

const cfg = loadNeo4jConfig();
if (!cfg.ok) { log(`[neo4j-push] skipped: ${cfg.error}`); process.exit(0); }
if (!existsSync(GLOBAL_GRAPH_PATH)) {
  log(`[neo4j-push] skipped: no global graph at ${GLOBAL_GRAPH_PATH} (run graphify-sync-all first)`);
  process.exit(0);
}
const hp = parseBoltHostPort(cfg.config.uri);
if (!hp) { log(`[neo4j-push] skipped: cannot parse NEO4J_URI '${cfg.config.uri}'`); process.exit(0); }

const reachable = await probeReachable(hp.host, hp.port);
if (!reachable) { log(`[neo4j-push] skipped: ${hp.host}:${hp.port} unreachable (fail-soft)`); process.exit(0); }

const tags = repoTagsFromGlobalGraph(readFileSync(GLOBAL_GRAPH_PATH, "utf8"));
const env = {
  ...process.env,
  NEO4J_URI: cfg.config.uri,
  NEO4J_USER: cfg.config.user,
  NEO4J_PASSWORD: cfg.config.password,
};
const py = process.env.GRAPHIFY_PYTHON || "python";

// 1. per-repo prune (staleness hygiene, no global wipe)
log(`[neo4j-push] pruning ${tags.length} repo(s) before push...`);
const prune = spawnSync(py, [join(HERE, "graphify-neo4j-prune.py"), ...tags], { env, encoding: "utf8" });
process.stdout.write(prune.stdout || "");
process.stderr.write(prune.stderr || "");
if (prune.status !== 0) {
  log(`[neo4j-push] prune failed (status ${prune.status}) - aborting push to avoid a stale mix`);
  process.exit(1);
}

// 2. MERGE-push the whole global graph (re-adds this PC's repos fresh)
log(`[neo4j-push] pushing global graph to ${cfg.config.uri}...`);
const push = spawnSync("graphify",
  ["export", "neo4j", "--graph", GLOBAL_GRAPH_PATH, "--push", cfg.config.uri, "--user", cfg.config.user],
  { env, encoding: "utf8" });
process.stdout.write(push.stdout || "");
process.stderr.write(push.stderr || "");
process.exit(push.status === 0 ? 0 : 1);
```

- [ ] **Step 2: Verify the fail-soft path (no config)**

Run (with no `~/.graphify/neo4j.env`): `node payload/bin/graphify-neo4j-push.mjs`
Expected: `[neo4j-push] skipped: config not found: ...neo4j.env`, exit code 0.

- [ ] **Step 3: Verify the unreachable fail-soft path**

```bash
mkdir -p ~/.graphify
printf 'NEO4J_URI=bolt://127.0.0.1:1\nNEO4J_USER=neo4j\nNEO4J_PASSWORD=x\n' > ~/.graphify/neo4j.env
node payload/bin/graphify-neo4j-push.mjs
rm ~/.graphify/neo4j.env
```
Expected: `[neo4j-push] skipped: 127.0.0.1:1 unreachable (fail-soft)`, exit 0.

- [ ] **Step 4: Commit**

```bash
git add payload/bin/graphify-neo4j-push.mjs
git commit -m "feat(graphify-neo4j): push orchestrator (probe + prune + MERGE)"
```

---

## Task 4: Opt-in `--neo4j-push` in `graphify-sync-all.mjs`

**Files:**
- Modify: `payload/graphify-sync-all.mjs`

**Interfaces:**
- Consumes: `graphify-neo4j-push.mjs` (Task 3), invoked via `node` from the same `bin`/dir layout as deployed (`~/.claude/bin/graphify-neo4j-push.mjs`).

- [ ] **Step 1: Add the flag and post-sync push**

At the top, alongside the existing `const INSTALL_HOOKS = flag("--install-hooks");`, add:

```js
const NEO4J_PUSH = flag("--neo4j-push");
```

After the existing `if (!DRY && projects.length) { ... global list ... }` block near the end (just before the final `log(\`\nLog: ${logFile}\`);`), add:

```js
if (NEO4J_PUSH && !DRY) {
  log("\n--- Neo4j push ---");
  const pushScript = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "bin", "graphify-neo4j-push.mjs");
  const r = spawnSync(process.execPath, [pushScript], { encoding: "utf8", stdio: "inherit" });
  if (r.status !== 0) log("(neo4j push reported a non-zero exit - see output above)");
}
```

Note: `graphify-sync-all.mjs` deploys to `~/.claude/` and the push script to `~/.claude/bin/` (per `payload/bin/` → `bin/`), so resolve `bin/graphify-neo4j-push.mjs` relative to this script's own directory.

- [ ] **Step 2: Verify the flag is a no-op without config**

Run: `node payload/graphify-sync-all.mjs --root . --max-depth 1 --neo4j-push --dry-run`
Expected: dry-run summary prints; because `--dry-run` is set, the push block is skipped (guarded by `!DRY`). No crash.

- [ ] **Step 3: Verify push runs (fail-soft) on a real sync**

Run: `node payload/graphify-sync-all.mjs --root . --max-depth 1 --neo4j-push`
Expected: after the sync summary, `--- Neo4j push ---` then the fail-soft skip line (no `~/.graphify/neo4j.env`). Exit 0.

- [ ] **Step 4: Commit**

```bash
git add payload/graphify-sync-all.mjs
git commit -m "feat(graphify-neo4j): opt-in --neo4j-push in graphify-sync-all"
```

---

## Task 5: Neo4j MCP section in `init-mcp.md`

**Files:**
- Modify: `payload/commands/init-mcp.md`

- [ ] **Step 1: Add the section**

Insert a new section after the Postgres section (after the block ending `## 2. Postgres ...`, before `## 3. Web search`):

```markdown
## 2b. Neo4j (opt-in, reads the graphify global graph via Cypher)
- Only if I ask, and only meaningful once the global graph has been pushed to Neo4j (see
  `graphify-neo4j-push.mjs`). This is the READ side of the graphify Neo4j mirror.
- **User scope** (not project) - the global graph is cross-project, so the MCP must be
  available in every repo: `--scope user`.
- Verify the current Cypher MCP package via WebSearch before adding (package names drift);
  the common one is `mcp-neo4j-cypher`. Confirm, then:
  `claude mcp add neo4j --scope user -e NEO4J_URI="bolt://<nas>:7687" -e NEO4J_USERNAME="neo4j" -e NEO4J_PASSWORD="<pw>" -- uvx mcp-neo4j-cypher`
- Reuse the same URI/creds as `~/.graphify/neo4j.env`. Never echo the password back.
- Needs `uv`/`uvx` (see `graphify-setup.mjs --bootstrap-uv` if missing - with consent).
- Verify: `claude mcp list` shows `neo4j` connected; then run a Cypher query
  (`MATCH (n) RETURN count(n)`) - see `payload/graphify-neo4j.cypher` for a cookbook.
- Overlap: graphify (local JSON, per-project) vs this Neo4j MCP (cross-project global graph).
  Rule of thumb: `graphify query` for the current repo, Neo4j MCP for cross-repo questions.
```

Also add `neo4j` to the argument-hint on line 3 and the status summary bullets so `/init-mcp neo4j` jumps here.

- [ ] **Step 2: Verify**

Run: `grep -n "2b. Neo4j" payload/commands/init-mcp.md`
Expected: the new section header prints.

- [ ] **Step 3: Commit**

```bash
git add payload/commands/init-mcp.md
git commit -m "docs(init-mcp): add Neo4j Cypher MCP section (user scope)"
```

---

## Task 6: Cypher read cookbook (`graphify-neo4j.cypher`)

**Files:**
- Create: `payload/graphify-neo4j.cypher`

- [ ] **Step 1: Write the cookbook**

```cypher
// graphify -> Neo4j read cookbook. The global graph is pushed by graphify-neo4j-push.mjs.
// Query by `label` and `repo`, NOT by node id: graphify re-keys ids across rebuilds
// (0.9.0 full-path id change), so ids are not stable across pushes.

// 1. God nodes (highest-degree hubs) across all repos
MATCH (n)
RETURN n.label AS label, n.repo AS repo, count { (n)--() } AS degree
ORDER BY degree DESC
LIMIT 20;

// 2. Neighbors of a concept (parametrize $label)
MATCH (n {label: $label})--(m)
RETURN DISTINCT m.label AS label, m.repo AS repo, m.source_file AS file
LIMIT 50;

// 3. Shortest path between two concepts (cross-repo bridges surface here)
MATCH (a {label: $from}), (b {label: $to}),
      p = shortestPath((a)-[*..8]-(b))
RETURN [x IN nodes(p) | x.label + ' (' + coalesce(x.repo,'?') + ')'] AS hops;

// 4. Which repos does a shared external library connect?
MATCH (lib {label: $lib})--(m)
RETURN DISTINCT m.repo AS repo
ORDER BY repo;

// 5. Everything in one repo (sanity / staleness check)
MATCH (n {repo: $repo})
RETURN count(n) AS nodes;
```

- [ ] **Step 2: Verify syntax against a throwaway Neo4j (optional)**

If a test Neo4j is up (Task 2 Step 3), paste query #1 into `cypher-shell` — expect it to parse (0 rows on an empty DB is fine).

- [ ] **Step 3: Commit**

```bash
git add payload/graphify-neo4j.cypher
git commit -m "docs(graphify-neo4j): Cypher read cookbook (query by label/repo)"
```

---

## Task 7: gsd-agent Cypher/MCP guidance patch

**Files:**
- Modify: `payload/hooks/lib/gsd-agent-patches.mjs`

**Interfaces:**
- Consumes: the existing patch infra in that file — `PATCHES` array, patch shape `{id, version, appliesTo(name, claudeDir), block, insertAnchor, insertMode}`, HTML-comment version markers applied by `apply-gsd-agent-patches.mjs`.

- [ ] **Step 1: Add the block constant and helper**

Near the other `*_BLOCK` consts (e.g. after `CONTEXT_MODE_ROUTING_BLOCK`), add:

```js
const NEO4J_GRAPH_ROUTING_BLOCK = `<neo4j_global_graph_routing>
A Neo4j MCP named \`neo4j\` may hold graphify's merged GLOBAL graph (all repos on this machine),
pushed by graphify-neo4j-push.mjs. When it is configured:
- CROSS-PROJECT / "how does repo A relate to repo B" / "who else uses this library" questions →
  query the \`neo4j\` MCP with Cypher (query by \`label\`/\`repo\`, never by node id — ids are not
  stable across graphify rebuilds). See payload/graphify-neo4j.cypher for canned queries.
- CURRENT-repo questions → keep using \`graphify query "<question>"\` on the local JSON graph.
The local JSON graph stays graphify's source of truth; Neo4j is an additive cross-project mirror.
</neo4j_global_graph_routing>`;

// Neo4j guidance is only useful once the write side is configured on this machine.
import { existsSync as _existsSync } from "node:fs";
import { homedir as _homedir } from "node:os";
import { join as _join } from "node:path";
function isNeo4jConfigured() {
  return _existsSync(_join(_homedir(), ".graphify", "neo4j.env"));
}
```

Note: if the file already imports `existsSync`/`homedir`/`join`, reuse those imports instead of the aliased ones.

- [ ] **Step 2: Add the patch object to `PATCHES`**

Append inside the `PATCHES = [ ... ]` array:

```js
  {
    id: "neo4j-global-graph-routing",
    version: 1,
    // Gated on the write side being configured (neo4j.env present) - otherwise the guidance
    // points agents at an MCP that isn't there. Same anchor as the context-mode routing block.
    appliesTo: (name) => name.startsWith("gsd-") && name.endsWith(".md") && isNeo4jConfigured(),
    block: NEO4J_GRAPH_ROUTING_BLOCK,
    insertAnchor: "</role>", insertMode: "after",
  },
```

- [ ] **Step 3: Verify apply + idempotency**

```bash
mkdir -p ~/.graphify && printf 'NEO4J_URI=bolt://h:7687\nNEO4J_PASSWORD=x\n' > ~/.graphify/neo4j.env
node payload/apply-gsd-agent-patches.mjs
node payload/apply-gsd-agent-patches.mjs   # second run must report no pending patches
rm ~/.graphify/neo4j.env
```
Expected: first run lists `neo4j-global-graph-routing` applied to gsd-* files; second run reports "no pending patches" (idempotent). If `~/.claude/agents/gsd-*.md` aren't present on this machine, the applier reports nothing to patch — that is fine.

- [ ] **Step 4: Commit**

```bash
git add payload/hooks/lib/gsd-agent-patches.mjs
git commit -m "feat(gsd-patches): Neo4j global-graph Cypher routing guidance"
```

---

## Task 8: Neo4j opt-in prompt in `setup.mjs`

**Files:**
- Modify: `setup.mjs`

**Interfaces:**
- Produces: `~/.graphify/neo4j.env` (chmod 600) on opt-in; a `GRAPHIFY_NEO4J` flag in `settings.json.env` recording the decision so re-runs don't re-ask (mirrors `CLAUDE_CONFIG_UPDATE_CHECK`).

- [ ] **Step 1: Add the prompt block**

Immediately AFTER the existing `CLAUDE_CONFIG_UPDATE_CHECK` decision block (the `if (!DRY) { ... }` around lines 693–725), add a sibling block:

```js
  // One-time, machine-wide graphify->Neo4j opt-in (same "decide once" idiom as the update check
  // above). Non-secret decision recorded in settings.json.env; the password is written ONLY to
  // ~/.graphify/neo4j.env (chmod 600), never into the repo or settings.json.
  if (!DRY) {
    let s = {};
    try { s = JSON.parse(readFileSync(SETTINGS, "utf8")); } catch { s = {}; }
    const decided = s.env && "GRAPHIFY_NEO4J" in s.env;
    if (!decided && INTERACTIVE) {
      const a = await ask("\nConfigure graphify -> Neo4j (LAN) for the global knowledge graph? " +
        "Writes connection + password to ~/.graphify/neo4j.env (never committed). [y/N] > ");
      s.env = s.env || {};
      if (a[0] === "y") {
        const uri = (await ask("  Neo4j bolt URI [bolt://localhost:7687] > ")).trim() || "bolt://localhost:7687";
        const user = (await ask("  Neo4j user [neo4j] > ")).trim() || "neo4j";
        const pw = (await ask("  Neo4j password > ")).trim();
        const envPath = join(homedir(), ".graphify", "neo4j.env");
        mkdirSync(dirname(envPath), { recursive: true });
        writeFileSync(envPath, `NEO4J_URI=${uri}\nNEO4J_USER=${user}\nNEO4J_PASSWORD=${pw}\n`);
        try { chmodSync(envPath, 0o600); } catch { /* best-effort on Windows */ }
        s.env.GRAPHIFY_NEO4J = "1";
        if (write(SETTINGS, JSON.stringify(s, null, 2) + "\n"))
          summary.push(`updated  ${SETTINGS} (graphify-neo4j: enabled)`);
        log("  Wrote ~/.graphify/neo4j.env. Next: run '/init-mcp neo4j' (+ restart) for reads, and");
        log("  'node ~/.claude/graphify-sync-all.mjs --neo4j-push' (or the push script) to write.");
      } else {
        s.env.GRAPHIFY_NEO4J = "0";
        if (write(SETTINGS, JSON.stringify(s, null, 2) + "\n"))
          summary.push(`updated  ${SETTINGS} (graphify-neo4j: declined - won't ask again here)`);
      }
    }
  }
```

Confirm `homedir` is imported at the top of `setup.mjs` (it imports from `node:os`); `mkdirSync`, `writeFileSync`, `chmodSync`, `dirname`, `join` are already imported (verified in the file header).

- [ ] **Step 2: Verify the decline path records the flag**

```bash
node setup.mjs --dry-run   # DRY: block is guarded by !DRY, so it must NOT prompt
```
Expected: no Neo4j prompt in a dry run. (Interactive real-run verification is manual — answering "N" should add `"GRAPHIFY_NEO4J": "0"` to `~/.claude/settings.json` env and never ask again.)

- [ ] **Step 3: Commit**

```bash
git add setup.mjs
git commit -m "feat(setup): one-time graphify->Neo4j opt-in (writes ~/.graphify/neo4j.env)"
```

---

## Task 9: graphify freshness nudge (`graphify-freshness.mjs`)

**Files:**
- Create: `payload/bin/graphify-freshness.mjs`
- Test: `payload/bin/graphify-freshness.test.mjs`

**Interfaces:**
- Produces: CLI `node graphify-freshness.mjs` (best-effort nudge, always exit 0) and a testable `cmpSemver(a, b) -> -1|0|1`.

- [ ] **Step 1: Write the failing test**

```js
// payload/bin/graphify-freshness.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { cmpSemver } from "./graphify-freshness.mjs";

test("cmpSemver orders versions", () => {
  assert.equal(cmpSemver("0.9.5", "0.9.22"), -1);
  assert.equal(cmpSemver("0.9.22", "0.9.5"), 1);
  assert.equal(cmpSemver("1.0.0", "0.9.99"), 1);
  assert.equal(cmpSemver("0.9.5", "0.9.5"), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test payload/bin/graphify-freshness.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
#!/usr/bin/env node
// Best-effort: nudge if the installed graphify lags PyPI. Fail-soft: no network / not
// installed / parse error => exit 0 silently. Never blocks setup or init-stack.
import { spawnSync } from "node:child_process";
import { get } from "node:https";

export function cmpSemver(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

function installedVersion() {
  const r = spawnSync("graphify", ["--version"], { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout) return null;
  const m = r.stdout.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

function latestVersion(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req = get("https://pypi.org/pypi/graphifyy/json", (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => { try { resolve(JSON.parse(body).info.version); } catch { resolve(null); } });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
  });
}

async function main() {
  const installed = installedVersion();
  if (!installed) return;                 // graphify not installed -> nothing to nudge
  const latest = await latestVersion();
  if (!latest) return;                    // offline -> silent
  if (cmpSemver(installed, latest) < 0) {
    process.stdout.write(
      `\n[graphify] update available: ${installed} installed, ${latest} on PyPI.\n` +
      `  Upgrade: uv tool upgrade graphifyy  (or: python -m pip install -U graphifyy),\n` +
      `  then run 'graphify install' to refresh the skill files.\n`);
  }
}

// Only run the network path when invoked as a script, not when imported by the test.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("graphify-freshness.mjs")) {
  main().then(() => process.exit(0)).catch(() => process.exit(0));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test payload/bin/graphify-freshness.test.mjs`
Expected: PASS (the guard prevents the network path from running under the test).

- [ ] **Step 5: Verify the live nudge**

Run: `node payload/bin/graphify-freshness.mjs`
Expected: with graphify 0.9.22 installed and 0.9.22 latest → no output, exit 0. (If a newer release exists, the nudge prints.)

- [ ] **Step 6: Commit**

```bash
git add payload/bin/graphify-freshness.mjs payload/bin/graphify-freshness.test.mjs
git commit -m "feat(graphify): best-effort freshness nudge with semver test"
```

---

## Task 10: Wire freshness check into setup.mjs and init-stack

**Files:**
- Modify: `setup.mjs`
- Modify: `payload/commands/init-stack.md`

- [ ] **Step 1: Call from setup.mjs near the final summary**

Just before setup.mjs prints its closing "Step 1..4" guidance (near the end of `main()`), add:

```js
  // Best-effort graphify staleness nudge (never blocks; exits 0 on any error/offline).
  if (!DRY) {
    const fresh = join(CDIR, "bin", "graphify-freshness.mjs");
    if (existsSync(fresh)) spawnSync(process.execPath, [fresh], { stdio: "inherit" });
  }
```

Confirm `spawnSync` is imported (add `import { spawnSync } from "node:child_process";` at the top if not already present) and that `CDIR` points at the deployed `~/.claude` dir (it does — `SETTINGS = join(CDIR, "settings.json")`).

- [ ] **Step 2: Add an init-stack step**

In `payload/commands/init-stack.md`, in the graphify-related step (the step that mentions registering the project in the global graph), add a bullet:

```markdown
- Check graphify freshness (best-effort, non-blocking): run
  `node ~/.claude/bin/graphify-freshness.mjs`. If it prints an update line, tell me the
  upgrade command; never upgrade automatically.
```

- [ ] **Step 3: Verify**

Run: `node payload/bin/graphify-freshness.mjs; echo "exit=$?"`
Expected: `exit=0` regardless of output. Then `grep -n "graphify-freshness" payload/commands/init-stack.md setup.mjs` shows both wirings.

- [ ] **Step 4: Commit**

```bash
git add setup.mjs payload/commands/init-stack.md
git commit -m "feat(setup,init-stack): wire graphify freshness nudge"
```

---

## Task 11: Phase 3 — one-time push of the current global graph (runbook)

**Files:** none (operational). Requires: real NAS bolt URI + creds, `pip install neo4j`, Neo4j reachable.

This is a manual, consent-gated operation, not code.

- [ ] **Step 1: Ensure the neo4j driver is present**

Run: `python -c "import neo4j; print(neo4j.__version__)"`
If it errors: `python -m pip install neo4j`.

- [ ] **Step 2: Write the machine's config (if not done via setup.mjs Task 8)**

```bash
mkdir -p ~/.graphify
printf 'NEO4J_URI=bolt://<nas>:7687\nNEO4J_USER=neo4j\nNEO4J_PASSWORD=<pw>\n' > ~/.graphify/neo4j.env
chmod 600 ~/.graphify/neo4j.env    # no-op on Windows; fine
```

- [ ] **Step 3: Ensure a global graph exists**

Run: `graphify global list`
Expected: one or more repos listed. If empty, run `node ~/.claude/graphify-sync-all.mjs --root <dev-root>` first.

- [ ] **Step 4: Push**

Run: `node ~/.claude/bin/graphify-neo4j-push.mjs`
Expected: `pruning N repo(s)...` (0 cleared on first push into an empty DB) then `pushing global graph...` then graphify's push summary. Exit 0.

- [ ] **Step 5: Verify in Neo4j**

In Neo4j Browser / cypher-shell: `MATCH (n) RETURN count(n);`
Expected: node count ≈ the global graph's node count (`graphify global list` totals). Spot-check cookbook query #1 returns hubs.

---

## Self-Review

**1. Spec coverage:**
- C1 write path → Tasks 1–4 (+ Task 11 push). ✓
- C2 Neo4j MCP → Task 5. ✓
- C3 Cypher cookbook + patch → Tasks 6, 7. ✓
- C4 setup.mjs wiring → Task 8. ✓
- C5 one-time push → Task 11. ✓
- C6 freshness check → Tasks 9, 10. ✓ (refined: standalone `graphify-freshness.mjs` instead of a `--check` mode inside `graphify-setup.mjs` — more testable, less invasive; noted in File Structure.)

**2. Placeholder scan:** `<nas>`/`<pw>` are intentional connection placeholders filled at deploy; no TBD/TODO/"handle edge cases". ✓

**3. Type consistency:** `loadNeo4jConfig` returns `{ok, config:{uri,user,password}}` — consumed exactly so in Task 3. `repoTagsFromGlobalGraph` returns `string[]` — spread into prune argv in Task 3 and the prune reads them from argv in Task 2. `cmpSemver` signature matches between Tasks 9's impl and test. Prune reads `NEO4J_USER`/`NEO4J_URI`/`NEO4J_PASSWORD` — exactly the env the push orchestrator sets. ✓

**Deviation from spec noted:** C6 home changed from "`--check` mode in graphify-setup.mjs" to a standalone `graphify-freshness.mjs` for testability; behavior and call sites (setup.mjs + init-stack) are unchanged.
