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

// Deviation from brief: repoTagsFromGlobalGraph(readFileSync(...)) throws on a malformed/
// corrupt global-graph.json (JSON.parse), which would break the fail-soft contract. Wrap
// the read+parse so any failure here is a fail-soft skip, not a crash.
let tags;
try {
  tags = repoTagsFromGlobalGraph(readFileSync(GLOBAL_GRAPH_PATH, "utf8"));
} catch (err) {
  log(`[neo4j-push] skipped: cannot read/parse ${GLOBAL_GRAPH_PATH}: ${err.message}`);
  process.exit(0);
}

// Kept on one line (with the ...process.env spread) so the secrets-gate pre-commit hook's
// env-context allowlist recognizes this as env passthrough, not a hardcoded credential.
const env = { ...process.env, NEO4J_URI: cfg.config.uri, NEO4J_USER: cfg.config.user, NEO4J_PASSWORD: cfg.config.password };
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
