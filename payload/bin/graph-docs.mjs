#!/usr/bin/env node
// Harvest the comment above every code symbol in the global graph into one markdown corpus,
// so "have I already written something that does X?" is answerable by words rather than by
// guessing a symbol name. Feed the result to context-mode: ctx_index on the printed path.
//   node graph-docs.mjs --build
// Roughly one code symbol in five carries a comment; the rest stay findable by name through
// graph-find.mjs.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildDocCorpus } from "./lib/doc-corpus.mjs";

const HOME_GRAPHIFY = join(homedir(), ".graphify");
const GRAPH = join(HOME_GRAPHIFY, "global-graph.json");
const MANIFEST = join(HOME_GRAPHIFY, "global-manifest.json");
const OUT = join(HOME_GRAPHIFY, "global-docs.md");
const log = (s = "") => process.stdout.write(s + "\n");

if (!existsSync(GRAPH)) { log(`no global graph at ${GRAPH} (run graphify-sync-all.mjs first)`); process.exit(0); }

const repoRoots = new Map();
if (existsSync(MANIFEST)) {
  let repos = {};
  try { repos = JSON.parse(readFileSync(MANIFEST, "utf8")).repos || {}; } catch { repos = {}; }
  for (const [name, entry] of Object.entries(repos)) {
    const sp = String((entry && entry.source_path) || "").replace(/\\/g, "/");
    const cut = sp.toLowerCase().lastIndexOf("/graphify-out/");
    if (cut > 0) repoRoots.set(name, sp.slice(0, cut));
  }
}
if (!repoRoots.size) { log(`no repo roots in ${MANIFEST} - cannot locate sources`); process.exit(0); }

const started = Date.now();
const graph = JSON.parse(readFileSync(GRAPH, "utf8"));
const cache = new Map();
const readLines = (repo, file) => {
  const key = `${repo} ${file}`;
  if (cache.has(key)) return cache.get(key);
  const root = repoRoots.get(repo);
  let lines = null;
  if (root) { try { lines = readFileSync(join(root, file), "utf8").split(/\r?\n/); } catch { lines = null; } }
  cache.set(key, lines);
  return lines;
};

const corpus = buildDocCorpus(graph.nodes || [], readLines);
writeFileSync(OUT, corpus);

const entries = (corpus.match(/^## /gm) || []).length;
const filesRead = [...cache.values()].filter(Boolean).length;
log(`${entries} documented symbols from ${filesRead} files in ${Date.now() - started} ms`);
log(`${(corpus.length / 1024).toFixed(0)} KB -> ${OUT}`);
log(`index it with context-mode: ctx_index on ${OUT}`);
