#!/usr/bin/env node
// Builds the deterministic occurrence inventory the interactive filter-building pass walks.
//
// No filters, no judgement: every occurrence of the upstream name anywhere in the plugin is
// collected. Grouping is by EXACT spelling (the maximal token the name sits inside), not by any
// guess at intent - the shapes are supposed to emerge from the human's decisions, not from mine.
//
// Output is stable across runs (sorted by count desc, then spelling asc) so the session cursor in
// rename-session.json stays meaningful after a restart.
//
// Usage: node scan-inventory.mjs [pluginRoot] [--out <file>]
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, relative, dirname, extname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const outIdx = argv.indexOf("--out");
const OUT = outIdx !== -1 && argv[outIdx + 1] ? argv[outIdx + 1] : join(HERE, "inventory.json");
const ROOT = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--out")
  || join(homedir(), ".claude", "plugins", "cache", "claude-plugins-official", "superpowers", "6.2.0");

const TEXTUAL = /\.(md|mjs|js|cjs|ts|tsx|sh|cmd|bat|txt|html|json|yml|yaml|toml)$/i;
// a token is the maximal run of characters that reads as one "thing" - path, identifier, URL
const TOKEN_CHAR = /[^\s"'`(),\[\]{}<>|]/;

function walk(dir, out = []) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (TEXTUAL.test(e.name) || extname(e.name) === "") out.push(p);
  }
  return out;
}

const groups = new Map();
let total = 0;
const filesWithHits = new Set();

for (const file of walk(ROOT)) {
  let text = "";
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  if (!/superpowers/i.test(text)) continue;
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  filesWithHits.add(rel);

  text.split("\n").forEach((line, i) => {
    const re = /superpowers/gi;
    let m;
    while ((m = re.exec(line)) !== null) {
      total += 1;
      let s = m.index;
      let e = m.index + m[0].length;
      while (s > 0 && TOKEN_CHAR.test(line[s - 1])) s -= 1;
      while (e < line.length && TOKEN_CHAR.test(line[e])) e += 1;
      const spelling = line.slice(s, e);
      // case-sensitive: `Superpowers` and `superpowers` are different spellings and take
      // different replacements, so they must be decided separately
      const key = spelling;
      if (!groups.has(key)) groups.set(key, { spelling, count: 0, files: new Set(), samples: [] });
      const g = groups.get(key);
      g.count += 1;
      g.files.add(rel);
      if (g.samples.length < 3) g.samples.push({ file: rel, line: i + 1, text: line.trim().slice(0, 200) });
    }
  });
}

const items = [...groups.entries()]
  .map(([key, g]) => ({
    key,
    spelling: g.spelling,
    count: g.count,
    fileCount: g.files.size,
    files: [...g.files].sort().slice(0, 12),
    samples: g.samples,
  }))
  .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

const inventory = {
  pluginRoot: ROOT,
  scannedAt: null, // stamped by the caller; kept null so re-scans stay byte-comparable
  totals: { occurrences: total, filesWithHits: filesWithHits.size, spellings: items.length },
  items,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(inventory, null, 2) + "\n", "utf8");
console.log(`occurrences ${total} | files ${filesWithHits.size} | spellings ${items.length} -> ${OUT}`);
