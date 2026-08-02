#!/usr/bin/env node
// Cross-project symbol lookup over graphify's global graph.
//   node graph-find.mjs "<symbol>"   answer from the index (~20 ms)
//   node graph-find.mjs --build      rebuild the index from ~/.graphify/global-graph.json
// The index is a flat TSV beside the graph. A missing or stale index is rebuilt on demand,
// so the first query after a sync pays the rebuild and every later one does not.
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildIndex, queryIndex } from "./lib/global-index.mjs";

const GRAPH = join(homedir(), ".graphify", "global-graph.json");
const INDEX = join(homedir(), ".graphify", "global-index.tsv");
const log = (s = "") => process.stdout.write(s + "\n");

function rebuild() {
  if (!existsSync(GRAPH)) { log(`no global graph at ${GRAPH} (run graphify-sync-all.mjs first)`); return false; }
  const text = buildIndex(JSON.parse(readFileSync(GRAPH, "utf8")));
  writeFileSync(INDEX, text);
  return true;
}

const stale = () => !existsSync(INDEX)
  || (existsSync(GRAPH) && statSync(INDEX).mtimeMs < statSync(GRAPH).mtimeMs);

const argv = process.argv.slice(2);
if (argv.includes("--build")) {
  const started = Date.now();
  if (!rebuild()) process.exit(0);
  const rows = readFileSync(INDEX, "utf8").split("\n").length - 1;
  log(`indexed ${rows} symbols in ${Date.now() - started} ms -> ${INDEX}`);
  process.exit(0);
}

const needle = argv.filter((a) => !a.startsWith("--")).join(" ").trim();
if (!needle) { log('usage: graph-find.mjs "<symbol>"  |  graph-find.mjs --build'); process.exit(0); }

if (stale() && !rebuild()) process.exit(0);

const limitArg = argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice(8)) || 20 : 20;
const hits = queryIndex(readFileSync(INDEX, "utf8"), needle, { limit });
if (!hits.length) { log(`no symbol matching "${needle}" in the global graph`); process.exit(0); }

for (const h of hits) {
  const where = h.repos.length > 1 ? `${h.repos[0]} (+${h.repos.length - 1} more)` : h.repos[0] || "?";
  log(`${h.label}  ${h.file}${h.location ? ":" + h.location : ""}  [${where}]`);
}
